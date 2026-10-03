import * as THREE from 'three';
import { buildTiles, TILE_DEPTH } from './tiles.js';
import { Background } from './background.js';
import { Particles } from './particles.js';
import { sketchMaterial, outlineMaterial, addOutline, customShader, shared } from './materials.js';
import { Character, sketchBox } from './models.js';
import { canvasTexture, cachedTexture, Sketch, rng, INK, PAPER } from './draw.js';
import { channelColor, clamp, lerp } from '../engine/constants.js';

/** Инструменты, которые получают сущности (и моды) для построения своего вида. */
export function makeKit(view) {
  return {
    THREE,
    view,
    get particles() { return view.particles; },
    get world() { return view.world; },
    sketchMaterial, outlineMaterial, addOutline, customShader, shared,
    Character, sketchBox,
    canvasTexture, cachedTexture, Sketch, rng, INK, PAPER,
    channelColor, clamp, lerp,
    TILE_DEPTH,
  };
}

/**
 * Визуальное представление мира. Не влияет на симуляцию: только читает
 * состояние сущностей и рисует его. Используется и игрой, и редактором.
 */
export class WorldView {
  constructor(renderer) {
    this.r = renderer;
    this.scene = renderer.scene;
    this.kit = makeKit(this);
    this.particles = new Particles();
    this.background = new Background();
    this.views = new Map();
    this.tiles = null;
    this.world = null;
    this.camPos = new THREE.Vector3(0, 0, 18);
    this.camTarget = new THREE.Vector3();
    this.shake = 0;
    this.zoom = 1;
    this.followSpeed = 5;
    this.tilt = 2.6;
    this.dist = 15;
    this.scene.add(this.background.group, this.particles.points);
    const amb = new THREE.Group();
    this.scene.add(amb);
    this.ambient = amb;
  }

  setWorld(world, { rebuildTiles = true } = {}) {
    for (const [, v] of this.views) this.disposeView(v);
    this.views.clear();
    this.world = world;
    if (rebuildTiles || !this.tiles) {
      if (this.tiles) {
        this.scene.remove(this.tiles);
        this.tiles.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      }
      this.tiles = buildTiles(world);
      this.scene.add(this.tiles);
      this.background.fit(world);
    }
    for (const e of world.entities) {
      let v = null;
      try {
        v = e.createView(this.kit);
      } catch (err) {
        console.error(`createView(${e.type})`, err);
      }
      if (v) {
        this.scene.add(v);
        this.views.set(e, v);
      }
    }
  }

  disposeView(v) {
    this.scene.remove(v);
    if (v.userData.dispose) v.userData.dispose();
    v.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
  }

  rebuildTiles() {
    if (!this.world) return;
    this.setWorld(this.world, { rebuildTiles: true });
  }

  /** Камера мягко следует за точкой и не выходит за края уровня */
  follow(x, y, dt, snap = false) {
    const w = this.world;
    const cam = this.r.camera;
    const dist = this.dist / this.zoom;
    const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * dist;
    const halfW = halfH * cam.aspect;
    let tx = x, ty = y + 1;
    if (w) {
      tx = w.width <= halfW * 2 - 1 ? w.width / 2 : clamp(tx, halfW - 0.5, w.width - halfW + 0.5);
      ty = w.height <= halfH * 2 - 1 ? w.height / 2 : clamp(ty, halfH - 1.5, w.height - halfH + 1);
    }
    const k = snap ? 1 : 1 - Math.exp(-this.followSpeed * dt);
    this.camTarget.x = lerp(this.camTarget.x, tx, k);
    this.camTarget.y = lerp(this.camTarget.y, ty, k);
    this.applyCamera(dist);
  }

  applyCamera(dist = this.dist / this.zoom) {
    const cam = this.r.camera;
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    cam.position.set(this.camTarget.x + sx, this.camTarget.y + this.tilt + sy, dist);
    cam.lookAt(this.camTarget.x + sx * 0.5, this.camTarget.y + sy * 0.5, 0);
  }

