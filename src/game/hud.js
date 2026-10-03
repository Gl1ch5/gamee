import { abilityTypes } from '../engine/registry.js';
import { KEYMAP } from './input.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Интерфейс поверх игры (DOM): способности, энергия, часы петли, сообщения. */
export class Hud {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'hud';
    const lvl = game.level;
    const abil = game.abilities;
    this.el.innerHTML = `
      <div class="hud-top">
        <div class="hud-title sketch-box"><small>${esc(game.packName || '')}</small><b>${esc(lvl.name || 'Без названия')}</b></div>
        <div class="hud-right">
          <div class="hud-shards sketch-box" ${game.world.shardsTotal ? '' : 'hidden'}>⏳ <span>0</span>/${game.world.shardsTotal}</div>
          ${lvl.loop ? `<div class="hud-loop sketch-box">
            <svg viewBox="0 0 100 100" class="loop-clock">
              <circle cx="50" cy="50" r="42" class="clock-rim"/>
              <path class="clock-fill" d=""/>
              ${Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return `<line x1="${50 + Math.sin(a) * 34}" y1="${50 - Math.cos(a) * 34}" x2="${50 + Math.sin(a) * 40}" y2="${50 - Math.cos(a) * 40}" class="clock-tick"/>`; }).join('')}
              <line x1="50" y1="50" x2="50" y2="14" class="clock-hand"/>
              <circle cx="50" cy="50" r="4" class="clock-pin"/>
            </svg>
            <div class="loop-info"><b class="loop-time">0.0</b><span class="loop-echoes">эхо: 0/${lvl.loop.maxEchoes ?? 3}</span></div>
          </div>` : ''}
        </div>
      </div>
      <div class="hud-banner"></div>
      <div class="hud-tip" hidden></div>
      <div class="hud-bottom">
        ${abil.some((a) => abilityTypes.get(a)?.cost || a === 'slow') ? '<div class="energy sketch-box"><div class="energy-fill"></div><span>энергия</span></div>' : ''}
        <div class="abilities">
          ${abil.map((id) => {
            const a = abilityTypes.get(id);
            if (!a) return '';
            return `<div class="ability sketch-box" data-id="${id}" title="${esc(a.desc || '')}">
              <div class="ab-icon">${a.icon}</div><div class="ab-name">${esc(a.name)}</div><kbd>${esc(a.keyLabel)}</kbd>
              <div class="ab-bar"><i></i></div></div>`;
          }).join('')}
        </div>
      </div>
      <div class="hud-dead" hidden>
        <h2 class="scribble">Время сломалось!</h2>
        <p></p>
      </div>
      <div class="hud-panel" hidden></div>
    `;
    root.appendChild(this.el);
    this.q = (s) => this.el.querySelector(s);
    this.abEls = [...this.el.querySelectorAll('.ability')].map((el) => ({ el, a: abilityTypes.get(el.dataset.id), bar: el.querySelector('.ab-bar i') }));
    this.bannerT = 0;
    this.lastTip = null;
  }

  banner(text, cls = '', dur = 1.5) {
    const b = this.q('.hud-banner');
    b.textContent = text;
    b.className = `hud-banner show ${cls}`;
    this.bannerT = dur;
  }

  update(dt) {
    const g = this.game;
    const v = g.vars;
    for (const { el, a, bar } of this.abEls) {
      const st = a.status ? a.status(g) : { ready: true, active: false, fill: 1 };
      el.classList.toggle('active', !!st.active);
      el.classList.toggle('disabled', !st.ready);
      bar.style.width = `${Math.round((st.fill ?? 0) * 100)}%`;
    }
    const ef = this.q('.energy-fill');
    if (ef) ef.style.width = `${Math.round(v.energy * 100)}%`;
    const sh = this.q('.hud-shards span');
    if (sh) sh.textContent = g.world.countShards();
    if (g.level.loop) {
      const d = g.level.loop.duration;
      const t = Math.min(g.loopTime / d, 1);
      const a = t * Math.PI * 2;
      this.q('.clock-hand').setAttribute('x2', 50 + Math.sin(a) * 36);
      this.q('.clock-hand').setAttribute('y2', 50 - Math.cos(a) * 36);
      const large = t > 0.5 ? 1 : 0;
      const ex = 50 + Math.sin(a) * 42, ey = 50 - Math.cos(a) * 42;
      this.q('.clock-fill').setAttribute('d', t > 0.999 ? 'M50 8 A42 42 0 1 1 49.9 8 Z' : `M50 50 L50 8 A42 42 0 ${large} 1 ${ex} ${ey} Z`);
      this.q('.loop-time').textContent = `${Math.max(0, d - g.loopTime).toFixed(1)}с`;
      this.q('.loop-echoes').textContent = `эхо: ${g.recordings.length}/${g.level.loop.maxEchoes ?? 3}`;
      this.q('.hud-loop').classList.toggle('urgent', d - g.loopTime < 3);
    }
    // подсказки табличек
    const p = g.world.player;
    let tip = null;
    if (p) {
      const r = p.rect();
      for (const e of g.world.entities) {
        if (e.type !== 'sign') continue;
        const b = e.bounds();
        if (r.l < b.r && r.r > b.l && r.b < b.t && r.t > b.b) { tip = e.props.text; break; }
      }
    }
    if (tip !== this.lastTip) {
      const t = this.q('.hud-tip');
      t.hidden = !tip;
      if (tip) t.innerHTML = esc(tip).replace(/\[(\w+)\]/g, (_, k) => `<kbd>${keyName(k)}</kbd>`).replace(/\n/g, '<br>');
      this.lastTip = tip;
    }
    // смерть
    const dead = p && p.dead && !g.rewinding;
    const dd = this.q('.hud-dead');
    if (dead !== !dd.hidden) {
      dd.hidden = !dead;
      if (dead) {
        dd.querySelector('p').innerHTML = g.abilities.includes('rewind')
          ? 'Держите <kbd>R</kbd>, чтобы отмотать время назад' + (g.level.loop ? ', или <kbd>Q</kbd> — новая петля' : '')
          : 'Нажмите <kbd>Пробел</kbd>, чтобы попробовать снова';
      }
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.q('.hud-banner').classList.remove('show');
    }
  }

  showPanel(html) {
    const p = this.q('.hud-panel');
    p.innerHTML = html;
    p.hidden = false;
    return p;
  }
  hidePanel() {
    this.q('.hud-panel').hidden = true;
  }

  dispose() {
    this.el.remove();
  }
}

export function keyName(action) {
  const map = { left: '←', right: '→', jump: 'Пробел', down: '↓', rewind: 'R', loop: 'Q', stop: 'E', slow: 'C', recall: 'F', restart: 'Backspace', pause: 'Esc' };
  return map[action] || (KEYMAP[action] ? KEYMAP[action][0] : action);
}
