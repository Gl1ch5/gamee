// Реестр типов объектов. Каждый тип — просто описание: параметры, поведение (хуки) и рисование.
// Новые типы добавляются через registerType() (плагины) или прямо в JSON уровня (поле "types"
// с "extends") — без правки движка.
//
// Хуки: init(e,w) reset(e,w) update(e,w,dt) solid(e,w) hazard(e,w) sense(e,w,bodies) signal(e,w) draw(e,w,g)

export const INK = '#2b2540';
const TYPES = {};

export function registerType(name, def) { TYPES[name] = def; return def; }

export function resolveDef(name, local) {
  const raw = (local && local[name]) || TYPES[name];
  if (!raw) {
    const d = Object.create(TYPES.block);
    d.label = `? ${name}`; d.missing = true;
    return d;
  }
  if (raw.$merged) return raw.$merged;
  if (!raw.extends) return raw;
  const parent = resolveDef(raw.extends, local);
  const merged = Object.create(parent);
  Object.assign(merged, raw);
  merged.defaults = { ...parent.defaults, ...raw.defaults };
  merged.props = { ...parent.props, ...raw.props };
  merged.params = { ...parent.params, ...raw.params };
  merged.name = name;
  if (!(local && local[name])) raw.$merged = merged;
  return merged;
}

export function listTypes(local) {
  const names = new Set([...Object.keys(TYPES), ...Object.keys(local || {})]);
  return [...names].map((n) => ({ name: n, def: resolveDef(n, local) })).filter((t) => !t.def.hidden);
}

// ---------- общие помощники ----------
export function stepMover(e, w, dt) {
  const s = e.s;
  s.clock += dt;
  e.scope.t = s.clock + e.num('phase');
  const nx = e.x + e.ev('px');
  const ny = e.y + e.ev('py');
  s.dx = nx - s.x; s.dy = ny - s.y;
  s.x = nx; s.y = ny;
}
function placeMover(e) {
  e.scope.t = e.num('phase');
  e.s.x = e.x + e.ev('px'); e.s.y = e.y + e.ev('py'); e.s.dx = 0; e.s.dy = 0;
}
const movable = { px: { type: 'expr', label: 'x(t) — смещение по X' }, py: { type: 'expr', label: 'y(t) — смещение по Y' }, phase: { type: 'number', label: 'сдвиг фазы t' } };
const idProp = { id: { type: 'string', label: 'id (имя сигнала)' } };

const rectOf = (e) => ({ x: e.s.x, y: e.s.y, w: e.w, h: e.h, e });
const hashN = (n) => { const s = Math.sin(n * 91.7 + 17.3) * 43758.5453; return s - Math.floor(s); };

// ---------- встроенные типы ----------
registerType('block', {
  label: 'Блок', icon: '▦', defaults: { w: 4, h: 1, color: '#c9d4ec' }, props: { color: { type: 'color' } },
  reset(e) { e.s.x = e.x; e.s.y = e.y; },
  solid: rectOf,
  draw(e, w, g) {
    g.rect(e.s.x, e.s.y, e.w, e.h, { fill: e.get('color'), ink: INK, z: 0, seed: e.i * 3.1 });
    const n = Math.min(60, Math.floor(e.w / 1.3));
    for (let k = 0; k < n; k++) {
      const gx = e.s.x - e.w / 2 + 0.6 + k * 1.3 + hashN(e.i * 7 + k) * 0.5;
      const gy = e.s.y + e.h / 2;
      if (hashN(e.i * 3 + k * 5) > 0.45) {
        g.line(gx, gy, gx - 0.12, gy + 0.22, { ink: '#4e8a5a', lw: 0.045, a: 0.9, z: 0.4, seed: k });
        g.line(gx, gy, gx + 0.1, gy + 0.28, { ink: '#4e8a5a', lw: 0.045, a: 0.9, z: 0.4, seed: k + 9 });
      }
    }
  },
});

