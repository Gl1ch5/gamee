// Редактор уровней: тот же рендер three.js, правка мышью, формулы с проверкой и графиком,
// ползунок времени, свои типы объектов и плагины.
import { World } from './sim.js';
import { listTypes, resolveDef, INK } from './types.js';
import { compile, getExpr, Fns } from './expr.js';

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const SEL = '#ff2d87';
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const k of kids) n.append(k);
  return n;
};

export class Editor {
  constructor(app) {
    this.app = app; this.gfx = app.gfx;
    this.grid = 0.5; this.tool = 'select'; this.placeType = null;
    this.sel = []; this.drag = null; this.mouse = [0, 0]; this.T = 0; this.playing = false; this.pf = 0;
    this.history = []; this.future = []; this.plotTarget = null; this.trailCache = new Map();
    this.bindUi();
  }

  // ---------- жизненный цикл ----------
  open(level) {
    this.level = clone(level);
    if (!Array.isArray(this.level.entities)) this.level.entities = [];
    if (!this.level.entities.some((e) => e.type === 'spawn')) this.level.entities.push({ type: 'spawn', x: 0, y: 0.5 });
    this.history = []; this.future = []; this.lastJSON = JSON.stringify(this.level);
    this.sel = []; this.tool = 'select'; this.placeType = null; this.T = 0; this.playing = false;
    $('editor').classList.remove('hidden');
    $('e-name').value = this.level.name || '';
    this.rebuild();
    const [x0, y0, x1, y1] = this.world.bounds;
    const g = this.gfx;
    g.cam.x = (x0 + x1) / 2; g.cam.y = (y0 + y1) / 2 + 2;
    g.cam.view = Math.max(10, Math.min(60, Math.max((y1 - y0) * 0.75, ((x1 - x0) / g.aspect) * 0.8)));
    this.buildPalette(); this.buildObj(); this.buildLvl(); this.buildPlug();
    this.updateButtons();
  }
  resume() { $('editor').classList.remove('hidden'); this.app.mode = 'edit'; this.rebuild(); this.buildPalette(); this.buildObj(); }

  rebuild() {
    try { this.world = new World(this.level, { editing: true }); } catch (err) { this.status('Ошибка уровня: ' + err.message, true); return; }
    this.trailCache.clear();
    const tmax = this.tmax();
    const r = $('e-T'); r.max = tmax; if (this.T > tmax) this.T = 0;
    this.world.evalStatic(this.T);
  }
  tmax() { return this.level.loop > 0 ? this.level.loop : 20; }

  status(msg, bad) { const s = $('ed-status'); s.textContent = msg; s.style.color = bad ? '#d6453d' : ''; clearTimeout(this.stT); this.stT = setTimeout(() => { s.textContent = ''; }, 3500); }

  // ---------- история ----------
  commit() {
    const js = JSON.stringify(this.level);
    if (js === this.lastJSON) return;
    this.history.push(this.lastJSON); if (this.history.length > 120) this.history.shift();
    this.lastJSON = js; this.future = [];
    this.updateButtons();
  }
  undo() {
    if (!this.history.length) return;
    this.future.push(this.lastJSON); this.lastJSON = this.history.pop(); this.level = JSON.parse(this.lastJSON);
    this.afterHistory();
  }
  redo() {
    if (!this.future.length) return;
    this.history.push(this.lastJSON); this.lastJSON = this.future.pop(); this.level = JSON.parse(this.lastJSON);
    this.afterHistory();
  }
  afterHistory() {
    this.sel = this.sel.filter((i) => i < this.level.entities.length);
    $('e-name').value = this.level.name || '';
    this.rebuild(); this.buildPalette(); this.buildObj(); this.buildLvl(); this.updateButtons();
  }
  updateButtons() { $('e-undo').disabled = !this.history.length; $('e-redo').disabled = !this.future.length; }
  live() { this.rebuild(); }

