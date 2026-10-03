import './style.css';
import './entities/index.js';
import './api.js';
import { Renderer } from './render/renderer.js';
import { Input } from './game/input.js';
import { Game } from './game/game.js';
import { Editor } from './editor/editor.js';
import { MenuScene } from './menuScene.js';
import { sfx } from './game/audio.js';
import { loadManifest, loadLevelFile, loadAllMods, customLevels, deleteCustomLevel, progress, markDone, decodeLevel, pickJSONFile, emptyLevel, userMods, setUserMods, loadMod } from './levels/loader.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

class App {
  constructor() {
    this.canvas = document.getElementById('view');
    this.ui = document.getElementById('ui');
    this.renderer = new Renderer(this.canvas);
    this.input = new Input();
    this.screen = null;
    this.last = performance.now();
    const loop = (t) => {
      const dt = Math.min((t - this.last) / 1000, 0.1);
      this.last = t;
      try {
        this.screen?.frame(dt);
        this.renderer.render(dt);
      } catch (e) {
        console.error(e);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.addEventListener('pointerdown', () => sfx.ensure(), { once: true });
    window.addEventListener('keydown', () => sfx.ensure(), { once: true });
  }

  /** make — фабрика экрана: старый экран и его UI убираются до создания нового */
  setScreen(make) {
    this.screen?.dispose();
    this.screen = null;
    this.ui.innerHTML = '';
    this.input.reset();
    this.renderer.fx.uWipe.value = 0;
    this.screen = make();
    return this.screen;
  }

  async start() {
    const errs = await loadAllMods();
    if (errs.length) console.warn('Ошибки модов:', errs);
    this.manifest = await loadManifest();
    const m = location.hash.match(/play=([\w-]+)/);
    if (m) {
      try {
        const lvl = await decodeLevel(m[1]);
        history.replaceState(null, '', location.pathname);
        return this.play(lvl, { packName: 'Уровень по ссылке', onExit: () => this.menu() });
      } catch (e) {
        console.error('Ссылка на уровень повреждена', e);
      }
    }
    this.menu();
  }

  // ---------------- главное меню ----------------
  menu() {
    this.setScreen(() => new MenuScene(this));
    const el = document.createElement('div');
    el.className = 'menu';
    el.innerHTML = `
      <div class="logo">
        <svg viewBox="0 0 900 200" class="logo-svg" aria-label="Хроноскетч">
          <text x="450" y="140" text-anchor="middle" class="logo-text">Хроноскетч</text>
          <path class="logo-underline" d="M150 165 C 300 150, 500 185, 760 160"/>
        </svg>
        <p class="tagline">головоломка о том, как перехитрить время</p>
      </div>
      <nav class="menu-buttons">
        <button class="btn big primary" data-a="play">▶ Играть</button>
        <button class="btn big" data-a="mine">✎ Мои уровни</button>
        <button class="btn big" data-a="editor">🛠 Редактор</button>
        <button class="btn big" data-a="load">📂 Открыть файл</button>
        <button class="btn big" data-a="mods">🧩 Моды</button>
        <button class="btn big" data-a="help">? Как играть</button>
      </nav>
      <button class="btn sm mute" data-a="mute">${sfx.muted ? '🔇' : '🔊'}</button>
      <div class="menu-foot">Three.js · рисованная 2.5D графика · уровни в JSON · моды</div>
    `;
    this.ui.appendChild(el);
    el.onclick = async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      sfx.play('ui');
      if (a === 'play') this.packs();
      if (a === 'mine') this.myLevels();
      if (a === 'editor') this.editor(emptyLevel());
      if (a === 'help') this.help();
      if (a === 'mods') this.mods();
      if (a === 'mute') { sfx.setMuted(!sfx.muted); e.target.textContent = sfx.muted ? '🔇' : '🔊'; }
      if (a === 'load') {
        try {
          const L = await pickJSONFile();
          if (L) this.play(L, { packName: 'Из файла', onExit: () => this.menu() });
        } catch (err) {
          alert(`Не удалось открыть: ${err.message}`);
        }
      }
    };
  }

  overlay(html, cls = '') {
    const el = document.createElement('div');
    el.className = `overlay ${cls}`;
    el.innerHTML = `<div class="sketch-box panel pop">${html}</div>`;
    this.ui.appendChild(el);
    return el;
  }

  // ---------------- паки уровней ----------------
  packs() {
    const prog = progress();
    const el = this.overlay(`
      <h2 class="scribble">Выбор уровня</h2>
      ${this.manifest.packs.map((p, pi) => `
        <section class="pack">
          <h3>${esc(p.name)}</h3>
          ${p.description ? `<p class="hint">${esc(p.description)}</p>` : ''}
          <div class="lvl-grid">
            ${p.levels.map((path, i) => {
              const key = `${p.id}/${path}`;
              const pr = prog[key];
              return `<button class="lvl-card ${pr?.done ? 'done' : ''}" data-p="${pi}" data-i="${i}">
                <b>${i + 1}</b>${pr?.done ? '<i>✓</i>' : ''}${pr?.shards ? `<s>${'⏳'.repeat(pr.shards)}</s>` : ''}
              </button>`;
            }).join('')}
          </div>
        </section>`).join('')}
      <div class="row"><button class="btn" data-a="back">← Назад</button></div>`, 'packs');
    el.onclick = (e) => {
      if (e.target.closest('[data-a=back]')) { sfx.play('ui'); el.remove(); return; }
      const c = e.target.closest('.lvl-card');
      if (!c) return;
      sfx.play('ui');
      this.playFromPack(Number(c.dataset.p), Number(c.dataset.i));
    };
  }

  async playFromPack(pi, i) {
    const pack = this.manifest.packs[pi];
    const path = pack.levels[i];
    let level;
    try {
      level = await loadLevelFile(path);
    } catch (e) {
      alert(e.message);
      return;
    }
    const key = `${pack.id}/${path}`;
    const hasNext = i + 1 < pack.levels.length;
    this.play(level, {
      packName: `${pack.name} · ${i + 1}/${pack.levels.length}`,
      onExit: () => { this.menu(); this.packs(); },
      onWin: (res) => markDone(key, { shards: res.shards }),
      onNext: hasNext ? () => this.playFromPack(pi, i + 1) : () => { this.menu(); this.packs(); },
    });
  }

  play(level, opts = {}) {
    this.setScreen(() => new Game(this, level, opts));
  }

  // ---------------- свои уровни ----------------
  myLevels() {
    const list = Object.values(customLevels()).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    const el = this.overlay(`
      <h2 class="scribble">Мои уровни</h2>
      ${list.length ? `<div class="my-list">${list.map((l) => `
        <div class="my-row sketch-box">
          <div><b>${esc(l.name)}</b><small>${l.width}×${l.height} · ${new Date(l.savedAt || 0).toLocaleDateString()}</small></div>
          <div class="row">
            <button class="btn sm primary" data-a="play" data-id="${esc(l.id)}">▶</button>
            <button class="btn sm" data-a="edit" data-id="${esc(l.id)}">✎</button>
            <button class="btn sm danger" data-a="del" data-id="${esc(l.id)}">✕</button>
          </div>
        </div>`).join('')}</div>` : '<p class="hint">Здесь появятся уровни, сохранённые в редакторе.</p>'}
      <div class="row"><button class="btn" data-a="back">← Назад</button><button class="btn primary" data-a="new">+ Создать</button></div>`, 'packs');
    el.onclick = (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      sfx.play('ui');
      const L = b.dataset.id && customLevels()[b.dataset.id];
      if (b.dataset.a === 'back') el.remove();
      if (b.dataset.a === 'new') this.editor(emptyLevel());
      if (b.dataset.a === 'play' && L) this.play(L, { packName: 'Мои уровни', onExit: () => { this.menu(); this.myLevels(); } });
      if (b.dataset.a === 'edit' && L) this.editor(L);
      if (b.dataset.a === 'del' && L && confirm(`Удалить «${L.name}»?`)) { deleteCustomLevel(L.id); el.remove(); this.myLevels(); }
    };
  }

  // ---------------- редактор ----------------
  editor(level, camera) {
    const ed = this.setScreen(() => new Editor(this, level, {
      camera,
      onExit: () => this.menu(),
      onPlay: (lvl, cam) => {
        const modified = ed.modified;
        const undo = ed.undoStack.slice();
        this.play(lvl, {
          packName: 'Тест из редактора',
          testMode: true,
          onExit: () => {
            this.editor(lvl, cam);
            this.screen.undoStack = undo;
            this.screen.modified = modified;
            this.screen.updateTitle();
          },
        });
      },
    }));
  }

  // ---------------- моды ----------------
  mods() {
    const el = this.overlay(`
      <h2 class="scribble">Моды</h2>
      <p class="hint">Мод — это JS-модуль, который регистрирует новые тайлы, объекты и способности через <code>api</code>.
      Встроенные моды подключаются в <code>public/levels/index.json</code>. Здесь можно добавить свой по URL.</p>
      <div class="mods-list">${userMods().map((u, i) => `<div class="my-row sketch-box"><code>${esc(u)}</code><button class="btn sm danger" data-del="${i}">✕</button></div>`).join('') || '<p class="hint">Пользовательских модов нет.</p>'}</div>
      <div class="row"><input class="inp" placeholder="https://.../my-mod.js" /><button class="btn sm primary" data-a="add">Подключить</button></div>
      <div class="row"><button class="btn" data-a="back">← Назад</button></div>`, 'packs');
    el.onclick = async (e) => {
      const d = e.target.closest('[data-del]');
      if (d) {
        const list = userMods();
        list.splice(Number(d.dataset.del), 1);
        setUserMods(list);
        el.remove();
        this.mods();
        return;
      }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'back') el.remove();
      if (a === 'add') {
        const url = el.querySelector('.inp').value.trim();
        if (!url) return;
        try {
          await loadMod(url);
          setUserMods([...userMods(), url]);
          el.remove();
          this.mods();
        } catch (err) {
          alert(`Мод не загрузился: ${err.message}`);
        }
      }
    };
  }