registerType('platform', {
  label: 'Платформа', icon: '▬', defaults: { w: 4, h: 0.6, px: '0', py: '0', phase: 0, color: '#f2bd52' },
  props: { ...movable, color: { type: 'color' } },
  reset(e) { e.s.clock = 0; placeMover(e); },
  update: stepMover,
  solid: rectOf,
  draw(e, w, g) {
    const { x, y } = e.s;
    const sp = Math.hypot(e.s.dx, e.s.dy) * 60;
    if (sp > 0.6) g.line(x, y, x - e.s.dx * 9, y - e.s.dy * 9, { ink: e.get('color'), lw: e.h * 0.8, a: Math.min(0.35, sp * 0.05), z: -0.5, layer: 'alpha' });
    g.rect(x, y, e.w, e.h, { fill: e.get('color'), ink: INK, z: 1, seed: e.i * 2.3 });
    g.circle(x - e.w / 2 + 0.25, y, 0.07, { fill: INK, ink: null, z: 1.2 });
    g.circle(x + e.w / 2 - 0.25, y, 0.07, { fill: INK, ink: null, z: 1.2 });
  },
});

registerType('door', {
  label: 'Дверь', icon: '🚪', defaults: { w: 0.8, h: 3, open: 'a', speed: 3, color: '#9b7fd6', id: '' },
  props: { ...idProp, open: { type: 'expr', label: 'open — условие открытия' }, speed: { type: 'number' }, color: { type: 'color' } },
  reset(e) { e.s.clock = 0; e.s.x = e.x; e.s.y = e.y; e.s.amt = 0; e.s.dx = 0; e.s.dy = 0; },
  update(e, w, dt) {
    e.s.clock += dt;
    e.scope.t = e.s.clock;
    const target = e.ev('open') ? 1 : 0;
    const step = e.num('speed') * Math.abs(dt);
    const before = e.s.amt;
    e.s.amt = Math.abs(target - before) <= step ? target : before + Math.sign(target - before) * step;
    if (before < 0.99 && e.s.amt >= 0.99) w.emit('door', { x: e.x, y: e.y });
  },
  preview(e, w, T) { e.scope.t = T; e.s.amt = e.ev('open') ? 1 : 0; },
  solid(e) { return e.s.amt < 0.97 ? { x: e.s.x, y: e.s.y - (e.h * e.s.amt) / 2, w: e.w, h: e.h * (1 - e.s.amt), e } : null; },
  draw(e, w, g) {
    const k = e.s.amt, h = e.h * (1 - k);
    const col = e.get('color');
    g.glow(e.s.x, e.s.y, 1.6 + e.h * 0.3, col, 0.12 + 0.2 * k);
    if (h > 0.05) {
      g.rect(e.s.x, e.s.y - (e.h * k) / 2, e.w, h, { fill: col, ink: INK, z: 1, seed: e.i * 5.7 });
      const n = Math.floor(h / 0.5);
      for (let j = 1; j < n; j++) g.line(e.s.x - e.w / 2 + 0.1, e.s.y - e.h / 2 + j * 0.5, e.s.x + e.w / 2 - 0.1, e.s.y - e.h / 2 + j * 0.5, { ink: INK, lw: 0.04, a: 0.5, z: 1.1, seed: j });
    }
    g.rect(e.s.x, e.y + e.h / 2 + 0.12, e.w + 0.3, 0.24, { fill: '#6c5aa0', ink: INK, z: 1.2, seed: e.i });
  },
});

