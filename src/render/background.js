import * as THREE from 'three';
import { canvasTexture, rng, INK } from './draw.js';
import { customShader } from './materials.js';

const ROMAN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

function clockFaceTex() {
  return canvasTexture(1024, 1024, (ctx, s, w) => {
    const c = w / 2;
    s.circle(c, c, 470, { width: 10, passes: 3, fill: 'rgba(250,240,220,0.55)' });
    s.circle(c, c, 430, { width: 4, passes: 2 });
    s.circle(c, c, 300, { width: 2, passes: 1, alpha: 0.4 });
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r0 = i % 5 ? 405 : 380;
      s.line(c + Math.cos(a) * r0, c + Math.sin(a) * r0, c + Math.cos(a) * 428, c + Math.sin(a) * 428, { width: i % 5 ? 2 : 5, passes: 1 });
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      s.text(ROMAN[i], c + Math.cos(a) * 335, c + Math.sin(a) * 335, { size: 70, color: INK });
    }
    s.hatch(c - 470, c - 470, 940, 940, { gap: 22, alpha: 0.06 });
  });
}

function handTex(len) {
  return canvasTexture(64, 512, (ctx, s, w, h) => {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(w / 2, 6);
    ctx.lineTo(w / 2 + 14, h * (1 - len) + 40);
    ctx.lineTo(w / 2 + 6, h - 20);
    ctx.lineTo(w / 2 - 6, h - 20);
    ctx.lineTo(w / 2 - 14, h * (1 - len) + 40);
    ctx.closePath();
    ctx.fill();
    s.circle(w / 2, h - 30, 18, { fill: INK, width: 3 });
  });
}

function gearTex(teeth, seed) {
  return canvasTexture(512, 512, (ctx, s, w) => {
    const c = w / 2, R = 230, r = 195;
    const pts = [];
    for (let i = 0; i < teeth * 4; i++) {
      const a = (i / (teeth * 4)) * Math.PI * 2;
      const rr = (i % 4 < 2) ? R : r;
      pts.push([c + Math.cos(a) * rr, c + Math.sin(a) * rr]);
    }
    ctx.fillStyle = 'rgba(160,140,110,0.5)';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * 110, c + Math.sin(a) * 110, 48, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    s.poly(pts, { width: 4, passes: 2, alpha: 0.7 });
    s.circle(c, c, 40, { width: 4, fill: 'rgba(120,100,80,0.6)' });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      s.circle(c + Math.cos(a) * 110, c + Math.sin(a) * 110, 48, { width: 3, alpha: 0.6 });
    }
  }, { seed });
}

function hillsTex(seed, color, height) {
  return canvasTexture(2048, 512, (ctx, s, w, h) => {
    const r = rng(seed);
    const pts = [];
    for (let x = 0; x <= w; x += 32) {
      const y = h - height * h * (0.55 + 0.45 * Math.sin(x * 0.004 + seed) * Math.sin(x * 0.0013 + seed * 2)) - r() * 10;
      pts.push([x, y]);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    pts.forEach((p) => ctx.lineTo(p[0], p[1]));
    ctx.lineTo(w, h);
    ctx.fill();
    for (let i = 1; i < pts.length; i++) s.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], { width: 3, alpha: 0.55 });
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, h);
    pts.forEach((p) => ctx.lineTo(p[0], p[1]));
    ctx.lineTo(w, h);
    ctx.clip();
    s.hatch(0, 0, w, h, { gap: 14, alpha: 0.12, angle: -0.9 });
    ctx.restore();
    // деревца-закорючки
    for (let i = 0; i < 14; i++) {
      const p = pts[Math.floor(r() * pts.length)];
      const tx = p[0], ty = p[1] + 4;
      s.line(tx, ty, tx, ty - 30, { width: 3 });
      s.circle(tx, ty - 44, 16 + r() * 8, { width: 2.5, fill: 'rgba(120,150,100,0.5)' });
    }
  }, { seed, repeat: true });
}

function cloudTex(seed) {
  return canvasTexture(512, 256, (ctx, s) => {
    const r = rng(seed);
    const blobs = [];
    for (let i = 0; i < 5; i++) blobs.push([120 + i * 65 + r() * 20, 140 - Math.sin((i / 4) * Math.PI) * 50, 50 + r() * 30]);
    ctx.fillStyle = 'rgba(255,252,244,0.95)';
    blobs.forEach(([x, y, rr]) => { ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); });
    blobs.forEach(([x, y, rr]) => s.circle(x, y, rr, { width: 3, alpha: 0.5, passes: 1 }));
    ctx.fillStyle = 'rgba(255,252,244,1)';
    blobs.forEach(([x, y, rr]) => { ctx.beginPath(); ctx.arc(x, y, rr - 4, 0, Math.PI * 2); ctx.fill(); });
  }, { seed });
}

