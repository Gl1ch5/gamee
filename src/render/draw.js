import * as THREE from 'three';

/** Детерминированный ГПСЧ, чтобы рисунки «от руки» были стабильными. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const INK = '#2b2622';
export const PAPER = '#f3ead8';

/**
 * Набор функций рисования «карандашом» на 2D-канвасе.
 * Каждая линия рисуется в несколько проходов с дрожанием — как набросок.
 */
export class Sketch {
  constructor(ctx, seed = 7) {
    this.ctx = ctx;
    this.r = rng(seed);
  }
  j(a) { return (this.r() - 0.5) * 2 * a; }

  line(x1, y1, x2, y2, { width = 2, color = INK, passes = 2, jitter = 1.6, alpha = 0.9 } = {}) {
    const c = this.ctx;
    c.save();
    c.strokeStyle = color;
    c.lineCap = 'round';
    c.globalAlpha = alpha;
    for (let p = 0; p < passes; p++) {
      c.lineWidth = width * (p ? 0.6 : 1);
      const mx = (x1 + x2) / 2 + this.j(jitter * 1.5), my = (y1 + y2) / 2 + this.j(jitter * 1.5);
      c.beginPath();
      c.moveTo(x1 + this.j(jitter), y1 + this.j(jitter));
      c.quadraticCurveTo(mx, my, x2 + this.j(jitter), y2 + this.j(jitter));
      c.stroke();
    }
    c.restore();
  }

  poly(pts, opts = {}) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (opts.open && i === pts.length - 1) break;
      this.line(a[0], a[1], b[0], b[1], opts);
    }
  }

  rect(x, y, w, h, opts = {}) {
    if (opts.fill) {
      const c = this.ctx;
      c.save();
      c.fillStyle = opts.fill;
      c.globalAlpha = opts.fillAlpha ?? 1;
      c.beginPath();
      c.moveTo(x + this.j(1.5), y + this.j(1.5));
      c.lineTo(x + w + this.j(1.5), y + this.j(1.5));
      c.lineTo(x + w + this.j(1.5), y + h + this.j(1.5));
      c.lineTo(x + this.j(1.5), y + h + this.j(1.5));
      c.closePath();
      c.fill();
      c.restore();
    }
    if (opts.stroke !== false) this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], opts);
  }

  circle(cx, cy, rad, { width = 2, color = INK, passes = 2, fill = null, alpha = 0.9, wobble = 0.06 } = {}) {
    const c = this.ctx;
    c.save();
    if (fill) {
      c.fillStyle = fill;
      c.beginPath();
      c.arc(cx, cy, rad, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = color;
    c.globalAlpha = alpha;
    c.lineCap = 'round';
    for (let p = 0; p < passes; p++) {
      c.lineWidth = width * (p ? 0.6 : 1);
      c.beginPath();
      const start = this.r() * Math.PI * 2;
      const seg = 28;
      const over = 0.15 + this.r() * 0.2;
      for (let i = 0; i <= seg; i++) {
        const a = start + (i / seg) * Math.PI * (2 + over);
        const rr = rad * (1 + this.j(wobble) * 0.5);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    c.restore();
  }

  /** Штриховка прямоугольной области под углом */
  hatch(x, y, w, h, { gap = 8, angle = Math.PI / 4, color = INK, width = 1, alpha = 0.35 } = {}) {
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    const d = Math.hypot(w, h);
    const cx = x + w / 2, cy = y + h / 2;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    for (let o = -d; o < d; o += gap) {
      const px = cx - dy * o, py = cy + dx * o;
      this.line(px - dx * d, py - dy * d, px + dx * d, py + dy * d, { width, color, alpha, passes: 1, jitter: 1.2 });
    }
    c.restore();
  }

  text(str, x, y, { size = 32, color = INK, font = 'Caveat, Neucha, cursive', align = 'center', weight = 700 } = {}) {
    const c = this.ctx;
    c.save();
    c.fillStyle = color;
    c.font = `${weight} ${size}px ${font}`;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillText(str, x, y);
    c.restore();
  }
}

export function canvasTexture(w, h, draw, { repeat = false, seed = 7 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx, new Sketch(ctx, seed), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

let paperTex = null;
/** Бумажное зерно: волокна + шум. Используется во всех шейдерах. */
export function paperTexture() {
  if (paperTex) return paperTex;
  paperTex = canvasTexture(512, 512, (ctx, s, w, h) => {
    const img = ctx.createImageData(w, h);
    const r = rng(99);
    for (let i = 0; i < w * h; i++) {
      const v = 200 + r() * 55;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 900; i++) {
      const x = r() * w, y = r() * h, a = r() * Math.PI, l = 4 + r() * 18;
      ctx.strokeStyle = r() > 0.5 ? '#ffffff' : '#9a9a9a';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // мягкие пятна
    for (let i = 0; i < 40; i++) {
      const g = ctx.createRadialGradient(r() * w, r() * h, 0, r() * w, r() * h, 40 + r() * 80);
      g.addColorStop(0, 'rgba(120,110,90,0.05)');
      g.addColorStop(1, 'rgba(120,110,90,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }, { repeat: true });
  return paperTex;
}

const texCache = new Map();
export function cachedTexture(key, w, h, draw, opts) {
  if (!texCache.has(key)) texCache.set(key, canvasTexture(w, h, draw, opts));
  return texCache.get(key);
}