registerType('plate', {
  label: 'Плита', icon: '⏺', defaults: { w: 1.6, h: 0.3, id: 'a', hold: 0, latch: false, color: '#6dc17a' },
  props: { ...idProp, hold: { type: 'number', label: 'удержание после (сек)' }, latch: { type: 'bool', label: 'залипает' }, color: { type: 'color' } },
  reset(e) { e.s.x = e.x; e.s.y = e.y; e.s.on = 0; e.s.hold = 0; e.s.latched = 0; e.s.press = 0; },
  sense(e, w, bodies, dt) {
    const area = { x: e.x, y: e.y + 0.18, w: e.w, h: e.h + 0.3 };
    let pressed = false;
    for (const b of bodies) if (Math.abs(b.x - area.x) < (b.w + area.w) / 2 && Math.abs(b.y - area.y) < (b.h + area.h) / 2) { pressed = true; break; }
    const was = e.s.on;
    if (pressed) { e.s.hold = e.num('hold'); if (e.get('latch')) e.s.latched = 1; } else e.s.hold -= dt;
    e.s.on = pressed || e.s.hold > 0 || e.s.latched ? 1 : 0;
    e.s.press += ((pressed ? 1 : 0) - e.s.press) * Math.min(1, dt * 18);
    if (e.s.on !== was) w.emit('plate', { x: e.x, y: e.y, on: e.s.on });
  },
  signal(e) { return e.s.on; },
  draw(e, w, g) {
    const on = e.s.on, p = e.s.press;
    g.rect(e.x, e.y - 0.05, e.w + 0.5, e.h * 0.8, { fill: '#8a8fa8', ink: INK, z: 2, seed: e.i });
    const col = on ? '#ffe36b' : e.get('color');
    g.rect(e.x, e.y + e.h * 0.35 - p * 0.14, e.w, e.h * 0.65, { fill: col, ink: INK, z: 2.2, seed: e.i + 4 });
    if (on) g.glow(e.x, e.y + 0.3, 1.8, '#ffe36b', 0.5);
    if (e.get('id')) g.text(e.get('id'), e.x, e.y - 0.5, 0.42, INK, 0.7, { z: 3 });
  },
});

registerType('box', {
  label: 'Ящик', icon: '▣', defaults: { w: 1, h: 1, color: '#c98f5a' }, props: { color: { type: 'color' } },
  dynamic: true,
  reset(e) { e.s.clock = 0; e.s.x = e.x; e.s.y = e.y; e.s.vx = 0; e.s.vy = 0; e.s.dx = 0; e.s.dy = 0; },
  update(e, w, dt) { w.physicsBox(e, dt); },
  solid: rectOf,
  draw(e, w, g) {
    const { x, y } = e.s;
    g.rect(x, y, e.w, e.h, { fill: e.get('color'), ink: INK, z: 3, seed: e.i * 1.7 });
    g.line(x - e.w * 0.38, y - e.h * 0.38, x + e.w * 0.38, y + e.h * 0.38, { ink: INK, lw: 0.05, a: 0.7, z: 3.1, seed: 1 });
    g.line(x - e.w * 0.38, y + e.h * 0.38, x + e.w * 0.38, y - e.h * 0.38, { ink: INK, lw: 0.05, a: 0.7, z: 3.1, seed: 2 });
  },
});

registerType('spikes', {
  label: 'Шипы', icon: '▲', defaults: { w: 2, h: 0.7, on: '1', px: '0', py: '0', phase: 0, dir: 'up', color: '#e0524a' },
  props: { on: { type: 'expr', label: 'on — активны (1/0)' }, ...movable, dir: { type: 'select', options: ['up', 'down', 'left', 'right'] }, color: { type: 'color' } },
  reset(e) { e.s.clock = 0; e.s.k = 1; placeMover(e); },
  update(e, w, dt) {
    stepMover(e, w, dt);
    const target = e.ev('on') ? 1 : 0;
    e.s.k += Math.sign(target - e.s.k) * Math.min(Math.abs(target - e.s.k), dt * 6);
  },
  preview(e, w, T) { stepMover(e, w, 0); e.s.k = e.ev('on') ? 1 : 0; },
  hazard(e) { return e.s.k > 0.7 ? { x: e.s.x, y: e.s.y, w: e.w * 0.85, h: e.h * 0.7 } : null; },
  draw(e, w, g) {
    const k = e.s.k, { x, y } = e.s, dir = e.get('dir');
    const horiz = dir === 'left' || dir === 'right';
    const len = horiz ? e.w : e.h, span = horiz ? e.h : e.w;
    const n = Math.max(1, Math.round(span / 0.5)), tw = span / n;
    const tris = [];
    const pt = (a, b) => {
      // a — вдоль основания, b — высота шипа (0..len)
      if (dir === 'up') return [x - span / 2 + a, y - len / 2 + b];
      if (dir === 'down') return [x - span / 2 + a, y + len / 2 - b];
      if (dir === 'right') return [x - len / 2 + b, y - span / 2 + a];
      return [x + len / 2 - b, y - span / 2 + a];
    };
    const outline = [pt(0, 0)];
    for (let i = 0; i < n; i++) {
      const p0 = pt(i * tw, 0), p1 = pt(i * tw + tw / 2, len * k), p2 = pt((i + 1) * tw, 0);
      tris.push(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]);
      outline.push(p1, p2);
    }
    g.tris(tris, { fill: e.get('color'), z: 4 });
    g.path(outline, { ink: INK, z: 4.1, seed: e.i });
    if (k > 0.7) g.glow(x, y, Math.max(e.w, e.h) * 0.9, e.get('color'), 0.12);
  },
});

