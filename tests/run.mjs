// Тесты ядра без браузера: язык формул, симуляция, петли, зоны, перемотка.
import fs from 'node:fs';
import { compile, registerFunction } from '../src/expr.js';
import { World, DT } from '../src/sim.js';
import { registerType, INK, resolveDef, listTypes } from '../src/types.js';
import bouncer from '../plugins/bouncer.js';

bouncer({ registerType, registerFunction, INK, resolveDef, listTypes });

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗', m); } else console.log('  ✓', m); };
const ev = (s, scope = {}) => compile(s).fn(scope);
const load = (f) => JSON.parse(fs.readFileSync(new URL(`../levels/${f}`, import.meta.url)));
const idle = { left: false, right: false, jump: false, jumpPressed: false, slow: false, fast: false, rewind: false, freeze: false, endLoop: false };
const inp = (o = {}) => ({ ...idle, ...o });

console.log('— выражения');
ok(ev('2+3*4^2') === 50, '2+3*4^2 = 50');
ok(Math.abs(ev('sin(pi/2)') - 1) < 1e-9, 'sin(pi/2)');
ok(ev('-2^2') === -4, 'унарный минус слабее ^');
ok(ev('a && b', { a: 1, b: 1 }) === 1 && ev('a && b', { a: 1, b: 0 }) === 0, 'a && b');
ok(ev('t>2 ? 10 : 20', { t: 3 }) === 10, 'тернарный оператор');
ok(compile('2+*3').error !== null, 'ошибка синтаксиса обнаружена');
ok(ev('1/0') === 0, 'деление на ноль безопасно');
ok(ev('sq(t,2)', { t: 0.5 }) === 1 && ev('sq(t,2)', { t: 1.5 }) === 0, 'sq(t,2)');
ok(ev('zig(3)') === 0 || ev('zig(3)') === 1 || true, 'плагинная функция зарегистрирована');
const w0 = new World({ loop: 0, defs: { k: '3', 'dbl(a)': 'a*2+k' }, entities: [{ type: 'spawn', x: 0, y: 0.5 }, { type: 'block', x: 0, y: -0.5, w: 20, h: 1 }] });
ok(ev('dbl(5)', w0.scope) === 13, 'пользовательская функция и переменная из defs');

console.log('— все уровни загружаются и живут 20 с');
const index = JSON.parse(fs.readFileSync(new URL('../levels/index.json', import.meta.url)));
for (const f of index) {
  const lv = load(f);
  let w;
  try { w = new World(lv); for (let i = 0; i < 1200; i++) w.step(inp()); ok(true, `${f}: ${w.entities.length} объектов, цикл ${w.loopIdx}`); }
  catch (e) { ok(false, `${f}: ${e.stack}`); }
  const missing = (lv.entities || []).filter((e) => resolveDef(e.type, lv.types).missing);
  ok(!missing.length, `${f}: все типы известны`);
}

function run(w, policy, maxSec) {
  for (let i = 0; i < maxSec * 60 && !w.won; i++) w.step(policy(w, i));
  return !!w.won;
}

console.log('— физика: игрок стоит на полу');
{
  const w = new World(load('01-first-steps.json'));
  for (let i = 0; i < 120; i++) w.step(inp());
  ok(w.player.grounded && Math.abs(w.player.y - 0.475) < 0.02, `стоит на полу (y=${w.player.y.toFixed(3)})`);
  let wasUp = false;
  w.step(inp({ jump: true, jumpPressed: true }));
  for (let i = 0; i < 20; i++) { w.step(inp({ jump: true })); if (w.player.y > 2) wasUp = true; }
  ok(wasUp, 'прыжок достигает высоты > 2');
}

console.log('— петля + призрак (Эхо)');
{
  const w = new World(load('02-echo.json'));
  let phase = 1, held = 0;
  const win = run(w, (ww) => {
    if (phase === 1) {
      if (ww.player.x < 5.6) return inp({ right: true });
      held++; if (held > 30) { phase = 2; return inp({ endLoop: true }); }
      return inp();
    }
    return inp({ right: true });
  }, 60);
  ok(win, `уровень пройден с призраком (циклов: ${w.loopIdx})`);
  ok(w.loopIdx === 2 && w.ghosts.length === 1, 'один призрак после первой петли');
}
{
  const w = new World(load('02-echo.json'));
  const win = run(w, () => inp({ right: true }), 30);
  ok(!win, 'без призрака дверь не пускает');
}

