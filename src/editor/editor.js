import * as THREE from 'three';
import { World } from '../engine/world.js';
import { entityTypes, tileTypes, abilityTypes, propDefaults, onRegistryChange } from '../engine/registry.js';
import { channelColor, clamp } from '../engine/constants.js';
import { WorldView } from '../render/worldView.js';
import { normalizeLevel, saveCustomLevel, downloadJSON, pickJSONFile, encodeLevel, customLevels, emptyLevel } from '../levels/loader.js';
import { sfx } from '../game/audio.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Клетки, занимаемые сущностью: якорь — нижняя левая клетка, растёт вправо и вверх. */
export function footprint(def) {
  const t = entityTypes.get(def.type);
  const ed = t?.editor || { w: 1, h: 1 };
  const p = { ...propDefaults(def.type), ...(def.props || {}) };
  let w = ed.w || 1, h = ed.h || 1;
  if (def.type === 'door') h = p.height;
  if (def.type === 'platform') { w = p.width; h = 1; }
  if (ed.resizable) { w = p.w; h = p.h; }
  return { x: def.x, row: def.y, w, h, top: def.y - h + 1 };
}

/**
 * Редактор уровней. Рисует уровень тем же движком, что и игра,
 * поэтому что видите — то и получите. Палитра строится из реестров:
 * любой тайл/сущность из мода сразу появляется в редакторе.
 */
export class Editor {
  constructor(app, level, { onExit, onPlay, camera } = {}) {
    this.app = app;
    this.onExit = onExit;
    this.onPlay = onPlay;
    this.level = normalizeLevel(clone(level || emptyLevel()));
    this.view = new WorldView(app.renderer);
    this.view.tilt = 1.2;
    this.undoStack = [];
    this.redoStack = [];
    this.tool = { kind: 'tile', char: '#' };
    this.selected = -1;
    this.hover = null;
    this.dirty = true;
    this.cam = camera || { x: this.level.width / 2, y: this.level.height / 2, zoom: 0.8 };
    this.drag = null;
    this.keys = new Set();
    this.buildOverlays();
    this.buildUI();
    this.bindInput();
    this.unsub = onRegistryChange(() => this.renderPalette());
    this.rebuild();
  }