  help() {
    const el = this.overlay(`
      <h2 class="scribble">Как играть</h2>
      <div class="help-grid">
        <div><kbd>←</kbd><kbd>→</kbd> / <kbd>A</kbd><kbd>D</kbd> — бег</div>
        <div><kbd>Пробел</kbd> / <kbd>W</kbd> — прыжок (держите — выше)</div>
        <div><kbd>↓</kbd> — дёрнуть рычаг; <kbd>↓</kbd>+<kbd>Пробел</kbd> — спрыгнуть с доски</div>
        <div><kbd>R</kbd> — ⏪ перемотка (держите)</div>
        <div><kbd>Q</kbd> — ➰ замкнуть петлю: прошлое «я» повторит ваши действия</div>
        <div><kbd>E</kbd> — ⏸ стоп-кадр мира на 3 секунды</div>
        <div><kbd>C</kbd> — 🐌 замедление (переключатель)</div>
        <div><kbd>F</kbd> — ↩ откат на 2 секунды назад</div>
        <div><kbd>Backspace</kbd> — начать заново · <kbd>Esc</kbd> — пауза</div>
        <div>🎮 Геймпад тоже поддерживается</div>
      </div>
      <h3>Законы времени</h3>
      <ul class="laws">
        <li><b>Золотые</b> объекты существуют вне времени: перемотка и петли их не трогают.</li>
        <li><b>Эхо</b> повторяет только ваши движения. Если мир изменился — эхо может ошибиться.</li>
        <li><b>Синие зоны</b> замедляют время, <b>оранжевые</b> — ускоряют. Даже для вас.</li>
        <li><b>Ростки</b> растут со временем. Ускорьте их — или отмотайте рост назад.</li>
      </ul>
      <div class="row"><button class="btn" data-a="back">← Понятно</button></div>`, 'packs');
    el.onclick = (e) => { if (e.target.closest('[data-a=back]')) el.remove(); };
  }
}

const app = new App();
window.__app = app;
app.start();
