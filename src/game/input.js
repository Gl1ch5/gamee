import { BIT } from '../engine/constants.js';

export const KEYMAP = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  jump: ['Space', 'ArrowUp', 'KeyW', 'KeyZ'],
  down: ['ArrowDown', 'KeyS'],
  rewind: ['KeyR', 'ShiftLeft', 'KeyX'],
  loop: ['KeyQ'],
  stop: ['KeyE'],
  slow: ['KeyC'],
  recall: ['KeyF'],
  restart: ['Backspace'],
  pause: ['Escape', 'KeyP'],
};

// стандартная раскладка геймпада
const PAD = { jump: [0], rewind: [2, 6], loop: [4], stop: [5], slow: [3], recall: [1], pause: [9], restart: [8], down: [13], left: [14], right: [15] };

/**
 * Ввод опрашивается один раз за тик симуляции. Короткие нажатия
 * «защёлкиваются», чтобы не потеряться между тиками.
 */
export class Input {
  constructor() {
    this.held = new Set();
    this.latched = new Set();
    this.now = new Set();
    this.prev = new Set();
    this.enabled = true;
    this.codeToAction = new Map();
    for (const [a, codes] of Object.entries(KEYMAP)) for (const c of codes) this.codeToAction.set(c, a);
    this.onDown = (e) => {
      if (!this.enabled || e.target.closest?.('input, textarea, select')) return;
      const a = this.codeToAction.get(e.code);
      if (!a) return;
      if (a !== 'pause' || !e.repeat) e.preventDefault();
      this.held.add(a);
      this.latched.add(a);
    };
    this.onUp = (e) => {
      const a = this.codeToAction.get(e.code);
      if (a) this.held.delete(a);
    };
    this.onBlur = () => this.held.clear();
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  poll() {
    this.prev = this.now;
    this.now = new Set([...this.held, ...this.latched]);
    this.latched.clear();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      for (const [a, btns] of Object.entries(PAD)) if (btns.some((b) => p.buttons[b] && p.buttons[b].pressed)) this.now.add(a);
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (ax < -0.4) this.now.add('left');
      if (ax > 0.4) this.now.add('right');
      if (ay > 0.6) this.now.add('down');
    }
  }

  down(a) { return this.now.has(a); }
  pressed(a) { return this.now.has(a) && !this.prev.has(a); }

  bits() {
    let b = 0;
    if (this.now.has('left')) b |= BIT.LEFT;
    if (this.now.has('right')) b |= BIT.RIGHT;
    if (this.now.has('jump')) b |= BIT.JUMP;
    if (this.now.has('down')) b |= BIT.DOWN;
    return b;
  }

  reset() {
    this.held.clear();
    this.latched.clear();
    this.now.clear();
    this.prev.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
