import { World } from '../engine/world.js';
import { abilityTypes } from '../engine/registry.js';
import { DT, HISTORY_SECONDS } from '../engine/constants.js';
import './abilities.js';

const MAX_HISTORY = HISTORY_SECONDS * 60;

/**
 * Контроллер времени — сердце игры, без графики (работает и в Node для тестов):
 *  - каждую тику пишется снимок мира → перемотка;
 *  - ввод игрока пишется в запись петли → эхо-копии;
 *  - способности из реестра (стоп-кадр, замедление, откат и любые из модов).
 *
 * inp: { down(action), pressed(action), bits() }
 */
export class Chronos {
  constructor(level, { onWorld, onFx } = {}) {
    this.level = level;
    this.onWorld = onWorld;
    this.onFx = onFx;
    this.abilities = (level.abilities || ['rewind']).filter((a) => abilityTypes.has(a));
    if (level.loop && !this.abilities.includes('loop')) this.abilities.push('loop');
    this.recordings = [];
    this.newWorld();
  }

  initVars() {
    const v = { energy: 1, busy: false };
    for (const id of this.abilities) abilityTypes.get(id).init?.(v);
    return v;
  }

  newWorld({ carryFrom = null } = {}) {
    this.world = new World(this.level, { echoes: this.recordings });
    if (carryFrom) this.world.carryAnchoredFrom(carryFrom);
    this.vars = this.initVars();
    this.history = [];
    this.recording = [];
    this.loopTime = 0;
    this.rewinding = false;
    this.rewindHeld = 0;
    this.deadT = 0;
    this.pushHistory();
    this.onWorld?.(this.world, { carry: !!carryFrom });
  }

  pushHistory() {
    this.history.push({ w: this.world.snapshot(), v: { ...this.vars }, rec: this.recording.length, lt: this.loopTime });
    if (this.history.length > MAX_HISTORY) this.history.shift();
  }

  fx(name, data = {}) {
    this.onFx?.(name, data);
  }

  closeLoop() {
    const L = this.level.loop;
    if (!L) return;
    this.recordings.push(this.recording.slice());
    const max = L.maxEchoes ?? 3;
    while (this.recordings.length > max) this.recordings.shift();
    this.newWorld({ carryFrom: this.world });
    this.fx('loop', { n: this.recordings.length + 1 });
  }

  restart(clearEchoes = true) {
    if (clearEchoes) this.recordings = [];
    this.newWorld();
    this.fx('restart', { clear: clearEchoes });
  }

  rewindStep() {
    if (!this.rewinding) this.fx('rewindStart');
    this.rewinding = true;
    this.rewindHeld += DT;
    const n = this.rewindHeld > 2.5 ? 4 : this.rewindHeld > 1.2 ? 2 : 1;
    for (let i = 0; i < n && this.history.length > 1; i++) this.history.pop();
    const s = this.history[this.history.length - 1];
    const w = this.world;
    w.muted = true;
    w.restore(s.w);
    Object.assign(this.vars, s.v);
    this.recording.length = s.rec;
    this.loopTime = s.lt;
    if (w.entities.some((e) => e.anchored)) {
      w.globalScale = 1;
      w.step(DT, (e) => e.anchored);
      w.tick = s.w.tick;
    }
    w.events.length = 0;
    w.muted = false;
    this.rewindSpeed = n;
  }

  /** Один шаг. Возвращает 'win' при победе. */
  tick(inp) {
    if (inp.pressed('restart')) return this.restart(true);
    const w = this.world;
    const p = w.player;
    const canRewind = this.abilities.includes('rewind');

    if (this.level.loop && inp.pressed('loop')) return this.closeLoop();

    if (canRewind && inp.down('rewind') && this.history.length > 1) return this.rewindStep();
    if (this.rewinding) {
      this.rewinding = false;
      this.rewindHeld = 0;
      this.fx('rewindEnd');
    }

    if (!p || p.dead) {
      this.deadT += DT;
      if (this.deadT > 0.35 && (inp.pressed('jump') || (!canRewind && this.deadT > 1.6))) this.restart(false);
      return;
    }
    this.deadT = 0;

    w.globalScale = 1;
    this.vars.busy = false;
    for (const id of this.abilities) {
      const a = abilityTypes.get(id);
      if (a.special) continue;
      if (inp.pressed(a.key)) a.onPress?.(this);
      a.tick?.(this, inp.down(a.key));
    }
    if (!this.vars.busy) this.vars.energy = Math.min(1, this.vars.energy + DT * 0.12);

    const bits = inp.bits();
    w.input = bits;
    w.step(DT);
    this.recording.push(bits);
    const prevSec = Math.floor(this.loopTime);
    this.loopTime += DT;
    this.pushHistory();
    if (this.level.loop) {
      if (Math.floor(this.loopTime) !== prevSec) this.fx('clockTick', { tock: prevSec % 2 });
      if (this.loopTime >= this.level.loop.duration) this.closeLoop();
    }
    if (w.won) return 'win';
  }
}
