// Рендер на three.js: «рисованный карандашом/маркером» стиль, дрожащие линии, акварельная заливка,
// бумага, частицы, пост-эффекты времени (перемотка, замедление, ускорение).
import * as THREE from '../vendor/three.module.js';
import { INK } from './types.js';
import { PW, PH, DT } from './sim.js';

const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const noise1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };
const colCache = new Map();
export function col(hex) {
  let c = colCache.get(hex);
  if (!c) { const k = new THREE.Color(hex); c = [k.r, k.g, k.b]; colCache.set(hex, c); }
  return c;
}

const NOISE = `
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.03; a*=.5; } return s; }
`;

const BATCH_VERT = `
attribute vec4 color; attribute vec4 shape;
varying vec4 vC; varying vec4 vS; varying vec2 vW;
void main(){ vC=color; vS=shape; vW=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const BATCH_FRAG = `
precision highp float;
varying vec4 vC; varying vec4 vS; varying vec2 vW;
${NOISE}
void main(){
  vec3 c=vC.rgb; float a=vC.a;
  float grain=vn(vW*70.0);
  if(vS.z>0.0){
    float d=min(vS.z-abs(vW.x-vS.x), vS.w-abs(vW.y-vS.y));
    float pool=exp(-max(d,0.0)*5.0);
    float n=vn(vW*5.0);
    c*=1.0-0.22*pool*(0.5+n);
    float hh=fract((vW.x+vW.y)*3.5+n*0.7);
    float hl=smoothstep(0.0,0.06,hh)*(1.0-smoothstep(0.16,0.24,hh));
    c*=1.0-0.10*hl*(0.35+pool);
    c*=0.94+0.06*grain;
  } else { a*=0.80+0.20*grain; }
  gl_FragColor=vec4(c,a);
}`;

const BG_FRAG = `
precision highp float;
varying vec2 vW; uniform float uTime; uniform vec3 uTint;
${NOISE}
float gridLine(float v, float w){ float d=abs(fract(v+0.5)-0.5); return smoothstep(w,w*0.25,d); }
void main(){
  vec2 p=vW;
  vec3 paper=vec3(0.957,0.925,0.839);
  float wash=fbm(p*0.07);
  paper=mix(paper, paper*vec3(0.96,0.99,1.03), smoothstep(0.35,0.8,wash));
  paper=mix(paper, uTint, 0.10*smoothstep(0.45,0.9,fbm(p*0.05+9.0)));
  paper*=0.965+0.05*vn(p*55.0)+0.02*vn(p*180.0);
  vec2 q=p+vec2(vn(p*0.9),vn(p*0.9+7.0))*0.07;
  float g1=gridLine(q.x,0.018)+gridLine(q.y,0.018);
  float g5=gridLine(q.x/5.0,0.006)+gridLine(q.y/5.0,0.006);
  vec3 ink=vec3(0.55,0.66,0.84);
  paper=mix(paper, ink, clamp(g1*0.20+g5*0.30,0.,0.55));
  gl_FragColor=vec4(paper,1.0);
}`;

const POST_FRAG = `
precision highp float;
varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uRes;
uniform float uTime,uRewind,uSlow,uFast,uFlash,uShock;
${NOISE}
void main(){
  vec2 uv=vUv;
  float tk=floor(uTime*8.0);
  uv+=(vec2(vn(uv*26.+tk*1.7),vn(uv*26.+17.+tk*2.3))-0.5)*0.0022;
  float band=step(0.90,vn(vec2(floor(uv.y*26.0),floor(uTime*16.0))));
  uv.x+=(uRewind*band*0.035+uShock*band*0.05)*(vn(vec2(uTime*30.,uv.y*40.))-0.5)*2.0;
  vec2 dir=uv-0.5;
  float ca=0.0012+uRewind*0.006+uShock*0.012+uSlow*0.002;
  float amt=uFast*0.05;
  vec3 col=vec3(0.0);
  for(int i=0;i<6;i++){
    float k=float(i)/5.0;
    vec2 u=uv-dir*amt*k;
    col+=vec3(texture2D(tDiffuse,u+dir*ca).r, texture2D(tDiffuse,u).g, texture2D(tDiffuse,u-dir*ca).b);
  }
  col/=6.0;
  float lum=dot(col,vec3(0.3,0.55,0.15));
  col=mix(col,vec3(lum)*vec3(0.72,0.88,1.18)+vec3(0.0,0.02,0.08),uRewind*0.65);
  col*=1.0-uRewind*0.10*step(0.5,fract(uv.y*uRes.y*0.5));
  col=mix(col,vec3(lum)*vec3(0.80,0.93,1.12)+vec3(0.0,0.02,0.07),uSlow*0.55);
  col*=mix(vec3(1.0),vec3(1.08,1.0,0.86),uFast);
  float v=smoothstep(1.05,0.30,length(dir)*1.25);
  col*=mix(0.80,1.0,v)*mix(1.0,0.85,uSlow);
  col*=0.97+0.05*vn(uv*uRes*0.6+tk);
  col=mix(col,vec3(1.0),uFlash);
  gl_FragColor=vec4(col,1.0);
}`;

const PART_VERT = `
attribute vec4 aColor; attribute float aSize; attribute float aShape; uniform float uScale;
varying vec4 vC; varying float vS;
void main(){ vC=aColor; vS=aShape; gl_PointSize=aSize*uScale; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const PART_FRAG = `
precision highp float;
varying vec4 vC; varying float vS;
void main(){
  vec2 p=gl_PointCoord*2.0-1.0; float r=length(p); float a=0.0;
  if(vS<0.5){ a=smoothstep(1.0,0.5,r); }
  else if(vS<1.5){ a=smoothstep(1.0,0.85,r)*smoothstep(0.5,0.72,r); }
  else if(vS<2.5){ float d=min(abs(p.x),abs(p.y)); a=smoothstep(0.24,0.04,d)*smoothstep(1.0,0.55,r); }
  else { a=step(abs(p.x),0.9)*step(abs(p.y),0.4); }
  if(vC.a*a<0.01) discard;
  gl_FragColor=vec4(vC.rgb,vC.a*a);
}`;

class Batch {
  constructor(cap, transparent) {
    this.cap = cap; this.n = 0;
    this.pos = new Float32Array(cap * 3); this.colr = new Float32Array(cap * 4); this.shp = new Float32Array(cap * 4);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.colr, 4).setUsage(THREE.DynamicDrawUsage);
    this.aShp = new THREE.BufferAttribute(this.shp, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos); geo.setAttribute('color', this.aCol); geo.setAttribute('shape', this.aShp);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: BATCH_VERT, fragmentShader: BATCH_FRAG, transparent, depthWrite: !transparent, depthTest: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = transparent ? 2 : 1;
  }
  begin() { this.n = 0; }
  v(x, y, z, c, a, sx = 0, sy = 0, sz = 0, sw = 0) {
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.colr[i * 4] = c[0]; this.colr[i * 4 + 1] = c[1]; this.colr[i * 4 + 2] = c[2]; this.colr[i * 4 + 3] = a;
    this.shp[i * 4] = sx; this.shp[i * 4 + 1] = sy; this.shp[i * 4 + 2] = sz; this.shp[i * 4 + 3] = sw;
  }
  room(k) { return this.n + k <= this.cap; }
  end() {
    this.geo.setDrawRange(0, this.n);
    for (const a of [this.aPos, this.aCol, this.aShp]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

// ---------- API рисования, передаётся в draw-хуки типов ----------
class Draw {
  constructor(gfx) { this.gfx = gfx; this.time = 0; this.dt = 0.016; this.wob = 0; }

  pick(a, layer) { return a < 0.999 || layer === 'alpha' ? this.gfx.alpha : this.gfx.opaque; }

  stroke(batch, ax, ay, bx, by, w, c, a, z, seed, amp = 0.028) {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-4) return;
    const nseg = Math.max(2, Math.ceil(len / 0.55));
    const ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy, ny = ux;
    const pts = [];
    for (let i = 0; i <= nseg; i++) {
      const s = i / nseg;
      const off = (noise1(seed * 1.7 + s * len * 0.9) - 0.5) * 2 * amp;
      pts.push([ax + ux * s * len + nx * off, ay + uy * s * len + ny * off]);
    }
    this.ribbon(batch, pts, w, c, a, z, seed, true);
  }

  ribbon(batch, pts, w, c, a, z, seed, taper) {
    const n = pts.length;
    if (n < 2 || !batch.room(n * 6 + 6)) return;
    const nrm = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)];
      let dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      nrm.push([-dy, dx]);
    }
    let prevL = null, prevR = null;
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      const wv = w * (taper ? 0.5 + 0.5 * Math.pow(Math.sin(Math.PI * s), 0.5) : 1) * (0.82 + 0.36 * noise1(seed * 3.3 + i * 0.9));
      const L = [pts[i][0] + nrm[i][0] * wv / 2, pts[i][1] + nrm[i][1] * wv / 2];
      const R = [pts[i][0] - nrm[i][0] * wv / 2, pts[i][1] - nrm[i][1] * wv / 2];
      if (prevL) {
        batch.v(prevL[0], prevL[1], z, c, a); batch.v(prevR[0], prevR[1], z, c, a); batch.v(L[0], L[1], z, c, a);
        batch.v(prevR[0], prevR[1], z, c, a); batch.v(R[0], R[1], z, c, a); batch.v(L[0], L[1], z, c, a);
      }
      prevL = L; prevR = R;
    }
  }

  fillFan(batch, pts, cx, cy, c, a, z, shape) {
    const n = pts.length;
    if (!batch.room(n * 3)) return;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      batch.v(cx, cy, z, c, a, shape[0], shape[1], shape[2], shape[3]);
      batch.v(p[0], p[1], z, c, a, shape[0], shape[1], shape[2], shape[3]);
      batch.v(q[0], q[1], z, c, a, shape[0], shape[1], shape[2], shape[3]);
    }
  }

  seedOf(o) { return (o.seed ?? 0) * 1.37 + this.wob; }

  inkLine(ax, ay, bx, by, o, w, seed, a, z, dash, amp) {
    const batch = this.pick(a, o.layer);
    const c = col(o.ink ?? INK);
    if (dash) {
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      for (let s = 0; s < len; s += dash * 2) {
        const e = Math.min(len, s + dash);
        this.stroke(batch, ax + ux * s, ay + uy * s, ax + ux * e, ay + uy * e, w, c, a, z, seed + s, amp);
      }
    } else this.stroke(batch, ax, ay, bx, by, w, c, a, z, seed, amp);
  }

  line(ax, ay, bx, by, o = {}) {
    const a = o.a ?? 1, z = (o.z ?? 0) + 0.05, w = o.lw ?? 0.07;
    this.inkLine(ax, ay, bx, by, o, w, this.seedOf(o), a, z, o.dash, 0.02);
  }

  path(pts, o = {}) {
    const a = o.a ?? 1, z = (o.z ?? 0) + 0.05, w = o.lw ?? 0.07, seed = this.seedOf(o);
    for (let i = 0; i < pts.length - 1; i++) this.inkLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], o, w, seed + i * 3.1, a, z, o.dash, 0.02);
  }

  outlinePoly(pts, o, closed) {
    if (o.ink === null) return;
    const a = o.a ?? 1, z = (o.z ?? 0) + 0.05, w = o.lw ?? 0.07, seed = this.seedOf(o);
    const n = pts.length, m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      let [ax, ay, bx, by] = [p[0], p[1], q[0], q[1]];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      if (!o.dash) { // перерисовка линии с «перехлёстом» как от руки
        const os = 0.04 + hash(seed + i) * 0.08, ux = (bx - ax) / len, uy = (by - ay) / len;
        ax -= ux * os * hash(seed + i * 3); ay -= uy * os * hash(seed + i * 3); bx += ux * os; by += uy * os;
      }
      this.inkLine(ax, ay, bx, by, o, w, seed + i * 5.3, a, z, o.dash, 0.022);
      if (!o.dash && w > 0.03) this.inkLine(ax, ay, bx, by, o, w * 0.45, seed + 31 + i * 2.1, a * 0.45, z - 0.01, 0, 0.05);
    }
  }

  rect(x, y, w, h, o = {}) {
    const hw = w / 2, hh = h / 2, z = o.z ?? 0, a = o.a ?? 1, seed = this.seedOf(o);
    const corners = [[x - hw, y - hh], [x + hw, y - hh], [x + hw, y + hh], [x - hw, y + hh]];
    if (o.fill) {
      const j = (k) => (noise1(seed * 1.3 + k) - 0.5) * 0.09;
      const q = corners.map((p, k) => [p[0] + j(k * 2) + 0.05, p[1] + j(k * 2 + 1) - 0.04]);
      const batch = this.pick(a, o.layer), c = col(o.fill), sh = [x, y, hw, hh];
      if (batch.room(6)) {
        for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]]) for (const i of [i0, i1, i2]) batch.v(q[i][0], q[i][1], z, c, a, sh[0], sh[1], sh[2], sh[3]);
      }
    }
    this.outlinePoly(corners, o, true);
  }

  circle(x, y, r, o = {}) {
    const ry = o.ry ?? r, z = o.z ?? 0, a = o.a ?? 1, seed = this.seedOf(o);
    const N = Math.max(14, Math.min(40, Math.ceil(Math.max(r, ry) * 16)));
    if (o.fill) {
      const pts = [];
      for (let i = 0; i < N; i++) {
        const an = (i / N) * Math.PI * 2, k = 1 + (noise1(seed + i * 0.7) - 0.5) * 0.06;
        pts.push([x + 0.04 + Math.cos(an) * r * k, y - 0.03 + Math.sin(an) * ry * k]);
      }
      this.fillFan(this.pick(a, o.layer), pts, x + 0.04, y - 0.03, col(o.fill), a, z, [x, y, r, ry]);
    }
    if (o.ink !== null) {
      const w = o.lw ?? 0.07, c = col(o.ink ?? INK);
      const batch = this.pick(a, o.layer);
      const dash = o.dash;
      const build = (turns, jit, off) => {
        const pts = [], a0 = hash(seed + off) * 6.28, M = Math.ceil(N * turns);
        for (let i = 0; i <= M; i++) {
          const an = a0 + (i / N) * Math.PI * 2, k = 1 + (noise1(seed * 2 + i * 0.45 + off) - 0.5) * jit + (i / M) * 0.03 * turns;
          pts.push([x + Math.cos(an) * r * k, y + Math.sin(an) * ry * k]);
        }
        return pts;
      };
      if (dash) {
        const pts = build(1, 0.02, 0);
        for (let i = 0; i < pts.length - 1; i += 2) this.ribbon(batch, [pts[i], pts[Math.min(pts.length - 1, i + 1)]], w, c, a, z + 0.05, seed, false);
      } else {
        this.ribbon(batch, build(1.08, 0.05, 0), w, c, a, z + 0.05, seed, true);
        if (w > 0.03) this.ribbon(batch, build(1.0, 0.09, 5), w * 0.45, c, a * 0.45, z + 0.04, seed + 3, true);
      }
    }
  }

  poly(pts, o = {}) {
    const z = o.z ?? 0, a = o.a ?? 1, seed = this.seedOf(o);
    if (o.fill) {
      let cx = 0, cy = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const p of pts) { cx += p[0]; cy += p[1]; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      cx /= pts.length; cy /= pts.length;
      const q = pts.map((p, k) => [p[0] + 0.04 + (noise1(seed + k) - 0.5) * 0.05, p[1] - 0.035 + (noise1(seed + k + 9) - 0.5) * 0.05]);
      this.fillFan(this.pick(a, o.layer), q, cx + 0.04, cy - 0.035, col(o.fill), a, z, [(x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2]);
    }
    this.outlinePoly(pts, o, true);
  }

  tris(list, o = {}) {
    const z = o.z ?? 0, a = o.a ?? 1, c = col(o.fill ?? '#ccc');
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < list.length; i += 2) { x0 = Math.min(x0, list[i]); x1 = Math.max(x1, list[i]); y0 = Math.min(y0, list[i + 1]); y1 = Math.max(y1, list[i + 1]); }
    const batch = this.pick(a, o.layer);
    if (!batch.room(list.length / 2)) return;
    for (let i = 0; i < list.length; i += 2) batch.v(list[i] + 0.03, list[i + 1] - 0.03, z, c, a, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2);
  }

  glow(x, y, r, color, a = 0.3, o = {}) {
    const batch = this.gfx.alpha, c = col(color), N = 22, z = o.z ?? -0.2;
    if (!batch.room(N * 3)) return;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      batch.v(x, y, z, c, a); batch.v(x + Math.cos(a0) * r, y + Math.sin(a0) * r, z, c, 0); batch.v(x + Math.cos(a1) * r, y + Math.sin(a1) * r, z, c, 0);
    }
  }

  spiral(x, y, r, turns, rot, o = {}) {
    const ry = o.ry ?? r, M = Math.ceil(turns * 20), pts = [];
    for (let i = 0; i <= M; i++) {
      const s = i / M, an = rot + s * turns * Math.PI * 2, rr = 0.08 + s * 0.92;
      pts.push([x + Math.cos(an) * r * rr, y + Math.sin(an) * ry * rr]);
    }
    const a = o.a ?? 1;
    this.ribbon(this.pick(a, o.layer), pts, o.lw ?? 0.07, col(o.ink ?? INK), a, (o.z ?? 0) + 0.05, this.seedOf(o), true);
  }

  text(str, x, y, size, color, a = 1, o = {}) { this.gfx.drawText(str, x, y, size, color, a, o); }
  emit(kind, x, y, o) { this.gfx.parts.emit(kind, x, y, o); }
}

