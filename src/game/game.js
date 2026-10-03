import { lerp, DT } from '../engine/constants.js';
import { WorldView } from '../render/worldView.js';
import { shared } from '../render/materials.js';
import { Chronos } from './chronos.js';
import { abilityTypes } from '../engine/registry.js';
import { Hud } from './hud.js';
import { sfx } from './audio.js';

/** Игровой экран: Chronos (логика времени) + WorldView (графика) + HUD. */
export class Game {
  constructor(app, level, { packName = '', onExit, onWin, onNext, testMode = false } = {}) {
    this.app = app;
    this.level = level;
    this.packName = packName;
    this.onExit = onExit;
    this.onWin = onWin;
    this.onNext = onNext;
    this.testMode = testMode;
    this.input = app.input;
    this.view = new WorldView(app.renderer);
    this.acc = 0;
    this.paused = false;
    this.finished = false;
    this.fxState = { rewind: 0, stop: 0, slow: 0, flash: 0, wipe: 1, death: 0 };
    let tilesBuilt = false;
    this.chronos = new Chronos(level, {
      onWorld: (world, { carry }) => {
        this.view.setWorld(world, { rebuildTiles: !tilesBuilt });
        tilesBuilt = true;
      },
      onFx: (name, data) => this.fx(name, data),
    });
    this.hud = new Hud(app.ui, this);
    const p = this.world.player;
    this.view.follow(p?.x ?? 0, p?.y ?? 0, 1, true);
    if (level.intro) this.hud.banner(level.intro, 'intro', 4);
  }

  // фасад для HUD и способностей
  get world() { return this.chronos.world; }
  get vars() { return this.chronos.vars; }
  get history() { return this.chronos.history; }
  get recordings() { return this.chronos.recordings; }
  get loopTime() { return this.chronos.loopTime; }
  get rewinding() { return this.chronos.rewinding; }
  get abilities() { return this.chronos.abilities; }

  fx(name, data = {}) {
    const hud = this.hud;
    const p = this.world?.player;
    switch (name) {
      case 'loop':
        this.fxState.wipe = 0.6;
        this.fxState.flash = 0.6;
        this.view.onEvent({ type: 'loop' });
        hud?.banner(`ПЕТЛЯ ${data.n}`, 'loop', 1.4);
        break;
      case 'restart':
        this.fxState.wipe = 0.7;
        hud?.banner(data.clear ? 'заново' : 'ещё раз', '', 0.8);
        break;
      case 'rewindStart':
        hud?.banner('◀◀ ПЕРЕМОТКА', 'rewind', 0.3);
        return;
      case 'rewindEnd':
        sfx.rewind(false);
        return;
      case 'stop':
        if (p) this.view.onEvent({ type: 'stop', x: p.x, y: p.y });
        hud?.banner('СТОП-КАДР', 'stop', 1);
        break;
      case 'slow':
        hud?.banner('замедление', 'slow', 1);
        break;
      case 'denied':
        hud?.banner('не хватает энергии', 'denied', 0.8);
        break;
      default:
    }
    sfx.play(name, data);
  }

  tick() {
    const inp = this.input;
    inp.poll();
    if (inp.pressed('pause')) return this.togglePause();
    if (this.paused || this.finished) return;
    const r = this.chronos.tick(inp);
    if (this.chronos.rewinding) {
      this.hud.bannerT = 0.25;
      sfx.rewind(true, this.chronos.rewindSpeed);
    }
    if (r === 'win') this.win();
  }

  win() {
    this.finished = true;
    const got = this.world.countShards();
    const total = this.world.shardsTotal;
    const res = { shards: got, total, loops: this.recordings.length + 1 };
    this.onWin?.(res);
    setTimeout(() => {
      if (this.disposed) return;
      const panel = this.hud.showPanel(`
        <div class="win-card sketch-box pop">
          <h2 class="scribble">Уровень пройден!</h2>
          ${total ? `<p class="win-shards">${'⏳'.repeat(got)}<span class="dim">${'⏳'.repeat(total - got)}</span></p>` : ''}
          <p>Петель: ${res.loops}</p>
          <div class="row">
            ${this.testMode ? '<button class="btn" data-a="back">В редактор</button>' : ''}
            <button class="btn" data-a="retry">Ещё раз</button>
            ${!this.testMode && this.onNext ? '<button class="btn primary" data-a="next">Дальше →</button>' : ''}
            ${!this.testMode ? '<button class="btn" data-a="menu">Меню</button>' : ''}
          </div>
        </div>`);
      panel.onclick = (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        sfx.play('ui');
        if (a === 'retry') { this.finished = false; this.hud.hidePanel(); this.chronos.restart(true); }
        if (a === 'next') this.onNext();
        if (a === 'menu' || a === 'back') this.onExit();
      };
      panel.querySelector('.primary, [data-a=back]')?.focus();
    }, 900);
  }

