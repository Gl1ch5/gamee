import { entityTypes, tileTypes } from './registry.js';
import { overlaps } from './physics.js';

/**
 * Мир уровня: сетка тайлов + сущности + каналы сигналов.
 * Состояние мира целиком сериализуется в снимки (snapshot/restore),
 * на этом построены перемотка, петли и откат.
 */
export class World {
  constructor(level, { echoes = [] } = {}) {
    this.level = level;
    this.width = level.width;
    this.height = level.height;
    this.grid = [];
    for (let r = 0; r < this.height; r++) {
      const row = level.tiles[r] || '';
      const out = [];
      for (let c = 0; c < this.width; c++) out.push(row[c] || '.');
      this.grid.push(out);
    }
    this.entities = [];
    this.channels = new Set();
    this.tick = 0;
    this.globalScale = 1;
    this.input = 0;
    this.events = [];
    this.player = null;
    this.won = false;
    this.shardsTotal = 0;

    level.entities.forEach((d, i) => {
      const t = entityTypes.get(d.type);
      if (!t) {
        console.warn(`Неизвестный тип сущности «${d.type}» — пропущен (не подключён мод?)`);
        return;
      }
      const ent = new t.cls(this, { ...d, id: d.id || `e${i}` }, t);
      this.entities.push(ent);
      if (d.type === 'player' && !this.player) this.player = ent;
      if (d.type === 'shard') this.shardsTotal++;
    });

    if (this.player) {
      const P = this.player.constructor;
      echoes.forEach((rec, i) => {
        const def = { ...this.player.def, id: `echo${i}`, type: 'player' };
        const e = new P(this, def, this.player.typeDef, { echo: true, recording: rec, echoIndex: i });
        this.entities.push(e);
      });
    }
    this.entities.sort((a, b) => a.order - b.order);
    for (const e of this.entities) e.init();
  }

  // ---------- тайлы ----------
  /** cy — мировая строка (0 = низ) */
  tileAt(cx, cy) {
    if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height) return null;
    return tileTypes.get(this.grid[this.height - 1 - cy][cx]) || null;
  }

  solidsIn(rect, exclude) {
    const out = [];
    const x0 = Math.floor(rect.l), x1 = Math.floor(rect.r - 1e-6);
    const y0 = Math.floor(rect.b), y1 = Math.floor(rect.t - 1e-6);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (cx < 0 || cx >= this.width) {
          if (cy < this.height + 6) out.push({ l: cx, b: cy, r: cx + 1, t: cy + 1, oneWay: false });
          continue;
        }
        const t = this.tileAt(cx, cy);
        if (!t) continue;
        if (t.solid) out.push({ l: cx, b: cy, r: cx + 1, t: cy + 1, oneWay: false });
        else if (t.oneWay) out.push({ l: cx, b: cy + 0.75, r: cx + 1, t: cy + 1, oneWay: true });
      }
    }
    for (const e of this.entities) {
      if (e === exclude || !e.alive) continue;
      const s = e.solid();
      if (s && overlaps(rect, s)) out.push(s.ent ? s : { ...s, ent: e });
    }
    return out;
  }

  hazardHit(rect) {
    const x0 = Math.floor(rect.l), x1 = Math.floor(rect.r - 1e-6);
    const y0 = Math.floor(rect.b), y1 = Math.floor(rect.t - 1e-6);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const t = this.tileAt(cx, cy);
        if (t && t.hazard && overlaps(rect, { l: cx + 0.15, b: cy, r: cx + 0.85, t: cy + 0.45 })) return true;
      }
    }
    for (const e of this.entities) {
      if (!e.alive) continue;
      const h = e.hazard();
      if (h && overlaps(rect, h)) return true;
    }
    return false;
  }

  // ---------- каналы ----------
  emitChannel(name) {
    if (name) this.channels.add(String(name));
  }
  /** "a" | "a,b" (все должны быть включены) | "" (всегда true) */
  isOn(spec) {
    if (!spec) return true;
    return String(spec).split(',').map((s) => s.trim()).filter(Boolean).every((c) => this.channels.has(c));
  }

  emit(type, data = {}) {
    if (!this.muted) this.events.push({ type, ...data });
  }

  zones() {
    return this.entities.filter((e) => e.isZone && e.alive && e.active());
  }

  scaleFor(e, zones) {
    let s = e.timeImmune ? 1 : this.globalScale;
    if (!e.ignoreZones && s > 0) {
      const b = e.bounds();
      const px = (b.l + b.r) / 2, py = (b.b + b.t) / 2;
      for (const z of zones) if (z.contains(px, py)) s *= z.props.scale;
    }
    return s;
  }

  /** Один фиксированный шаг симуляции. filter — для шага только «якорных» объектов во время перемотки. */
  step(dt, filter = null) {
    this.tick++;
    const zones = this.zones();
    this.channels.clear();
    for (const e of this.entities) if (e.alive) e.signal();
    for (const e of this.entities) {
      if (!e.alive || (filter && !filter(e))) continue;
      e.timeScale = this.scaleFor(e, zones);
      if (e.timeScale <= 0) continue;
      const sdt = dt * e.timeScale;
      e.localTime += sdt;
      e.update(sdt, dt);
    }
  }

  snapshot() {
    return { tick: this.tick, won: this.won, ents: this.entities.map((e) => e.getState()) };
  }

  restore(snap, { skipAnchored = true } = {}) {
    this.tick = snap.tick;
    this.won = snap.won;
    snap.ents.forEach((s, i) => {
      const e = this.entities[i];
      if (!e || (skipAnchored && e.anchored)) return;
      e.setState(s);
    });
  }

  /** Перенос состояния «якорных» (золотых) объектов при перезапуске петли. */
  carryAnchoredFrom(old) {
    for (const e of this.entities) {
      if (!e.anchored) continue;
      const o = old.entities.find((x) => x.id === e.id);
      if (o) e.setState(o.getState());
    }
  }

  countShards() {
    return this.entities.filter((e) => e.type === 'shard' && e.collected).length;
  }
}