// ---------- частицы ----------
class Particles {
  constructor(max = 2500) {
    this.max = max; this.list = [];
    this.pos = new Float32Array(max * 3); this.colr = new Float32Array(max * 4); this.size = new Float32Array(max); this.shape = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.colr, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aShape = new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos); geo.setAttribute('aColor', this.aCol); geo.setAttribute('aSize', this.aSize); geo.setAttribute('aShape', this.aShape);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({ vertexShader: PART_VERT, fragmentShader: PART_FRAG, transparent: true, depthWrite: false, depthTest: false, uniforms: { uScale: { value: 1 } } });
    this.mesh = new THREE.Points(geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
  }
  emit(kind, x, y, o = {}) {
    if (this.list.length >= this.max) return;
    const rnd = Math.random;
    const p = { x, y, vx: o.vx ?? 0, vy: o.vy ?? 0, life: o.life ?? 1, age: 0, size: o.size ?? 8, c: col(o.color ?? '#ffffff'), drag: 0, grav: 0, shape: 0, a: 1, spin: 0 };
    if (kind === 'spark') { p.shape = 2; p.vx += (rnd() - 0.5) * 2; p.vy += (rnd() - 0.5) * 2; p.drag = 1.5; }
    else if (kind === 'dust') { p.shape = 0; p.vx += (rnd() - 0.5) * 3; p.vy += rnd() * 1.5; p.drag = 3; p.a = 0.55; }
    else if (kind === 'mote') { p.shape = rnd() < 0.3 ? 1 : 0; p.vx += (rnd() - 0.5) * 0.4; p.vy += (rnd() - 0.5) * 0.4; p.a = 0.7; }
    else if (kind === 'confetti') { p.shape = 3; p.drag = 0.6; p.grav = -5; p.a = 1; }
    else if (kind === 'burst') { p.shape = rnd() < 0.5 ? 2 : 0; const an = rnd() * 6.28, sp = (o.speed ?? 6) * (0.3 + rnd()); p.vx = Math.cos(an) * sp; p.vy = Math.sin(an) * sp; p.drag = 2.2; }
    Object.assign(p, o.override || {});
    this.list.push(p);
  }
  burst(n, x, y, o) { for (let i = 0; i < n; i++) this.emit(o.kind || 'burst', x, y, { ...o }); }
  update(dt, uScale) {
    this.mat.uniforms.uScale.value = uScale;
    const L = this.list;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vx -= p.vx * p.drag * dt; p.vy -= p.vy * p.drag * dt; p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      L[w++] = p;
    }
    L.length = w;
    for (let i = 0; i < w; i++) {
      const p = L[i], k = 1 - p.age / p.life;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = 9;
      this.colr[i * 4] = p.c[0]; this.colr[i * 4 + 1] = p.c[1]; this.colr[i * 4 + 2] = p.c[2]; this.colr[i * 4 + 3] = p.a * Math.min(1, k * 2.2);
      this.size[i] = p.size * (p.shape === 1 ? 1 + (1 - k) * 0.6 : 0.4 + 0.6 * k);
      this.shape[i] = p.shape;
    }
    this.geo.setDrawRange(0, w);
    for (const a of [this.aPos, this.aCol, this.aSize, this.aShape]) { a.clearUpdateRanges(); a.addUpdateRange(0, w * a.itemSize); a.needsUpdate = true; }
  }
}