registerType('saw', {
  label: 'Пила', icon: '✺', defaults: { w: 1.6, h: 1.6, px: '0', py: '0', phase: 0, color: '#d9dde8' },
  props: { ...movable, color: { type: 'color' } },
  reset(e) { e.s.clock = 0; e.s.ang = 0; placeMover(e); },
  update(e, w, dt) { stepMover(e, w, dt); e.s.ang += dt * 7; },
  hazard(e) { return { x: e.s.x, y: e.s.y, r: e.w * 0.42 }; },
  draw(e, w, g) {
    const { x, y } = e.s, r = e.w / 2, a = e.s.ang;
    const pts = [];
    const teeth = 12;
    for (let i = 0; i < teeth * 2; i++) {
      const rr = i % 2 ? r * 0.78 : r;
      const an = a + (i / (teeth * 2)) * Math.PI * 2;
      pts.push([x + Math.cos(an) * rr, y + Math.sin(an) * rr]);
    }
    g.poly(pts, { fill: e.get('color'), ink: INK, z: 4, seed: e.i * 1.3 });
    g.circle(x, y, r * 0.28, { fill: '#e0524a', ink: INK, z: 4.2, seed: e.i });
    g.line(x, y, x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, { ink: INK, lw: 0.05, z: 4.3, seed: 4 });
    if (Math.abs(e.s.dx) + Math.abs(e.s.dy) > 0.002) g.glow(x, y, r * 1.5, '#e0524a', 0.08);
  },
});

registerType('beam', {
  label: 'Лазер', icon: '┃', defaults: { w: 0.3, h: 5, on: 'sq(T,2)', px: '0', py: '0', phase: 0, color: '#ff4f6d' },
  props: { on: { type: 'expr', label: 'on — включён (1/0)' }, ...movable, color: { type: 'color' } },
  reset(e) { e.s.clock = 0; e.s.k = 0; placeMover(e); },
  update(e, w, dt) {
    stepMover(e, w, dt);
    const target = e.ev('on') ? 1 : 0;
    e.s.k += Math.sign(target - e.s.k) * Math.min(Math.abs(target - e.s.k), dt * 9);
  },
  preview(e, w, T) { stepMover(e, w, 0); e.s.k = e.ev('on') ? 1 : 0; },
  hazard(e) { return e.s.k > 0.9 ? { x: e.s.x, y: e.s.y, w: e.w, h: e.h } : null; },
  draw(e, w, g) {
    const { x, y } = e.s, k = e.s.k, vert = e.h >= e.w;
    const L = vert ? e.h : e.w;
    const ax = vert ? x : x - L / 2, ay = vert ? y - L / 2 : y;
    const bx = vert ? x : x + L / 2, by = vert ? y + L / 2 : y;
    const col = e.get('color');
    if (k > 0.02) {
      const flick = 0.85 + Math.random() * 0.3;
      g.line(ax, ay, bx, by, { ink: col, lw: (vert ? e.w : e.h) * (0.4 + k) * flick + 0.05, a: 0.35 * k, z: 4, layer: 'alpha' });
      g.line(ax, ay, bx, by, { ink: '#fff', lw: 0.06 * k, a: 0.9 * k, z: 4.1, layer: 'alpha' });
      g.glow(x, y, L * 0.55, col, 0.18 * k);
    } else {
      g.line(ax, ay, bx, by, { ink: col, lw: 0.03, a: 0.35, z: 4, layer: 'alpha', dash: 0.3 });
    }
    for (const [px, py] of [[ax, ay], [bx, by]]) g.rect(px, py, vert ? 0.7 : 0.3, vert ? 0.3 : 0.7, { fill: '#5b5870', ink: INK, z: 4.2, seed: px + py });
  },
});

