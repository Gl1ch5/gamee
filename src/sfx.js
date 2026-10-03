// Минимальный синтезатор звуков на WebAudio (без файлов).
let ctx = null, mode = null, modeOsc = null, modeGain = null, lfo = null;
let muted = false;

function ensure() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function tone(freq, dur, type = 'sine', vol = 0.08, slideTo = 0, delay = 0) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.03);
}

export const sfx = {
  enable() { ensure(); },
  toggleMute() { muted = !muted; if (modeGain) modeGain.gain.value = 0; return muted; },
  play(ev) {
    switch (ev.type) {
      case 'jump': tone(340, 0.13, 'triangle', 0.07, 640); break;
      case 'land': tone(130, 0.09, 'sine', Math.min(0.12, 0.04 + ev.v * 0.004), 60); break;
      case 'collect': [660, 880, 1320].forEach((f, i) => tone(f, 0.18, 'triangle', 0.07, 0, i * 0.06)); break;
      case 'death': tone(380, 0.5, 'sawtooth', 0.08, 40); tone(90, 0.4, 'square', 0.05, 30); break;
      case 'plate': tone(ev.on ? 520 : 330, 0.1, 'square', 0.04); break;
      case 'door': tone(180, 0.3, 'sawtooth', 0.035, 420); break;
      case 'freeze': tone(1100, 0.45, 'sine', 0.07, 260); tone(1650, 0.3, 'triangle', 0.03, 400); break;
      case 'loop': tone(220, 0.5, 'sine', 0.1, 880); [523, 659, 784].forEach((f, i) => tone(f, 0.25, 'triangle', 0.05, 0, 0.1 + i * 0.07)); break;
      case 'win': [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.35, 'triangle', 0.08, 0, i * 0.09)); break;
      case 'respawn': tone(300, 0.2, 'sine', 0.05, 700); break;
      default: break;
    }
  },
  tick(high) { tone(high ? 1500 : 1100, 0.025, 'square', 0.012); },
  // непрерывный фон способностей: перемотка / замедление / ускорение
  setMode(fx) {
    const m = fx.rewind ? 'rewind' : fx.slow ? 'slow' : fx.fast ? 'fast' : null;
    const c = ctx;
    if (!c) return;
    if (!modeOsc) {
      modeOsc = c.createOscillator(); modeGain = c.createGain(); lfo = c.createOscillator();
      const lg = c.createGain(); lg.gain.value = 40;
      lfo.frequency.value = 7; lfo.connect(lg).connect(modeOsc.frequency);
      modeOsc.type = 'triangle'; modeGain.gain.value = 0;
      modeOsc.connect(modeGain).connect(c.destination);
      modeOsc.start(); lfo.start();
    }
    if (m === mode) return;
    mode = m;
    const t = c.currentTime;
    modeGain.gain.cancelScheduledValues(t);
    modeGain.gain.linearRampToValueAtTime(m && !muted ? 0.045 : 0, t + 0.08);
    if (m === 'rewind') { modeOsc.frequency.cancelScheduledValues(t); modeOsc.frequency.setValueAtTime(520, t); modeOsc.frequency.exponentialRampToValueAtTime(110, t + 1.2); lfo.frequency.value = 14; }
    else if (m === 'slow') { modeOsc.frequency.setValueAtTime(95, t); lfo.frequency.value = 2.5; }
    else if (m === 'fast') { modeOsc.frequency.setValueAtTime(640, t); lfo.frequency.value = 22; }
  },
};
