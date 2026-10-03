import * as THREE from 'three';
import { shared, NOISE_GLSL } from './materials.js';

const MAX = 3000;

/**
 * Пул частиц, нарисованных «от руки» во фрагментном шейдере:
 * 0 — клякса, 1 — колечко, 2 — искра-звёздочка, 3 — штрих, 4 — песчинка-часики.
 */
export class Particles {
  constructor() {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.data = new Float32Array(MAX * 4); // size, alpha, kind, rot
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.baseSize = new Float32Array(MAX);
    this.spin = new Float32Array(MAX);
    this.head = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aData', new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const m = new THREE.ShaderMaterial({
      uniforms: { uPx: shared.uPx, uBoil: shared.uBoil, uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute vec4 aData;
        uniform float uScale; uniform float uPx;
        varying vec3 vCol; varying vec4 vData;
        void main(){
          vCol = aColor; vData = aData;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aData.x * uScale * uPx / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uBoil;
        varying vec3 vCol; varying vec4 vData;
        ${NOISE_GLSL}
        void main(){
          if (vData.y <= 0.0) discard;
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float c = cos(vData.w), s = sin(vData.w);
          p = mat2(c, -s, s, c) * p;
          float r = length(p);
          float a = atan(p.y, p.x);
          float wob = (vnoise(vec2(a * 2.0, uBoil * 7.0 + vData.w)) - 0.5) * 0.25;
          float k = vData.z;
          float alpha = 0.0;
          vec3 col = vCol;
          if (k < 0.5) {            // клякса с контуром
            alpha = 1.0 - smoothstep(0.75 + wob, 0.85 + wob, r);
            col = mix(col, vec3(0.17, 0.15, 0.13), smoothstep(0.55 + wob, 0.75 + wob, r));
          } else if (k < 1.5) {     // кольцо
            alpha = 1.0 - smoothstep(0.08, 0.16, abs(r - 0.7 - wob * 0.5));
          } else if (k < 2.5) {     // звёздочка
            float st = 0.25 + 0.6 * pow(abs(cos(a * 2.0)), 8.0);
            alpha = 1.0 - smoothstep(st - 0.08, st, r);
          } else if (k < 3.5) {     // штрих
            alpha = (1.0 - smoothstep(0.08, 0.2, abs(p.y + wob * 0.3))) * (1.0 - smoothstep(0.8, 0.95, abs(p.x)));
          } else {                  // песочные часы
            float hx = abs(p.x), hy = abs(p.y);
            float shape = step(hx, 0.1 + hy * 0.55) * step(hy, 0.75);
            alpha = shape;
            col = mix(col, vec3(0.17, 0.15, 0.13), step(0.6, hy) * shape);
          }
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(col, alpha * vData.y);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.tmp = new THREE.Color();
  }

  spawn({ x, y, z = 0.6, vx = 0, vy = 0, vz = 0, life = 0.6, size = 0.2, color = '#2b2622', kind = 0, gravity = 0, spin = 0 }) {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.tmp.set(color);
    this.col[i * 3] = this.tmp.r; this.col[i * 3 + 1] = this.tmp.g; this.col[i * 3 + 2] = this.tmp.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = gravity;
    this.baseSize[i] = size;
    this.spin[i] = spin;
    this.data[i * 4] = size;
    this.data[i * 4 + 1] = 1;
    this.data[i * 4 + 2] = kind;
    this.data[i * 4 + 3] = Math.random() * 6.28;
  }

  burst(x, y, n, opts = {}) {
    const { speed = 3, spread = Math.PI * 2, dir = Math.PI / 2, ...rest } = opts;
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (Math.random() - 0.5) * sp * 0.3, ...rest,
        size: (rest.size || 0.2) * (0.6 + Math.random() * 0.7), life: (rest.life || 0.6) * (0.7 + Math.random() * 0.6) });
    }
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.data[i * 4 + 1] = 0; continue; }
      this.life[i] -= dt;
      const t = Math.max(this.life[i] / this.maxLife[i], 0);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.data[i * 4] = this.baseSize[i] * (0.4 + 0.6 * Math.sqrt(t));
      this.data[i * 4 + 1] = Math.min(1, t * 2.5);
      this.data[i * 4 + 3] += this.spin[i] * dt;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aData.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
  }
}