  // ---------------- сцена ----------------
  buildOverlays() {
    this.overlay = new THREE.Group();
    this.overlay.renderOrder = 20;
    this.app.renderer.scene.add(this.overlay);
    this.hoverMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#2b2622', transparent: true, opacity: 0.18, depthTest: false }));
    this.hoverMesh.renderOrder = 30;
    this.overlay.add(this.hoverMesh);
    this.selMesh = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: '#e4572e', depthTest: false }));
    this.selMesh.renderOrder = 31;
    this.overlay.add(this.selMesh);
    this.rectMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#2a9d8f', transparent: true, opacity: 0.25, depthTest: false }));
    this.rectMesh.renderOrder = 30;
    this.rectMesh.visible = false;
    this.overlay.add(this.rectMesh);
  }

  rebuildGrid() {
    if (this.grid) {
      this.overlay.remove(this.grid, this.border);
      this.grid.geometry.dispose();
      this.border.geometry.dispose();
    }
    const W = this.level.width, H = this.level.height;
    const pts = [];
    for (let x = 0; x <= W; x++) pts.push(x, 0, 0.62, x, H, 0.62);
    for (let y = 0; y <= H; y++) pts.push(0, y, 0.62, W, y, 0.62);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#2b2622', transparent: true, opacity: this.showGrid === false ? 0 : 0.12, depthTest: false }));
    this.grid.renderOrder = 25;
    const bg = new THREE.EdgesGeometry(new THREE.PlaneGeometry(W, H));
    this.border = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: '#e4572e', depthTest: false }));
    this.border.position.set(W / 2, H / 2, 0.63);
    this.border.renderOrder = 26;
    this.overlay.add(this.grid, this.border);
  }

  rebuild() {
    this.dirty = false;
    const sizeKey = `${this.level.width}x${this.level.height}`;
    try {
      this.world = new World(this.level);
    } catch (e) {
      console.error(e);
      return;
    }
    this.view.setWorld(this.world, { rebuildTiles: true });
    if (sizeKey !== this.gridKey) {
      this.rebuildGrid();
      this.gridKey = sizeKey;
    }
    this.updateSelection();
  }

  // ---------------- правки и история ----------------
  snapshot() { return JSON.stringify(this.level); }
  commit(before) {
    if (before === this.snapshot()) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    this.modified = true;
    this.updateTitle();
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.level = JSON.parse(this.undoStack.pop());
    this.selected = -1;
    this.dirty = true;
    this.renderInspector();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.level = JSON.parse(this.redoStack.pop());
    this.selected = -1;
    this.dirty = true;
    this.renderInspector();
  }

  setTile(col, row, ch) {
    const L = this.level;
    if (col < 0 || row < 0 || col >= L.width || row >= L.height) return false;
    const r = L.tiles[row];
    if (r[col] === ch) return false;
    L.tiles[row] = r.slice(0, col) + ch + r.slice(col + 1);
    this.dirty = true;
    return true;
  }

  entityAt(col, row) {
    const ents = this.level.entities;
    for (let i = ents.length - 1; i >= 0; i--) {
      const f = footprint(ents[i]);
      if (col >= f.x && col < f.x + f.w && row <= f.row && row >= f.top) return i;
    }
    return -1;
  }

  placeEntity(type, col, row) {
    const t = entityTypes.get(type);
    if (!t) return;
    const L = this.level;
    if (t.editor.unique) {
      const i = L.entities.findIndex((e) => e.type === type);
      if (i >= 0) {
        L.entities[i].x = col;
        L.entities[i].y = row;
        this.selected = i;
        this.dirty = true;
        return;
      }
    }
    if (this.entityAt(col, row) >= 0 && L.entities[this.entityAt(col, row)].type === type) return;
    const props = propDefaults(type);
    // наследуем последний использованный канал — удобно ставить связанные плиты/двери
    if ('channel' in props && this.lastChannel !== undefined && t.editor.props.channel?.default) props.channel = this.lastChannel;
    L.entities.push({ type, x: col, y: row, props });
    this.selected = L.entities.length - 1;
    this.dirty = true;
  }

  // ---------------- ввод ----------------
  cellFromEvent(e) {
    const p = this.app.renderer.screenToWorld(e.clientX, e.clientY, 0.6);
    const col = Math.floor(p.x), cy = Math.floor(p.y);
    return { col, row: this.level.height - 1 - cy, x: p.x, y: p.y };
  }

  bindInput() {
    const cv = this.app.renderer.canvas;
    this.onPointerDown = (e) => {
      if (e.target !== cv) return;
      cv.setPointerCapture?.(e.pointerId);
      const c = this.cellFromEvent(e);
      if (e.button === 1 || (e.button === 0 && this.keys.has('Space'))) {
        this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y };
        return;
      }
      const before = this.snapshot();
      if (e.button === 2) {
        this.drag = { kind: 'erase', before };
        this.eraseAt(c.col, c.row);
        return;
      }
      const tool = this.tool;
      if (tool.kind === 'tile') {
        if (e.shiftKey) this.drag = { kind: 'rect', before, start: c, char: tool.char };
        else {
          this.drag = { kind: 'paint', before };
          if (this.setTile(c.col, c.row, tool.char)) sfx.play('paint');
        }
      } else if (tool.kind === 'erase') {
        this.drag = { kind: 'erase', before };
        this.eraseAt(c.col, c.row);
      } else if (tool.kind === 'entity') {
        this.placeEntity(tool.type, c.col, c.row);
        sfx.play('ui');
        this.drag = { kind: 'move', before, idx: this.selected, ox: 0, oy: 0 };
        this.renderInspector();
      } else if (tool.kind === 'select') {
        const i = this.entityAt(c.col, c.row);
        this.selected = i;
        if (i >= 0) {
          const en = this.level.entities[i];
          this.drag = { kind: 'move', before, idx: i, ox: c.col - en.x, oy: c.row - en.y };
        } else this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y };
        this.renderInspector();
        this.updateSelection();
      }
    };
    this.onPointerMove = (e) => {
      const c = this.cellFromEvent(e);
      this.hover = c;
      const d = this.drag;
      this.status(`x: ${c.col}  y: ${c.row}${d?.kind === 'rect' ? `  [${Math.abs(c.col - d.start.col) + 1}×${Math.abs(c.row - d.start.row) + 1}]` : ''}`);
      if (!d) return;
      if (d.kind === 'pan') {
        const k = (0.035 / this.cam.zoom);
        this.cam.x = d.cx - (e.clientX - d.sx) * k;
        this.cam.y = d.cy + (e.clientY - d.sy) * k;
      } else if (d.kind === 'paint') {
        if (this.setTile(c.col, c.row, this.tool.char)) sfx.play('paint');
      } else if (d.kind === 'erase') this.eraseAt(c.col, c.row);
      else if (d.kind === 'move' && d.idx >= 0) {
        const en = this.level.entities[d.idx];
        const nx = clamp(c.col - d.ox, 0, this.level.width - 1), ny = clamp(c.row - d.oy, 0, this.level.height - 1);
        if (en.x !== nx || en.y !== ny) {
          en.x = nx;
          en.y = ny;
          this.dirty = true;
        }
      }
    };
    this.onPointerUp = () => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.kind === 'rect' && this.hover) {
        const a = d.start, b = this.hover;
        for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++)
          for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) this.setTile(c, r, d.char);
        sfx.play('paint');
      }
      if (d.before) this.commit(d.before);
      this.renderInspector();
    };
    this.onWheel = (e) => {
      if (e.target !== cv) return;
      e.preventDefault();
      const before = this.app.renderer.screenToWorld(e.clientX, e.clientY, 0.6);
      this.cam.zoom = clamp(this.cam.zoom * Math.exp(-e.deltaY * 0.0015), 0.2, 3);
      this.applyCamera();
      const after = this.app.renderer.screenToWorld(e.clientX, e.clientY, 0.6);
      this.cam.x += before.x - after.x;
      this.cam.y += before.y - after.y;
    };
    this.onContext = (e) => { if (e.target === cv) e.preventDefault(); };
    this.onKeyDown = (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      this.keys.add(e.code);
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if (ctrl && e.code === 'KeyY') { e.preventDefault(); this.redo(); }
      else if (ctrl && e.code === 'KeyS') { e.preventDefault(); this.save(); }
      else if (ctrl && e.code === 'KeyD' && this.selected >= 0) { e.preventDefault(); this.duplicate(); }
      else if ((e.code === 'Delete' || e.code === 'Backspace') && this.selected >= 0) { e.preventDefault(); this.deleteSelected(); }
      else if (e.code === 'Escape') { this.selected = -1; this.renderInspector(); this.updateSelection(); }
      else if (e.code === 'KeyT' || e.code === 'Enter') this.play();
      else if (e.code === 'KeyG') { this.showGrid = this.showGrid === false; this.grid.material.opacity = this.showGrid === false ? 0 : 0.12; }
      else if (e.code === 'KeyV') this.setTool({ kind: 'select' });
      else if (e.code === 'KeyX') this.setTool({ kind: 'erase' });
      else if (e.code === 'Space') e.preventDefault();
      else if (/^Digit[1-9]$/.test(e.code)) {
        const chars = [...tileTypes.keys()];
        const ch = chars[Number(e.code.slice(5)) - 1];
        if (ch) this.setTool({ kind: 'tile', char: ch });
      }
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    cv.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  eraseAt(col, row) {
    const i = this.entityAt(col, row);
    if (i >= 0) {
      this.level.entities.splice(i, 1);
      if (this.selected === i) this.selected = -1;
      else if (this.selected > i) this.selected--;
      this.dirty = true;
      sfx.play('paint');
      this.renderInspector();
      return;
    }
    if (this.setTile(col, row, '.')) sfx.play('paint');
  }

  deleteSelected() {
    if (this.selected < 0) return;
    const before = this.snapshot();
    this.level.entities.splice(this.selected, 1);
    this.selected = -1;
    this.dirty = true;
    this.commit(before);
    this.renderInspector();
  }

  duplicate() {
    const en = this.level.entities[this.selected];
    if (!en || entityTypes.get(en.type)?.editor.unique) return;
    const before = this.snapshot();
    const copy = clone(en);
    copy.x = Math.min(copy.x + 1, this.level.width - 1);
    delete copy.id;
    this.level.entities.push(copy);
    this.selected = this.level.entities.length - 1;
    this.dirty = true;
    this.commit(before);
    this.renderInspector();
  }

  setTool(tool) {
    this.tool = tool;
    sfx.play('ui');
    this.ui.querySelectorAll('.pal-item').forEach((el) => el.classList.toggle('on', el.dataset.tool === toolKey(tool)));
  }

  // ---------------- UI ----------------
  buildUI() {
    const ui = document.createElement('div');
    ui.className = 'editor';
    ui.innerHTML = `
      <div class="ed-top sketch-box">
        <button class="btn sm" data-a="exit" title="В меню">← Меню</button>
        <span class="ed-title"></span>
        <div class="ed-actions">
          <button class="btn sm" data-a="new" title="Новый уровень">Новый</button>
          <button class="btn sm" data-a="open" title="Мои уровни">Открыть</button>
          <button class="btn sm" data-a="import" title="Импорт JSON">Импорт</button>
          <button class="btn sm" data-a="save" title="Ctrl+S">Сохранить</button>
          <button class="btn sm" data-a="export" title="Скачать JSON">Экспорт</button>
          <button class="btn sm" data-a="share" title="Ссылка на уровень">Ссылка</button>
          <button class="btn sm" data-a="undo" title="Ctrl+Z">↶</button>
          <button class="btn sm" data-a="redo" title="Ctrl+Y">↷</button>
          <button class="btn sm primary" data-a="play" title="T / Enter">▶ Играть</button>
        </div>
      </div>
      <div class="ed-left sketch-box"><div class="palette"></div></div>
      <div class="ed-right sketch-box"><div class="inspector"></div></div>
      <div class="ed-status"></div>
      <div class="ed-modal" hidden></div>
    `;
    this.app.ui.appendChild(ui);
    this.ui = ui;
    ui.querySelector('.ed-top').onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a) this.action(a);
    };
    this.renderPalette();
    this.renderInspector();
    this.updateTitle();
    this.status('ЛКМ — рисовать · ПКМ — стереть · Shift+ЛКМ — прямоугольник · колесо — масштаб · СКМ/Пробел+ЛКМ — двигать');
  }

  updateTitle() {
    this.ui.querySelector('.ed-title').textContent = `${this.level.name || 'Без названия'}${this.modified ? ' •' : ''}`;
  }

  status(t) {
    this.ui.querySelector('.ed-status').textContent = t;
  }

  renderPalette() {
    const pal = this.ui.querySelector('.palette');
    const tiles = [...tileTypes.values()];
    const cats = new Map();
    for (const t of entityTypes.values()) {
      if (!cats.has(t.editor.category)) cats.set(t.editor.category, []);
      cats.get(t.editor.category).push(t);
    }
    const item = (key, icon, label, color, hint = '') => `<button class="pal-item ${toolKey(this.tool) === key ? 'on' : ''}" data-tool="${esc(key)}" title="${esc(label)}${hint}"><span class="pal-icon" style="--c:${color}">${icon}</span><span class="pal-label">${esc(label)}</span></button>`;
    pal.innerHTML = `
      <h4>Инструменты</h4>
      <div class="pal-grid">
        ${item('select', '👆', 'Выбор', '#e9e1cf', ' (V)')}
        ${item('erase', '🧽', 'Ластик', '#e9e1cf', ' (X / ПКМ)')}
      </div>
      <h4>Тайлы</h4>
      <div class="pal-grid">
        ${tiles.map((t, i) => item(`tile:${t.char}`, `<i class="swatch" style="background:${t.color};${t.top ? `border-top:5px solid ${t.top}` : ''}"></i>`, t.name, t.color, ` (${i + 1})`)).join('')}
      </div>
      ${[...cats].map(([cat, list]) => `<h4>${esc(cat)}</h4><div class="pal-grid">${list.map((t) => item(`entity:${t.type}`, t.editor.icon, t.editor.label, t.editor.color)).join('')}</div>`).join('')}
    `;
    pal.onclick = (e) => {
      const b = e.target.closest('.pal-item');
      if (!b) return;
      const [kind, arg] = b.dataset.tool.split(':');
      if (kind === 'tile') this.setTool({ kind, char: arg });
      else if (kind === 'entity') this.setTool({ kind, type: arg });
      else this.setTool({ kind });
    };
  }

  renderInspector() {
    const box = this.ui.querySelector('.inspector');
    const L = this.level;
    const en = L.entities[this.selected];
    if (en) {
      const t = entityTypes.get(en.type);
      const props = { ...propDefaults(en.type), ...en.props };
      box.innerHTML = `
        <h3>${t?.editor.icon || ''} ${esc(t?.editor.label || en.type)}</h3>
        <div class="field"><label>Позиция</label><span>x ${en.x}, y ${en.y}</span></div>
        ${Object.entries(t?.editor.props || {}).map(([k, p]) => fieldHtml(`p.${k}`, p, props[k])).join('')}
        <div class="row">
          <button class="btn sm" data-a="dup" title="Ctrl+D">Копия</button>
          <button class="btn sm danger" data-a="del" title="Delete">Удалить</button>
        </div>
        <button class="btn sm ghost" data-a="level">← Настройки уровня</button>`;
    } else {
      box.innerHTML = `
        <h3>Уровень</h3>
        ${fieldHtml('name', { type: 'string', label: 'Название' }, L.name)}
        ${fieldHtml('author', { type: 'string', label: 'Автор' }, L.author)}
        ${fieldHtml('intro', { type: 'text', label: 'Вступление' }, L.intro || '')}
        <div class="field two"><label>Размер</label>
          <input type="number" min="8" max="400" data-k="width" value="${L.width}"> ×
          <input type="number" min="6" max="200" data-k="height" value="${L.height}"></div>
        <h4>Способности</h4>
        <div class="checks">
          ${[...abilityTypes.values()].filter((a) => a.id !== 'loop').map((a) => `<label class="check"><input type="checkbox" data-ab="${a.id}" ${L.abilities.includes(a.id) ? 'checked' : ''}> ${a.icon} ${esc(a.name)} <kbd>${a.keyLabel}</kbd></label>`).join('')}
        </div>
        <h4>Петля времени</h4>
        <label class="check"><input type="checkbox" data-k="loopOn" ${L.loop ? 'checked' : ''}> ➰ Включить петли</label>
        ${L.loop ? `
          ${fieldHtml('loop.duration', { type: 'number', label: 'Длина петли, с', min: 2, max: 120, step: 0.5 }, L.loop.duration)}
          ${fieldHtml('loop.maxEchoes', { type: 'number', label: 'Макс. эхо', min: 1, max: 12, step: 1 }, L.loop.maxEchoes ?? 3)}` : ''}
        <p class="hint">Выберите объект инструментом «Выбор», чтобы редактировать его свойства. Каналы связывают плиты, кнопки и рычаги с дверями, платформами и зонами.</p>`;
    }
    box.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', () => this.onField(inp)));
    box.querySelectorAll('[data-ab]').forEach((inp) => inp.addEventListener('change', () => {
      const before = this.snapshot();
      const set = new Set(L.abilities);
      if (inp.checked) set.add(inp.dataset.ab); else set.delete(inp.dataset.ab);
      L.abilities = [...abilityTypes.keys()].filter((k) => set.has(k));
      this.commit(before);
    }));
    box.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'del') this.deleteSelected();
      if (a === 'dup') this.duplicate();
      if (a === 'level') { this.selected = -1; this.renderInspector(); this.updateSelection(); }
    };
    this.updateSelection();
  }

  onField(inp) {
    const before = this.snapshot();
    const k = inp.dataset.k;
    const L = this.level;
    let v = inp.type === 'checkbox' ? inp.checked : inp.value;
    if (inp.type === 'number') v = Number(v);
    if (k.startsWith('p.')) {
      const en = L.entities[this.selected];
      const name = k.slice(2);
      en.props[name] = v;
      if (name === 'channel') this.lastChannel = v;
      if (name === 'anchored' && en.id) delete en.id;
    } else if (k === 'width' || k === 'height') {
      this.resize(k === 'width' ? clamp(v, 8, 400) : L.width, k === 'height' ? clamp(v, 6, 200) : L.height);
    } else if (k === 'loopOn') {
      L.loop = v ? { duration: 10, maxEchoes: 3 } : null;
      this.renderInspector();
    } else if (k.startsWith('loop.')) {
      L.loop[k.slice(5)] = v;
    } else {
      L[k] = v;
      this.updateTitle();
    }
    this.dirty = true;
    this.commit(before);
    if (k.startsWith('p.')) {
      const sw = inp.parentElement.querySelector('.ch-swatch');
      if (sw) sw.style.background = channelColor(v);
    }
  }

  /** Изменение размера: низ уровня остаётся на месте, сверху добавляются/удаляются строки */
  resize(w, h) {
    const L = this.level;
    const dh = h - L.height;
    let tiles = L.tiles.map((r) => r.padEnd(w, '.').slice(0, w));
    if (dh > 0) tiles = [...Array.from({ length: dh }, () => '.'.repeat(w)), ...tiles];
    else if (dh < 0) tiles = tiles.slice(-dh);
    L.tiles = tiles;
    L.width = w;
    L.height = h;
    L.entities = L.entities.map((e) => ({ ...e, y: e.y + dh })).filter((e) => e.x < w && e.y >= 0 && e.y < h);
    this.selected = -1;
    this.renderInspector();
  }

  async action(a) {
    sfx.play('ui');
    if (a === 'exit') {
      if (this.modified && !confirm('Есть несохранённые изменения. Выйти?')) return;
      this.onExit();
    } else if (a === 'undo') this.undo();
    else if (a === 'redo') this.redo();
    else if (a === 'play') this.play();
    else if (a === 'save') this.save();
    else if (a === 'export') downloadJSON(this.level, this.level.name || 'level');
    else if (a === 'new') {
      if (this.modified && !confirm('Начать новый уровень? Несохранённое пропадёт.')) return;
      this.loadLevel(emptyLevel());
    } else if (a === 'import') {
      try {
        const L = await pickJSONFile();
        if (L) this.loadLevel(L);
      } catch (e) {
        alert(`Не удалось прочитать файл: ${e.message}`);
      }
    } else if (a === 'open') this.openDialog();
    else if (a === 'share') {
      const code = await encodeLevel(this.level);
      const url = `${location.origin}${location.pathname}#play=${code}`;
      try {
        await navigator.clipboard.writeText(url);
        this.toast('Ссылка скопирована — по ней уровень сразу откроется в игре');
      } catch {
        prompt('Ссылка на уровень:', url);
      }
    }
  }

  loadLevel(L) {
    this.level = normalizeLevel(clone(L));
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.selected = -1;
    this.modified = false;
    this.cam = { x: this.level.width / 2, y: this.level.height / 2, zoom: 0.8 };
    this.dirty = true;
    this.renderInspector();
    this.updateTitle();
  }

  save() {
    const issues = this.validate();
    saveCustomLevel(this.level);
    this.modified = false;
    this.updateTitle();
    this.toast(issues.length ? `Сохранено, но: ${issues.join('; ')}` : 'Сохранено в «Мои уровни»');
  }

  validate() {
    const L = this.level;
    const out = [];
    if (!L.entities.some((e) => e.type === 'player')) out.push('нет старта игрока');
    if (!L.entities.some((e) => e.type === 'goal')) out.push('нет портала-выхода');
    return out;
  }

  play() {
    const issues = this.validate();
    if (issues.includes('нет старта игрока')) return this.toast('Поставьте старт игрока 🎩');
    this.onPlay(clone(this.level), { ...this.cam });
  }

  openDialog() {
    const m = this.ui.querySelector('.ed-modal');
    const list = Object.values(customLevels()).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    m.innerHTML = `<div class="sketch-box modal-card pop">
      <h3>Мои уровни</h3>
      <div class="lvl-list">${list.length ? list.map((l) => `<button class="btn lvl-row" data-id="${esc(l.id)}">${esc(l.name)} <small>${l.width}×${l.height}</small></button>`).join('') : '<p class="hint">Пока пусто — сохраните уровень.</p>'}</div>
      <button class="btn sm" data-a="close">Закрыть</button></div>`;
    m.hidden = false;
    m.onclick = (e) => {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (id) {
        this.loadLevel(customLevels()[id]);
        m.hidden = true;
      }
      if (e.target.closest('[data-a=close]') || e.target === m) m.hidden = true;
    };
  }

  toast(text) {
    const t = document.createElement('div');
    t.className = 'toast sketch-box';
    t.textContent = text;
    this.app.ui.appendChild(t);
    setTimeout(() => t.classList.add('hide'), 2200);
    setTimeout(() => t.remove(), 2800);
  }

  updateSelection() {
    const en = this.level.entities[this.selected];
    this.selMesh.visible = !!en;
    if (en) {
      const f = footprint(en);
      const H = this.level.height;
      this.selMesh.scale.set(f.w + 0.1, f.h + 0.1, 1);
      this.selMesh.position.set(f.x + f.w / 2, H - 1 - f.row + f.h / 2, 0.66);
    }
  }

  applyCamera() {
    const v = this.view;
    v.zoom = this.cam.zoom;
    v.dist = 22;
    v.camTarget.set(this.cam.x, this.cam.y, 0);
    v.applyCamera(v.dist / v.zoom);
  }

  // ---------------- кадр ----------------
  frame(dt) {
    const sp = (14 / this.cam.zoom) * dt;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.cam.x -= sp;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.cam.x += sp;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.cam.y += sp;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.cam.y -= sp;
    if (this.dirty) {
      this.rebuild();
      if (this.selected >= 0 && this.ui.querySelector('.inspector h3') && this.drag?.kind === 'move') {
        const pos = this.ui.querySelector('.inspector .field span');
        const en = this.level.entities[this.selected];
        if (pos && en) pos.textContent = `x ${en.x}, y ${en.y}`;
      }
    }
    this.applyCamera();
    const h = this.hover;
    const H = this.level.height;
    if (h) {
      this.hoverMesh.visible = true;
      let w = 1, hh = 1;
      if (this.tool.kind === 'entity') {
        const f = footprint({ type: this.tool.type, x: h.col, y: h.row, props: {} });
        w = f.w;
        hh = f.h;
      }
      this.hoverMesh.scale.set(w, hh, 1);
      this.hoverMesh.position.set(h.col + w / 2, H - 1 - h.row + hh / 2, 0.64);
      this.hoverMesh.material.color.set(this.tool.kind === 'erase' ? '#d1495b' : '#2b2622');
    }
    if (this.drag?.kind === 'rect' && h) {
      const a = this.drag.start;
      const c0 = Math.min(a.col, h.col), c1 = Math.max(a.col, h.col), r0 = Math.min(a.row, h.row), r1 = Math.max(a.row, h.row);
      this.rectMesh.visible = true;
      this.rectMesh.scale.set(c1 - c0 + 1, r1 - r0 + 1, 1);
      this.rectMesh.position.set((c0 + c1 + 1) / 2, H - (r0 + r1 + 1) / 2, 0.65);
    } else this.rectMesh.visible = false;
    this.view.update(dt, { worldTime: this.app.renderer.time * 0.3, rewind: 0 });
  }

  dispose() {
    const cv = this.app.renderer.canvas;
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    cv.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.unsub();
    this.view.dispose();
    this.app.renderer.scene.remove(this.overlay);
    this.ui.remove();
  }
}