const COLORS = { player: '#ff6b4a', ghost: '#2bb3a8' };

export class Gfx {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.cam = { x: 0, y: 4, view: 15 };
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
    this.camera.position.z = 50;
    this.opaque = new Batch(180000, false);
    this.alpha = new Batch(180000, true);
    this.scene.add(this.opaque.mesh, this.alpha.mesh);
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xy; gl_Position=projectionMatrix*viewMatrix*w; }',
      fragmentShader: BG_FRAG, depthWrite: false, depthTest: false, uniforms: { uTime: { value: 0 }, uTint: { value: new THREE.Vector3(0.5, 0.7, 0.9) } },
    }));
    this.bg.renderOrder = -10; this.bg.frustumCulled = false;
    this.scene.add(this.bg);
    this.parts = new Particles();
    this.scene.add(this.parts.mesh);
    this.draw = new Draw(this);
    this.texts = new Map();
    this.rings = [];
    this.shake = 0;
    this.fxs = { rewind: 0, slow: 0, fast: 0, flash: 0, shock: 0 };
    this.time = 0;
    this.charState = new Map();
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.rt = new THREE.WebGLRenderTarget(4, 4, { samples: 4, depthBuffer: true });
    this.post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
      fragmentShader: POST_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: this.rt.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uRewind: { value: 0 }, uSlow: { value: 0 }, uFast: { value: 0 }, uFlash: { value: 0 }, uShock: { value: 0 } },
    }));
    this.postScene.add(this.post);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (document.fonts?.ready) document.fonts.ready.then(() => this.clearTexts());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt.setSize(db.x, db.y);
    this.post.material.uniforms.uRes.value.set(db.x, db.y);
    this.aspect = w / h; this.px = h;
  }

  screenToWorld(sx, sy) {
    const r = this.canvas.getBoundingClientRect();
    const nx = (sx - r.left) / r.width * 2 - 1, ny = 1 - (sy - r.top) / r.height * 2;
    return [this.cam.x + nx * this.cam.view * this.aspect / 2, this.cam.y + ny * this.cam.view / 2];
  }

  clearTexts() { for (const t of this.texts.values()) { this.scene.remove(t.mesh); t.mesh.material.map.dispose(); } this.texts.clear(); }

  drawText(str, x, y, size, color, a, o = {}) {
    const key = `${str}|${color}|${o.maxW ?? ''}`;
    let t = this.texts.get(key);
    if (!t) {
      const c = document.createElement('canvas'), ctx = c.getContext('2d');
      const fs = 72;
      ctx.font = `${fs}px Caveat, 'Patrick Hand', 'Segoe Print', 'Comic Sans MS', cursive`;
      const lines = String(str).split('\n');
      const wmax = Math.max(...lines.map((l) => ctx.measureText(l).width));
      c.width = Math.ceil(wmax + 24); c.height = Math.ceil(fs * 1.3 * lines.length + 12);
      ctx.font = `${fs}px Caveat, 'Patrick Hand', 'Segoe Print', 'Comic Sans MS', cursive`;
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      lines.forEach((l, i) => ctx.fillText(l, c.width / 2, 6 + fs * 0.65 + i * fs * 1.3));
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.frustumCulled = false; mesh.renderOrder = 3;
      this.scene.add(mesh);
      t = { mesh, w: c.width, h: c.height, lines: lines.length };
      this.texts.set(key, t);
    }
    t.used = this.frame;
    const hh = size * 1.3 * t.lines + size * 0.16;
    let ww = hh * (t.w / t.h);
    let k = 1;
    if (o.maxW && ww > o.maxW) k = o.maxW / ww;
    t.mesh.scale.set(ww * k, hh * k, 1);
    t.mesh.position.set(x, y, o.z ?? 6);
    t.mesh.material.opacity = a;
    t.mesh.visible = true;
  }

  ring(x, y, r0, r1, life, color, lw = 0.12) { this.rings.push({ x, y, r0, r1, life, age: 0, color, lw }); }

  // реакция на события симуляции
  handleEvents(world) {
    const P = this.parts;
    for (const ev of world.events) {
      switch (ev.type) {
        case 'jump': for (let i = 0; i < 6; i++) P.emit('dust', ev.x, ev.y, { color: '#8a7f6a', life: 0.5, size: 16 }); this.ring(ev.x, ev.y, 0.1, 0.9, 0.35, '#8a7f6a', 0.05); break;
        case 'land': { const n = Math.min(12, 4 + Math.floor(ev.v / 3)); for (let i = 0; i < n; i++) P.emit('dust', ev.x, ev.y, { color: '#8a7f6a', life: 0.6, size: 18 }); this.shake = Math.max(this.shake, Math.min(0.25, ev.v * 0.01)); const st = this.charState.get('player'); if (st) st.land = Math.min(1, ev.v / 14); break; }
        case 'death': P.burst(44, ev.x, ev.y, { color: '#ff6b4a', size: 14, life: 1.1, speed: 9 }); P.burst(14, ev.x, ev.y, { color: INK, size: 10, life: 0.9, speed: 6 }); this.ring(ev.x, ev.y, 0.2, 3.5, 0.6, '#ff6b4a'); this.shake = 0.6; this.fxs.shock = 1; break;
        case 'respawn': this.ring(ev.x, ev.y, 2.5, 0.2, 0.5, '#4a8dff'); break;
        case 'collect': P.burst(22, ev.x, ev.y, { color: ev.color, size: 12, life: 0.9, speed: 5 }); this.ring(ev.x, ev.y, 0.2, 2, 0.5, ev.color); break;
        case 'plate': this.ring(ev.x, ev.y + 0.2, 0.2, 1.6, 0.4, ev.on ? '#e8b92c' : '#888', 0.08); break;
        case 'door': for (let i = 0; i < 10; i++) P.emit('spark', ev.x, ev.y + (Math.random() - 0.5) * 2, { color: '#9b7fd6', life: 0.8, size: 10 }); break;
        case 'freeze': this.ring(ev.x, ev.y, 0.3, 4, 0.7, '#7fb8ff', 0.15); P.burst(30, ev.x, ev.y, { color: '#9cc9ff', size: 10, life: 1.2, speed: 4 }); break;
        case 'loop': this.fxs.flash = 1; this.shake = 0.4; this.ring(ev.x, ev.y, 0.2, 14, 0.9, '#2bb3a8', 0.25); this.ring(ev.x, ev.y, 0.2, 9, 0.7, INK, 0.1); P.burst(40, ev.x, ev.y, { color: '#2bb3a8', size: 12, life: 1.2, speed: 8 }); break;
        case 'win': this.fxs.flash = 0.8; for (let i = 0; i < 110; i++) P.emit('confetti', ev.x, ev.y, { color: ['#ff6b4a', '#f2bd52', '#2bb3a8', '#9b7fd6', '#4a8dff'][i % 5], life: 2.2, size: 14, vx: (Math.random() - 0.5) * 14, vy: 4 + Math.random() * 9 }); this.ring(ev.x, ev.y, 0.2, 16, 1.1, '#f2bd52', 0.3); break;
        case 'rewind': if (Math.random() < 0.5) P.emit('mote', ev.x + (Math.random() - 0.5), ev.y + (Math.random() - 0.5), { color: '#5aa2ff', life: 0.7, size: 10, vy: -1.5 }); break;
        default: break;
      }
    }
  }

  // ---- персонаж (игрок и призраки) ----
  drawChar(g, key, x, y, face, vx, vy, grounded, opt) {
    let st = this.charState.get(key);
    if (!st) { st = { sq: 0, land: 0, run: 0, blink: 1 + Math.random() * 3, keyAng: 0, sx: 1, sy: 1 }; this.charState.set(key, st); }
    const dt = g.dt * (opt.timeK ?? 1);
    st.run += Math.abs(vx) * dt * 1.6;
    st.keyAng += dt * (1.5 + Math.abs(vx) * 0.4) * (opt.timeScale ?? 1) * 3;
    st.land *= Math.pow(0.0008, g.dt);
    st.blink -= g.dt; if (st.blink < -0.12) st.blink = 2 + Math.random() * 3;
    const flip = opt.flip ? -1 : 1;
    const stretch = Math.max(-0.2, Math.min(0.28, Math.abs(vy) * 0.016 * (grounded ? 0 : 1)));
    const tsx = 1 - stretch * 0.7 + st.land * 0.35, tsy = 1 + stretch - st.land * 0.3;
    st.sx += (tsx - st.sx) * Math.min(1, g.dt * 18); st.sy += (tsy - st.sy) * Math.min(1, g.dt * 18);
    const rx = 0.36 * st.sx, ry = 0.43 * st.sy;
    const bob = grounded ? Math.abs(Math.sin(st.run * 2)) * Math.min(1, Math.abs(vx) / 4) * 0.06 : 0;
    const P = (lx, ly) => [x + lx, y + flip * ly];
    const base = -PH / 2 + 0.06 + bob;
    const cy = base + ry;
    const a = opt.a ?? 1, z = opt.z ?? 8, layer = a < 0.999 ? 'alpha' : undefined;
    const fill = opt.fill, ink = opt.ink ?? INK;
    // ножки
    const ph = Math.sin(st.run * 3) * Math.min(1, Math.abs(vx) / 3);
    for (const sgn of [-1, 1]) {
      const lift = grounded ? Math.max(0, ph * sgn) * 0.12 : 0.1;
      const f = P(sgn * 0.17 + ph * sgn * 0.08, -PH / 2 + 0.07 + lift);
      g.circle(f[0], f[1], 0.1, { fill: ink, ink: null, a, z: z - 0.1, layer });
    }
    // ключ «заводной игрушки»
    const top = P(0, cy + ry - 0.02);
    const ka = st.keyAng;
    g.line(top[0], top[1], top[0], top[1] + flip * 0.2, { ink, lw: 0.05, a, z: z - 0.2, layer, seed: 1 });
    const kx = top[0], ky = top[1] + flip * 0.26;
    g.poly([[kx + Math.cos(ka) * 0.2, ky + Math.sin(ka) * 0.08], [kx, ky + 0.07], [kx - Math.cos(ka) * 0.2, ky - Math.sin(ka) * 0.08], [kx, ky - 0.07]], { fill: opt.accent ?? '#f2bd52', ink, a, z: z - 0.2, layer, lw: 0.045, seed: 3 });
    // тело
    const pts = [];
    for (let i = 0; i < 20; i++) { const an = (i / 20) * Math.PI * 2; const sq = 1 + 0.12 * Math.max(0, Math.sin(an)) * 0; pts.push(P(Math.cos(an) * rx * sq, cy + Math.sin(an) * ry)); }
    g.poly(pts, { fill, ink, a, z, layer, lw: 0.075, seed: opt.seed ?? 5 });
    // часы на животе: стрелки = прогресс петли
    const cc = P(0, cy - ry * 0.32);
    g.circle(cc[0], cc[1], 0.13, { fill: '#fff8e8', ink, a, z: z + 0.1, layer, lw: 0.035, seed: 2 });
    const ang = opt.clock ?? 0;
    g.line(cc[0], cc[1], cc[0] + Math.sin(ang) * 0.1, cc[1] + flip * Math.cos(ang) * 0.1, { ink, lw: 0.035, a, z: z + 0.2, layer, seed: 4 });
    g.line(cc[0], cc[1], cc[0] + Math.sin(ang * 12) * 0.06, cc[1] + flip * Math.cos(ang * 12) * 0.06, { ink, lw: 0.03, a, z: z + 0.2, layer, seed: 6 });
    // глаза
    const ey = cy + ry * 0.35, look = Math.max(-1, Math.min(1, vx / 6)) * 0.03 + face * 0.02;
    const blink = st.blink < 0 ? 0.15 : 1;
    for (const sgn of [-1, 1]) {
      const e = P(sgn * 0.13 + face * 0.04, ey);
      g.circle(e[0], e[1], 0.095, { fill: '#fff', ink, a, z: z + 0.1, layer, lw: 0.035, seed: sgn + 7, ry: 0.095 * blink });
      if (blink > 0.5) g.circle(e[0] + look * 2 + face * 0.02, e[1] + flip * Math.max(-0.04, Math.min(0.04, vy * 0.004)), 0.045, { fill: ink, ink: null, a, z: z + 0.2, layer });
    }
  }

  // ---- отрисовка мира ----
  renderWorld(world, dt, opts = {}) {
    this.frame = (this.frame || 0) + 1;
    this.time += dt;
    const g = this.draw;
    g.time = this.time; g.dt = dt; g.wob = Math.floor(this.time * 9) * 1.37;
    this.opaque.begin(); this.alpha.begin();

    // камера
    const cam = this.cam;
    const halfH = cam.view / 2, halfW = halfH * this.aspect;
    if (!opts.freeCam) {
      const p = world.player;
      const tx = p.x + p.face * 1.5, ty = p.y + 1.2;
      const k = 1 - Math.exp(-dt * 5);
      cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
      const [bx0, by0, bx1, by1] = world.bounds;
      if (bx1 - bx0 > halfW * 2) cam.x = Math.max(bx0 + halfW, Math.min(bx1 - halfW, cam.x)); else cam.x = (bx0 + bx1) / 2;
      if (by1 - by0 > halfH * 2) cam.y = Math.max(by0 + halfH, Math.min(by1 - halfH, cam.y)); else cam.y = (by0 + by1) / 2;
    }
    this.shake *= Math.pow(0.002, dt);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    const c = this.camera;
    c.left = -halfW; c.right = halfW; c.top = halfH; c.bottom = -halfH;
    c.position.set(cam.x + sx, cam.y + sy, 50);
    c.updateProjectionMatrix();
    this.bg.position.set(cam.x, cam.y, -20);
    this.bg.scale.set(halfW * 2 + 4, halfH * 2 + 4, 1);
    this.bg.material.uniforms.uTime.value = this.time;
    const lv = world.level.theme;
    if (lv) this.bg.material.uniforms.uTint.value.set(...col(lv));

    this.drawDoodles(g, cam, halfW, halfH);

    for (const e of world.entities) {
      if (e.def.editorOnly && !world.editing) continue;
      if (!e.def.draw) continue;
      try { e.def.draw(e, world, g); } catch (err) { if (!e.$err) { e.$err = 1; console.warn('draw error', e.type, err); } }
    }

    // пузыри стазиса
    for (const b of world.bubbles) {
      const k = Math.min(1, b.ttl / 0.5), life = b.ttl / b.ttl0;
      g.rect(b.x, b.y, b.w, b.h, { fill: '#9cc9ff', ink: null, a: 0.12 * k, z: 7, layer: 'alpha' });
      g.rect(b.x, b.y, b.w, b.h, { fill: null, ink: '#4a8dff', a: 0.8 * k, z: 7, layer: 'alpha', dash: 0.3, lw: 0.07, seed: 3 });
      g.circle(b.x, b.y, 0.55, { fill: null, ink: '#4a8dff', a: 0.7 * k, z: 7, layer: 'alpha', lw: 0.05 });
      const an = life * Math.PI * 2;
      g.line(b.x, b.y, b.x + Math.sin(an) * 0.5, b.y + Math.cos(an) * 0.5, { ink: '#4a8dff', lw: 0.06, a: k, z: 7.1, layer: 'alpha' });
      for (let i = 0; i < 6; i++) {
        const ax = b.x + (hash(i * 3.1) - 0.5) * b.w * 0.9, ay = b.y + (hash(i * 5.7) - 0.5) * b.h * 0.9;
        g.line(ax - 0.2, ay, ax + 0.2, ay, { ink: '#9cc9ff', lw: 0.04, a: 0.6 * k, z: 7, layer: 'alpha', seed: i });
        g.line(ax, ay - 0.2, ax, ay + 0.2, { ink: '#9cc9ff', lw: 0.04, a: 0.6 * k, z: 7, layer: 'alpha', seed: i + 9 });
      }
    }

    if (!world.editing) this.drawActors(world, g);

    if (opts.overlay) opts.overlay(g, this);

    // кольца-ударные волны
    for (const r of this.rings) {
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) continue;
      const e = 1 - Math.pow(1 - k, 3);
      g.circle(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, { fill: null, ink: r.color, a: 1 - k, lw: r.lw * (1 - k * 0.6), z: 9, layer: 'alpha', seed: Math.floor(r.x * 10) });
    }
    this.rings = this.rings.filter((r) => r.age < r.life);

    // фоновые эффекты времени
    this.opaque.end(); this.alpha.end();
    this.handleEvents(world);
    this.parts.update(dt, this.renderer.domElement.height / 900);
    for (const [k, t] of this.texts) if (t.used !== this.frame) t.mesh.visible = false;
    if (this.texts.size > 300) for (const [k, t] of this.texts) if (!t.mesh.visible) { this.scene.remove(t.mesh); t.mesh.material.map.dispose(); this.texts.delete(k); }

    // пост-обработка
    const f = this.fxs, wf = world.fx || {};
    const ease = (v, t, r) => v + (t - v) * Math.min(1, dt * r);
    f.rewind = ease(f.rewind, wf.rewind ? 1 : 0, 10);
    f.slow = ease(f.slow, wf.slow ? 1 : 0, 8);
    f.fast = ease(f.fast, wf.fast ? 1 : 0, 8);
    f.flash *= Math.pow(0.02, dt); f.shock *= Math.pow(0.03, dt);
    const u = this.post.material.uniforms;
    u.uTime.value = this.time; u.uRewind.value = f.rewind; u.uSlow.value = f.slow; u.uFast.value = f.fast; u.uFlash.value = f.flash; u.uShock.value = f.shock;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.setClearColor(0xf4ecd6, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }

  drawActors(world, g) {
    const p = world.player, flip = world.G < 0;
    const loopAng = world.loopLen > 0 ? (world.T / world.loopLen) * Math.PI * 2 : world.T;
    // призраки: путь вперёд (пунктир), след, тело
    world.ghosts.forEach((gh, gi) => {
      const f = world.ghostFrame(gh);
      const i0 = Math.min(gh.frames.length - 1, Math.floor(world.T / DT));
      const path = [];
      for (let i = i0; i < Math.min(gh.frames.length, i0 + 150); i += 6) path.push([gh.frames[i][0], gh.frames[i][1]]);
      if (path.length > 1) g.path(path, { ink: COLORS.ghost, a: 0.4, lw: 0.05, z: 6, layer: 'alpha', dash: 0.18, seed: gi });
      g.glow(f[0], f[1], 1.3, COLORS.ghost, 0.28);
      const wob = 0.9 + 0.1 * Math.sin(this.time * 6 + gi);
      this.drawChar(g, 'ghost' + gi, f[0], f[1], f[2], 0, f[3] * 0.5, !!f[4], { fill: COLORS.ghost, ink: '#1c6c66', a: 0.55 * wob, z: 7, seed: 20 + gi, clock: loopAng, accent: '#cfeeea', flip });
      if (i0 >= gh.frames.length - 1) g.text('держит', f[0], f[1] + 1.2, 0.3, COLORS.ghost, 0.8, { z: 8 });
    });
    if (!p.alive) return;
    const st = this.charState.get('player');
    // послеобразы
    const mode = world.fx;
    if ((mode.rewind || mode.slow || mode.fast) && world.hist.length > 12) {
      const colr = mode.rewind ? '#5aa2ff' : mode.slow ? '#4ac0e0' : '#ff9a2e';
      for (let k = 1; k <= 5; k++) {
        const sn = world.hist[Math.max(0, world.hist.length - 1 - k * 5 * (mode.rewind ? -1 : 1))] || world.hist[world.hist.length - 1];
        const q = mode.rewind ? world.hist[Math.max(0, world.hist.length - 1 - k * 5)] : world.hist[Math.max(0, world.hist.length - 1 - k * 4)];
        if (!q) continue;
        g.circle(q.p.x, q.p.y - 0.05, 0.38, { fill: colr, ink: null, a: 0.22 - k * 0.03, z: 7, layer: 'alpha', ry: 0.46 });
      }
    }
    g.glow(p.x, p.y, 1.6, '#ff9a6a', 0.22);
    this.drawChar(g, 'player', p.x, p.y, p.face, p.vx, p.vy, p.grounded, { fill: COLORS.player, ink: INK, a: 1, z: 8.2, seed: 11, clock: loopAng, timeScale: world.fx.slow ? 0.3 : world.fx.fast ? 2.5 : 1, flip });
    // следы бега
    if (p.grounded && Math.abs(p.vx) > 4 && Math.random() < dtChance(g.dt, 22)) this.parts.emit('dust', p.x - p.face * 0.2, p.y - (flip ? -1 : 1) * PH / 2, { color: '#8a7f6a', life: 0.45, size: 12 });
    if (world.fx.rewind && Math.random() < 0.6) this.parts.emit('mote', p.x + (Math.random() - 0.5) * 0.8, p.y + (Math.random() - 0.5) * 1, { color: '#5aa2ff', life: 0.6, size: 11, vy: -2 });
    if (world.fx.slow && Math.random() < 0.4) this.parts.emit('mote', p.x + (Math.random() - 0.5) * 6, p.y + (Math.random() - 0.5) * 5, { color: '#4ac0e0', life: 1.2, size: 8 });
    if (world.fx.fast && Math.random() < 0.7) this.parts.emit('spark', p.x + (Math.random() - 0.5) * 6, p.y + (Math.random() - 0.5) * 5, { color: '#ff9a2e', life: 0.5, size: 9, vx: -8 });
  }

  drawDoodles(g, cam, halfW, halfH) {
    const k = 0.45, cell = 10;
    const lx0 = cam.x * k - halfW, lx1 = cam.x * k + halfW, ly0 = cam.y * k - halfH, ly1 = cam.y * k + halfH;
    const ox = cam.x * (1 - k), oy = cam.y * (1 - k);
    const eqs = ['Δt → 0', 'x(t)=sin(ωt)', 'e^{iπ}+1=0', 't ↦ −t', '∫ dt', 'T = 2π/ω', 'dx/dt = v', 'lim t→∞', 'f(t+T)=f(t)', 'Δx·Δp ≥ ħ/2'];
    for (let cx = Math.floor(lx0 / cell) - 1; cx <= Math.ceil(lx1 / cell); cx++) {
      for (let cy = Math.floor(ly0 / cell) - 1; cy <= Math.ceil(ly1 / cell); cy++) {
        const h = hash(cx * 12.9898 + cy * 78.233);
        if (h > 0.62) continue;
        const x = cx * cell + hash(h * 91) * cell + ox, y = cy * cell + hash(h * 57) * cell + oy;
        const type = Math.floor(hash(h * 13) * 6), sc = 0.8 + hash(h * 7) * 1.2, o = { ink: '#6b7ba8', a: 0.26, lw: 0.06, z: -8, layer: 'alpha', seed: cx * 7 + cy };
        if (type === 0) {
          g.circle(x, y, 0.9 * sc, o); const a1 = this.time * 0.5 + h * 6, a2 = a1 / 12;
          g.line(x, y, x + Math.sin(a1) * 0.7 * sc, y + Math.cos(a1) * 0.7 * sc, o); g.line(x, y, x + Math.sin(a2) * 0.45 * sc, y + Math.cos(a2) * 0.45 * sc, o);
        } else if (type === 1) g.spiral(x, y, 1.0 * sc, 3, this.time * 0.3 + h, o);
        else if (type === 2) { // песочные часы
          const s = 0.8 * sc; g.path([[x - s, y + s * 1.2], [x + s, y + s * 1.2], [x - s, y - s * 1.2], [x + s, y - s * 1.2], [x - s, y + s * 1.2]], o);
        } else if (type === 3) g.text(eqs[Math.floor(hash(h * 29) * eqs.length)], x, y, 0.6 * sc, '#6b7ba8', 0.4, { z: -8 });
        else if (type === 4) { // стрелка-петля
          const pts = []; for (let i = 0; i <= 18; i++) { const an = i / 18 * 5.2 + 0.4; pts.push([x + Math.cos(an) * sc, y + Math.sin(an) * sc]); }
          g.path(pts, o); const e = pts[pts.length - 1]; g.line(e[0], e[1], e[0] + 0.3, e[1] + 0.1, o); g.line(e[0], e[1], e[0] + 0.1, e[1] + 0.35, o);
        } else { const pts = []; for (let i = 0; i < 10; i++) { const an = i / 10 * Math.PI * 2, r = (i % 2 ? 0.35 : 0.8) * sc; pts.push([x + Math.cos(an + this.time * 0.1) * r, y + Math.sin(an + this.time * 0.1) * r]); } g.poly(pts, { ...o, ink: '#d4a93a', a: 0.35 }); }
      }
    }
  }
}

const dtChance = (dt, rate) => dt * rate;
