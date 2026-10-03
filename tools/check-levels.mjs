// Проверка уровней без браузера: загружает все уровни из public/levels/index.json,
// гоняет симуляцию (физика + время) и прогоняет записанные решения из tools/solutions.mjs.
// Запуск: npm run check-levels  [-- имя_уровня]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import '../src/entities/index.js';
import { normalizeLevel } from '../src/levels/format.js';
import { Chronos } from '../src/game/chronos.js';
import { solutions } from './solutions.mjs';
import { api } from '../src/api.js';
import { pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'levels');
const manifest = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
const only = process.argv[2];
for (const m of manifest.mods || []) {
  const mod = await import(pathToFileURL(join(root, '..', m)).href);
  await mod.default(api);
}

class ScriptInput {
  constructor() { this.now = new Set(); this.prev = new Set(); }
  set(list) { this.prev = this.now; this.now = new Set(list); }
  down(a) { return this.now.has(a); }
  pressed(a) { return this.now.has(a) && !this.prev.has(a); }
  bits() {
    return (this.now.has('left') ? 1 : 0) | (this.now.has('right') ? 2 : 0) | (this.now.has('jump') ? 4 : 0) | (this.now.has('down') ? 8 : 0);
  }
}

/**
 * Шаги сценария:
 *  ['right+jump', 0.3]   — держать клавиши N секунд
 *  ['run', 17.5]         — бежать до x (влево/вправо), затем затормозить
 *  ['leap', 'right']     — прыжок с удержанием направления до приземления
 *  ['hop', 'right']      — короткий прыжок
 *  ['leap', 'right:8:12.5'] — держать прыжок 8 тиков, отпустить направление на x=12.5
 *  ['tap', 'loop']       — нажать клавишу на один тик
 *  ['pass', 23]          — проскочить под пилой из столбца 23, когда она уходит вверх
 */
function run(level, script, { trace = false } = {}) {
  const c = new Chronos(level);
  const inp = new ScriptInput();
  let t = 0;
  const step = (list) => {
    inp.set(list);
    t++;
    return c.tick(inp) === 'win';
  };
  const P = () => c.world.player;
  for (const [acts, arg] of script) {
    let won = false;
    if (acts === 'run') {
      for (let i = 0; i < 600 && !won; i++) {
        const dx = arg - P().x;
        if (Math.abs(dx) < 0.08) break;
        won = step([dx > 0 ? 'right' : 'left']);
        if (Math.abs(arg - P().x) < 0.5 && Math.sign(arg - P().x) !== Math.sign(dx)) break;
      }
      for (let i = 0; i < 6 && !won; i++) won = step([]);
    } else if (acts === 'leap' || acts === 'hop') {
      const [dir, h, stopAt] = String(arg).split(':');
      const hold = h ? Number(h) : acts === 'leap' ? 22 : 5;
      for (let i = 0; i < hold && !won; i++) won = step([dir, 'jump']);
      for (let i = 0; i < 180 && !won && !P().onGround && !P().dead; i++) {
        const x = P().x;
        const halt = stopAt && (dir === 'right' ? x >= Number(stopAt) : x <= Number(stopAt));
        won = step(halt ? [] : [dir]);
      }
    } else if (acts === 'pass') {
      // дождаться, пока пила в столбце arg пойдёт вверх, и проскочить под ней
      const saw = c.world.entities.find((e) => e.type === 'saw' && e.cx === arg);
      for (let i = 0; i < 600 && !won && !(saw.dir === 1 && saw.t > 0.3); i++) won = step([]);
      for (let i = 0; i < 300 && !won && P().x < arg + 2 && !P().dead; i++) won = step(['right']);
    } else if (acts === 'tap') {
      won = step([arg]) || step([]);
    } else {
      const list = acts ? acts.split('+') : [];
      const n = Math.max(1, Math.round(arg * 60));
      for (let i = 0; i < n && !won; i++) won = step(list);
    }
    if (won) return { win: true, t: t / 60, c };
    if (trace) {
      const p = P();
      console.log(`  после [${acts || '—'} ${arg}]: x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} ground=${p.onGround} dead=${p.dead} loop=${c.recordings.length} t=${(t / 60).toFixed(1)}`);
    }
  }
  return { win: false, t: t / 60, c };
}

let failed = 0;
for (const pack of manifest.packs) {
  for (const path of pack.levels) {
    if (only && !path.includes(only)) continue;
    const level = normalizeLevel(JSON.parse(readFileSync(join(root, path), 'utf8')));
    const label = path;
    try {
      const idle = run(level, [['', 8]]);
      if (idle.win) throw new Error('уровень проходится сам по себе!');
      const sol = solutions[path];
      if (!sol) {
        console.log(`·  ${label}: загружается${pack.mods ? ' (мод)' : ''}, решения нет`);
        continue;
      }
      const r = run(level, sol, { trace: !!only });
      if (r.win) console.log(`✓  ${label}: решение проходит за ${r.t.toFixed(1)}с`);
      else {
        failed++;
        const p = r.c.world.player;
        console.log(`✗  ${label}: решение НЕ проходит (x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} dead=${p.dead})`);
      }
    } catch (e) {
      failed++;
      console.log(`✗  ${label}: ${e.stack}`);
    }
  }
}
process.exit(failed ? 1 : 0);
