// Детерминированная симуляция: мир, время (петли, призраки, перемотка, замедление, зоны), физика.
import { getExpr, makeUserFn } from './expr.js';
import { resolveDef } from './types.js';

export const DT = 1 / 60;
export const PW = 0.7;
export const PH = 0.95;
const EPS = 1e-6;

const overlap = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 - EPS && Math.abs(a.y - b.y) < (a.h + b.h) / 2 - EPS;

function moveX(b, dx, solids) {
  if (!dx) return null;
  const x0 = b.x;
  b.x += dx;
  let hit = null;
  for (const s of solids) {
    if (!overlap(b, s)) continue;
    if (overlap({ x: x0, y: b.y, w: b.w, h: b.h }, s)) continue;
    b.x = dx > 0 ? s.x - s.w / 2 - b.w / 2 : s.x + s.w / 2 + b.w / 2;
    hit = s;
  }
  return hit;
}
function moveY(b, dy, solids) {
  if (!dy) return null;
  const y0 = b.y;
  b.y += dy;
  let hit = null;
  for (const s of solids) {
    if (!overlap(b, s)) continue;
    if (overlap({ x: b.x, y: y0, w: b.w, h: b.h }, s)) continue;
    b.y = dy > 0 ? s.y - s.h / 2 - b.h / 2 : s.y + s.h / 2 + b.h / 2;
    hit = s;
  }
  return hit;
}
// выталкивает тело из пересечений; true — раздавлено
function depenetrate(b, solids) {
  for (let pass = 0; pass < 2; pass++) {
    for (const s of solids) {
      if (!overlap(b, s)) continue;
      const ox = (b.w + s.w) / 2 - Math.abs(b.x - s.x);
      const oy = (b.h + s.h) / 2 - Math.abs(b.y - s.y);
      if (ox < oy) b.x += Math.sign(b.x - s.x || 1) * ox; else b.y += Math.sign(b.y - s.y || 1) * oy;
    }
  }
  return solids.some((s) => overlap({ x: b.x, y: b.y, w: b.w * 0.6, h: b.h * 0.6 }, s));
}

class Entity {
  constructor(world, spec, i) {
    this.world = world; this.spec = spec; this.i = i;
    this.type = spec.type;
    this.def = resolveDef(spec.type, world.level.types);
    const d = this.def.defaults || {};
    this.id = String(spec.id ?? d.id ?? '').replace(/[^\w$]/g, '_');
    this.x = spec.x ?? 0; this.y = spec.y ?? 0;
    this.w = spec.w ?? d.w ?? 1; this.h = spec.h ?? d.h ?? 1;
    this.scope = Object.create(world.scope);
    Object.assign(this.scope, this.def.params || {}, spec.params || {});
    Object.assign(this.scope, { x0: this.x, y0: this.y, w: this.w, h: this.h, i, t: 0 });
    this.s = { clock: 0, x: this.x, y: this.y, dx: 0, dy: 0, w: this.w, h: this.h };
  }
  get(k) { const v = this.spec[k]; return v === undefined ? this.def.defaults?.[k] ?? this.def.props?.[k]?.default : v; }
  num(k) { const v = Number(this.get(k)); return Number.isFinite(v) ? v : 0; }
  ev(k) { const v = getExpr(this.get(k)).fn(this.scope); return Number.isFinite(v) ? v : 0; }
}

export class World {
  constructor(level, opts = {}) {
    this.editing = !!opts.editing;
    this.load(level);
  }

