import * as THREE from 'three';
import { INK, paperTexture } from './draw.js';

/** Общие юниформы для всех рисованных материалов. */
export const shared = {
  uBoil: { value: 0 }, // «кипение» линий: время, квантованное до ~8 кадров/с
  uTime: { value: 0 },
  uPx: { value: 1 }, // devicePixelRatio
  uLight: { value: new THREE.Vector3(-0.45, 0.8, 0.6).normalize() },
  uPaper: { value: null },
  uRewind: { value: 0 },
  uStop: { value: 0 },
};

export function initShared() {
  shared.uPaper.value = paperTexture();
}

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y);
}
`;

const WOBBLE_GLSL = /* glsl */ `
vec4 sketchWorld(vec4 p){
  vec4 w = modelMatrix * p;
  w.x += (vnoise(w.xy*1.7 + vec2(uBoil*7.1, 0.0)) - 0.5) * uWobble;
  w.y += (vnoise(w.yx*1.7 + vec2(5.0, uBoil*3.3)) - 0.5) * uWobble;
  return w;
}
`;

const SKETCH_VERT = /* glsl */ `
uniform float uBoil;
uniform float uWobble;
varying vec3 vN;
varying vec2 vUv;
varying vec3 vW;
#ifdef USE_EDGEMASK
attribute vec4 aEdges;
varying vec4 vEdges;
#endif
#ifdef USE_COLOR
varying vec3 vCol;
#endif
${NOISE_GLSL}
${WOBBLE_GLSL}
void main(){
  vec4 p = vec4(position, 1.0);
  vec3 nrm = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    nrm = mat3(instanceMatrix) * nrm;
  #endif
  vec4 w = sketchWorld(p);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * nrm);
  vUv = uv;
  #ifdef USE_EDGEMASK
  vEdges = aEdges;
  #endif
  #ifdef USE_COLOR
  vCol = color;
  #endif
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SKETCH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uInk;
uniform vec3 uLight;
uniform vec3 uEmissive;
uniform vec3 uTop;
uniform float uOpacity;
uniform float uHatch;
uniform float uEdgeW;
uniform float uBoil;
uniform float uPx;
uniform float uGrain;
uniform float uDoodle;
uniform sampler2D uPaper;
#ifdef USE_MAP
uniform sampler2D uMap;
#endif
varying vec3 vN;
varying vec2 vUv;
varying vec3 vW;
#ifdef USE_EDGEMASK
varying vec4 vEdges;
#endif
#ifdef USE_COLOR
varying vec3 vCol;
#endif
${NOISE_GLSL}
void main(){
  vec3 base = uColor;
  float alpha = uOpacity;
  #ifdef USE_COLOR
  base *= vCol;
  #endif
  #ifdef USE_MAP
  vec4 m = texture2D(uMap, vUv);
  if (m.a < 0.08) discard;
  base *= m.rgb;
  alpha *= m.a;
  #endif
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float l = dot(n, normalize(uLight)) * 0.5 + 0.5;
  float shade = l > 0.72 ? 1.0 : (l > 0.5 ? 0.86 : 0.72);
  vec2 fw = fwidth(vUv);

  #ifdef USE_TOPCOLOR
  if (n.y > 0.6) base = uTop;
  #ifdef USE_EDGEMASK
  else if (vEdges.w > 0.5 && n.z > 0.5) {
    float wave = 0.8 + sin(vW.x * 9.0) * 0.035 + (vnoise(vW.xy * 6.0) - 0.5) * 0.09;
    float g = smoothstep(wave - 0.01, wave + 0.01, vUv.y);
    base = mix(base, uTop, g);
    float bl = abs(vUv.y - wave) / max(fw.y, 1e-5);
    base = mix(base, uInk, (1.0 - smoothstep(uPx * 0.7, uPx * 1.6, bl)) * 0.75);
  }
  #endif
  #endif

  vec3 col = base * shade;
  vec2 sp = gl_FragCoord.xy / uPx;
  float jit = vnoise(sp * 0.04 + uBoil * 9.0) * 3.0;
  float h1 = abs(fract((sp.x + sp.y + jit) / 7.0) - 0.5) * 7.0;
  float h2 = abs(fract((sp.x - sp.y + jit) / 6.0) - 0.5) * 6.0;
  float line1 = 1.0 - smoothstep(0.5, 1.3, h1);
  float line2 = 1.0 - smoothstep(0.5, 1.3, h2);
  float dark = 1.0 - l;
  col = mix(col, uInk, line1 * smoothstep(0.42, 0.6, dark) * 0.32 * uHatch);
  col = mix(col, uInk, line2 * smoothstep(0.56, 0.72, dark) * 0.28 * uHatch);

  #ifdef USE_DOODLE
  float dn = vnoise(vW.xy * 1.3 + vec2(vW.z * 0.7, 0.0)) * 5.0;
  float dw = fwidth(dn);
  float dl = 1.0 - smoothstep(0.0, dw * 1.6, min(fract(dn), 1.0 - fract(dn)));
  col = mix(col, uInk, dl * 0.22 * uDoodle);
  #endif

  #ifdef USE_EDGES
  vec2 ifw = 1.0 / max(fw, vec2(1e-5));
  vec2 d0 = vUv * ifw;
  vec2 d1 = (1.0 - vUv) * ifw;
  float e = 1e5;
  #ifdef USE_EDGEMASK
    if (vEdges.x > 0.5) e = min(e, d0.x);
    if (vEdges.y > 0.5) e = min(e, d1.x);
    if (vEdges.z > 0.5) e = min(e, d0.y);
    if (vEdges.w > 0.5) e = min(e, d1.y);
  #else
    e = min(min(d0.x, d1.x), min(d0.y, d1.y));
  #endif
  float wob = (vnoise(vUv * 7.0 + vW.xy * 2.0 + uBoil * 13.0) - 0.5) * 1.8 * uPx;
  float ew = uEdgeW * uPx;
  float ink = 1.0 - smoothstep(ew * 0.45, ew, e + wob);
  col = mix(col, uInk, ink * 0.9);
  #endif

  float grain = texture2D(uPaper, sp / 420.0).r;
  col *= mix(1.0, 0.8 + 0.24 * grain, uGrain);
  gl_FragColor = vec4(col + uEmissive, alpha);
}
`;

const col = (c) => (c instanceof THREE.Color ? c : new THREE.Color(c));

/**
 * Основной рисованный материал: ступенчатое освещение, штриховка в экранном
 * пространстве, кипящие чернильные контуры по краям граней, бумажное зерно.
 */
export function sketchMaterial({
  color = '#d8cbb0', ink = INK, hatch = 1, edges = true, edgeMask = false, edgeWidth = 2.2,
  map = null, opacity = 1, transparent = false, wobble = 0.018, emissive = '#000000',
  grain = 1, doodle = 0, top = null, side = THREE.FrontSide, vertexColors = false, depthWrite = true,
} = {}) {
  const defines = {};
  if (edges) defines.USE_EDGES = '';
  if (edgeMask) defines.USE_EDGEMASK = '';
  if (map) defines.USE_MAP = '';
  if (doodle) defines.USE_DOODLE = '';
  if (top) defines.USE_TOPCOLOR = '';
  const m = new THREE.ShaderMaterial({
    vertexShader: SKETCH_VERT,
    fragmentShader: SKETCH_FRAG,
    defines,
    uniforms: {
      uBoil: shared.uBoil,
      uPx: shared.uPx,
      uLight: shared.uLight,
      uPaper: shared.uPaper,
      uWobble: { value: wobble },
      uColor: { value: col(color) },
      uInk: { value: col(ink) },
      uEmissive: { value: col(emissive) },
      uTop: { value: col(top || '#7fae5a') },
      uOpacity: { value: opacity },
      uHatch: { value: hatch },
      uEdgeW: { value: edgeWidth },
      uGrain: { value: grain },
      uDoodle: { value: doodle },
      uMap: { value: map },
    },
    transparent: transparent || opacity < 1,
    side,
    vertexColors,
    depthWrite,
  });
  return m;
}

const OUTLINE_VERT = /* glsl */ `
uniform float uBoil;
uniform float uWobble;
uniform float uThick;
${NOISE_GLSL}
${WOBBLE_GLSL}
void main(){
  vec4 p = vec4(position, 1.0);
  vec3 nrm = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    nrm = mat3(instanceMatrix) * nrm;
  #endif
  vec4 w = sketchWorld(p);
  vec3 wn = normalize(mat3(modelMatrix) * nrm);
  float t = uThick * (0.7 + vnoise(w.xy * 3.0 + uBoil * 11.0) * 0.7);
  w.xyz += wn * t;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const OUTLINE_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform float uOpacity;
void main(){ gl_FragColor = vec4(uInk, uOpacity); }
`;

/** Материал «обводки» методом вывернутой оболочки. */
export function outlineMaterial({ ink = INK, thickness = 0.035, opacity = 1, wobble = 0.018 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    uniforms: {
      uBoil: shared.uBoil,
      uWobble: { value: wobble },
      uThick: { value: thickness },
      uInk: { value: col(ink) },
      uOpacity: { value: opacity },
    },
    side: THREE.BackSide,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
  });
}

/** Добавить чернильную обводку к мешу (для гладких форм: сферы, капсулы). */
export function addOutline(mesh, opts = {}) {
  const o = new THREE.Mesh(mesh.geometry, outlineMaterial(opts));
  o.name = 'outline';
  o.renderOrder = -1;
  mesh.add(o);
  return o;
}

/**
 * Произвольный шейдер с общими юниформами и функциями шума (для модов и эффектов).
 * В шейдерах доступны vnoise(vec2), hash12(vec2), uBoil, uTime, uPx.
 */
export function customShader({ vertex, fragment, uniforms = {}, ...rest }) {
  return new THREE.ShaderMaterial({
    vertexShader: vertex || /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uBoil; uniform float uTime; uniform float uPx;\n${NOISE_GLSL}\n${fragment}`,
    uniforms: { uBoil: shared.uBoil, uTime: shared.uTime, uPx: shared.uPx, ...uniforms },
    ...rest,
  });
}
