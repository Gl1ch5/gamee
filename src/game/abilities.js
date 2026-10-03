import { registerAbility } from '../engine/registry.js';
import { DT } from '../engine/constants.js';

/**
 * Встроенные способности. Каждая — это просто запись в реестре,
 * поэтому мод может добавить новую способность, не трогая игру.
 * g — объект игры (Game): g.world, g.vars (состояние, перематывается), g.history, g.fx(...)
 */

registerAbility('rewind', {
  name: 'Перемотка', key: 'rewind', keyLabel: 'R', icon: '⏪', special: true,
  desc: 'Держите, чтобы отмотать время назад. Чем дольше держите — тем быстрее. Золотые объекты не подвластны перемотке.',
  status: (g) => ({ active: g.rewinding, ready: g.history.length > 1, fill: Math.min(1, g.history.length / (60 * 20)) }),
});

registerAbility('loop', {
  name: 'Петля', key: 'loop', keyLabel: 'Q', icon: '➰', special: true,
  desc: 'Замкнуть петлю: время начнётся сначала, а ваше прошлое «я» повторит все ваши действия.',
  status: (g) => ({ active: false, ready: true, fill: g.level.loop ? g.loopTime / g.level.loop.duration : 0 }),
});

registerAbility('stop', {
  name: 'Стоп-кадр', key: 'stop', keyLabel: 'E', icon: '⏸', cost: 0.5,
  desc: 'Остановить время для всего мира на 3 секунды. Вы продолжаете двигаться.',
  init(v) { v.stopT = 0; },
  onPress(g) {
    const v = g.vars;
    if (v.stopT > 0) { v.stopT = 0; return; }
    if (v.energy < this.cost) return g.fx('denied');
    v.energy -= this.cost;
    v.stopT = 3;
    g.fx('stop');
  },
  tick(g) {
    const v = g.vars;
    if (v.stopT > 0) {
      v.stopT = Math.max(0, v.stopT - DT);
      g.world.globalScale = 0;
      g.vars.busy = true;
      if (v.stopT === 0) g.fx('resume');
    }
  },
  status: (g) => ({ active: g.vars.stopT > 0, ready: g.vars.energy >= 0.5, fill: g.vars.stopT / 3 }),
});

registerAbility('slow', {
  name: 'Замедление', key: 'slow', keyLabel: 'C', icon: '🐌',
  desc: 'Переключатель: мир движется в 3 раза медленнее, пока есть энергия.',
  init(v) { v.slowOn = false; },
  onPress(g) {
    const v = g.vars;
    if (!v.slowOn && v.energy < 0.1) return g.fx('denied');
    v.slowOn = !v.slowOn;
    g.fx(v.slowOn ? 'slow' : 'resume');
  },
  tick(g) {
    const v = g.vars;
    if (!v.slowOn) return;
    v.energy -= DT * 0.16;
    g.vars.busy = true;
    g.world.globalScale *= 0.33;
    if (v.energy <= 0) { v.energy = 0; v.slowOn = false; g.fx('resume'); }
  },
  status: (g) => ({ active: g.vars.slowOn, ready: g.vars.energy > 0.1, fill: g.vars.energy }),
});

registerAbility('recall', {
  name: 'Откат', key: 'recall', keyLabel: 'F', icon: '↩', cost: 0.35,
  desc: 'Мгновенно вернуться туда, где вы были 2 секунды назад. Мир при этом не перематывается.',
  init(v) { v.recallCD = 0; },
  onPress(g) {
    const v = g.vars;
    const p = g.world.player;
    if (v.recallCD > 0 || p.dead || g.history.length < 2) return g.fx('denied');
    if (v.energy < this.cost) return g.fx('denied');
    const idx = g.world.entities.indexOf(p);
    const snap = g.history[Math.max(0, g.history.length - 1 - 120)].w.ents[idx];
    v.energy -= this.cost;
    v.recallCD = 1.5;
    const from = { fromX: p.x, fromY: p.y };
    p.x = snap.x; p.y = snap.y; p.vx = 0; p.vy = 0; p.facing = snap.facing;
    g.world.emit('recall', { ...from, x: p.x, y: p.y });
  },
  tick(g) { if (g.vars.recallCD > 0) g.vars.recallCD = Math.max(0, g.vars.recallCD - DT); },
  status: (g) => ({ active: g.vars.recallCD > 1.2, ready: g.vars.recallCD <= 0 && g.vars.energy >= 0.35, fill: 1 - g.vars.recallCD / 1.5 }),
});