registerType('zone', {
  label: 'Зона времени', icon: '⏱', defaults: { w: 5, h: 4, scale: '0.3', px: '0', py: '0', phase: 0, playerToo: true },
  props: { scale: { type: 'expr', label: 'scale — скорость времени (×)' }, ...movable, playerToo: { type: 'bool', label: 'влияет на игрока' } },
  isZone: true,
  reset(e) { e.s.clock = 0; e.s.rot = 0; placeMover(e); e.scope.t = 0; e.s.scale = e.ev('scale'); },
  update(e, w, dt) {
    stepMover(e, w, dt);
    e.s.scale = e.ev('scale');
    e.s.rot += dt * e.s.scale * 2.2;
  },
  draw(e, w, g) {
    const { x, y } = e.s, sc = e.s.scale;
    const col = Math.abs(sc) < 0.02 ? '#8d9bad' : sc < 0 ? '#b066e0' : sc < 1 ? '#4a8dff' : sc > 1 ? '#ff9a2e' : '#7fd0a0';
    g.rect(x, y, e.w, e.h, { fill: col, ink: null, a: 0.16, z: -3, layer: 'alpha' });
    g.rect(x, y, e.w, e.h, { fill: null, ink: col, a: 0.9, z: -2.9, layer: 'alpha', dash: 0.35, lw: 0.06, seed: e.i });
    const r = Math.min(e.w, e.h) * 0.22;
    g.circle(x, y, r, { fill: null, ink: col, a: 0.75, z: -2.8, layer: 'alpha', seed: e.i + 3 });
    for (let k = 0; k < 12; k++) {
      const an = (k / 12) * Math.PI * 2;
      g.line(x + Math.cos(an) * r * 0.82, y + Math.sin(an) * r * 0.82, x + Math.cos(an) * r * 0.97, y + Math.sin(an) * r * 0.97, { ink: col, lw: 0.04, a: 0.7, z: -2.8, layer: 'alpha', seed: k });
    }
    const h1 = e.s.rot, h2 = e.s.rot * 0.083;
    g.line(x, y, x + Math.sin(h1) * r * 0.78, y + Math.cos(h1) * r * 0.78, { ink: col, lw: 0.07, a: 0.95, z: -2.7, layer: 'alpha', seed: 1 });
    g.line(x, y, x + Math.sin(h2) * r * 0.5, y + Math.cos(h2) * r * 0.5, { ink: col, lw: 0.09, a: 0.95, z: -2.7, layer: 'alpha', seed: 2 });
    const lbl = Math.abs(sc) < 0.02 ? '❄ стоп' : sc < 0 ? `◀ ×${sc.toFixed(1)}` : `×${sc.toFixed(2).replace(/\.?0+$/, '')}`;
    g.text(lbl, x, y + e.h / 2 - 0.5, 0.5, col, 0.95, { z: -2.6 });
    if (Math.random() < g.dt * 14 * Math.min(2, e.w * e.h / 12)) {
      const mx = x + (Math.random() - 0.5) * e.w, my = y + (Math.random() - 0.5) * e.h;
      g.emit('mote', mx, my, { color: col, vx: sc * 0.8, vy: 0.2 * sc, life: 1.4, size: 7 });
    }
  },
});

registerType('crystal', {
  label: 'Кристалл', icon: '◆', defaults: { w: 0.7, h: 0.9, color: '#46d3e6' }, props: { color: { type: 'color' } },
  reset(e, w) { e.s.x = e.x; e.s.y = e.y; e.s.got = w.collected.has(e.i) ? 1 : 0; },
  sense(e, w, bodies) {
    if (e.s.got) return;
    const p = w.player;
    if (p.alive && Math.abs(p.x - e.x) < 0.6 && Math.abs(p.y - e.y) < 0.75) {
      e.s.got = 1; w.addEnergy(25); w.emit('collect', { x: e.x, y: e.y, color: e.get('color') });
    }
  },
  draw(e, w, g) {
    if (e.s.got) return;
    const y = e.y + Math.sin(g.time * 2.4 + e.i) * 0.1, wx = Math.cos(g.time * 1.7 + e.i) * 0.3 + 0.5;
    const hw = 0.38 * wx + 0.08, hh = 0.5;
    g.glow(e.x, y, 1.4, e.get('color'), 0.4);
    g.poly([[e.x, y + hh], [e.x + hw, y], [e.x, y - hh], [e.x - hw, y]], { fill: e.get('color'), ink: INK, z: 5, seed: e.i });
    g.line(e.x - hw * 0.3, y + hh * 0.3, e.x - hw * 0.1, y - hh * 0.2, { ink: '#fff', lw: 0.05, a: 0.9, z: 5.1, seed: 2 });
    if (Math.random() < g.dt * 3) g.emit('spark', e.x + (Math.random() - 0.5) * 0.7, y + (Math.random() - 0.5) * 1.0, { color: e.get('color'), life: 0.9, size: 8, vy: 0.4 });
  },
});