  addShake(a) {
    this.shake = Math.max(this.shake, a);
  }

  /** Обработка событий симуляции: частицы, тряска */
  onEvent(ev) {
    const p = this.particles;
    switch (ev.type) {
      case 'jump':
        p.burst(ev.x, ev.y + 0.05, 6, { speed: 2, dir: -Math.PI / 2, spread: 2.5, size: 0.18, life: 0.35, color: '#d8cbb0', kind: 0 });
        break;
      case 'land':
        p.burst(ev.x, ev.y + 0.05, Math.min(14, 4 + ev.power * 0.6), { speed: 2.5, dir: Math.PI / 2, spread: 2.6, size: 0.2, life: 0.4, color: '#e6dcc5', kind: 0, gravity: 4 });
        if (ev.power > 14) this.addShake(0.12);
        break;
      case 'death':
        p.burst(ev.x, ev.y + 0.45, 30, { speed: 6, size: 0.25, life: 0.9, color: '#c8553d', kind: 3, gravity: 8, spin: 6 });
        p.burst(ev.x, ev.y + 0.45, 12, { speed: 3, size: 0.4, life: 1.2, color: '#2b2622', kind: 1 });
        this.addShake(0.35);
        break;
      case 'shard':
        p.burst(ev.x, ev.y, 24, { speed: 4, size: 0.3, life: 0.8, color: '#e9c46a', kind: 2, spin: 4 });
        break;
      case 'plate':
        p.burst(ev.x, ev.y + 0.1, 6, { speed: 1.5, dir: Math.PI / 2, spread: 1.6, size: 0.18, life: 0.4, color: ev.color || '#888', kind: 2 });
        break;
      case 'win':
        p.burst(ev.x, ev.y + 1, 60, { speed: 7, size: 0.35, life: 1.4, color: '#e9c46a', kind: 2, gravity: 3, spin: 5 });
        p.burst(ev.x, ev.y + 1, 20, { speed: 4, size: 0.5, life: 1.2, color: '#2a9d8f', kind: 1 });
        break;
      case 'stop':
        p.burst(ev.x, ev.y + 0.5, 30, { speed: 9, size: 0.5, life: 0.7, color: '#3d7cc9', kind: 1 });
        this.addShake(0.15);
        break;
      case 'recall':
        p.burst(ev.fromX, ev.fromY + 0.5, 20, { speed: 3, size: 0.3, life: 0.6, color: '#7d5ba6', kind: 4, spin: 3 });
        p.burst(ev.x, ev.y + 0.5, 20, { speed: 5, size: 0.3, life: 0.7, color: '#7d5ba6', kind: 2, spin: 3 });
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          p.spawn({ x: lerp(ev.fromX, ev.x, t), y: lerp(ev.fromY, ev.y, t) + 0.5, life: 0.5 + t * 0.3, size: 0.25, color: '#b39ddb', kind: 4 });
        }
        break;
      case 'loop':
        this.addShake(0.2);
        break;
      default:
        if (ev.particles) p.burst(ev.x, ev.y, ev.particles.count || 10, ev.particles);
    }
  }

  update(frameDt, { worldTime = 0, rewind = 0 } = {}) {
    if (this.world) {
      for (const [e, v] of this.views) {
        try {
          e.updateView(v, this.kit, frameDt);
        } catch (err) {
          console.error(`updateView(${e.type})`, err);
          this.views.delete(e);
        }
      }
    }
    this.background.update(worldTime, rewind, frameDt);
    this.particles.update(frameDt);
    this.shake *= Math.exp(-8 * frameDt);
    if (this.shake < 0.005) this.shake = 0;
  }

  dispose() {
    for (const [, v] of this.views) this.disposeView(v);
    this.views.clear();
    if (this.tiles) this.scene.remove(this.tiles);
    this.scene.remove(this.background.group, this.particles.points, this.ambient);
  }
}
