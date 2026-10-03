import { Entity, Body } from '../engine/entity.js';
import { moveX, moveY, overlaps, ridersOf } from '../engine/physics.js';
import { GRAVITY, approach, channelColor } from '../engine/constants.js';

// ---------- общие помощники для видов ----------
function crateTex(kit, gold) {
  return kit.cachedTexture(gold ? 'crate-gold' : 'crate', 256, 256, (ctx, s, w, h) => {
    ctx.fillStyle = gold ? '#f3d27a' : '#d8b98a';
    ctx.fillRect(0, 0, w, h);
    for (let i = 1; i < 4; i++) s.line(10, (i * h) / 4, w - 10, (i * h) / 4, { width: 2, alpha: 0.5 });
    s.hatch(0, 0, w, h, { gap: 18, alpha: 0.12, angle: 0.3 });
    s.rect(18, 18, w - 36, h - 36, { width: 6 });
    s.line(24, 24, w - 24, h - 24, { width: 7 });
    s.line(w - 24, 24, 24, h - 24, { width: 4, alpha: 0.6 });
    if (gold) {
      // песочные часы — знак «вне времени»
      ctx.fillStyle = '#fff6d6';
      ctx.beginPath();
      ctx.moveTo(w / 2 - 40, h / 2 - 55); ctx.lineTo(w / 2 + 40, h / 2 - 55); ctx.lineTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + 40, h / 2 + 55); ctx.lineTo(w / 2 - 40, h / 2 + 55); ctx.lineTo(w / 2, h / 2);
      ctx.closePath(); ctx.fill();
      s.poly([[w / 2 - 40, h / 2 - 55], [w / 2 + 40, h / 2 - 55], [w / 2, h / 2], [w / 2 + 40, h / 2 + 55], [w / 2 - 40, h / 2 + 55], [w / 2, h / 2]], { width: 5 });
    }
  });
}

function pathLine(kit, x0, y0, x1, y1, color) {
  const { THREE } = kit;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const g = new THREE.Group();
  const n = Math.max(2, Math.floor(len * 3));
  const dotGeo = new THREE.CircleGeometry(0.05, 6);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 });
  for (let i = 0; i <= n; i++) {
    const m = new THREE.Mesh(dotGeo, mat);
    m.position.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, -0.3);
    g.add(m);
  }
  return g;
}

const ease = (t) => t * t * (3 - 2 * t);

// ============ Финиш ============
export class Goal extends Entity {
  static order = 10;
  bounds() { return { l: this.cx + 0.15, b: this.cy, r: this.cx + 0.85, t: this.cy + 1.8 }; }
  active() { return this.world.isOn(this.props.require); }
  update() {
    const p = this.world.player;
    if (!this.world.won && p && !p.dead && this.active() && overlaps(p.rect(), this.bounds())) {
      this.world.won = true;
      this.world.emit('win', { x: this.cx + 0.5, y: this.cy });
    }
  }
  createView(kit) {
    const { THREE } = kit;
    const g = new THREE.Group();
    g.position.set(this.cx + 0.5, this.cy, 0);
    const stone = kit.sketchMaterial({ color: '#cbbfa6', doodle: 1 });
    for (const x of [-0.6, 0.6]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.1, 0.5), stone);
      p.position.set(x, 1.05, 0);
      g.add(p);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.15, 6, 16, Math.PI), kit.sketchMaterial({ color: '#cbbfa6', edges: false }));
    arch.position.y = 2.05;
    kit.addOutline(arch, { thickness: 0.03 });
    g.add(arch);
    const portal = kit.customShader({
      uniforms: { uOn: { value: 1 } },
      fragment: /* glsl */ `
        uniform float uOn; varying vec2 vUv;
        void main(){
          vec2 p = (vUv - 0.5) * vec2(1.0, 2.0);
          float r = length(p); float a = atan(p.y, p.x);
          float sw = sin(a * 3.0 + r * 14.0 - uTime * 4.0 * uOn);
          vec3 c = mix(vec3(0.16,0.55,0.6), vec3(0.95,0.85,0.5), smoothstep(-0.2, 0.9, sw) * (1.0 - r));
          c = mix(vec3(0.55), c, uOn);
          float edge = smoothstep(1.0, 0.9, length(p * vec2(1.0, 0.5) * 2.0 / vec2(1.0, 1.0)));
          if (vUv.y > 0.5) edge *= smoothstep(1.0, 0.95, length(vec2(p.x, (vUv.y - 0.5) * 2.0) * vec2(1.0, 1.7)));
          gl_FragColor = vec4(c, edge * 0.92);
        }`,
      transparent: true,
      depthWrite: false,
    });
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.5), portal);
    pl.position.set(0, 1.25, -0.05);
    g.add(pl);
    g.userData.portal = portal;
    g.userData.sparkT = 0;
    return g;
  }
  updateView(g, kit, dt) {
    const on = this.active();
    const u = g.userData.portal.uniforms.uOn;
    u.value = approach(u.value, on ? 1 : 0, dt * 3);
    g.userData.sparkT -= dt;
    if (on && g.userData.sparkT < 0) {
      g.userData.sparkT = 0.12;
      kit.particles.spawn({ x: this.cx + 0.5 + (Math.random() - 0.5) * 0.8, y: this.cy + Math.random() * 2, z: 0.3, vy: 0.6, life: 1, size: 0.18, color: '#e9c46a', kind: 2, spin: 2 });
    }
  }
}