registerType('goal', {
  label: 'Портал-выход', icon: '◎', defaults: { w: 1.6, h: 2.2, open: '1', need: 0, color: '#ffc94d' },
  props: { open: { type: 'expr', label: 'open — когда активен' }, need: { type: 'number', label: 'нужно кристаллов' }, color: { type: 'color' } },
  reset(e) { e.s.x = e.x; e.s.y = e.y; e.s.active = 0; e.s.spin = 0; },
  update(e, w, dt) {
    e.scope.t = w.T;
    e.s.active = e.ev('open') && w.crystalCount() >= e.num('need') ? 1 : 0;
    e.s.spin += dt * (e.s.active ? 3 : 0.4);
  },
  sense(e, w) {
    const p = w.player;
    if (e.s.active && p.alive && Math.abs(p.x - e.x) < e.w * 0.4 && Math.abs(p.y - e.y) < e.h * 0.5) w.win();
  },
  draw(e, w, g) {
    const act = e.s.active, col = act ? e.get('color') : '#9aa0b4';
    g.glow(e.x, e.y, 3.2, col, act ? 0.55 : 0.12);
    g.circle(e.x, e.y, e.w * 0.62, { fill: act ? '#fff6d2' : '#d9dce6', ink: INK, z: 2, seed: e.i, ry: e.h * 0.5 });
    g.spiral(e.x, e.y, e.w * 0.52, 3.2, e.s.spin, { ink: col, lw: 0.07, z: 2.3, ry: e.h * 0.43 });
    g.spiral(e.x, e.y, e.w * 0.3, 2.2, -e.s.spin * 1.4, { ink: INK, lw: 0.05, a: 0.7, z: 2.4, ry: e.h * 0.25 });
    if (!act) {
      g.text(`${w.crystalCount()}/${e.num('need')} ◆`, e.x, e.y + e.h * 0.5 + 0.5, 0.45, INK, 0.8, { z: 3 });
    } else if (Math.random() < g.dt * 24) {
      const a = Math.random() * 6.28;
      g.emit('spark', e.x + Math.cos(a) * e.w * 0.6, e.y + Math.sin(a) * e.h * 0.5, { color: col, life: 0.9, size: 8, vx: -Math.cos(a), vy: -Math.sin(a) });
    }
  },
});

registerType('text', {
  label: 'Надпись мелом', icon: '✎', defaults: { w: 4, h: 1, text: 'Привет, время!', size: 0.55, color: '#3a3558' },
  props: { text: { type: 'string' }, size: { type: 'number' }, color: { type: 'color' } },
  reset(e) { e.s.x = e.x; e.s.y = e.y; },
  draw(e, w, g) { g.text(e.get('text'), e.x, e.y, Number(e.get('size')) || 0.5, e.get('color'), 0.85, { z: 0.5, maxW: e.w, seed: e.i }); },
});

registerType('spawn', {
  label: 'Старт', icon: '☺', defaults: { w: 1, h: 1 }, props: {}, editorOnly: true,
  reset(e) { e.s.x = e.x; e.s.y = e.y; },
  draw(e, w, g) {
    if (!w.editing) return;
    g.circle(e.x, e.y, 0.55, { fill: null, ink: '#ff6b4a', dash: 0.25, z: 6, layer: 'alpha', seed: 1 });
    g.text('СТАРТ', e.x, e.y + 0.9, 0.38, '#ff6b4a', 0.9, { z: 6 });
  },
});