  load(level) {
    this.level = level;
    this.scope = { $f: {} };
    this.defVars = [];
    for (const [key, src] of Object.entries(level.defs || {})) {
      const m = /^\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*$/.exec(key);
      if (m) this.scope.$f[m[1]] = makeUserFn(m[2].split(',').map((s) => s.trim()).filter(Boolean), src);
      else this.defVars.push([key.trim(), src]);
    }
    this.rules = { gravity: '34', speed: '7.5', jump: '13.5', timeScale: '1', maxGhosts: 3, ...(level.rules || {}) };
    this.entities = (level.entities || []).map((spec, i) => new Entity(this, spec, i));
    this.zones = this.entities.filter((e) => e.def.isZone);
    this.boxes = this.entities.filter((e) => e.def.dynamic);
    this.byId = {};
    for (const e of this.entities) if (e.id) this.byId[e.id] = e;
    const sp = this.entities.find((e) => e.type === 'spawn');
    this.spawn = sp ? { x: sp.x, y: sp.y } : { x: level.spawn?.[0] ?? 0, y: level.spawn?.[1] ?? 1 };
    this.loopLen = Number(level.loop ?? 10) || 0;
    this.bounds = level.bounds || this.computeBounds();
    this.collected = new Set();
    this.ghosts = [];
    this.loopIdx = 1;
    this.totalTime = 0;
    this.energy = 100;
    this.G = 34;
    this.solids = [];
    this.exhausted = false;
    this.won = null;
    this.events = [];
    this.fx = { rewind: false, slow: false, fast: false };
    this.resetLoop();
  }

  computeBounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of this.entities) {
      if (e.type === 'text') continue;
      x0 = Math.min(x0, e.x - e.w / 2); x1 = Math.max(x1, e.x + e.w / 2);
      y0 = Math.min(y0, e.y - e.h / 2); y1 = Math.max(y1, e.y + e.h / 2);
    }
    if (!isFinite(x0)) { x0 = -10; x1 = 10; y0 = -6; y1 = 10; }
    return [x0 - 3, y0 - 6, x1 + 3, y1 + 6];
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  addEnergy(n) { this.energy = Math.min(100, this.energy + n); }
  crystalCount() { let n = 0; for (const e of this.entities) if (e.type === 'crystal' && e.s.got) n++; return n; }
  win() { if (!this.won) { this.won = { loops: this.loopIdx, time: this.totalTime }; this.emit('win', { x: this.player.x, y: this.player.y }); } }

  resetLoop() {
    this.T = 0;
    this.hist = [];
    this.rec = [];
    this.bubbles = [];
    this.dying = null;
    this.rewindSpeed = 2;
    this.player = { x: this.spawn.x, y: this.spawn.y, w: PW, h: PH, vx: 0, vy: 0, face: 1, grounded: false, coyote: 0, jumpBuf: 0, alive: true, jumping: false };
    this.refreshScope(1);
    for (const e of this.entities) {
      e.s = { clock: 0, x: e.x, y: e.y, dx: 0, dy: 0, w: e.w, h: e.h };
      e.def.reset?.(e, this);
    }
    this.hist.push(this.snapshot());
  }

  refreshScope(Ts) {
    const sc = this.scope, p = this.player;
    sc.T = this.T; sc.t = this.T; sc.loop = this.loopIdx; sc.ghosts = this.ghosts.length;
    sc.crystals = this.entities ? this.crystalCount() : 0;
    sc.px = p.x; sc.py = p.y; sc.pvx = p.vx; sc.pvy = p.vy; sc.speed = Ts;
    sc.looplen = this.loopLen;
    if (this.entities) for (const e of this.entities) if (e.id && e.def.signal) sc[e.id] = e.def.signal(e);
    for (const [name, src] of this.defVars) sc[name] = getExpr(src).fn(sc);
  }
  rule(name, fallback) {
    const v = getExpr(this.rules[name]).fn(this.scope);
    return Number.isFinite(v) ? v : fallback;
  }

  snapshot() {
    return {
      T: this.T, p: { ...this.player }, ents: this.entities.map((e) => ({ ...e.s })), bub: this.bubbles.map((b) => ({ ...b })),
    };
  }
  restore(sn) {
    this.T = sn.T; this.player = { ...sn.p };
    this.entities.forEach((e, i) => { e.s = { ...sn.ents[i] }; });
    this.bubbles = sn.bub.map((b) => ({ ...b }));
  }

  zoneScaleAt(x, y, forPlayer) {
    let k = 1;
    for (const z of this.zones) {
      if (forPlayer && z.get('playerToo') === false) continue;
      if (Math.abs(x - z.s.x) < z.w / 2 && Math.abs(y - z.s.y) < z.h / 2) k *= z.s.scale;
    }
    for (const b of this.bubbles) {
      if (forPlayer && b.playerToo === false) continue;
      if (Math.abs(x - b.x) < b.w / 2 && Math.abs(y - b.y) < b.h / 2) k *= b.scale;
    }
    return k;
  }

  allSolids(exclude) {
    const out = this.solids.slice();
    for (const b of this.boxes) if (b !== exclude) out.push({ x: b.s.x, y: b.s.y, w: b.w, h: b.h, e: b });
    return out;
  }

  supportOf(b, solids, gdir) {
    const probe = { x: b.x, y: b.y + gdir * 0.06, w: b.w, h: b.h };
    for (const s of solids) if (overlap(probe, s) && !overlap(b, s)) return s;
    return null;
  }

  physicsBox(e, dt) {
    const s = e.s, G = this.G, gdir = G >= 0 ? -1 : 1;
    const x0 = s.x, y0 = s.y;
    const solids = this.allSolids(e);
    const sup = this.supportOf(s, solids, gdir);
    if (sup && sup.e) { moveX(s, sup.e.s.dx || 0, solids); moveY(s, sup.e.s.dy || 0, solids); }
    s.vy = Math.max(-22, Math.min(22, s.vy - G * dt));
    const hit = moveY(s, s.vy * dt, solids);
    if (hit && Math.sign(s.vy) === gdir) s.vy = 0; else if (hit) s.vy = 0;
    depenetrate(s, solids);
    s.dx = s.x - x0; s.dy = s.y - y0;
  }

  // ---------- основной шаг ----------
  step(input) {
    this.events.length = 0;
    if (this.won) { this.fx = { rewind: false, slow: false, fast: false }; return; }
    this.fx = { rewind: false, slow: false, fast: false };

    // смерть -> автоперемотка
    if (this.dying) { this.autoRewind(); return; }

    const canUse = this.energy > 0 && !this.exhausted;
    if (input.rewind && canUse && this.hist.length > 1) {
      this.energy = Math.max(0, this.energy - 26 * DT);
      this.rewindSpeed = Math.min(6, this.rewindSpeed + DT * 3);
      this.doRewind(Math.round(this.rewindSpeed));
      if (this.energy <= 0) this.exhausted = true;
      return;
    }
    this.rewindSpeed = 2;

    let Ts = Math.max(0, Math.min(5, this.rule('timeScale', 1)));
    if (input.slow && canUse) { Ts *= 0.3; this.energy = Math.max(0, this.energy - 20 * DT); this.fx.slow = true; }
    else if (input.fast && canUse) { Ts *= 2.5; this.energy = Math.max(0, this.energy - 16 * DT); this.fx.fast = true; }
    else if (!input.rewind) this.energy = Math.min(100, this.energy + 10 * DT);
    if (this.energy <= 0) this.exhausted = true; else if (this.exhausted && this.energy >= 20) this.exhausted = false;

    if (input.freeze && this.energy >= 30 && !this.exhausted) {
      this.energy -= 30;
      const p = this.player;
      this.bubbles.push({ x: p.x, y: p.y, w: 7, h: 6, ttl: 4, ttl0: 4, scale: 0, playerToo: false });
      this.emit('freeze', { x: p.x, y: p.y });
    }
    if (input.endLoop && this.loopLen > 0) { this.newLoop(); return; }

    const dtw = DT * Ts;
    this.T += dtw;
    this.totalTime += DT;
    this.refreshScope(Ts);
    this.G = this.rule('gravity', 34);

    for (const b of this.bubbles) b.ttl -= DT;
    this.bubbles = this.bubbles.filter((b) => b.ttl > 0);

    for (const z of this.zones) z.def.update(z, this, dtw);
    for (const e of this.entities) {
      if (e.def.isZone || e.def.dynamic || !e.def.update) continue;
      e.def.update(e, this, dtw * this.zoneScaleAt(e.s.x, e.s.y, false));
    }
    this.solids = [];
    for (const e of this.entities) { const r = e.def.solid && !e.def.dynamic ? e.def.solid(e, this) : null; if (r) this.solids.push(r); }
    for (const e of this.boxes) e.def.update(e, this, dtw * this.zoneScaleAt(e.s.x, e.s.y, false));

    this.stepPlayer(input);

    // запись призрака (индекс по мировому времени T)
    const p = this.player;
    if (p.alive) {
      const idx = Math.floor(this.T / DT + 1e-6);
      const fr = [p.x, p.y, p.face, p.vy, p.grounded ? 1 : 0];
      while (this.rec.length < idx) this.rec.push(this.rec[this.rec.length - 1] || fr);
      this.rec[idx] = fr;
    }

    // датчики и опасности
    const bodies = this.bodies();
    for (const e of this.entities) if (e.def.sense) e.def.sense(e, this, bodies, DT);
    if (p.alive && !this.won) this.checkHazards();

    if (p.alive) this.hist.push(this.snapshot());
    if (this.hist.length > 4000) this.hist.shift();

    if (!this.dying && this.loopLen > 0 && this.T >= this.loopLen) this.newLoop();
  }

  bodies() {
    const out = [];
    const p = this.player;
    if (p.alive) out.push({ x: p.x, y: p.y, w: p.w, h: p.h, kind: 'player' });
    for (const g of this.ghosts) { const f = this.ghostFrame(g); out.push({ x: f[0], y: f[1], w: PW, h: PH, kind: 'ghost' }); }
    for (const b of this.boxes) out.push({ x: b.s.x, y: b.s.y, w: b.w, h: b.h, kind: 'box' });
    return out;
  }

  ghostFrame(g) {
    const idx = Math.min(g.frames.length - 1, Math.max(0, Math.floor(this.T / DT + 1e-6)));
    return g.frames[idx];
  }

  stepPlayer(input) {
    const p = this.player;
    if (!p.alive) return;
    const pz = Math.max(0.15, Math.min(3, this.zoneScaleAt(p.x, p.y, true)));
    const dt = DT * pz;
    const G = this.G, gdir = G >= 0 ? -1 : 1, up = -gdir;
    const speed = this.rule('speed', 7.5), jumpV = this.rule('jump', 13.5);
    const solids = this.allSolids();

    // перенос движущейся опорой
    const sup = this.supportOf(p, solids, gdir);
    if (sup && sup.e) { moveX(p, sup.e.s.dx || 0, solids); moveY(p, sup.e.s.dy || 0, solids); }

    const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (ax) p.face = ax;
    const accel = ax ? (p.grounded ? 80 : 50) : (p.grounded ? 90 : 18);
    const target = ax * speed;
    p.vx += Math.max(-accel * dt, Math.min(accel * dt, target - p.vx));

    p.coyote = p.grounded ? 0.11 : Math.max(0, p.coyote - dt);
    p.jumpBuf = input.jumpPressed ? 0.12 : Math.max(0, p.jumpBuf - dt);
    if (p.jumpBuf > 0 && p.coyote > 0) {
      p.vy = up * jumpV; p.jumpBuf = 0; p.coyote = 0; p.jumping = true; p.grounded = false;
      this.emit('jump', { x: p.x, y: p.y + gdir * PH / 2 });
    }
    if (p.jumping && !input.jump && p.vy * up > 0) { p.vy *= 0.5; p.jumping = false; }
    p.vy = Math.max(-22, Math.min(22, p.vy - G * dt));

    // толкаем ящики
    const dx = p.vx * dt;
    if (dx) {
      const test = { x: p.x + dx, y: p.y, w: p.w, h: p.h };
      for (const b of this.boxes) {
        if (overlap(test, { x: b.s.x, y: b.s.y, w: b.w, h: b.h }) && Math.abs(p.y - b.s.y) < (p.h + b.h) / 2 - 0.15) {
          const bx = b.s.x;
          moveX(b.s, dx, this.allSolids(b));
          b.s.dx += b.s.x - bx;
        }
      }
    }
    const solids2 = this.allSolids();
    if (moveX(p, dx, solids2)) p.vx = 0;
    const preVy = p.vy;
    const hitY = moveY(p, p.vy * dt, solids2);
    if (hitY) { if (Math.sign(p.vy) === gdir) { /* приземление */ } p.vy = 0; }
    const crushed = depenetrate(p, this.allSolids());
    const was = p.grounded;
    p.grounded = !!this.supportOf(p, this.allSolids(), gdir);
    if (p.grounded && p.vy * gdir > 0) p.vy = 0;
    if (p.grounded) p.jumping = false;
    if (!was && p.grounded && Math.abs(preVy) > 5) this.emit('land', { x: p.x, y: p.y + gdir * PH / 2, v: Math.abs(preVy) });

    const [bx0, by0, bx1, by1] = this.bounds;
    if (crushed || p.x < bx0 - 2 || p.x > bx1 + 2 || p.y < by0 - 2 || p.y > by1 + 2) this.die();
  }

  checkHazards() {
    const p = this.player;
    const pr = { x: p.x, y: p.y, w: p.w * 0.7, h: p.h * 0.75 };
    for (const e of this.entities) {
      if (!e.def.hazard) continue;
      const h = e.def.hazard(e, this);
      if (!h) continue;
      if (h.r !== undefined) {
        const cx = Math.max(pr.x - pr.w / 2, Math.min(h.x, pr.x + pr.w / 2));
        const cy = Math.max(pr.y - pr.h / 2, Math.min(h.y, pr.y + pr.h / 2));
        if (Math.hypot(cx - h.x, cy - h.y) < h.r) return this.die();
      } else if (overlap(pr, h)) return this.die();
    }
  }

  die() {
    const p = this.player;
    if (!p.alive) return;
    p.alive = false;
    this.emit('death', { x: p.x, y: p.y });
    this.dying = { target: Math.max(0, this.T - 2.2) };
  }

  autoRewind() {
    this.fx.rewind = true;
    this.doRewind(7, true);
    if (this.hist.length <= 1 || this.T <= this.dying.target) { this.dying = null; this.emit('respawn', { x: this.player.x, y: this.player.y }); }
  }

  doRewind(k, quiet) {
    for (let i = 0; i < k && this.hist.length > 1; i++) this.hist.pop();
    this.restore(this.hist[this.hist.length - 1]);
    this.fx.rewind = true;
    this.refreshScope(1);
    if (!quiet) this.emit('rewind', { x: this.player.x, y: this.player.y });
  }

  newLoop() {
    const n = Math.floor(this.T / DT + 1e-6) + 1;
    const frames = this.rec.slice(0, Math.max(1, n));
    if (frames.length) this.ghosts.push({ frames });
    while (this.ghosts.length > Math.max(0, Math.floor(this.rule('maxGhosts', 3)))) this.ghosts.shift();
    for (const e of this.entities) if (e.type === 'crystal' && e.s.got) this.collected.add(e.i);
    this.loopIdx++;
    this.emit('loop', { x: this.player.x, y: this.player.y, loop: this.loopIdx });
    this.resetLoop();
  }

  restartLevel() { const ev = this.events; this.load(this.level); this.events = ev; }

  // предпросмотр положения всех объектов в момент T (для редактора)
  evalStatic(T) {
    this.T = T;
    this.player = { ...this.player, x: this.spawn.x, y: this.spawn.y };
    this.refreshScope(1);
    this.G = this.rule('gravity', 34);
    for (const e of this.entities) e.s.clock = T;
    for (const z of this.zones) z.def.update(z, this, 0);
    for (const e of this.entities) {
      if (e.def.isZone) continue;
      if (e.def.preview) e.def.preview(e, this, T);
      else if (e.def.update && !e.def.dynamic) e.def.update(e, this, 0);
    }
  }
}
