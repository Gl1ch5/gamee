import { Entity } from '../engine/entity.js';
import { moveY, ridersOf } from '../engine/physics.js';
import { approach } from '../engine/constants.js';

// ============ Зона времени: замедляет или ускоряет всё внутри ============
export class TimeZone extends Entity {
  static order = -20;
  constructor(world, def, t) {
    super(world, def, t);
    this.isZone = true;
    this.timeImmune = true;
    this.ignoreZones = true;
  }
  active() { return this.world.isOn(this.props.channel); }
  bounds() { return { l: this.cx, b: this.cy, r: this.cx + this.props.w, t: this.cy + this.props.h }; }
  contains(x, y) {
    const b = this.bounds();
    return x >= b.l && x < b.r && y >= b.b && y < b.t;
  }
  createView(kit) {
    const { THREE } = kit;
    const { w, h, scale } = this.props;
    const fast = scale > 1;
    const col = fast ? new THREE.Color('#f08a4b') : new THREE.Color('#4f8fd6');
    const mat = kit.customShader({
      uniforms: { uCol: { value: col }, uSpeed: { value: scale }, uSize: { value: new THREE.Vector2(w, h) }, uOn: { value: 1 }, uClock: { value: 0 } },
      fragment: /* glsl */ `
        uniform vec3 uCol; uniform float uSpeed; uniform vec2 uSize; uniform float uOn; uniform float uClock;
        varying vec2 vUv;
        void main(){
          vec2 p = vUv * uSize;
          // кромка-пунктир
          vec2 d = min(p, uSize - p);
          float edge = min(d.x, d.y);
          float along = (d.x < d.y) ? p.y : p.x;
          float dash = step(0.5, fract(along * 2.0 - uClock * 0.5));
          float border = (1.0 - smoothstep(0.03, 0.07, edge)) * dash;
          // поле «часовых стрелок»
          vec2 cell = fract(p) - 0.5;
          vec2 id = floor(p);
          float ang = uClock * (0.8 + hash12(id) * 0.6) + hash12(id + 3.0) * 6.28;
          vec2 dir = vec2(sin(ang), cos(ang));
          float t = clamp(dot(cell, dir), 0.0, 0.32);
          float hand = 1.0 - smoothstep(0.015, 0.04, length(cell - dir * t));
          float ring = 1.0 - smoothstep(0.015, 0.04, abs(length(cell) - 0.36));
          float swirl = 0.5 + 0.5 * sin(length(p - uSize * 0.5) * 3.0 - uClock * 2.0);
          float a = 0.07 + swirl * 0.05 + hand * 0.35 + ring * 0.12 + border * 0.7;
          gl_FragColor = vec4(mix(uCol, vec3(0.16, 0.14, 0.12), border * 0.4), a * mix(0.25, 1.0, uOn));
        }`,
      transparent: true,
      depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(this.cx + w / 2, this.cy + h / 2, 0.75);
    m.renderOrder = 5;
    const label = kit.canvasTexture(256, 96, (ctx, s, cw, ch) => {
      s.text(`${fast ? '⏩' : '⏪'} ×${scale}`, cw / 2, ch / 2, { size: 56, color: fast ? '#b24a1c' : '#1f4f86' });
    });
    const lm = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.45), new THREE.MeshBasicMaterial({ map: label, transparent: true, depthWrite: false }));
    lm.position.set(-w / 2 + 0.7, h / 2 - 0.3, 0.01);
    m.add(lm);
    m.userData = { mat, clock: 0, dispose: () => label.dispose() };
    return m;
  }
  updateView(m, kit, dt) {
    const u = m.userData.mat.uniforms;
    const on = this.active() ? 1 : 0;
    u.uOn.value = approach(u.uOn.value, on, dt * 3);
    const gs = kit.shared.uStop.value > 0.5 ? 0 : 1;
    m.userData.clock += dt * this.props.scale * on * gs;
    u.uClock.value = m.userData.clock;
    if (on && Math.random() < dt * this.props.w * this.props.h * 0.6) {
      kit.particles.spawn({
        x: this.cx + Math.random() * this.props.w, y: this.cy + Math.random() * this.props.h, z: 0.7,
        vx: 0, vy: 0.4 * this.props.scale, life: 1.5 / Math.max(this.props.scale, 0.3), size: 0.15,
        color: this.props.scale > 1 ? '#f08a4b' : '#4f8fd6', kind: 4, spin: this.props.scale,
      });
    }
  }
}

