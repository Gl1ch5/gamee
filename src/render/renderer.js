import * as THREE from 'three';
import { shared, initShared, NOISE_GLSL } from './materials.js';

THREE.ColorManagement.enabled = false;

const POST_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D uPaper;
uniform vec2 uRes;
uniform float uTime, uBoil, uPx;
uniform float uRewind, uStop, uSlow, uFast, uWipe, uFlash, uDeath;
uniform vec2 uWipeCenter;
varying vec2 vUv;
${NOISE_GLSL}
vec3 sepia(vec3 c){ float g = dot(c, vec3(0.299,0.587,0.114)); return vec3(g*1.07, g*0.92, g*0.72); }
void main(){
  vec2 uv = vUv;
  // лёгкое «кипение» всего кадра
  vec2 boil = (vec2(vnoise(uv * 30.0 + uBoil * 5.0), vnoise(uv * 30.0 + uBoil * 5.0 + 7.0)) - 0.5) * 0.0012;
  // перемотка: VHS-волна и хроматическая аберрация
  float band = step(0.985, fract(uv.y * 3.0 - uTime * 2.3)) * uRewind;
  uv.x += sin(uv.y * 90.0 + uTime * 40.0) * 0.0018 * uRewind + band * 0.02;
  uv += boil;
  float ca = 0.004 * uRewind + 0.002 * uFast;
  vec3 c;
  c.r = texture2D(tScene, uv + vec2(ca, 0.0)).r;
  c.g = texture2D(tScene, uv).g;
  c.b = texture2D(tScene, uv - vec2(ca, 0.0)).b;
  // перемотка: сепия + полосы
  c = mix(c, sepia(c), uRewind * 0.75);
  c *= 1.0 - uRewind * 0.08 * step(0.5, fract(gl_FragCoord.y / (3.0 * uPx)));
  // стоп-кадр: чернильно-синий монохром
  float g = dot(c, vec3(0.299,0.587,0.114));
  vec3 stopC = mix(vec3(0.12,0.16,0.28), vec3(0.93,0.95,1.0), smoothstep(0.15, 0.95, g));
  c = mix(c, stopC, uStop * 0.85);
  // замедление: холодный оттенок
  c = mix(c, c * vec3(0.85, 0.95, 1.12), uSlow * 0.6);
  // бумага
  float paper = texture2D(uPaper, gl_FragCoord.xy / uPx / 512.0).r;
  c *= 0.92 + 0.1 * paper;
  // виньетка-карандаш
  vec2 q = vUv - 0.5;
  float vig = smoothstep(0.85, 0.35, length(q * vec2(uRes.x / uRes.y, 1.0)) * (1.0 + uRewind * 0.3 + uStop * 0.2));
  c *= mix(0.72, 1.0, vig);
  // смерть — красноватое затемнение
  c = mix(c, c * vec3(0.7, 0.45, 0.4), uDeath * 0.6);
  // вспышка
  c = mix(c, vec3(1.0, 0.98, 0.92), uFlash);
  // чернильная шторка-переход
  if (uWipe > 0.0) {
    vec2 p = (vUv - uWipeCenter) * vec2(uRes.x / uRes.y, 1.0);
    float a = atan(p.y, p.x);
    float edge = (1.0 - uWipe) * 1.3 + (vnoise(vec2(a * 3.0, uBoil * 3.0)) - 0.5) * 0.08;
    float ink = smoothstep(edge, edge + 0.01, length(p));
    c = mix(c, vec3(0.16, 0.14, 0.12), ink);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * Обёртка над WebGLRenderer: сцена рендерится в MSAA-таргет,
 * затем финальный проход накладывает бумагу и эффекты времени.
 */
export class Renderer {
  constructor(canvas) {
    initShared();
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setClearColor('#efe3c8');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 300);
    this.camera.position.set(0, 3, 18);
    this.target = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType });
    this.postUniforms = {
      tScene: { value: this.target.texture },
      uPaper: shared.uPaper,
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: shared.uTime,
      uBoil: shared.uBoil,
      uPx: shared.uPx,
      uRewind: { value: 0 },
      uStop: { value: 0 },
      uSlow: { value: 0 },
      uFast: { value: 0 },
      uWipe: { value: 0 },
      uWipeCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uFlash: { value: 0 },
      uDeath: { value: 0 },
    };
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.postUniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
    })));
    this.fx = this.postUniforms;
    this.time = 0;
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const px = Math.min(window.devicePixelRatio || 1, 2);
    this.gl.setPixelRatio(px);
    this.gl.setSize(w, h, false);
    this.target.setSize(Math.floor(w * px), Math.floor(h * px));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    shared.uPx.value = px;
    this.postUniforms.uRes.value.set(w * px, h * px);
    this.width = w;
    this.height = h;
  }

  render(dt) {
    this.time += dt;
    shared.uTime.value = this.time;
    shared.uBoil.value = (Math.floor(this.time * 7) % 97) * 0.173;
    if (this.canvas.clientWidth !== this.width || this.canvas.clientHeight !== this.height) this.resize();
    this.gl.setRenderTarget(this.target);
    this.gl.render(this.scene, this.camera);
    this.gl.setRenderTarget(null);
    this.gl.render(this.postScene, this.postCam);
  }

  /** Луч из экранной точки в плоскость z = planeZ */
  screenToWorld(clientX, clientY, planeZ = 0) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ), p);
    return p;
  }

  clearScene() {
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
  }
}