function toolKey(t) {
  if (t.kind === 'tile') return `tile:${t.char}`;
  if (t.kind === 'entity') return `entity:${t.type}`;
  return t.kind;
}

function fieldHtml(key, p, value) {
  const label = `<label>${esc(p.label || key)}</label>`;
  switch (p.type) {
    case 'bool':
      return `<label class="check field"><input type="checkbox" data-k="${key}" ${value ? 'checked' : ''}> ${esc(p.label || key)}</label>`;
    case 'number':
      return `<div class="field">${label}<input type="number" data-k="${key}" value="${value ?? 0}" ${p.min != null ? `min="${p.min}"` : ''} ${p.max != null ? `max="${p.max}"` : ''} step="${p.step ?? 1}"></div>`;
    case 'select':
      return `<div class="field">${label}<select data-k="${key}">${p.options.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    case 'text':
      return `<div class="field">${label}<textarea data-k="${key}" rows="3">${esc(value)}</textarea></div>`;
    case 'channel':
      return `<div class="field">${label}<div class="ch"><i class="ch-swatch" style="background:${channelColor(value)}"></i><input type="text" data-k="${key}" value="${esc(value)}" placeholder="a, b, ... (a,b = оба)"></div></div>`;
    default:
      return `<div class="field">${label}<input type="text" data-k="${key}" value="${esc(value)}"></div>`;
  }
}