// ============ Ящик ============
export class Crate extends Body {
  static order = 0;
  constructor(world, def, t) {
    super(world, def, t);
    this.w = 0.92;
    this.h = 0.92;
    this.pushable = true;
    this.canPush = true;
    this.solidToBodies = true;
  }
  update(dt) {
    this.vy -= GRAVITY * dt;
    if (this.vy < -22) this.vy = -22;
    const before = this.vy;
    this.onGround = false;
    moveY(this.world, this, this.vy * dt);
    if (this.onGround && before < -8) this.world.emit('land', { x: this.x, y: this.y, power: -before, crate: true });
    if (this.y < -4) this.alive = false;
  }
  createView(kit) {
    const gold = this.anchored;
    const m = kit.sketchMaterial({ color: '#ffffff', map: crateTex(kit, gold), emissive: gold ? '#2a1c00' : '#000' });
    const mesh = new kit.THREE.Mesh(new kit.THREE.BoxGeometry(0.92, 0.92, 0.92), m);
    mesh.userData.mat = m;
    return mesh;
  }
  updateView(mesh, kit) {
    mesh.position.set(this.x, this.y + 0.46, 0);
    mesh.visible = this.alive;
    if (this.anchored) {
      const r = kit.shared.uRewind.value;
      const k = 0.12 + 0.1 * Math.sin(kit.shared.uTime.value * 4) + r * 0.25;
      mesh.userData.mat.uniforms.uEmissive.value.setRGB(k, k * 0.75, 0);
      if (r > 0.5 && Math.random() < 0.3) kit.particles.spawn({ x: this.x + (Math.random() - 0.5), y: this.y + Math.random(), z: 0.6, vy: 1, life: 0.6, size: 0.2, color: '#f2c94c', kind: 2 });
    }
  }
}

