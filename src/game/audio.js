/**
 * Крошечный синтезатор звуков на WebAudio — никаких файлов.
 */
class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    try {
      this.muted = localStorage.getItem('chrono.muted') === '1';
    } catch {
      this.muted = false;
    }
    this.rewindNode = null;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.35;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('chrono.muted', m ? '1' : '0');
    } catch { /* приватный режим */ }
    if (this.master) this.master.gain.value = m ? 0 : 0.35;
  }

  tone(freq, dur = 0.1, { type = 'square', vol = 0.3, slide = 0, delay = 0 } = {}) {
    const c = this.ensure();
    if (!c || this.muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur = 0.15, { vol = 0.3, freq = 800, delay = 0 } = {}) {
    const c = this.ensure();
    if (!c || this.muted) return;
    const t = c.currentTime + delay;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = vol;
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
  }

  play(name, data = {}) {
    switch (name) {
      case 'jump': if (!data.echo) this.tone(320, 0.12, { slide: 260, vol: 0.12 }); break;
      case 'land': this.noise(0.08, { vol: Math.min(0.3, (data.power || 8) / 60), freq: 400 }); break;
      case 'death': this.tone(220, 0.5, { type: 'sawtooth', slide: -180, vol: 0.2 }); this.noise(0.3, { vol: 0.2 }); break;
      case 'plateOn': this.tone(660, 0.06, { vol: 0.1 }); this.tone(990, 0.08, { vol: 0.08, delay: 0.05 }); break;
      case 'plateOff': this.tone(440, 0.06, { vol: 0.08 }); break;
      case 'button': this.tone(880, 0.08, { vol: 0.1, type: 'triangle' }); break;
      case 'tick': this.tone(1500, 0.03, { vol: 0.06, type: 'triangle' }); break;
      case 'lever': this.noise(0.05, { vol: 0.2, freq: 2000 }); this.tone(300, 0.05, { vol: 0.1 }); break;
      case 'door': this.noise(0.25, { vol: 0.12, freq: 300 }); break;
      case 'shard': [0, 4, 7, 12].forEach((n, i) => this.tone(660 * 2 ** (n / 12), 0.15, { type: 'triangle', vol: 0.12, delay: i * 0.06 })); break;
      case 'win': [0, 4, 7, 12, 16, 19].forEach((n, i) => this.tone(523 * 2 ** (n / 12), 0.3, { type: 'triangle', vol: 0.14, delay: i * 0.09 })); break;
      case 'stop': this.tone(1200, 0.6, { type: 'sine', vol: 0.2, slide: -900 }); this.tone(600, 0.8, { type: 'triangle', vol: 0.1 }); break;
      case 'slow': this.tone(500, 0.5, { type: 'sine', vol: 0.15, slide: -300 }); break;
      case 'resume': this.tone(300, 0.3, { type: 'sine', vol: 0.12, slide: 500 }); break;
      case 'recall': this.tone(200, 0.25, { type: 'sine', vol: 0.18, slide: 1200 }); break;
      case 'loop': [12, 7, 4, 0].forEach((n, i) => this.tone(440 * 2 ** (n / 12), 0.25, { type: 'triangle', vol: 0.12, delay: i * 0.07 })); this.noise(0.6, { vol: 0.12, freq: 3000 }); break;
      case 'denied': this.tone(150, 0.12, { vol: 0.12 }); break;
      case 'crumble': this.noise(0.3, { vol: 0.25, freq: 600 }); break;
      case 'grow': this.tone(400 + Math.random() * 200, 0.08, { type: 'sine', vol: 0.06, slide: 200 }); break;
      case 'clockTick': this.tone(data.tock ? 1100 : 1400, 0.025, { vol: 0.05, type: 'triangle' }); break;
      case 'ui': this.tone(700, 0.05, { vol: 0.08, type: 'triangle' }); break;
      case 'paint': this.tone(500 + Math.random() * 100, 0.03, { vol: 0.04, type: 'triangle' }); break;
      default: break;
    }
  }

  /** Непрерывный «вжух» во время перемотки */
  rewind(on, speed = 1) {
    const c = this.ensure();
    if (!c) return;
    if (on && !this.rewindNode && !this.muted) {
      const o = c.createOscillator();
      const o2 = c.createOscillator();
      const g = c.createGain();
      o.type = 'sawtooth';
      o2.type = 'sawtooth';
      o.frequency.value = 180;
      o2.frequency.value = 183;
      g.gain.value = 0.0;
      g.gain.setTargetAtTime(0.06, c.currentTime, 0.05);
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      f.Q.value = 3;
      o.connect(f);
      o2.connect(f);
      f.connect(g).connect(this.master);
      o.start();
      o2.start();
      this.rewindNode = { o, o2, g, f };
    }
    if (this.rewindNode) {
      if (on) {
        const t = c.currentTime;
        this.rewindNode.o.frequency.setTargetAtTime(140 + speed * 60 + Math.sin(t * 20) * 20, t, 0.05);
        this.rewindNode.f.frequency.setTargetAtTime(700 + speed * 400, t, 0.1);
      } else {
        const n = this.rewindNode;
        n.g.gain.setTargetAtTime(0, c.currentTime, 0.04);
        setTimeout(() => { n.o.stop(); n.o2.stop(); }, 200);
        this.rewindNode = null;
      }
    }
  }
}

export const sfx = new Sfx();