// ============ Росток: растёт со временем, его можно ускорить или перемотать ============
export class Sprout extends Entity {
  static state = ['growth'];
  static order = -12;
  constructor(world, def, t) {
    super(world, def, t);
    this.growth = this.props.start || 0;
  }
  top() { return this.cy + 0.3 + this.growth * this.props.height; }
  padRect() {
    const t = this.top();
    return { l: this.cx + 0.5 - 0.85, r: this.cx + 0.5 + 0.85, b: t - 0.25, t };
  }
  bounds() { return { l: this.cx, b: this.cy, r: this.cx + 1, t: this.cy + 1 }; }
  solid() { return { ...this.padRect(), oneWay: true, ent: this }; }
  update(dt) {
    if (this.growth >= 1) return;
    const riders = ridersOf(this.world, this, this.padRect());
    const before = this.top();
    const old = this.growth;
    this.growth = Math.min(1, this.growth + dt / this.props.growTime);
    if (Math.floor(old * 4) !== Math.floor(this.growth * 4)) this.world.emit('grow', { x: this.cx + 0.5, y: this.top(), particles: { count: 8, speed: 2, size: 0.22, life: 0.6, color: '#7fae5a', kind: 0 } });
    const dy = this.top() - before;
    for (const r of riders) moveY(this.world, r, dy);
  }
  createView(kit) {
    const { THREE } = kit;
    const g = new THREE.Group();
    g.position.set(this.cx + 0.5, this.cy, 0);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 1, 8), kit.sketchMaterial({ color: '#6c9a4b', edges: false, hatch: 1.3 }));
    stem.geometry.translate(0, 0.5, 0);
    kit.addOutline(stem, { thickness: 0.025 });
    const pad = new THREE.Group();
    const leafMat = kit.sketchMaterial({ color: '#8fc06a', edges: false });
    for (const s of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 6), leafMat);
      leaf.scale.set(1, 0.18, 0.7);
      leaf.position.set(s * 0.38, -0.08, 0);
      leaf.rotation.z = s * 0.15;
      kit.addOutline(leaf, { thickness: 0.025 });
      pad.add(leaf);
    }
    const bud = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), kit.sketchMaterial({ color: '#e76f51', edges: false }));
    bud.position.y = 0.08;
    kit.addOutline(bud, { thickness: 0.02 });
    pad.add(bud);
    const leaves = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 5), leafMat);
      l.scale.set(1.4, 0.4, 0.8);
      kit.addOutline(l, { thickness: 0.02 });
      g.add(l);
      leaves.push(l);
    }
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.3, 10), kit.sketchMaterial({ color: '#c8693e', edges: false }));
    pot.position.y = 0.15;
    kit.addOutline(pot, { thickness: 0.025 });
    g.add(stem, pad, pot);
    g.userData = { stem, pad, leaves };
    return g;
  }
  updateView(g, kit) {
    const { stem, pad, leaves } = g.userData;
    const h = this.top() - this.cy;
    stem.scale.y = Math.max(h - 0.05, 0.01);
    pad.position.y = h - 0.05;
    const sc = 0.3 + this.growth * 0.7;
    pad.scale.set(sc, sc, sc);
    const sway = Math.sin(kit.shared.uTime.value * 1.5 + this.cx) * 0.04;
    pad.rotation.z = sway;
    leaves.forEach((l, i) => {
      const y = ((i + 1) / (leaves.length + 1)) * h;
      l.position.set((i % 2 ? 1 : -1) * 0.18, y, 0);
      l.rotation.z = (i % 2 ? -0.5 : 0.5) + sway * 2;
      l.visible = h > y + 0.3;
    });
  }
}