// ============ Нажимная плита ============
export class Plate extends Entity {
  static state = ['pressed'];
  static order = -5;
  constructor(world, def, t) {
    super(world, def, t);
    this.pressed = false;
  }
  bounds() { return { l: this.cx + 0.08, b: this.cy, r: this.cx + 0.92, t: this.cy + 0.3 }; }
  signal() {
    const b = this.bounds();
    let p = false;
    for (const e of this.world.entities) if (e.isBody && e.alive && !e.dead && overlaps(e.rect(), b)) { p = true; break; }
    if (p !== this.pressed) this.world.emit(p ? 'plateOn' : 'plateOff', { x: this.cx + 0.5, y: this.cy, color: channelColor(this.props.channel) });
    if (p && !this.pressed) this.world.emit('plate', { x: this.cx + 0.5, y: this.cy, color: channelColor(this.props.channel) });
    this.pressed = p;
    if (p) this.world.emitChannel(this.props.channel);
  }
  createView(kit) {
    const { THREE } = kit;
    const g = new THREE.Group();
    g.position.set(this.cx + 0.5, this.cy, 0);
    const col = channelColor(this.props.channel);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.08, 0.8), kit.sketchMaterial({ color: '#8a8172' }));
    base.position.y = 0.04;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.66), kit.sketchMaterial({ color: col }));
    top.position.y = 0.14;
    g.add(base, top);
    g.userData.top = top;
    return g;
  }
  updateView(g, kit, dt) {
    const top = g.userData.top;
    top.position.y = approach(top.position.y, this.pressed ? 0.09 : 0.15, dt * 1.5);
    top.material.uniforms.uEmissive.value.setScalar(this.pressed ? 0.15 : 0);
  }
}

// ============ Кнопка с таймером ============
export class TimedButton extends Entity {
  static state = ['timer'];
  static order = -5;
  constructor(world, def, t) {
    super(world, def, t);
    this.timer = 0;
  }
  bounds() { return { l: this.cx + 0.2, b: this.cy, r: this.cx + 0.8, t: this.cy + 0.45 }; }
  signal() {
    const b = this.bounds();
    for (const e of this.world.entities) {
      if (e.isBody && e.alive && !e.dead && overlaps(e.rect(), b)) {
        if (this.timer <= 0) this.world.emit('button', { x: this.cx + 0.5, y: this.cy, color: channelColor(this.props.channel) });
        this.timer = this.props.duration;
        break;
      }
    }
    if (this.timer > 0) this.world.emitChannel(this.props.channel);
  }
  update(dt) {
    if (this.timer > 0) {
      const before = Math.ceil(this.timer);
      this.timer = Math.max(0, this.timer - dt);
      if (Math.ceil(this.timer) !== before) this.world.emit('tick', { x: this.cx + 0.5, y: this.cy });
    }
  }
  createView(kit) {
    const { THREE } = kit;
    const g = new THREE.Group();
    g.position.set(this.cx + 0.5, this.cy, 0);
    const col = channelColor(this.props.channel);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.12, 14), kit.sketchMaterial({ color: '#8a8172', edges: false }));
    base.position.y = 0.06;
    kit.addOutline(base, { thickness: 0.02 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), kit.sketchMaterial({ color: col, edges: false }));
    cap.position.y = 0.1;
    kit.addOutline(cap, { thickness: 0.02 });
    const ring = kit.customShader({
      uniforms: { uP: { value: 0 }, uCol: { value: new THREE.Color(col) } },
      fragment: /* glsl */ `
        uniform float uP; uniform vec3 uCol; varying vec2 vUv;
        void main(){
          vec2 p = vUv - 0.5; float r = length(p);
          float a = atan(p.x, p.y) / 6.2831853 + 0.5;
          float ring = smoothstep(0.03, 0.0, abs(r - 0.4));
          float fill = step(a, uP);
          if (ring < 0.05) discard;
          gl_FragColor = vec4(mix(vec3(0.17,0.15,0.13), uCol, fill), ring * (0.3 + 0.7 * fill));
        }`,
      transparent: true,
      depthWrite: false,
    });
    const rm = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), ring);
    rm.position.set(0, 0.9, 0.3);
    g.add(base, cap, rm);
    g.userData = { cap, ring };
    return g;
  }
  updateView(g) {
    g.userData.cap.position.y = this.timer > 0 ? 0.04 : 0.1;
    g.userData.ring.uniforms.uP.value = this.timer / this.props.duration;
  }
}

