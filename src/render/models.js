import * as THREE from 'three';
import { sketchMaterial, addOutline } from './materials.js';
import { clamp, lerp } from '../engine/constants.js';

const SCARF_N = 9;

/**
 * Персонаж-путешественник во времени: цилиндр, шарф, карманные часы.
 * Вся анимация процедурная: бег, прыжок, приземление (сжатие/растяжение),
 * моргание, развевающийся шарф (верле-цепочка), поворот на 3/4.
 */
export class Character {
  constructor({ coat = '#c8553d', scarf = '#e9b44c', skin = '#f4e4c8', ghost = false } = {}) {
    this.ghost = ghost;
    const opa = ghost ? 0.5 : 1;
    const mk = (color, o = {}) => sketchMaterial({ color, edges: false, opacity: opa, transparent: ghost, depthWrite: !ghost, emissive: ghost ? '#103a4a' : '#000', ...o });
    const ol = (mesh, t = 0.035) => { if (!ghost) addOutline(mesh, { thickness: t }); else addOutline(mesh, { thickness: t, ink: '#1f6f8b', opacity: 0.7 }); };

    this.root = new THREE.Group();
    this.facingGroup = new THREE.Group();
    this.squash = new THREE.Group();
    this.root.add(this.facingGroup);
    this.facingGroup.add(this.squash);

    // тело
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.22, 6, 12), mk(coat));
    body.position.y = 0.47;
    ol(body);
    this.body = body;
    this.squash.add(body);
    // полы плаща
    const coatTail = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.28, 10, 1, true), mk(coat, { side: THREE.DoubleSide }));
    coatTail.position.y = 0.32;
    this.coatTail = coatTail;
    this.squash.add(coatTail);

    // голова
    this.headPivot = new THREE.Group();
    this.headPivot.position.y = 0.78;
    this.squash.add(this.headPivot);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), mk(skin));
    ol(head);
    this.headPivot.add(head);
    // цилиндр
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.035, 16), mk('#2f2a2a'));
    brim.position.y = 0.15;
    brim.rotation.z = -0.12;
    ol(brim, 0.02);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.26, 14), mk('#3a3333'));
    hat.position.y = 0.29;
    hat.rotation.z = -0.12;
    ol(hat, 0.025);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.163, 0.163, 0.05, 14), mk(scarf));
    band.position.y = 0.2;
    band.rotation.z = -0.12;
    this.headPivot.add(brim, hat, band);
    // глаза
    this.eyes = [];
    for (const z of [-0.08, 0.08]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), new THREE.MeshBasicMaterial({ color: ghost ? '#1f6f8b' : '#1d1a18', transparent: ghost, opacity: ghost ? 0.8 : 1 }));
      e.position.set(0.15, 0.02, z);
      e.scale.y = 1.4;
      this.eyes.push(e);
      this.headPivot.add(e);
    }
    // карманные часы
    const watch = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 14), mk('#e9c46a', { emissive: ghost ? '#103a4a' : '#2a1d00' }));
    watch.rotation.x = Math.PI / 2;
    watch.rotation.z = Math.PI / 2;
    watch.position.set(0.17, 0.48, 0.1);
    ol(watch, 0.015);
    this.watch = watch;
    this.squash.add(watch);

    // ноги и руки
    const limbGeo = new THREE.CapsuleGeometry(0.055, 0.2, 4, 8);
    limbGeo.translate(0, -0.13, 0);
    this.legs = [];
    for (const z of [-0.09, 0.09]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, 0.3, z);
      const leg = new THREE.Mesh(limbGeo, mk('#3b3433'));
      ol(leg, 0.025);
      pivot.add(leg);
      this.squash.add(pivot);
      this.legs.push(pivot);
    }
    this.arms = [];
    for (const z of [-0.2, 0.2]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, 0.6, z);
      const arm = new THREE.Mesh(limbGeo, mk(coat));
      ol(arm, 0.025);
      pivot.add(arm);
      this.squash.add(pivot);
      this.arms.push(pivot);
    }

    // шарф — лента из верле-точек (в мировых координатах)
    this.scarfPts = Array.from({ length: SCARF_N }, () => new THREE.Vector3());
    this.scarfPrev = Array.from({ length: SCARF_N }, () => new THREE.Vector3());
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SCARF_N * 2 * 3), 3));
    sg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(SCARF_N * 2 * 3), 3));
    const suv = [];
    const sidx = [];
    for (let i = 0; i < SCARF_N; i++) {
      suv.push(i / (SCARF_N - 1), 0, i / (SCARF_N - 1), 1);
      if (i < SCARF_N - 1) sidx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
    sg.setIndex(sidx);
    for (let i = 0; i < SCARF_N * 2; i++) sg.attributes.normal.setXYZ(i, 0, 0, 1);
    this.scarf = new THREE.Mesh(sg, sketchMaterial({ color: scarf, side: THREE.DoubleSide, edgeWidth: 1.6, opacity: opa, transparent: ghost, depthWrite: !ghost, wobble: 0.01 }));
    this.scarf.frustumCulled = false;
    this.scarfInit = false;

    // анимационное состояние
    this.t = 0;
    this.runPhase = 0;
    this.face = 1;
    this.faceAngle = 0.45;
    this.sq = 1;
    this.sqV = 0;
    this.blinkT = 2;
    this.lean = 0;
    this.wasGround = true;
  }

  addTo(scene) {
    scene.add(this.root, this.scarf);
  }
  removeFrom(scene) {
    scene.remove(this.root, this.scarf);
  }

  /** s: {x,y,vx,vy,onGround,facing,dead,pushing}; scale — локальная скорость времени */
  animate(s, dt, scale = 1) {
    const adt = dt * scale;
    this.t += adt;
    this.root.position.set(s.x, s.y, 0);
    // поворот на 3/4 к камере
    if (s.facing) this.face = s.facing;
    const targetA = this.face > 0 ? 0.45 : Math.PI - 0.45;
    this.faceAngle = lerp(this.faceAngle, targetA, 1 - Math.exp(-14 * dt));
    this.facingGroup.rotation.y = -this.faceAngle;

    const speed = Math.abs(s.vx);
    const run = s.onGround ? clamp(speed / 6, 0, 1) : 0;
    this.runPhase += adt * (4 + speed * 2.2);
    const sw = Math.sin(this.runPhase);
    // ноги/руки
    if (s.onGround) {
      this.legs[0].rotation.z = sw * 0.9 * run;
      this.legs[1].rotation.z = -sw * 0.9 * run;
      this.arms[0].rotation.z = -sw * 0.8 * run + (s.pushing ? 1.3 : 0);
      this.arms[1].rotation.z = sw * 0.8 * run + (s.pushing ? 1.3 : 0);
    } else {
      const up = s.vy > 0 ? 1 : 0;
      this.legs[0].rotation.z = lerp(this.legs[0].rotation.z, up ? 0.7 : -0.2, 0.25);
      this.legs[1].rotation.z = lerp(this.legs[1].rotation.z, up ? -0.4 : 0.3, 0.25);
      this.arms[0].rotation.z = lerp(this.arms[0].rotation.z, up ? 2.6 : 1.9, 0.2);
      this.arms[1].rotation.z = lerp(this.arms[1].rotation.z, up ? 2.3 : 1.5, 0.2);
    }
    // подпрыгивание при беге
    this.squash.position.y = s.onGround ? Math.abs(Math.sin(this.runPhase)) * 0.06 * run : 0;
    // наклон
    this.lean = lerp(this.lean, -clamp(speed / 6, 0, 1) * 0.15 - (s.pushing ? 0.25 : 0), 1 - Math.exp(-10 * dt));
    this.squash.rotation.z = this.lean;

    // сжатие/растяжение (пружина)
    if (!this.wasGround && s.onGround) this.sqV -= 6;
    if (this.wasGround && !s.onGround && s.vy > 0) this.sqV += 5;
    this.wasGround = s.onGround;
    const target = s.onGround ? 1 : 1 + clamp(s.vy / 40, -0.12, 0.15);
    this.sqV += (target - this.sq) * 180 * dt;
    this.sqV *= Math.exp(-12 * dt);
    this.sq += this.sqV * dt;
    this.sq = clamp(this.sq, 0.6, 1.4);
    this.squash.scale.set(1 / Math.sqrt(this.sq), this.sq, 1 / Math.sqrt(this.sq));

    // голова, моргание
    this.headPivot.rotation.z = Math.sin(this.t * 2) * 0.05 + (s.onGround ? 0 : 0.1);
    this.blinkT -= dt;
    const blink = this.blinkT < 0.12;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3;
    for (const e of this.eyes) e.scale.y = blink ? 0.2 : 1.4;
    this.watch.rotation.y = this.t * 3;
    this.coatTail.scale.y = 1 + Math.sin(this.runPhase * 2) * 0.08 * run;

    // смерть — персонаж «рассыпается» и бледнеет
    this.root.visible = !s.dead;
    this.scarf.visible = !s.dead;

    this.updateScarf(dt, scale);
  }

  updateScarf(dt, scale) {
    const anchor = new THREE.Vector3(0, 0.66, 0);
    this.root.updateMatrixWorld(true);
    this.squash.localToWorld(anchor);
    const pts = this.scarfPts, prev = this.scarfPrev;
    const seg = 0.075;
    // телепорт (откат, перезапуск петли) — шарф пересоздаём на месте
    if (this.scarfInit && pts[0].distanceTo(anchor) > 1) this.scarfInit = false;
    if (!this.scarfInit) {
      pts.forEach((p, i) => { p.set(anchor.x - i * seg * this.face, anchor.y, anchor.z); prev[i].copy(p); });
      this.scarfInit = true;
    }
    pts[0].copy(anchor);
    prev[0].copy(anchor);
    const sdt = Math.min(dt, 1 / 30) * Math.max(scale, 0.05);
    const wind = Math.sin(this.t * 3) * 0.3;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = prev[i];
      const vx = (p.x - q.x) * 0.92, vy = (p.y - q.y) * 0.92;
      q.copy(p);
      p.x += vx - this.face * 0.4 * sdt * sdt * 60;
      p.y += vy - 4 * sdt * sdt + wind * sdt * 0.05;
      p.z = anchor.z + 0.05 + i * 0.01;
    }
    // «следуй за лидером»: каждое звено ровно seg от предыдущего — без растяжения
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      b.x = a.x + (dx / d) * seg;
      b.y = a.y + (dy / d) * seg;
    }
    const attr = this.scarf.geometry.attributes.position;
    for (let i = 0; i < pts.length; i++) {
      const w = 0.07 * (1 - (i / pts.length) * 0.4);
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
      let nx = -(b.y - a.y), ny = b.x - a.x;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l;
      attr.setXYZ(i * 2, pts[i].x + nx * w, pts[i].y + ny * w, pts[i].z);
      attr.setXYZ(i * 2 + 1, pts[i].x - nx * w, pts[i].y - ny * w, pts[i].z);
    }
    attr.needsUpdate = true;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.scarf.geometry.dispose();
  }
}

/** Простой «рисованный» бокс с контурами по краям граней. */
export function sketchBox(w, h, d, opts = {}) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), sketchMaterial(opts));
}