  // ---------- UI ----------
  bindUi() {
    const cv = $('c');
    cv.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    cv.addEventListener('wheel', (e) => { if (this.app.mode !== 'edit') return; e.preventDefault(); this.zoom(e); }, { passive: false });
    cv.addEventListener('contextmenu', (e) => { if (this.app.mode === 'edit') e.preventDefault(); });
    $('e-back').onclick = () => this.app.showMenu();
    $('e-name').onchange = (e) => { this.level.name = e.target.value; this.commit(); };
    $('e-undo').onclick = () => this.undo(); $('e-redo').onclick = () => this.redo();
    $('e-grid').onchange = (e) => { this.grid = parseFloat(e.target.value); };
    $('e-test').onclick = () => this.test();
    $('e-play').onclick = () => { this.playing = !this.playing; $('e-play').textContent = this.playing ? '⏸' : '▶'; };
    $('e-T').oninput = (e) => { this.T = parseFloat(e.target.value); this.playing = false; $('e-play').textContent = '▶'; };
    $('e-help').onclick = () => $('ed-help').classList.toggle('hidden');
    $('e-help-ok').onclick = () => $('ed-help').classList.add('hidden');
    $('e-save').onclick = () => { const n = this.level.name || 'Без названия'; this.level.name = n; this.app.saveUserLevel(n, clone(this.level)); this.status(`Сохранено в браузере: «${n}»`); };
    $('e-dl').onclick = () => {
      const blob = new Blob([JSON.stringify(this.level, null, 2)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: `${(this.level.name || 'level').replace(/[^\wЀ-ӿ-]+/g, '_')}.json` });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $('e-load').onclick = () => $('e-file').click();
    $('e-file').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const lv = JSON.parse(await f.text());
        if (!Array.isArray(lv.entities)) throw new Error('нет массива entities');
        this.level = lv; this.sel = []; this.commit(); $('e-name').value = lv.name || '';
        this.rebuild(); this.buildPalette(); this.buildObj(); this.buildLvl(); this.status('Уровень загружен');
      } catch (err) { this.status('Не удалось загрузить: ' + err.message, true); }
    };
    $('e-copy').onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(this.level, null, 2)); this.status('JSON скопирован'); } catch { this.status('Буфер обмена недоступен', true); } };
    document.querySelectorAll('#ed-ins .tabs button').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('#ed-ins .tabs button').forEach((x) => x.classList.toggle('on', x === b));
        for (const t of ['obj', 'lvl', 'plug']) $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab);
        if (b.dataset.tab !== 'obj') this.plotTarget = null, $('plotbox').classList.add('hidden');
      };
    });
  }

  buildPalette() {
    const box = $('ed-pal'); box.innerHTML = '';
    const mk = (label, onclick, on) => { const b = el('button', { textContent: label, className: on ? 'on' : '' }); b.onclick = onclick; box.append(b); return b; };
    box.append(el('h4', { textContent: 'Инструмент' }));
    mk('✥ Выбор', () => { this.tool = 'select'; this.placeType = null; this.buildPalette(); }, this.tool === 'select');
    box.append(el('h4', { textContent: 'Объекты' }));
    for (const { name, def } of listTypes(this.level.types)) {
      mk(`${def.icon || '■'} ${def.label || name}`, () => { this.tool = 'place'; this.placeType = name; this.sel = []; this.buildObj(); this.buildPalette(); }, this.tool === 'place' && this.placeType === name);
    }
  }

  fieldWrap(label, node, extra) { const d = el('div', { className: 'fld' }); if (label) d.append(el('label', { textContent: label })); d.append(node); if (extra) d.append(extra); return d; }

  varChips(input, spec) {
    const w = this.world;
    const names = new Set(['t', 'T', 'loop', 'px', 'py', 'crystals']);
    for (const e of w.entities) if (e.id && e.def.signal) names.add(e.id);
    for (const [k] of w.defVars) names.add(k);
    for (const k of Object.keys(w.scope.$f)) names.add(k + '(');
    const ent = w.entities[this.sel[0]];
    if (ent) for (const k of Object.keys({ ...ent.def.params, ...spec?.params })) names.add(k);
    ['sin(', 'cos(', 'abs(', 'sq(t,2)', 'tri(t,4)', 'saw(t,3)', 'ease(', 'min(', 'max(', 'clamp(', 'noise(', 'pi'].forEach((x) => names.add(x));
    const box = el('div', { className: 'chips' });
    for (const n of [...names].slice(0, 40)) {
      const c = el('span', { className: 'chip', textContent: n });
      c.onmousedown = (e) => e.preventDefault();
      c.onclick = () => {
        const s = input.selectionStart ?? input.value.length;
        input.value = input.value.slice(0, s) + n + input.value.slice(input.selectionEnd ?? s);
        input.focus(); input.setSelectionRange(s + n.length, s + n.length); input.dispatchEvent(new Event('input'));
      };
      box.append(c);
    }
    return box;
  }

  exprInput(value, onInput, onCommit, plot, spec) {
    const input = el('input', { type: 'text', value: value ?? '', spellcheck: false });
    const err = el('div', { className: 'err' });
    const chips = this.varChips(input, spec);
    chips.classList.add('hidden');
    const validate = () => { const c = compile(input.value); input.classList.toggle('bad', !!c.error); err.textContent = c.error ? '⚠ ' + c.error : ''; return !c.error; };
    input.oninput = () => { validate(); onInput(input.value); };
    input.onchange = () => { onCommit(input.value); };
    input.onfocus = () => { chips.classList.remove('hidden'); this.plotTarget = plot; $('plotbox').classList.remove('hidden'); this.drawPlot(); };
    input.onblur = () => setTimeout(() => chips.classList.add('hidden'), 150);
    validate();
    const wrap = el('div'); wrap.append(input, err, chips);
    return wrap;
  }

  buildObj() {
    const box = $('tab-obj'); box.innerHTML = '';
    this.plotTarget = null; $('plotbox').classList.add('hidden');
    const sel = this.sel;
    if (!sel.length) {
      box.append(el('p', { textContent: this.tool === 'place' ? 'Кликни на поле, чтобы поставить объект, или протяни рамку нужного размера.' : 'Выбери объект кликом или рамкой. Выбери тип слева и кликни на поле, чтобы добавить.', style: 'font-size:18px;color:var(--ink2)' }));
      return;
    }
    if (sel.length > 1) {
      box.append(el('p', { textContent: `Выбрано объектов: ${sel.length}` }));
      box.append(this.actionButtons());
      return;
    }
    const spec = this.level.entities[sel[0]];
    if (!spec) return;
    const def = resolveDef(spec.type, this.level.types);
    const typeSel = el('select');
    for (const { name, def: d } of listTypes(this.level.types)) typeSel.append(el('option', { value: name, textContent: `${d.icon || ''} ${d.label || name}`, selected: name === spec.type }));
    if (!listTypes(this.level.types).some((t) => t.name === spec.type)) typeSel.append(el('option', { value: spec.type, textContent: spec.type, selected: true }));
    typeSel.onchange = () => { spec.type = typeSel.value; this.commit(); this.rebuild(); this.buildObj(); };
    box.append(this.fieldWrap('тип', typeSel));
    const idx = sel[0];
    const num = (key, label) => {
      const i = el('input', { type: 'number', step: 0.25, value: +(spec[key] ?? def.defaults?.[key] ?? 0).toFixed(3) });
      i.oninput = () => { const v = parseFloat(i.value); if (Number.isFinite(v)) { spec[key] = v; this.live(); } };
      i.onchange = () => this.commit();
      return this.fieldWrap(label, i);
    };
    const row = el('div', { className: 'two' });
    row.append(num('x', 'x'), num('y', 'y'), num('w', 'ширина'), num('h', 'высота'));
    box.append(row);
    const props = def.props || {};
    if ('id' in (def.defaults || {}) || props.id) {
      const i = el('input', { type: 'text', value: spec.id ?? def.defaults?.id ?? '', placeholder: 'буквы/цифры' });
      i.oninput = () => { spec.id = i.value.replace(/[^\w$]/g, ''); this.live(); };
      i.onchange = () => { i.value = spec.id ?? ''; this.commit(); };
      box.append(this.fieldWrap('id — имя сигнала в формулах', i));
    }
    for (const [key, p] of Object.entries(props)) {
      if (key === 'id' || ['x', 'y', 'w', 'h'].includes(key)) continue;
      const label = p.label || key;
      const val = spec[key] ?? def.defaults?.[key] ?? p.default ?? '';
      if (p.type === 'expr') {
        box.append(this.fieldWrap(label, this.exprInput(val, (v) => { spec[key] = v; this.live(); }, () => this.commit(), { entity: idx, key }, spec)));
      } else if (p.type === 'bool') {
        const c = el('input', { type: 'checkbox', checked: !!val }); c.onchange = () => { spec[key] = c.checked; this.commit(); this.live(); };
        box.append(this.fieldWrap(label, c));
      } else if (p.type === 'color') {
        const c = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(val) ? val : '#cccccc' });
        c.oninput = () => { spec[key] = c.value; this.live(); }; c.onchange = () => this.commit();
        box.append(this.fieldWrap(label, c));
      } else if (p.type === 'select') {
        const s = el('select'); for (const o of p.options) s.append(el('option', { value: o, textContent: o, selected: o === val }));
        s.onchange = () => { spec[key] = s.value; this.commit(); this.live(); };
        box.append(this.fieldWrap(label, s));
      } else if (p.type === 'number') {
        const i = el('input', { type: 'number', step: 0.1, value: val });
        i.oninput = () => { const v = parseFloat(i.value); if (Number.isFinite(v)) { spec[key] = v; this.live(); } }; i.onchange = () => this.commit();
        box.append(this.fieldWrap(label, i));
      } else {
        const i = el('input', { type: 'text', value: val });
        i.oninput = () => { spec[key] = i.value; this.live(); }; i.onchange = () => this.commit();
        box.append(this.fieldWrap(label, i));
      }
    }
    // параметры экземпляра: подставляются в формулы как переменные
    const pi = el('input', { type: 'text', value: Object.entries(spec.params || {}).map(([k, v]) => `${k}=${v}`).join(', '), placeholder: 'amp=4, w=2' });
    const defP = Object.entries(def.params || {}).map(([k, v]) => `${k}=${v}`).join(', ');
    pi.onchange = () => {
      const params = {};
      for (const part of pi.value.split(',')) { const [k, v] = part.split('='); if (k && v !== undefined && Number.isFinite(parseFloat(v))) params[k.trim()] = parseFloat(v); }
      if (Object.keys(params).length) spec.params = params; else delete spec.params;
      this.commit(); this.rebuild();
    };
    box.append(this.fieldWrap(`параметры → переменные формул${defP ? ` (по умолчанию: ${defP})` : ''}`, pi));
    box.append(this.actionButtons());
  }

  actionButtons() {
    const d = el('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' });
    const dup = el('button', { textContent: '⧉ Дубль', className: 'small' }); dup.onclick = () => this.duplicate();
    const del = el('button', { textContent: '🗑 Удалить', className: 'small' }); del.onclick = () => this.deleteSel();
    d.append(dup, del);
    return d;
  }

  buildLvl() {
    const box = $('tab-lvl'); box.innerHTML = '';
    const L = this.level;
    L.rules = L.rules || {};
    const txt = (label, key, ph) => {
      const i = el('input', { type: 'text', value: L[key] ?? '', placeholder: ph || '' });
      i.oninput = () => { L[key] = i.value; }; i.onchange = () => { this.commit(); };
      box.append(this.fieldWrap(label, i));
    };
    txt('название', 'name'); txt('подсказка в уровне', 'hint'); txt('подзаголовок в меню', 'subtitle');
    const loop = el('input', { type: 'number', step: 1, min: 0, value: L.loop ?? 10 });
    loop.oninput = () => { L.loop = Math.max(0, parseFloat(loop.value) || 0); this.rebuild(); }; loop.onchange = () => this.commit();
    box.append(this.fieldWrap('длина петли, сек (0 — без петли)', loop));
    const gh = el('input', { type: 'number', step: 1, min: 0, value: L.rules.maxGhosts ?? 3 });
    gh.oninput = () => { L.rules.maxGhosts = Math.max(0, parseInt(gh.value, 10) || 0); }; gh.onchange = () => this.commit();
    box.append(this.fieldWrap('максимум призраков', gh));
    box.append(el('h4', { textContent: 'Правила — это формулы (доступны T, loop, px, py…)', style: 'margin:10px 0 2px;font-weight:500;color:var(--ink2);font-size:17px' }));
    const defaults = { gravity: '34', speed: '7.5', jump: '13.5', timeScale: '1' };
    const labels = { gravity: 'gravity — гравитация (знак = направление)', speed: 'speed — скорость бега', jump: 'jump — сила прыжка', timeScale: 'timeScale — ход мирового времени' };
    for (const k of Object.keys(defaults)) {
      box.append(this.fieldWrap(labels[k], this.exprInput(L.rules[k] ?? defaults[k],
        (v) => { L.rules[k] = v; this.rebuild(); }, () => { if (L.rules[k] === defaults[k]) delete L.rules[k]; this.commit(); }, { rule: k }, null)));
    }
    const defsText = Object.entries(L.defs || {}).map(([k, v]) => `${k} = ${v}`).join('\n');
    const dt = el('textarea', { rows: 5, value: defsText, spellcheck: false, placeholder: 'w = 2*pi/6\nwave(a,b) = a*sin(w*T+b)' });
    const dErr = el('div', { className: 'err' });
    dt.oninput = () => {
      const { defs, errs } = this.parseDefs(dt.value);
      dt.classList.toggle('bad', errs.length > 0); dErr.textContent = errs.join(' · ');
      if (!errs.length) { L.defs = defs; if (!Object.keys(defs).length) delete L.defs; this.rebuild(); }
    };
    dt.onchange = () => this.commit();
    box.append(this.fieldWrap('defs — свои переменные и функции (по строке)', dt, dErr));
    const tt = el('textarea', { rows: 7, value: L.types ? JSON.stringify(L.types, null, 1) : '', spellcheck: false, placeholder: '{"pendulum":{"extends":"platform","params":{"amp":3},"defaults":{"px":"amp*sin(t*2)"}}}' });
    const tErr = el('div', { className: 'err' });
    tt.oninput = () => {
      if (!tt.value.trim()) { delete L.types; tt.classList.remove('bad'); tErr.textContent = ''; this.rebuild(); this.buildPalette(); return; }
      try { L.types = JSON.parse(tt.value); tt.classList.remove('bad'); tErr.textContent = ''; this.rebuild(); this.buildPalette(); } catch (e) { tt.classList.add('bad'); tErr.textContent = '⚠ ' + e.message; }
    };
    tt.onchange = () => this.commit();
    box.append(this.fieldWrap('types — свои типы объектов (JSON, extends + defaults + params)', tt, tErr));
  }

  parseDefs(text) {
    const defs = {}, errs = [];
    for (const line of text.split('\n')) {
      const l = line.replace(/#.*$/, '').trim();
      if (!l) continue;
      const i = l.indexOf('=');
      if (i < 1) { errs.push(`нет «=»: ${l}`); continue; }
      const key = l.slice(0, i).trim(), val = l.slice(i + 1).trim();
      const c = compile(val);
      if (c.error) errs.push(`${key}: ${c.error}`);
      defs[key] = val;
    }
    return { defs, errs };
  }

  buildPlug() {
    const box = $('tab-plug'); box.innerHTML = '';
    box.append(el('p', { textContent: 'Плагин — JS-модуль, который добавляет новые типы объектов и функции для формул. Движок менять не нужно.', style: 'font-size:17px;color:var(--ink2)' }));
    for (const p of this.app.pluginStatus || []) box.append(el('div', { textContent: `${p.ok ? '✓' : '✗'} ${p.label}${p.err ? ' — ' + p.err : ''}`, style: `font-size:17px;color:${p.ok ? '#2a7d5f' : '#d6453d'}` }));
    const url = el('input', { type: 'text', placeholder: 'https://…/мой-плагин.js или plugins/x.js' });
    const b = el('button', { textContent: 'Подключить', className: 'small' });
    b.onclick = async () => {
      if (!url.value.trim()) return;
      const u = new URL(url.value.trim(), location.href).href;
      const err = await this.app.loadPlugin(u, url.value.trim());
      if (!err) { try { const k = JSON.parse(localStorage.getItem('chrono.plugins') || '[]'); k.push(u); localStorage.setItem('chrono.plugins', JSON.stringify(k)); } catch { /* ignore */ } }
      this.buildPlug(); this.buildPalette(); this.rebuild();
      this.status(err ? 'Ошибка плагина: ' + err : 'Плагин подключён', !!err);
    };
    box.append(this.fieldWrap('адрес модуля', url), b);
    box.append(el('pre', { textContent: "export default function (api) {\n  api.registerType('fan', {\n    label: 'Вентилятор', icon: '✲',\n    defaults: { w: 2, h: 3 },\n    sense(e, w) { /* ... */ },\n    draw(e, w, g) { g.rect(e.x, e.y, e.w, e.h, { fill: '#ccc' }); },\n  });\n  api.registerFunction('zig', (x) => Math.abs(x % 2 - 1));\n}", style: 'font-size:14px;background:#fffaf0;border:2px dashed var(--ink2);padding:6px;overflow:auto;white-space:pre' }));
  }

  // ---------- график формулы ----------
  drawPlot() {
    const tg = this.plotTarget, w = this.world;
    if (!tg || !w) return;
    const cv = $('plot'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height, tmax = this.tmax();
    let fn, scope, label, tOff = 0;
    if (tg.rule) {
      label = tg.rule; scope = w.scope; fn = getExpr(w.rules[tg.rule]).fn;
    } else {
      const e = w.entities[tg.entity]; if (!e) return;
      label = `${e.type}.${tg.key}`; scope = e.scope; fn = getExpr(e.get(tg.key)).fn; tOff = e.num('phase');
    }
    const N = 220, vals = [];
    const saveT = w.scope.T, saveS = scope.t;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * tmax;
      w.scope.T = t; scope.t = t + (tg.rule ? 0 : tOff);
      const v = fn(scope);
      vals.push(v); mn = Math.min(mn, v); mx = Math.max(mx, v);
    }
    w.scope.T = saveT; scope.t = saveS;
    if (mx - mn < 1e-6) { mn -= 1; mx += 1; }
    const pad = (mx - mn) * 0.12; mn -= pad; mx += pad;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fffaf0'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(90,83,120,.25)'; ctx.lineWidth = 1;
    for (let s = 0; s <= tmax; s += tmax > 12 ? 5 : 1) { const x = (s / tmax) * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    const y0 = H - ((0 - mn) / (mx - mn)) * H;
    ctx.strokeStyle = 'rgba(43,37,64,.5)'; ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
    ctx.strokeStyle = '#ff6b4a'; ctx.lineWidth = 2.5; ctx.beginPath();
    vals.forEach((v, i) => { const x = (i / N) * W, y = H - ((v - mn) / (mx - mn)) * H; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    const tx = (this.T / tmax) * W;
    ctx.strokeStyle = '#2bb3a8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx, H); ctx.stroke();
    ctx.fillStyle = '#2b2540'; ctx.font = '13px sans-serif';
    ctx.fillText(`${mx.toFixed(2)}`, 4, 13); ctx.fillText(`${mn.toFixed(2)}`, 4, H - 4);
    $('plot-title').textContent = `${label}(t), t ∈ [0, ${tmax}]`;
  }

  // ---------- мышь ----------
  snap(v) { return this.grid > 0 ? Math.round(v / this.grid) * this.grid : v; }
  worldPos(e) { return this.gfx.screenToWorld(e.clientX, e.clientY); }
  rectOf(i) { const e = this.world.entities[i]; return { x: e.s.x, y: e.s.y, w: e.w, h: e.h }; }

  hitEntity(wx, wy) {
    const hits = [];
    this.world.entities.forEach((e, i) => {
      const r = { x: e.s.x, y: e.s.y, w: Math.max(e.w, 0.5), h: Math.max(e.h, 0.5) };
      if (Math.abs(wx - r.x) <= r.w / 2 && Math.abs(wy - r.y) <= r.h / 2) hits.push({ i, area: r.w * r.h * (e.def.isZone ? 20 : 1) });
    });
    hits.sort((a, b) => a.area - b.area);
    return hits.length ? hits[0].i : -1;
  }

  handles(r) {
    const hx = r.w / 2, hy = r.h / 2;
    return [['nw', -hx, hy], ['n', 0, hy], ['ne', hx, hy], ['e', hx, 0], ['se', hx, -hy], ['s', 0, -hy], ['sw', -hx, -hy], ['w', -hx, 0]].map(([k, dx, dy]) => ({ k, x: r.x + dx, y: r.y + dy }));
  }

  onDown(e) {
    if (this.app.mode !== 'edit') return;
    const [wx, wy] = this.worldPos(e);
    if (e.button === 1 || (e.button === 0 && this.app.keys.Space)) { this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY }; e.preventDefault(); return; }
    if (e.button === 2) return;
    if (this.tool === 'place' && this.placeType) {
      this.drag = { kind: 'create', x0: this.snap(wx), y0: this.snap(wy), x1: this.snap(wx), y1: this.snap(wy) };
      return;
    }
    if (this.sel.length === 1) {
      const r = this.rectOf(this.sel[0]), rad = 0.22 * this.gfx.cam.view / 15 + 0.08;
      const h = this.handles(r).find((hh) => Math.hypot(hh.x - wx, hh.y - wy) < rad);
      if (h) {
        const spec = this.level.entities[this.sel[0]];
        this.drag = { kind: 'resize', k: h.k, spec, l: r.x - r.w / 2, rt: r.x + r.w / 2, b: r.y - r.h / 2, t: r.y + r.h / 2, ox: spec.x ?? 0, oy: spec.y ?? 0, cx: r.x, cy: r.y };
        return;
      }
    }
    const i = this.hitEntity(wx, wy);
    if (i >= 0) {
      if (e.shiftKey) { this.sel = this.sel.includes(i) ? this.sel.filter((s) => s !== i) : [...this.sel, i]; }
      else if (!this.sel.includes(i)) this.sel = [i];
      this.buildObj();
      const orig = this.sel.map((s) => ({ s: this.level.entities[s], x: this.level.entities[s].x ?? 0, y: this.level.entities[s].y ?? 0 }));
      this.drag = { kind: 'move', sx: this.snap(wx), sy: this.snap(wy), rx: wx, ry: wy, orig, moved: false };
    } else {
      if (!e.shiftKey) { this.sel = []; this.buildObj(); }
      this.drag = { kind: 'marquee', x0: wx, y0: wy, x1: wx, y1: wy, base: [...this.sel] };
    }
  }

  onMove(e) {
    if (this.app.mode !== 'edit') return;
    const [wx, wy] = this.worldPos(e);
    this.mouse = [wx, wy];
    $('c').style.cursor = this.app.keys.Space ? 'grab' : this.tool === 'place' ? 'crosshair' : 'default';
    const d = this.drag;
    if (!d) return;
    const g = this.gfx;
    if (d.kind === 'pan') {
      const k = g.cam.view / ($('c').clientHeight || 1);
      g.cam.x -= (e.clientX - d.sx) * k; g.cam.y += (e.clientY - d.sy) * k; d.sx = e.clientX; d.sy = e.clientY;
    } else if (d.kind === 'create') { d.x1 = this.snap(wx); d.y1 = this.snap(wy); }
    else if (d.kind === 'marquee') {
      d.x1 = wx; d.y1 = wy;
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      const inside = [];
      this.world.entities.forEach((en, i) => { if (Math.abs(en.s.x - (x0 + x1) / 2) <= (x1 - x0) / 2 + en.w / 2 && Math.abs(en.s.y - (y0 + y1) / 2) <= (y1 - y0) / 2 + en.h / 2) inside.push(i); });
      this.sel = [...new Set([...d.base, ...inside])];
    } else if (d.kind === 'move') {
      const dx = this.snap(wx) - d.sx, dy = this.snap(wy) - d.sy;
      if (!d.moved && Math.hypot(wx - d.rx, wy - d.ry) < 0.1) return;
      d.moved = true;
      for (const o of d.orig) { o.s.x = +(o.x + dx).toFixed(4); o.s.y = +(o.y + dy).toFixed(4); }
      this.live();
    } else if (d.kind === 'resize') {
      let { l, rt, b, t } = d;
      const sx = this.snap(wx), sy = this.snap(wy), min = Math.max(this.grid, 0.25);
      if (d.k.includes('w')) l = Math.min(sx, rt - min);
      if (d.k.includes('e')) rt = Math.max(sx, l + min);
      if (d.k === 'n' || d.k === 'ne' || d.k === 'nw') t = Math.max(sy, b + min);
      if (d.k === 's' || d.k === 'se' || d.k === 'sw') b = Math.min(sy, t + min);
      const nw = rt - l, nh = t - b, ncx = (l + rt) / 2, ncy = (b + t) / 2;
      d.spec.w = +nw.toFixed(4); d.spec.h = +nh.toFixed(4);
      d.spec.x = +(d.ox + (ncx - d.cx)).toFixed(4); d.spec.y = +(d.oy + (ncy - d.cy)).toFixed(4);
      this.live();
    }
  }

  onUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.kind === 'create') this.finishCreate(d);
    else if (d.kind === 'move' || d.kind === 'resize') { this.commit(); this.buildObj(); }
    else if (d.kind === 'marquee') this.buildObj();
  }

  finishCreate(d) {
    const def = resolveDef(this.placeType, this.level.types);
    const small = Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 0.3;
    const dw = def.defaults?.w ?? 1, dh = def.defaults?.h ?? 1;
    let x, y, w, h;
    if (small) { x = d.x0; y = d.y0; w = dw; h = dh; }
    else { w = Math.max(0.5, Math.abs(d.x1 - d.x0)); h = Math.max(0.5, Math.abs(d.y1 - d.y0)); x = (d.x0 + d.x1) / 2; y = (d.y0 + d.y1) / 2; }
    const spec = { type: this.placeType, x: +x.toFixed(3), y: +y.toFixed(3), w: +w.toFixed(3), h: +h.toFixed(3) };
    if ('id' in (def.defaults || {}) && def.defaults.id !== '') spec.id = this.nextId(def.defaults.id);
    if (spec.type === 'spawn') { this.level.entities = this.level.entities.filter((e) => e.type !== 'spawn'); }
    this.level.entities.push(spec);
    this.sel = [this.level.entities.length - 1];
    this.commit(); this.rebuild(); this.buildObj();
  }

  nextId(base) {
    const used = new Set(this.level.entities.map((e) => e.id).filter(Boolean));
    if (!used.has(base)) return base;
    for (let c = 98; c < 123; c++) { const s = String.fromCharCode(c); if (!used.has(s)) return s; }
    for (let i = 1; i < 99; i++) if (!used.has(base + i)) return base + i;
    return base;
  }

  zoom(e) {
    const g = this.gfx, before = this.worldPos(e);
    g.cam.view = Math.max(4, Math.min(90, g.cam.view * Math.exp(e.deltaY * 0.0012)));
    const after = this.worldPos(e);
    g.cam.x += before[0] - after[0]; g.cam.y += before[1] - after[1];
  }

  // ---------- действия ----------
  deleteSel() {
    if (!this.sel.length) return;
    const del = new Set(this.sel);
    this.level.entities = this.level.entities.filter((e, i) => !del.has(i));
    this.sel = []; this.commit(); this.rebuild(); this.buildObj();
  }
  duplicate() {
    if (!this.sel.length) return;
    const add = [];
    for (const i of this.sel) {
      const c = clone(this.level.entities[i]);
      if (c.type === 'spawn') continue;
      c.x = +((c.x ?? 0) + Math.max(1, this.grid)).toFixed(3); c.y = +((c.y ?? 0) + Math.max(1, this.grid)).toFixed(3);
      const def = resolveDef(c.type, this.level.types);
      if (c.id && def.signal) c.id = this.nextId(c.id);
      add.push(c);
    }
    const start = this.level.entities.length;
    this.level.entities.push(...add);
    this.sel = add.map((_, k) => start + k);
    this.commit(); this.rebuild(); this.buildObj();
  }
  test() { this.app.startLevel(clone(this.level), { fromEditor: true }); }

  onKey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (ctrl && e.code === 'KeyY') { e.preventDefault(); this.redo(); return; }
    if (ctrl && e.code === 'KeyD') { e.preventDefault(); this.duplicate(); return; }
    if (ctrl && e.code === 'KeyS') { e.preventDefault(); $('e-save').click(); return; }
    if (e.code === 'Delete' || e.code === 'Backspace') { this.deleteSel(); return; }
    if (e.code === 'Tab') { this.test(); return; }
    if (e.code === 'Escape') { if (!$('ed-help').classList.contains('hidden')) $('ed-help').classList.add('hidden'); else { this.tool = 'select'; this.placeType = null; this.sel = []; this.buildPalette(); this.buildObj(); } return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (arrows[e.code] && this.sel.length) {
      const st = Math.max(this.grid, 0.25);
      for (const i of this.sel) { const s = this.level.entities[i]; s.x = +((s.x ?? 0) + arrows[e.code][0] * st).toFixed(4); s.y = +((s.y ?? 0) + arrows[e.code][1] * st).toFixed(4); }
      this.commit(); this.rebuild(); this.buildObj();
    }
  }

  // ---------- кадр и оверлей ----------
  frame(dt) {
    if (!this.world) return;
    if (this.playing) { this.T += dt; if (this.T > this.tmax()) this.T = 0; $('e-T').value = this.T; }
    $('e-Tv').textContent = this.T.toFixed(2);
    this.world.evalStatic(this.T);
    this.world.events = [];
    if (this.plotTarget && ++this.pf % 6 === 0) this.drawPlot();
    this.gfx.renderWorld(this.world, dt, { freeCam: true, overlay: (g) => this.overlay(g) });
  }

  trail(i) {
    let pts = this.trailCache.get(i);
    if (pts) return pts;
    const w = this.world, e = w.entities[i], tmax = this.tmax();
    pts = [];
    if (!e.def.props?.px && !e.def.props?.py) { this.trailCache.set(i, pts); return pts; }
    const saveT = w.scope.T;
    const N = 140;
    for (let k = 0; k <= N; k++) {
      const t = (k / N) * tmax;
      w.scope.T = t; e.scope.t = t + e.num('phase');
      pts.push([e.x + e.ev('px'), e.y + e.ev('py')]);
    }
    w.scope.T = saveT;
    const moving = pts.some((p) => Math.abs(p[0] - pts[0][0]) > 0.05 || Math.abs(p[1] - pts[0][1]) > 0.05);
    if (!moving) pts = [];
    this.trailCache.set(i, pts);
    return pts;
  }

  overlay(g) {
    const w = this.world, Z = 12;
    // оси и границы
    g.line(-0.5, 0, 0.5, 0, { ink: '#d6453d', lw: 0.04, a: 0.5, z: Z, layer: 'alpha' }); g.line(0, -0.5, 0, 0.5, { ink: '#d6453d', lw: 0.04, a: 0.5, z: Z, layer: 'alpha' });
    const [bx0, by0, bx1, by1] = w.bounds;
    g.rect((bx0 + bx1) / 2, (by0 + by1) / 2, bx1 - bx0, by1 - by0, { fill: null, ink: '#8a7f6a', a: 0.35, dash: 0.4, lw: 0.05, z: Z - 1, layer: 'alpha' });
    // траектории
    w.entities.forEach((e, i) => {
      const pts = this.trail(i);
      if (pts.length < 2) return;
      const sel = this.sel.includes(i);
      g.path(pts, { ink: sel ? SEL : '#6b7ba8', a: sel ? 0.85 : 0.28, lw: sel ? 0.06 : 0.04, z: Z - 0.5, layer: 'alpha', dash: 0.16, seed: i });
      if (sel) {
        const tmax = this.tmax();
        for (let s = 0; s <= tmax + 0.001; s += tmax > 12 ? 2 : 1) { const p = pts[Math.min(pts.length - 1, Math.round((s / tmax) * (pts.length - 1)))]; g.circle(p[0], p[1], 0.09, { fill: SEL, ink: null, a: 0.9, z: Z, layer: 'alpha' }); }
        g.circle(pts[0][0], pts[0][1], 0.2, { fill: null, ink: SEL, a: 0.9, z: Z, layer: 'alpha', lw: 0.05 });
      }
    });
    // выделение
    for (const i of this.sel) {
      const e = w.entities[i]; if (!e) continue;
      const r = { x: e.s.x, y: e.s.y, w: Math.max(e.w, 0.3) + 0.2, h: Math.max(e.h, 0.3) + 0.2 };
      g.rect(r.x, r.y, r.w, r.h, { fill: null, ink: SEL, a: 0.95, dash: 0.22, lw: 0.06, z: Z, layer: 'alpha', seed: i });
      if (this.sel.length === 1) {
        const rad = 0.12 * this.gfx.cam.view / 15 + 0.04;
        for (const h of this.handles({ x: e.s.x, y: e.s.y, w: Math.max(e.w, 0.3), h: Math.max(e.h, 0.3) })) g.rect(h.x, h.y, rad * 2, rad * 2, { fill: '#fff', ink: SEL, a: 1, z: Z + 0.5, layer: 'alpha', lw: 0.05, seed: 1 });
      }
    }
    // превью создания / курсор
    const d = this.drag;
    if (d?.kind === 'create') {
      const x = (d.x0 + d.x1) / 2, y = (d.y0 + d.y1) / 2, ww = Math.abs(d.x1 - d.x0), hh = Math.abs(d.y1 - d.y0);
      if (ww > 0.01 || hh > 0.01) g.rect(x, y, Math.max(ww, 0.3), Math.max(hh, 0.3), { fill: '#ff6b4a', ink: SEL, a: 0.4, z: Z, layer: 'alpha', dash: 0.2 });
    } else if (this.tool === 'place' && this.placeType && !d) {
      const def = resolveDef(this.placeType, this.level.types);
      g.rect(this.snap(this.mouse[0]), this.snap(this.mouse[1]), def.defaults?.w ?? 1, def.defaults?.h ?? 1, { fill: '#ff6b4a', ink: SEL, a: 0.35, z: Z, layer: 'alpha', dash: 0.2 });
    }
    if (d?.kind === 'marquee') g.rect((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0), { fill: SEL, ink: SEL, a: 0.12, z: Z, layer: 'alpha', dash: 0.15, lw: 0.04 });
    // подпись
    const hov = this.hitEntity(this.mouse[0], this.mouse[1]);
    if (hov >= 0 && !d) { const e = w.entities[hov]; g.text(`${e.def.label || e.type}${e.id ? ' · ' + e.id : ''}`, e.s.x, e.s.y + e.h / 2 + 0.55, 0.42, INK, 0.9, { z: Z + 1 }); }
    const s = $('ed-status');
    if (!s.textContent) { s.textContent = `x ${this.mouse[0].toFixed(1)}  y ${this.mouse[1].toFixed(1)}`; clearTimeout(this.stT); this.stT = setTimeout(() => { s.textContent = ''; }, 120); }
  }
}