// ============ Рычаг ============
export class Lever extends Entity {
  static state = ['on'];
  static order = -5;
  constructor(world, def, t) {
    super(world, def, t);
    this.on = !!this.props.startOn;
  }
  bounds() { return { l: this.cx, b: this.cy, r: this.cx + 1, t: this.cy + 1 }; }
  interact() {
    this.on = !this.on;
    this.world.emit('lever', { x: this.cx + 0.5, y: this.cy + 0.3, on: this.on, color: channelColor(this.props.channel) });
  }
  signal() { if (this.on) this.world.emitChannel(this.props.channel); }
  createView(kit) {
    const { THREE } = kit;
    const g = new THREE.Group();
    g.position.set(this.cx + 0.5, this.cy, 0);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.4), kit.sketchMaterial({ color: '#8a8172' }));
    base.position.y = 0.09;
    const pivot = new THREE.Group();
    pivot.position.y = 0.15;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 6), kit.sketchMaterial({ color: '#5b4a3a', edges: false }));
    stick.position.y = 0.27;
    kit.addOutline(stick, { thickness: 0.02 });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), kit.sketchMaterial({ color: channelColor(this.props.channel), edges: false }));
    knob.position.y = 0.55;
    kit.addOutline(knob, { thickness: 0.02 });
    pivot.add(stick, knob);
    g.add(base, pivot);
    g.userData.pivot = pivot;
    return g;
  }
  updateView(g, kit, dt) {
    const p = g.userData.pivot;
    p.rotation.z = approach(p.rotation.z, this.on ? -0.6 : 0.6, dt * 6);
  }
}

// ============ Дверь ============
export class Door extends Entity {
  static state = ['open'];
  static order = -8;
  constructor(world, def, t) {
    super(world, def, t);
    this.open = this.isOpenTarget() ? 1 : 0;
  }
  isOpenTarget() {
    const on = this.world.isOn(this.props.channel) && !!this.props.channel;
    return this.props.invert ? !on : on;
  }
  update(dt) {
    const target = this.isOpenTarget() ? 1 : 0;
    const before = this.open;
    this.open = approach(this.open, target, dt * 4);
    if ((before === 0 && this.open > 0) || (before === 1 && this.open < 1)) this.world.emit('door', { x: this.cx + 0.5, y: this.cy + 1 });
  }
  solid() {
    if (this.open > 0.97) return null;
    const h = this.props.height;
    return { l: this.cx + 0.12, r: this.cx + 0.88, b: this.cy + h * this.open, t: this.cy + h, oneWay: false };
  }
  bounds() { return { l: this.cx, b: this.cy, r: this.cx + 1, t: this.cy + this.props.height }; }
  createView(kit) {
    const { THREE } = kit;
    const h = this.props.height;
    const col = channelColor(this.props.channel);
    const tex = kit.cachedTexture(`door-${col}-${h}`, 128, 128 * h, (ctx, s, w, hh) => {
      ctx.fillStyle = '#6d6a75';
      ctx.fillRect(0, 0, w, hh);
      s.hatch(0, 0, w, hh, { gap: 10, alpha: 0.2 });
      for (let x = 24; x < w; x += 40) s.line(x, 6, x, hh - 6, { width: 7, color: '#2b2622' });
      for (let y = 60; y < hh; y += 128) {
        ctx.fillStyle = col;
        ctx.fillRect(4, y - 10, w - 8, 20);
        s.rect(4, y - 10, w - 8, 20, { width: 3 });
      }
      s.rect(4, 4, w - 8, hh - 8, { width: 6 });
    });
    const g = new THREE.Group();
    g.position.set(this.cx + 0.5, this.cy, 0);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.76, h, 0.7), kit.sketchMaterial({ color: '#ffffff', map: tex }));
    slab.position.y = h / 2;
    const frameMat = kit.sketchMaterial({ color: '#a59a86' });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), kit.sketchMaterial({ color: col, edges: false }));
    lamp.position.set(0, h + 0.05, 0.4);
    kit.addOutline(lamp, { thickness: 0.02 });
    const holder = new THREE.Mesh(new THREE.BoxGeometry(1, 0.18, 0.9), frameMat);
    holder.position.y = h + 0.05;
    g.add(slab, holder, lamp);
    g.userData = { slab, lamp };
    return g;
  }
  updateView(g) {
    const h = this.props.height;
    const { slab, lamp } = g.userData;
    slab.scale.y = 1 - this.open * 0.9;
    slab.position.y = h / 2 + (h * this.open * 0.9) / 2;
    lamp.material.uniforms.uEmissive.value.setScalar(this.open > 0.5 ? 0.25 : 0);
  }
}