  togglePause() {
    this.paused = !this.paused;
    sfx.rewind(false);
    if (!this.paused) return this.hud.hidePanel();
    const panel = this.hud.showPanel(`
      <div class="pause-card sketch-box pop">
        <h2 class="scribble">Пауза</h2>
        <div class="col">
          <button class="btn primary" data-a="resume">Продолжить</button>
          <button class="btn" data-a="restart">Начать уровень заново</button>
          <button class="btn" data-a="mute">${sfx.muted ? 'Включить звук' : 'Выключить звук'}</button>
          <button class="btn" data-a="exit">${this.testMode ? 'Назад в редактор' : 'Выйти в меню'}</button>
        </div>
        <div class="controls-mini">${this.controlsHtml()}</div>
      </div>`);
    panel.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      sfx.play('ui');
      if (a === 'resume') this.togglePause();
      if (a === 'restart') { this.togglePause(); this.chronos.restart(true); }
      if (a === 'mute') { sfx.setMuted(!sfx.muted); e.target.textContent = sfx.muted ? 'Включить звук' : 'Выключить звук'; }
      if (a === 'exit') this.onExit();
    };
  }

  controlsHtml() {
    const rows = [['← →', 'бег'], ['Пробел', 'прыжок'], ['↓', 'рычаг · ↓+прыжок — спрыгнуть']];
    for (const id of this.abilities) {
      const a = abilityTypes.get(id);
      if (a) rows.push([a.keyLabel, a.name]);
    }
    rows.push(['Backspace', 'рестарт'], ['Esc', 'пауза']);
    return rows.map(([k, t]) => `<div><kbd>${k}</kbd> ${t}</div>`).join('');
  }

  frame(dt) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= DT && n < 6) {
      this.tick();
      this.acc -= DT;
      n++;
    }
    if (this.disposed) return;
    const w = this.world;
    for (const ev of w.events) {
      this.view.onEvent(ev);
      sfx.play(ev.type, ev);
      if (ev.type === 'death' && !ev.echo) this.fxState.death = 1;
    }
    w.events.length = 0;

    const f = this.fxState;
    const k = 1 - Math.exp(-10 * dt);
    f.rewind = lerp(f.rewind, this.rewinding ? 1 : 0, k);
    f.stop = lerp(f.stop, w.globalScale === 0 && !this.rewinding ? 1 : 0, k);
    f.slow = lerp(f.slow, this.vars.slowOn ? 1 : 0, k);
    f.flash = Math.max(0, f.flash - dt * 2.5);
    f.wipe = Math.max(0, f.wipe - dt * 2.2);
    f.death = lerp(f.death, w.player?.dead && !this.rewinding ? 1 : 0, k * 0.5);
    const u = this.app.renderer.fx;
    u.uRewind.value = f.rewind;
    u.uStop.value = f.stop;
    u.uSlow.value = f.slow;
    u.uFlash.value = f.flash;
    u.uWipe.value = f.wipe;
    u.uDeath.value = f.death;
    shared.uRewind.value = f.rewind;
    shared.uStop.value = f.stop;

    const p = w.player;
    if (p) this.view.follow(p.x + p.facing * 1.2, p.y, dt);
    // визуальное время мира: идёт назад при перемотке — фоновые часы тоже
    this.view.update(dt, { worldTime: w.tick * DT, rewind: f.rewind });
    if (this.rewinding && p && Math.random() < 0.5) {
      this.view.particles.spawn({ x: p.x + (Math.random() - 0.5) * 14, y: p.y + (Math.random() - 0.3) * 8, z: 1, vx: -3, life: 0.6, size: 0.3, color: '#7a6a55', kind: 3 });
    }
    this.hud.update(dt);
  }

  dispose() {
    this.disposed = true;
    sfx.rewind(false);
    this.view.dispose();
    this.hud.dispose();
    const u = this.app.renderer.fx;
    for (const k of ['uRewind', 'uStop', 'uSlow', 'uFlash', 'uWipe', 'uDeath']) u[k].value = 0;
    shared.uRewind.value = 0;
    shared.uStop.value = 0;
  }
}