function plane(tex, w, h, opts = {}) {
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, ...opts });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}

/**
 * Фон: бумажное небо, гигантские часы (стрелки идут назад при перемотке!),
 * вращающиеся шестерни, холмы и облака на разной глубине — параллакс.
 */
export class Background {
  constructor(theme = {}) {
    this.group = new THREE.Group();
    this.group.name = 'background';
    const sky = customShader({
      uniforms: { uTop: { value: new THREE.Color(theme.skyTop || '#efe3c8') }, uBottom: { value: new THREE.Color(theme.skyBottom || '#f7efe0') }, uRewind: { value: 0 } },
      fragment: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uBottom; uniform float uRewind;
        varying vec2 vUv;
        void main(){
          vec3 c = mix(uBottom, uTop, smoothstep(0.2, 0.9, vUv.y));
          float rings = abs(fract(length((vUv - vec2(0.5, 0.62)) * vec2(2.0, 1.0)) * 9.0 - uTime * 0.3 * (1.0 - 2.0 * uRewind)) - 0.5);
          c *= 1.0 - (1.0 - smoothstep(0.0, 0.04, rings)) * 0.035;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthWrite: false,
    });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(600, 300), sky);
    this.sky.position.z = -60;
    this.group.add(this.sky);

    // часы
    this.clock = new THREE.Group();
    this.clock.position.z = -40;
    const face = plane(clockFaceTex(), 36, 36, { opacity: 0.55 });
    this.clock.add(face);
    this.hourHand = plane(handTex(0.55), 1.6, 12, { opacity: 0.6 });
    this.minuteHand = plane(handTex(0.8), 1.3, 16, { opacity: 0.6 });
    for (const [hand, len] of [[this.hourHand, 12], [this.minuteHand, 16]]) {
      hand.geometry.translate(0, len / 2 - 0.9, 0);
      hand.position.z = 0.05;
      this.clock.add(hand);
    }
    this.minuteHand.position.z = 0.1;
    this.group.add(this.clock);

    // шестерни
    this.gears = [];
    const gearDefs = [[-20, 8, 9, 12, 1], [-9.5, 14, 6, 8, -1], [22, -2, 11, 14, -1], [33, 9, 5, 7, 1]];
    gearDefs.forEach(([x, y, size, teeth, dir], i) => {
      const g = plane(gearTex(teeth, 11 + i), size, size, { opacity: 0.55 });
      g.position.set(x, y, -26);
      g.userData = { speed: (dir * 0.25 * 12) / teeth };
      this.gears.push(g);
      this.group.add(g);
    });

    // холмы
    this.hills = [];
    [[-18, '#d9cba8', 0.55, 3], [-10, '#cbbd96', 0.4, 8]].forEach(([z, colr, hgt, seed]) => {
      const tex = hillsTex(seed, colr, hgt);
      tex.repeat.set(3, 1);
      const p = plane(tex, 240, 20);
      p.position.z = z;
      this.hills.push(p);
      this.group.add(p);
    });

    // облака
    this.clouds = [];
    for (let i = 0; i < 7; i++) {
      const c = plane(cloudTex(30 + i), 8 + (i % 3) * 3, 4 + (i % 3) * 1.5, { opacity: 0.85 });
      c.position.set(-40 + i * 16, 10 + (i % 4) * 3, -22 + (i % 3) * 2);
      c.userData.speed = 0.25 + (i % 3) * 0.15;
      this.clouds.push(c);
      this.group.add(c);
    }
  }

  /** Подогнать под размеры уровня */
  fit(world) {
    const cx = world.width / 2, cy = world.height / 2;
    this.group.position.set(cx, cy, 0);
    this.span = Math.max(world.width, 40);
    this.hills[0].position.y = -world.height / 2 + 4;
    this.hills[1].position.y = -world.height / 2 + 2;
    this.clock.position.y = 4;
  }

  /** worldTime идёт назад при перемотке — и часы вместе с ним */
  update(worldTime, rewind, frameDt) {
    this.sky.material.uniforms.uRewind.value = rewind;
    this.minuteHand.rotation.z = -worldTime * 0.6;
    this.hourHand.rotation.z = -worldTime * 0.05;
    for (const g of this.gears) g.rotation.z = worldTime * g.userData.speed;
    const span = (this.span || 40) + 30;
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * frameDt * (rewind > 0.5 ? -4 : 1);
      if (c.position.x > span / 2 + 10) c.position.x = -span / 2 - 10;
      if (c.position.x < -span / 2 - 10) c.position.x = span / 2 + 10;
    }
  }
}