// ============ Движущаяся платформа ============
export class Platform extends Entity {
  static state = ['t', 'dir', 'x', 'y'];
  static order = -10;
  constructor(world, def, t) {
    super(world, def, t);
    this.x0 = this.cx;
    this.y0 = this.cy + 0.6;
    this.x = this.x0;
    this.y = this.y0;
    this.t = 0;
    this.dir = 1;
  }
  rect() { return { l: this.x, b: this.y, r: this.x + this.props.width, t: this.y + 0.4 }; }
  bounds() { return this.rect(); }
  solid() { return { ...this.rect(), oneWay: !!this.props.oneWay, ent: this }; }
  update(dt) {
    const { dx, dy, speed, channel } = this.props;
    const len = Math.hypot(dx, dy);
    if (!len) return;
    const k = (speed / len) * dt;
    if (channel) this.t = approach(this.t, this.world.isOn(channel) ? 1 : 0, k);
    else {
      this.t += this.dir * k;
      if (this.t >= 1) { this.t = 1; this.dir = -1; }
      if (this.t <= 0) { this.t = 0; this.dir = 1; }
    }
    const e = ease(this.t);
    const nx = this.x0 + dx * e, ny = this.y0 + dy * e;
    const ddx = nx - this.x, ddy = ny - this.y;
    if (!ddx && !ddy) return;
    const riders = ridersOf(this.world, this, this.rect());
    this.x = nx;
    this.y = ny;
    for (const r of riders) {
      if (ddy) moveY(this.world, r, ddy);
      if (ddx) moveX(this.world, r, ddx);
    }
    if (!this.props.oneWay && ddx) {
      const pr = this.rect();
      for (const b of this.world.entities) {
        if (!b.isBody || !b.alive || riders.includes(b)) continue;
        const br = b.rect();
        if (overlaps(pr, br)) moveX(this.world, b, ddx > 0 ? pr.r - br.l : pr.l - br.r);
      }
    }
  }
  createView(kit) {
    const { THREE } = kit;
    const w = this.props.width;
    const g = new THREE.Group();
    const tex = kit.cachedTexture(`plat-${w}`, 128 * w, 64, (ctx, s, cw, ch) => {
      ctx.fillStyle = '#c49a6c';
      ctx.fillRect(0, 0, cw, ch);
      for (let x = 0; x < cw; x += 64) s.line(x, 4, x, ch - 4, { width: 3, alpha: 0.6 });
      s.hatch(0, 0, cw, ch, { gap: 9, alpha: 0.15, angle: 0.1 });
      s.rect(3, 3, cw - 6, ch - 6, { width: 5 });
      for (let x = 32; x < cw; x += 64) s.circle(x, ch / 2, 5, { width: 3, fill: '#2b2622' });
    });
    const plank = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, 1), kit.sketchMaterial({ color: '#ffffff', map: tex }));
    plank.position.set(w / 2, 0.2, 0);
    g.add(plank);
    const gears = [];
    for (const x of [0.25, w - 0.25]) {
      const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 8), kit.sketchMaterial({ color: '#a59a86', edges: false }));
      gear.rotation.x = Math.PI / 2;
      gear.position.set(x, 0.2, 0.55);
      kit.addOutline(gear, { thickness: 0.02 });
      g.add(gear);
      gears.push(gear);
    }
    g.userData = { gears };
    const root = new THREE.Group();
    root.add(g);
    const { dx, dy } = this.props;
    if (dx || dy) root.add(pathLine(kit, this.x0 + w / 2, this.y0 + 0.2, this.x0 + w / 2 + dx, this.y0 + 0.2 + dy, channelColor(this.props.channel)));
    root.userData = { body: g, gears };
    return root;
  }
  updateView(root) {
    root.userData.body.position.set(this.x, this.y, 0);
    for (const gear of root.userData.gears) gear.rotation.y = (this.x + this.y) * 2;
  }
}