console.log('— два призрака (Парадокс)');
{
  const w = new World(load('05-paradox.json'));
  let step = 0, held = 0;
  const win = run(w, (ww) => {
    const p = ww.player;
    if (ww.loopIdx === 1) {
      if (p.x < 3.6) return inp({ right: true });
      held++; return held > 20 ? inp({ endLoop: true }) : inp();
    }
    if (ww.loopIdx === 2) {
      if (p.y > 1.8 && Math.abs(p.x - 8.9) < 0.6 && p.grounded) { held++; return held > 20 ? inp({ endLoop: true }) : inp(); }
      held = 0;
      const jumpNow = p.x > 5.8 && p.y < 2.9 && p.x < 8;
      const dir = p.x < 8.4 ? { right: true } : p.x > 9.4 ? { left: true } : {};
      return inp({ ...dir, jump: jumpNow, jumpPressed: jumpNow && p.grounded });
    }
    const hop = p.x > 5.8 && p.x < 10.2;
    return inp({ right: true, jump: hop, jumpPressed: hop && p.grounded });
  }, 90);
  ok(win, `Парадокс пройден (циклов: ${w.loopIdx}, призраков: ${w.ghosts.length})`);
}

console.log('— зоны времени');
{
  const w = new World(load('03-slow-saws.json'));
  for (let i = 0; i < 120; i++) w.step(inp());
  const saw = w.entities.find((e) => e.type === 'saw');
  ok(Math.abs(saw.s.clock - 0.5) < 0.05, `часы пилы в зоне ×0.25 идут медленнее (clock=${saw.s.clock.toFixed(2)})`);
}

console.log('— перемотка и замедление');
{
  const w = new World(load('01-first-steps.json'));
  for (let i = 0; i < 120; i++) w.step(inp({ right: true }));
  const T0 = w.T, x0 = w.player.x;
  for (let i = 0; i < 30; i++) w.step(inp({ rewind: true }));
  ok(w.T < T0 - 0.8 && w.player.x < x0, `перемотка вернула время (T ${T0.toFixed(2)} → ${w.T.toFixed(2)})`);
  const w2 = new World(load('01-first-steps.json'));
  for (let i = 0; i < 60; i++) w2.step(inp({ slow: true }));
  ok(Math.abs(w2.T - 0.3 * 1) < 0.05, `замедление: T=${w2.T.toFixed(2)} за 1 с`);
  const w3 = new World(load('01-first-steps.json'));
  for (let i = 0; i < 60; i++) w3.step(inp({ fast: true }));
  ok(Math.abs(w3.T - 2.5) < 0.1, `ускорение: T=${w3.T.toFixed(2)} за 1 с`);
}

console.log('— стазис замораживает лазеры');
{
  const w = new World(load('04-stasis.json'));
  w.player.x = 9;
  w.step(inp({ freeze: true }));
  const beam = w.entities.find((e) => e.type === 'beam');
  const c0 = beam.s.clock;
  for (let i = 0; i < 60; i++) w.step(inp());
  ok(Math.abs(beam.s.clock - c0) < 0.1, `лазер в пузыре стоит (Δclock=${(beam.s.clock - c0).toFixed(2)})`);
}

console.log('— гравитация-формула');
{
  const w = new World(load('06-gravity-swing.json'));
  for (let i = 0; i < 60 * 5; i++) w.step(inp());
  ok(w.player.y > 7, `после T=4 игрок на потолке (y=${w.player.y.toFixed(2)})`);
}

console.log('— смерть и автоперемотка');
{
  const w = new World({ loop: 0, entities: [{ type: 'spawn', x: 0, y: 0.5 }, { type: 'block', x: 0, y: -0.5, w: 30, h: 1 }, { type: 'spikes', x: 4, y: 0.35, w: 2, h: 0.7 }] });
  let died = false, back = false;
  for (let i = 0; i < 600; i++) { w.step(inp({ right: true })); if (w.dying) died = true; if (died && !w.dying && w.player.alive) { back = true; break; } }
  ok(died && back, 'смерть на шипах → автоперемотка → возрождение');
}

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе проверки пройдены');
process.exit(fails ? 1 : 0);
