import * as THREE from 'three';
import { tileTypes } from '../engine/registry.js';
import { sketchMaterial, outlineMaterial } from './materials.js';

export const TILE_DEPTH = 1.2;
const BORDER = 10; // визуальное продолжение уровня за краями

/**
 * Строит геометрию тайлов: только видимые грани, с маской краёв для
 * чернильных контуров (линии рисуются лишь там, где блок граничит с пустотой).
 */
export function buildTiles(world) {
  const group = new THREE.Group();
  group.name = 'tiles';
  const W = world.width, H = world.height;

  const charAt = (cx, cy) => {
    // за пределами уровня продолжаем крайние тайлы (кроме верха)
    if (cy >= H) return '.';
    const x = Math.min(Math.max(cx, 0), W - 1);
    const y = Math.max(cy, 0);
    return world.grid[H - 1 - y][x];
  };
  const isBlock = (cx, cy) => {
    const t = tileTypes.get(charAt(cx, cy));
    return !!(t && t.render === 'block');
  };

  const byChar = new Map();
  const planks = [];
  const spikes = [];
  for (let cy = -BORDER; cy < H; cy++) {
    for (let cx = -BORDER; cx < W + BORDER; cx++) {
      const ch = charAt(cx, cy);
      const t = tileTypes.get(ch);
      if (!t) continue;
      if (t.render === 'block') {
        if (!byChar.has(ch)) byChar.set(ch, []);
        byChar.get(ch).push([cx, cy]);
      } else if (t.render === 'plank') planks.push([cx, cy, t]);
      else if (t.render === 'spikes') spikes.push([cx, cy, t]);
    }
  }

  const z0 = -TILE_DEPTH / 2, z1 = TILE_DEPTH / 2;
  for (const [ch, cells] of byChar) {
    const t = tileTypes.get(ch);
    const pos = [], nrm = [], uv = [], edges = [], idx = [];
    const quad = (a, b, c, d, n, e) => {
      const i = pos.length / 3;
      pos.push(...a, ...b, ...c, ...d);
      for (let k = 0; k < 4; k++) { nrm.push(...n); edges.push(...e); }
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    };
    for (const [cx, cy] of cells) {
      const x0 = cx, x1 = cx + 1, y0 = cy, y1 = cy + 1;
      const L = !isBlock(cx - 1, cy), R = !isBlock(cx + 1, cy), B = !isBlock(cx, cy - 1), T = !isBlock(cx, cy + 1);
      const sameL = charAt(cx - 1, cy) !== ch, sameR = charAt(cx + 1, cy) !== ch;
      const sameB = charAt(cx, cy - 1) !== ch, sameT = charAt(cx, cy + 1) !== ch;
      // лицевая грань
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1],
        [L || sameL ? 1 : 0, R || sameR ? 1 : 0, B || sameB ? 1 : 0, T ? 1 : (sameT ? 1 : 0)]);
      if (T) quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [L ? 1 : 0, R ? 1 : 0, 1, 1]);
      if (B) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [L ? 1 : 0, R ? 1 : 0, 1, 1]);
      if (L) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [1, 1, B ? 1 : 0, T ? 1 : 0]);
      if (R) quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [1, 1, B ? 1 : 0, T ? 1 : 0]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aEdges', new THREE.Float32BufferAttribute(edges, 4));
    g.setIndex(idx);
    const mat = sketchMaterial({ color: t.color, top: t.top, edgeMask: true, doodle: 1, wobble: 0.025 });
    group.add(new THREE.Mesh(g, mat));
  }

  if (planks.length) {
    const geo = new THREE.BoxGeometry(1, 0.22, TILE_DEPTH * 0.8);
    const mesh = new THREE.InstancedMesh(geo, sketchMaterial({ color: planks[0][2].color, wobble: 0.02 }), planks.length);
    const m = new THREE.Matrix4();
    planks.forEach(([cx, cy], i) => mesh.setMatrixAt(i, m.makeTranslation(cx + 0.5, cy + 0.89, 0)));
    group.add(mesh);
    // опоры-кронштейны
    const sg = new THREE.BoxGeometry(0.08, 0.35, 0.08);
    const sup = new THREE.InstancedMesh(sg, sketchMaterial({ color: '#7a6a55', edges: false }), planks.length * 2);
    planks.forEach(([cx, cy], i) => {
      sup.setMatrixAt(i * 2, m.makeTranslation(cx + 0.2, cy + 0.66, -0.25));
      sup.setMatrixAt(i * 2 + 1, m.makeTranslation(cx + 0.8, cy + 0.66, -0.25));
    });
    group.add(sup);
  }

  if (spikes.length) {
    const geo = new THREE.ConeGeometry(0.15, 0.48, 4, 1);
    geo.rotateY(Math.PI / 4);
    geo.translate(0, 0.24, 0);
    const per = 3;
    const count = spikes.length * per * 2;
    const mat = sketchMaterial({ color: spikes[0][2].color, edges: false, hatch: 1.4 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const outline = new THREE.InstancedMesh(geo, outlineMaterial({ thickness: 0.025 }), count);
    const m = new THREE.Matrix4();
    let i = 0;
    for (const [cx, cy] of spikes) {
      for (const z of [-0.25, 0.25]) {
        for (let k = 0; k < per; k++) {
          const h = 0.85 + ((cx * 7 + k * 3 + (z > 0 ? 1 : 0)) % 5) * 0.06;
          m.makeScale(1, h, 1).setPosition(cx + (k + 0.5) / per, cy, z);
          mesh.setMatrixAt(i, m);
          outline.setMatrixAt(i, m);
          i++;
        }
      }
    }
    group.add(outline, mesh);
  }
  return group;
}
