// Приложение: меню, игровой цикл, ввод, HUD, плагины, уровни.
import { Gfx } from './gfx.js';
import { World, DT } from './sim.js';
import { registerType, listTypes, resolveDef, INK } from './types.js';
import { registerFunction } from './expr.js';
import { Editor } from './editor.js';
import { sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);
const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};

// Публичное API для плагинов: window.Chrono
export const api = { registerType, registerFunction, resolveDef, listTypes, INK };
window.Chrono = api;

class App {
  constructor() {
    this.gfx = new Gfx($('c'));
    this.mode = 'menu';
    this.keys = {}; this.edge = {};
    this.levels = [];
    this.world = null; this.menuWorld = null;
    this.ctx = null; this.acc = 0; this.last = performance.now(); this.menuT = 0;
    this.paused = false;
    this.prevSec = -1;
    this.editor = new Editor(this);
    this.bind();
  }

  async init() {
    await this.loadPlugins();
    await this.loadLevels();
    this.showMenu();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- плагины ----------
  async loadPlugins() {
    this.pluginStatus = [];
    let list = [];
    try { list = await (await fetch(new URL('../plugins/index.json', import.meta.url))).json(); } catch { /* нет плагинов */ }
    const user = ls.get('chrono.plugins', []);
    for (const f of list) await this.loadPlugin(new URL(`../plugins/${f}`, import.meta.url).href, f);
    for (const u of user) await this.loadPlugin(u, u);
  }
  async loadPlugin(url, label) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      (mod.default || mod.register)?.(api);
      this.pluginStatus.push({ label, ok: true });
      return null;
    } catch (err) {
      console.warn('plugin failed', url, err);
      this.pluginStatus.push({ label, ok: false, err: String(err.message || err) });
      return String(err.message || err);
    }
  }

  // ---------- уровни ----------
  async loadLevels() {
    let files = [];
    try { files = await (await fetch(new URL('../levels/index.json', import.meta.url))).json(); } catch { /* пусто */ }
    this.levels = [];
    for (const f of files) {
      try { this.levels.push({ file: f, level: await (await fetch(new URL(`../levels/${f}`, import.meta.url))).json() }); } catch (e) { console.warn('level', f, e); }
    }
  }
  userLevels() { return ls.get('chrono.user', {}); }
  saveUserLevel(name, level) { const u = this.userLevels(); u[name] = level; ls.set('chrono.user', u); }
  progress() { return ls.get('chrono.progress', {}); }

  showMenu() {
    this.mode = 'menu'; this.paused = false;
    for (const id of ['hud', 'pause', 'win', 'help']) $(id).classList.add('hidden');
    $('editor').classList.add('hidden');
    $('menu').classList.remove('hidden');
    sfx.setMode({});
    this.buildLevelList();
    const first = this.levels[0]?.level;
    if (first) { this.menuWorld = new World(first); this.menuLoop = first.loop || 10; }
    this.gfx.cam.view = 14;
  }

  buildLevelList() {
    const box = $('levels'); box.innerHTML = '';
    const prog = this.progress();
    const mk = (title, sub, key, onPlay, onEdit, onDel) => {
      const b = document.createElement('button');
      b.className = 'lvl';
      b.innerHTML = `${title}<small>${sub}</small>${prog[key] ? '<span class="ck">✓</span>' : ''}`;
      b.onclick = onPlay;
      const tools = document.createElement('span');
      tools.style.cssText = 'position:absolute;right:6px;bottom:4px;display:flex;gap:4px';
      const eb = document.createElement('span'); eb.textContent = '✎'; eb.title = 'в редактор'; eb.onclick = (e) => { e.stopPropagation(); onEdit(); };
      tools.append(eb);
      if (onDel) { const d = document.createElement('span'); d.textContent = '✕'; d.title = 'удалить'; d.onclick = (e) => { e.stopPropagation(); onDel(); }; tools.append(d); }
      b.append(tools);
      box.append(b);
    };
    const h1 = document.createElement('div'); h1.className = 'sec'; h1.textContent = 'Кампания'; box.append(h1);
    this.levels.forEach((l, i) => mk(`${i + 1}. ${l.level.name}`, l.level.subtitle || (l.level.loop ? `петля ${l.level.loop} с` : 'без петли'), l.file,
      () => this.startLevel(l.level, { file: l.file, index: i }), () => this.openEditor(l.level)));
    const user = this.userLevels();
    const names = Object.keys(user);
    if (names.length) {
      const h2 = document.createElement('div'); h2.className = 'sec'; h2.textContent = 'Мои уровни'; box.append(h2);
      names.forEach((n) => mk(n, 'мой уровень', 'u:' + n, () => this.startLevel(user[n], { user: n }), () => this.openEditor(user[n]),
        () => { const u = this.userLevels(); delete u[n]; ls.set('chrono.user', u); this.buildLevelList(); }));
    }
  }

  // ---------- старт / игра ----------
  startLevel(level, ctx = {}) {
    sfx.enable();
    this.ctx = { ...ctx, level };
    this.mode = 'play'; this.paused = false;
    this.world = new World(JSON.parse(JSON.stringify(level)));
    this.winShown = false; this.prevSec = -1;
    for (const id of ['menu', 'pause', 'win', 'help']) $(id).classList.add('hidden');
    $('editor').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('h-name').textContent = level.name || 'Без названия';
    $('h-hint').textContent = level.hint || '';
    this.gfx.cam.view = level.view || 15;
    this.gfx.cam.x = this.world.player.x; this.gfx.cam.y = this.world.player.y + 1.2;
    this.gfx.charState.clear();
    this.toast(level.name || '');
  }

  toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  }

  openEditor(level) {
    sfx.setMode({});
    $('menu').classList.add('hidden'); $('hud').classList.add('hidden'); $('pause').classList.add('hidden'); $('win').classList.add('hidden');
    this.mode = 'edit';
    this.editor.open(level);
  }

  onWin() {
    const w = this.world.won;
    const c = this.ctx;
    const key = c.file || (c.user ? 'u:' + c.user : null);
    if (key) {
      const p = this.progress(); const old = p[key];
      if (!old || w.loops < old.loops || (w.loops === old.loops && w.time < old.time)) p[key] = { loops: w.loops, time: w.time };
      ls.set('chrono.progress', p);
    }
    $('win-text').textContent = `Циклов: ${w.loops} · время: ${w.time.toFixed(1)} с · кристаллов: ${this.world.crystalCount()}`;
    const hasNext = c.index != null && this.levels[c.index + 1];
    $('w-next').textContent = c.fromEditor ? '← В редактор' : 'Дальше →';
    $('w-next').classList.toggle('hidden', !hasNext && !c.fromEditor);
    $('win').classList.remove('hidden');
    this.winShown = true;
  }

  // ---------- ввод ----------
  bind() {
    const prevent = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
    window.addEventListener('keydown', (e) => {
      if (e.target.matches?.('input,textarea,select')) { if (e.code === 'Escape') e.target.blur(); return; }
      sfx.enable();
      if (prevent.has(e.code) && (this.mode === 'play' || this.mode === 'edit')) e.preventDefault();
      if (!e.repeat) {
        if (this.mode === 'play') {
          if (['Space', 'KeyW', 'ArrowUp'].includes(e.code)) this.edge.jump = true;
          if (e.code === 'KeyE') this.edge.freeze = true;
          if (e.code === 'KeyL') this.edge.endLoop = true;
          if (e.code === 'Escape') this.togglePause();
          if (e.code === 'Backspace') { e.preventDefault(); this.restart(); }
          if (e.code === 'KeyM') sfx.toggleMute();
        }
      }
      this.keys[e.code] = true;
      if (this.mode === 'edit') this.editor.onKey(e, true);
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });

    $('m-play').onclick = () => { const l = this.levels[0]; if (l) this.startLevel(l.level, { file: l.file, index: 0 }); };
    $('m-edit').onclick = () => this.openEditor(this.levels[0] ? JSON.parse(JSON.stringify(this.levels[0].level)) : { name: 'Новый уровень', loop: 10, entities: [{ type: 'block', x: 0, y: -0.5, w: 20, h: 1 }, { type: 'spawn', x: -6, y: 0.5 }] });
    $('m-import').onclick = () => $('file').click();
    $('m-help').onclick = () => $('help').classList.remove('hidden');
    $('help-ok').onclick = () => $('help').classList.add('hidden');
    $('file').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const lv = JSON.parse(await f.text());
        if (!Array.isArray(lv.entities)) throw new Error('нет entities');
        const name = lv.name || f.name.replace(/\.json$/, '');
        lv.name = name; this.saveUserLevel(name, lv); this.buildLevelList(); this.startLevel(lv, { user: name });
      } catch (err) { alert('Не удалось прочитать уровень: ' + err.message); }
    };
    $('p-resume').onclick = () => this.togglePause(false);
    $('p-restart').onclick = () => { this.restart(); this.togglePause(false); };
    $('p-back').onclick = () => this.leave();
    $('w-again').onclick = () => { $('win').classList.add('hidden'); this.restart(); };
    $('w-back').onclick = () => this.leave();
    $('w-next').onclick = () => {
      if (this.ctx.fromEditor) return this.leave();
      const n = this.levels[this.ctx.index + 1];
      if (n) this.startLevel(n.level, { file: n.file, index: this.ctx.index + 1 });
    };
  }

  leave() {
    if (this.ctx?.fromEditor) { this.mode = 'edit'; ['hud', 'pause', 'win'].forEach((i) => $(i).classList.add('hidden')); sfx.setMode({}); this.editor.resume(); } else this.showMenu();
  }
  togglePause(v) {
    if (this.mode !== 'play' || this.winShown) return;
    this.paused = v ?? !this.paused;
    $('pause').classList.toggle('hidden', !this.paused);
    $('p-back').textContent = this.ctx?.fromEditor ? '← В редактор' : 'В меню';
    if (this.paused) sfx.setMode({});
  }
  restart() { this.startLevel(this.ctx.level, this.ctx); }

  readInput() {
    const k = this.keys;
    const inp = {
      left: k.KeyA || k.ArrowLeft, right: k.KeyD || k.ArrowRight, jump: k.Space || k.KeyW || k.ArrowUp,
      slow: k.ShiftLeft || k.ShiftRight, fast: k.KeyF, rewind: k.KeyR,
      jumpPressed: !!this.edge.jump, freeze: !!this.edge.freeze, endLoop: !!this.edge.endLoop,
    };
    this.edge = {};
    return inp;
  }

  // ---------- кадр ----------
  frame(ts) {
    const dt = Math.min(0.05, (ts - this.last) / 1000);
    this.last = ts;
    try {
      if (this.mode === 'play') this.framePlay(dt);
      else if (this.mode === 'menu') this.frameMenu(dt);
      else if (this.mode === 'edit') this.editor.frame(dt);
    } catch (err) { console.error(err); }
    requestAnimationFrame((t) => this.frame(t));
  }

  frameMenu(dt) {
    const w = this.menuWorld; if (!w) return;
    this.menuT += dt;
    w.evalStatic(this.menuT % this.menuLoop);
    const cam = this.gfx.cam;
    cam.x = 14 + Math.sin(this.menuT * 0.12) * 7; cam.y = 3.5;
    w.events = [];
    this.gfx.renderWorld(w, dt, { freeCam: true });
  }

  framePlay(dt) {
    const w = this.world;
    if (!this.paused) {
      this.acc += dt;
      const evs = [];
      let first = true;
      while (this.acc >= DT) {
        w.step(first ? this.readInput() : { ...this.readInput(), jumpPressed: false });
        first = false;
        evs.push(...w.events);
        this.acc -= DT;
      }
      w.events = evs;
      for (const ev of evs) {
        sfx.play(ev);
        if (ev.type === 'loop') this.toast(`Цикл ${ev.loop}`);
        if (ev.type === 'death') this.toast('Ой!');
      }
      sfx.setMode(w.fx);
      const sec = Math.floor(w.T);
      if (w.loopLen > 0 && sec !== this.prevSec && !w.fx.rewind) { sfx.tick(sec % 2 === 0); }
      this.prevSec = sec;
      if (w.won && !this.winShown) {
        if (!this.winTimer) this.winTimer = setTimeout(() => { this.winTimer = null; if (this.mode === 'play') this.onWin(); }, 1300);
      }
    } else w.events = [];
    this.updateHud();
    this.gfx.renderWorld(w, dt);
  }

  updateHud() {
    const w = this.world;
    const arc = $('clock-arc'), txt = $('clock-t');
    if (w.loopLen > 0) {
      arc.style.strokeDashoffset = String(163.4 * Math.min(1, w.T / w.loopLen));
      txt.textContent = String(Math.max(0, Math.ceil(w.loopLen - w.T)));
      $('h-loop').textContent = `цикл ${w.loopIdx} · призраки ${w.ghosts.length}`;
    } else { arc.style.strokeDashoffset = '0'; txt.textContent = '∞'; $('h-loop').textContent = 'без петли'; }
    $('h-en').style.width = `${w.energy}%`;
    $('h-bar').classList.toggle('low', w.exhausted || w.energy < 20);
    const crystals = w.entities.filter((e) => e.type === 'crystal');
    $('h-crys').textContent = crystals.length ? `◆ ${w.crystalCount()} / ${crystals.length}` : '';
  }
}

const app = new App();
window.app = app;
app.init();