// ============ Пила ============
export class Saw extends Entity {
  static state = ['t', 'dir'];
  static order = -9;
  constructor(world, def, t) {
    super(world, def, t);
    this.t = 0;
    this.dir = 1;
  }
  pos() {
    const e = ease(this.t);
    return [this.cx + 0.5 + this.props.dx * e, this.cy + 0.5 + this.props.dy * e];
  }
  update(dt) {
    const len = Math.hypot(this.props.dx, this.props.dy);
    if (!len) return;
    this.t += this.dir * (this.props.speed / len) * dt;
    if (this.t >= 1) { this.t = 1; this.dir = -1; }
    if (this.t <= 0) { this.t = 0; this.dir = 1; }
  }
  hazard() {
    const [x, y] = this.pos();
    const r = this.props.radius * 0.8;
    return { l: x - r, b: y - r, r: x + r, t: y + r };
  }
  bounds() { return this.hazard(); }
  createView(kit) {
    const { THREE } = kit;
    const r = this.props.radius;
    const tex = kit.cachedTexture('saw', 256, 256, (ctx, s, w) => {
      const c = w / 2;
      ctx.fillStyle = '#b8c0c8';
      ctx.beginPath();
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const rr = i % 2 ? 100 : 126;
        ctx.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      s.circle(c, c, 100, { width: 4 });
      s.circle(c, c, 26, { width: 5, fill: '#5d646b' });
      s.hatch(c - 90, c - 90, 180, 180, { gap: 12, alpha: 0.2 });
    });
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 1.25, 32), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    disc.position.z = 0.3;
    g.add(disc);
    const root = new THREE.Group();
    root.add(g);
    if (this.props.dx || this.props.dy) root.add(pathLine(kit, this.cx + 0.5, this.cy + 0.5, this.cx + 0.5 + this.props.dx, this.cy + 0.5 + this.props.dy, '#d1495b'));
    root.userData = { g, disc };
    return root;
  }
  updateView(root, kit, dt) {
    const [x, y] = this.pos();
    root.userData.g.position.set(x, y, 0);
    root.userData.disc.rotation.z -= dt * 12 * this.timeScale;
  }
}

// ============ Осколок часов (собираемый) ============
export class Shard extends Entity {
  static state = ['collected'];
  static order = 10;
  constructor(world, def, t) {
    super(world, def, t);
    this.collected = false;
  }
  bounds() { return { l: this.cx + 0.2, b: this.cy + 0.2, r: this.cx + 0.8, t: this.cy + 0.9 }; }
  update() {
    const p = this.world.player;
    if (!this.collected && p && !p.dead && overlaps(p.rect(), this.bounds())) {
      this.collected = true;
      this.world.emit('shard', { x: this.cx + 0.5, y: this.cy + 0.5 });
    }
  }
  createView(kit) {
    const { THREE } = kit;
    const g = new THREE.Group();
    const mat = kit.sketchMaterial({ color: '#f2c94c', edges: false, emissive: '#3a2a00' });
    for (const s of [1, -1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.25, 8), mat);
      cone.rotation.x = s > 0 ? Math.PI : 0;
      cone.position.y = s * 0.13;
      kit.addOutline(cone, { thickness: 0.02 });
      g.add(cone);
    }
    for (const s of [1, -1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 10), kit.sketchMaterial({ color: '#8a5a2b', edges: false }));
      cap.position.y = s * 0.27;
      kit.addOutline(cap, { thickness: 0.015 });
      g.add(cap);
    }
    g.position.set(this.cx + 0.5, this.cy + 0.55, 0);
    return g;
  }
  updateView(g, kit, dt) {
    g.visible = !this.collected;
    g.rotation.y += dt * 2;
    g.position.y = this.cy + 0.55 + Math.sin(kit.shared.uTime.value * 3 + this.cx) * 0.08;
  }
}

// ============ Табличка с подсказкой ============
export class Sign extends Entity {
  static order = 10;
  bounds() { return { l: this.cx - 0.5, b: this.cy, r: this.cx + 1.5, t: this.cy + 2 }; }
  createView(kit) {
    const { THREE } = kit;
    const g = new THREE.Group();
    g.position.set(this.cx + 0.5, this.cy, -0.2);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.1), kit.sketchMaterial({ color: '#7a5a3a' }));
    post.position.y = 0.35;
    const tex = kit.cachedTexture('sign', 128, 96, (ctx, s, w, h) => {
      ctx.fillStyle = '#e8cfa0';
      ctx.fillRect(0, 0, w, h);
      s.hatch(0, 0, w, h, { gap: 10, alpha: 0.15, angle: 0.1 });
      s.rect(4, 4, w - 8, h - 8, { width: 5 });
      s.text('?', w / 2, h / 2 + 4, { size: 64 });
    });
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.08), kit.sketchMaterial({ color: '#ffffff', map: tex }));
    board.position.y = 0.8;
    board.rotation.z = 0.05;
    g.add(post, board);
    g.userData.board = board;
    return g;
  }
  updateView(g, kit) {
    const p = kit.world.player;
    const near = p && overlaps(p.rect(), this.bounds());
    g.userData.board.rotation.z = 0.05 + (near ? Math.sin(kit.shared.uTime.value * 8) * 0.06 : 0);
  }
}

// ============ Рассыпающийся блок ============
export class Crumble extends Entity {
  static state = ['timer', 'broken', 'respawnT'];
  static order = -7;
  constructor(world, def, t) {
    super(world, def, t);
    this.timer = 0;
    this.broken = false;
    this.respawnT = 0;
  }
  bounds() { return { l: this.cx, b: this.cy, r: this.cx + 1, t: this.cy + 1 }; }
  solid() { return this.broken ? null : { ...this.bounds(), oneWay: false }; }
  update(dt) {
    if (this.broken) {
      if (this.props.respawn > 0) {
        this.respawnT += dt;
        if (this.respawnT >= this.props.respawn) { this.broken = false; this.timer = 0; this.respawnT = 0; }
      }
      return;
    }
    if (this.timer > 0 || ridersOf(this.world, this, this.bounds()).length) {
      this.timer += dt;
      if (this.timer >= this.props.delay) {
        this.broken = true;
        this.respawnT = 0;
        this.world.emit('crumble', { x: this.cx + 0.5, y: this.cy + 0.5, particles: { count: 18, speed: 4, size: 0.3, life: 0.8, color: '#b8a888', kind: 0, gravity: 12 } });
      }
    }
  }
  createView(kit) {
    const tex = kit.cachedTexture('crumble', 128, 128, (ctx, s, w, h) => {
      ctx.fillStyle = '#c9b48f';
      ctx.fillRect(0, 0, w, h);
      s.hatch(0, 0, w, h, { gap: 12, alpha: 0.15 });
      s.line(20, 10, 60, 64, { width: 3 });
      s.line(60, 64, 40, 118, { width: 3 });
      s.line(60, 64, 112, 80, { width: 3 });
      s.rect(4, 4, w - 8, h - 8, { width: 5 });
    });
    const m = new kit.THREE.Mesh(new kit.THREE.BoxGeometry(1, 1, 1.1), kit.sketchMaterial({ color: '#ffffff', map: tex }));
    m.position.set(this.cx + 0.5, this.cy + 0.5, 0);
    return m;
  }
  updateView(m) {
    m.visible = !this.broken;
    const shake = this.timer > 0 && !this.broken ? (Math.random() - 0.5) * 0.08 : 0;
    m.position.x = this.cx + 0.5 + shake;
    m.rotation.z = shake;
  }
}
