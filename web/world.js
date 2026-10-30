/* Night Watch - the world, drawn.

   One renderer for every screen. A phone is a camera at the centre of the
   sphere, turned by the phone's own sensors; the TV is a camera outside it,
   looking over the players' shoulders at the whole battle.

   Nothing here decides anything. It is fed snapshots from the host (sim.js
   via host.js) and draws them: each thing it is told about is shown where
   it was plus how far it will have moved since (its velocity times the
   snapshot's age), eased towards that so a late snapshot never makes a ship
   jump. That keeps a phone's view within a frame or two of the host's, which
   is what lets the phone decide what its own crosshair is on.

   The sky is the expensive part, so it is drawn once, into a cube map, at
   start-up. The landmarks in it (the ringed planet, the sun, the red nebula,
   the moon) are fixed so that people can call things out: "under the
   planet!" */
import * as THREE from 'three';
import {EffectComposer} from './lib/postprocessing/EffectComposer.js';
import {RenderPass} from './lib/postprocessing/RenderPass.js';
import {UnrealBloomPass} from './lib/postprocessing/UnrealBloomPass.js';
import {OutputPass} from './lib/postprocessing/OutputPass.js';
import {TYPES, TYPE_LIST, COLORS, HULL_MAX} from './sim.js';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();     // behind, left, up
export const PLANET_DIR = new THREE.Vector3(0.62, -0.22, -0.75).normalize(); // front right, low
export const NEBULA_DIR = new THREE.Vector3(-0.72, 0.38, -0.45).normalize(); // front left, high
export const MOON_DIR = new THREE.Vector3(0.55, -0.45, 0.7).normalize();     // behind right, low

const KIND = ['repair', 'rapid', 'missiles'];

/* Where something is, in words the whole room shares: front is the TV (or
   whatever everybody pointed at when they locked on). */
export function dirWords(x, y, z){
  const l = Math.hypot(x, y, z) || 1;
  x /= l; y /= l; z /= l;
  if(y > 0.8) return 'straight up';
  if(y < -0.8) return 'straight down';
  const h = Math.atan2(x, -z) * 180 / Math.PI;      // 0 front, 90 right
  const a = Math.abs(h);
  let side = a < 30 ? 'in front' : a > 150 ? 'behind' : h > 0 ? 'right' : 'left';
  if(a >= 30 && a < 60) side = 'front ' + (h > 0 ? 'right' : 'left');
  if(a > 120 && a <= 150) side = 'behind ' + (h > 0 ? 'right' : 'left');
  const v = y > 0.35 ? ', high' : y < -0.35 ? ', low' : '';
  return side + v;
}

/* ---------- GLSL ---------- */
const NOISE = `
float hash3(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float noise3(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i = 0; i < 6; i++){ s += a * noise3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

const SKY_FRAG = `
varying vec3 vDir;
uniform vec3 uNeb; uniform vec3 uSun;
${NOISE}
void main(){
  vec3 d = normalize(vDir);
  vec3 col = vec3(0.0025, 0.0035, 0.011);
  // the galaxy: a band round a tilted great circle, with dust lanes through it
  vec3 gn = normalize(vec3(0.35, 0.9, 0.25));
  float g = dot(d, gn);
  float warp = fbm(d * 3.0) - 0.5;
  float band = exp(-pow((g + warp * 0.18) * 3.4, 2.0));
  float core = exp(-pow((g + warp * 0.12) * 9.0, 2.0));
  float n1 = fbm(d * 4.0), n2 = fbm(d * 9.0 + 5.0);
  float dust = smoothstep(0.42, 0.72, fbm(d * 6.0 + 11.0));
  col += band * vec3(0.05, 0.05, 0.075) * (0.5 + n1);
  col += core * vec3(0.10, 0.085, 0.08) * (0.3 + n2 * n2 * 1.4) * (1.0 - 0.9 * dust);
  // big soft clouds, blue and violet
  float c1 = smoothstep(0.48, 0.9, fbm(d * 1.6 + 3.0));
  float c2 = smoothstep(0.5, 0.95, fbm(d * 2.2 + 17.0));
  col += c1 * vec3(0.01, 0.05, 0.09) * (0.6 + n1);
  col += c2 * vec3(0.07, 0.015, 0.09) * (0.6 + n2);
  // the red nebula: a landmark
  float r = max(0.0, dot(d, uNeb));
  float rn = fbm(d * 7.0 + 2.0);
  float wisp = fbm(d * 14.0 + 4.0);
  col += smoothstep(0.86, 1.0, r + (rn - 0.5) * 0.16) * vec3(0.55, 0.06, 0.1) * (0.1 + rn * rn * 2.2) * (0.5 + wisp);
  col += smoothstep(0.93, 1.0, r + (wisp - 0.5) * 0.1) * vec3(0.2, 0.12, 0.35) * wisp;
  col += pow(r, 60.0) * vec3(0.9, 0.35, 0.2) * rn;
  // the sun's glow in the dust
  float s = max(0.0, dot(d, uSun));
  col += pow(s, 8.0) * vec3(0.25, 0.16, 0.08) + pow(s, 80.0) * vec3(0.6, 0.45, 0.3);
  gl_FragColor = vec4(col, 1.0);
}`;

const STAR_VERT = `
attribute float aSize; attribute vec3 aColor; attribute float aPhase;
uniform float uTime; uniform float uPx;
varying vec3 vC; varying float vA;
void main(){
  vC = aColor;
  vA = 0.75 + 0.25 * sin(uTime * (1.5 + aPhase) + aPhase * 40.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPx;
}`;
const STAR_FRAG = `
varying vec3 vC; varying float vA;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = (exp(-d * d * 7.0) + 0.18 * exp(-d * d * 2.0)) * smoothstep(1.0, 0.6, d);
  gl_FragColor = vec4(vC * a * vA, 1.0);
}`;

const PART_VERT = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
uniform float uScale;
varying vec3 vC; varying float vA;
void main(){
  vC = aColor; vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aAlpha <= 0.0 ? 0.0 : clamp(aSize * uScale / max(0.1, -mv.z), 1.0, 256.0);
}`;
const PART_FRAG = `
varying vec3 vC; varying float vA;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a = a * a;
  gl_FragColor = vec4(vC * a * vA, 1.0);
}`;

const BEAM_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_FRAG = `
varying vec2 vUv; uniform vec3 uColor; uniform float uAlpha;
void main(){
  float x = abs(vUv.x - 0.5) * 2.0;
  float core = exp(-x * x * 40.0), glow = exp(-x * x * 5.0) * 0.55;
  float ends = smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
  vec3 c = mix(uColor, vec3(1.0), core * 0.8) * (core * 2.2 + glow);
  gl_FragColor = vec4(c * uAlpha * ends, 1.0);
}`;

const FRESNEL_VERT = `
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  vP = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SHIELD_FRAG = `
varying vec3 vN; varying vec3 vV; varying vec3 vP;
uniform vec4 uHits[6]; uniform float uTime; uniform float uBase; uniform vec3 uColor; uniform float uHitGain; uniform float uHitSize;
${NOISE}
void main(){
  float f = pow(1.0 - abs(dot(vN, vV)), 3.0);
  float hex = smoothstep(0.42, 0.5, abs(fract(vP.x * 9.0 + vP.y * 5.0) - 0.5) + abs(fract(vP.z * 9.0 - vP.y * 5.0) - 0.5) * 0.6);
  float h = 0.0;
  for(int i = 0; i < 6; i++){
    float age = uTime - uHits[i].w;
    if(age >= 0.0 && age < 0.9){
      float d = distance(vP, uHits[i].xyz);
      h += smoothstep(uHitSize, 0.0, d) * (1.0 - age / 0.9) * (0.55 + 0.45 * sin(d * 28.0 - age * 22.0));
    }
  }
  float a = f * uBase * (0.6 + 0.4 * hex) + h * uHitGain * (0.6 + hex);
  gl_FragColor = vec4(uColor * a, 1.0);
}`;
const RIM_FRAG = `
varying vec3 vN; varying vec3 vV; varying vec3 vP;
uniform vec3 uColor; uniform float uPow; uniform float uAlpha; uniform float uTime;
void main(){
  float f = pow(1.0 - abs(dot(vN, vV)), uPow);
  float shimmer = 0.7 + 0.3 * sin(vP.y * 18.0 + uTime * 6.0) * sin(vP.x * 14.0 - uTime * 4.0);
  gl_FragColor = vec4(uColor * f * uAlpha * shimmer, 1.0);
}`;

const PLANET_VERT = `
varying vec3 vP; varying vec3 vWN; varying vec3 vV;
void main(){
  vP = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const PLANET_FRAG = `
varying vec3 vP; varying vec3 vWN; varying vec3 vV;
uniform vec3 uSun;
${NOISE}
void main(){
  float w = fbm(vP * 3.0) * 1.6 + fbm(vP * 9.0) * 0.35;
  float b = vP.y * 11.0 + w;
  vec3 c = mix(vec3(0.55, 0.26, 0.11), vec3(0.20, 0.09, 0.05), 0.5 + 0.5 * sin(b));
  c = mix(c, vec3(0.78, 0.56, 0.36), smoothstep(0.55, 1.0, sin(b * 2.3 + 1.0)) * 0.5);
  c = mix(c, vec3(0.10, 0.18, 0.32), smoothstep(0.7, 1.0, sin(b * 0.7 + 2.0)) * 0.45);
  // a storm, for somebody to point at
  vec3 sp = normalize(vec3(0.6, -0.25, 0.75));
  float st = smoothstep(0.985, 0.995, dot(vP, sp) + (fbm(vP * 30.0) - 0.5) * 0.01);
  c = mix(c, vec3(0.75, 0.25, 0.15), st * 0.85);
  float l = dot(vWN, uSun);
  float lit = smoothstep(-0.15, 0.6, l);
  vec3 col = c * lit * 0.8 + c * 0.012;
  float rim = pow(1.0 - max(0.0, dot(vWN, vV)), 4.0);
  col += vec3(0.9, 0.6, 0.35) * rim * smoothstep(-0.2, 0.4, l) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`;
const RING_FRAG = `
varying vec2 vUv; varying vec3 vWP;
uniform vec3 uSun; uniform vec3 uPlanet; uniform float uR;
${NOISE}
void main(){
  float r = vUv.x;
  float bands = fbm(vec3(r * 40.0, 0.0, 0.0)) * 0.9 + fbm(vec3(r * 140.0, 3.0, 0.0)) * 0.4;
  float a = smoothstep(0.0, 0.05, r) * smoothstep(1.0, 0.85, r) * smoothstep(0.35, 0.7, bands);
  a *= 1.0 - smoothstep(0.52, 0.55, r) * smoothstep(0.6, 0.57, r) * 0.9;     // a gap
  // the planet's shadow across the rings
  vec3 toP = uPlanet - vWP;
  float along = dot(toP, uSun);
  float perp = length(toP - uSun * along);
  float shadow = (along > 0.0 && perp < uR) ? 0.15 : 1.0;
  vec3 c = mix(vec3(0.65, 0.55, 0.45), vec3(0.85, 0.78, 0.66), bands) * shadow;
  gl_FragColor = vec4(c * a * 0.55, a * 0.6);
}`;
const RING_VERT = `
varying vec2 vUv; varying vec3 vWP;
uniform float uIn; uniform float uOut;
void main(){
  vUv = vec2((length(position.xy) - uIn) / (uOut - uIn), 0.0);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/* ---------- little textures, drawn once ---------- */
export function canvasTex(size, draw){
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function glowTex(){
  return canvasTex(128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.15, 'rgba(255,255,255,0.75)');
    r.addColorStop(0.4, 'rgba(255,255,255,0.18)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
}
export function ringTex(){
  return canvasTex(256, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,0)');
    r.addColorStop(0.82, 'rgba(255,255,255,0)');
    r.addColorStop(0.92, 'rgba(255,255,255,0.8)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
}
export function textSprite(text, color, h){
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = '700 64px system-ui, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 40;
  c.width = w; c.height = 96;
  g.font = '700 64px system-ui, sans-serif';
  g.textBaseline = 'middle'; g.textAlign = 'center';
  g.shadowColor = color; g.shadowBlur = 18;
  g.fillStyle = color;
  g.fillText(text, w / 2, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({map: t, transparent: true, depthWrite: false, opacity: 0.8, blending: THREE.AdditiveBlending});
  const sp = new THREE.Sprite(m);
  sp.scale.set(h * w / 96, h, 1);
  return sp;
}

/* ---------- particles: sparks, trails, explosions ---------- */
export class Particles {
  constructor(n){
    this.n = n; this.next = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.size0 = new Float32Array(n);
    this.alpha = new Float32Array(n); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.drag = new Float32Array(n); this.grow = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos); geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aSize', this.aSize); geo.setAttribute('aAlpha', this.aAlpha);
    this.mat = new THREE.ShaderMaterial({vertexShader: PART_VERT, fragmentShader: PART_FRAG,
      uniforms: {uScale: {value: 500}}, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true});
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.live = 0;
  }
  emit(x, y, z, vx, vy, vz, r, g, b, size, life, drag, grow){
    const i = this.next; this.next = (this.next + 1) % this.n;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b;
    this.size[i] = this.size0[i] = size; this.life[i] = this.max[i] = life; this.alpha[i] = 1;
    this.drag[i] = drag || 0; this.grow[i] = grow || 0;
  }
  burst(p, n, speed, color, size, life, spread){
    for(let i = 0; i < n; i++){
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const v = speed * (0.3 + Math.random() * 0.7);
      const c = spread ? 0.7 + Math.random() * 0.6 : 1;
      this.emit(p.x, p.y, p.z, s * Math.cos(a) * v, u * v, s * Math.sin(a) * v,
        color.r * c, color.g * c, color.b * c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), 2.2, 0.5);
    }
  }
  update(dt){
    let live = 0;
    for(let i = 0; i < this.n; i++){
      if(this.life[i] <= 0){ if(this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      live++;
      this.life[i] -= dt;
      const k = i * 3, f = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= f; this.vel[k + 1] *= f; this.vel[k + 2] *= f;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const l = Math.max(0, this.life[i] / this.max[i]);
      this.alpha[i] = l * l;
      this.size[i] = this.size0[i] * (1 + this.grow[i] * (1 - l));
    }
    this.live = live;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
  }
}

/* ---------- beams: lasers and bolts, camera-facing quads ---------- */
const beamGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
export class Beam {
  constructor(scene){
    this.mat = new THREE.ShaderMaterial({vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
      uniforms: {uColor: {value: new THREE.Color()}, uAlpha: {value: 1}},
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide});
    this.mesh = new THREE.Mesh(beamGeo, this.mat);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3();
    this.t = 0; this.life = 0; this.width = 0.3;
    scene.add(this.mesh);
  }
  set(a, b, color, width, life){
    this.a.copy(a); this.b.copy(b);
    this.mat.uniforms.uColor.value.copy(color);
    this.width = width; this.t = this.life = life;
    this.mesh.visible = true;
  }
  place(cam){
    const axis = _v1.subVectors(this.b, this.a);
    const toCam = _v2.subVectors(cam.position, this.a);
    const side = _v3.crossVectors(axis, toCam).normalize().multiplyScalar(this.width);
    const n = _v4.crossVectors(side, axis).normalize();
    this.mesh.matrix.makeBasis(side, axis, n).setPosition(this.a);
    this.mesh.matrixWorldNeedsUpdate = true;
  }
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _o = new THREE.Object3D();

/* ---------- the ships ----------
   Built from primitives, nose along +z (Object3D.lookAt points +z at the
   target). Gunmetal hulls that pick up the sky's reflections; every
   glowing part is a plain colour brighter than white, which is what the
   bloom catches. */
export function hot(hex, k){ const c = new THREE.Color(hex); c.multiplyScalar(k || 3); return c; }
function glowMat(hex, k){ return new THREE.MeshBasicMaterial({color: hot(hex, k)}); }

function buildShip(type, glow){
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({color: 0x8a94a8, metalness: 0.55, roughness: 0.36, emissive: 0x000000});
  const dark = new THREE.MeshStandardMaterial({color: 0x3c4352, metalness: 0.5, roughness: 0.55, emissive: 0x000000});
  const flash = [hull, dark];
  const engines = [];
  const add = (geo, mat, x, y, z, rx, ry, rz) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    g.add(m); return m;
  };
  const sprite = (color, s, x, y, z) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: glow, color: hot(color, 1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
    sp.scale.set(s * 0.6, s * 0.6, 1); sp.position.set(x, y, z);
    g.add(sp); return sp;
  };
  if(type === 'dart'){
    add(new THREE.ConeGeometry(0.62, 3.8, 6), hull, 0, 0, 0.2, Math.PI / 2);
    const wing = new THREE.BoxGeometry(2.2, 0.08, 1.1);
    add(wing, dark, 1.0, 0, -0.7, 0, 0.45, -0.12);
    add(wing, dark, -1.0, 0, -0.7, 0, -0.45, 0.12);
    add(new THREE.BoxGeometry(0.08, 0.9, 0.9), dark, 0, 0.45, -1.0, 0.3);
    add(new THREE.SphereGeometry(0.28, 10, 8), glowMat(0xff3b30, 4), 0, 0.22, 0.5);
    add(new THREE.BoxGeometry(0.06, 0.05, 1.0), glowMat(0xff3b30, 3), 1.9, 0, -0.95, 0, 0.45);
    add(new THREE.BoxGeometry(0.06, 0.05, 1.0), glowMat(0xff3b30, 3), -1.9, 0, -0.95, 0, -0.45);
    engines.push(sprite(0xff5a2a, 2.2, 0, 0, -1.8));
  } else if(type === 'raider'){
    const sh = new THREE.Shape();
    sh.moveTo(0, 2.4); sh.lineTo(2.1, -1.5); sh.lineTo(0.7, -1.0); sh.lineTo(0, -1.6); sh.lineTo(-0.7, -1.0); sh.lineTo(-2.1, -1.5); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, {depth: 0.35, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2});
    geo.translate(0, 0, -0.17);
    add(geo, hull, 0, 0, 0, -Math.PI / 2);
    add(new THREE.BoxGeometry(0.9, 0.5, 1.6), dark, 0, 0.35, 0.1);
    add(new THREE.BoxGeometry(0.7, 0.08, 0.5), glowMat(0xffb020, 3.5), 0, 0.62, 0.5);
    const eng = new THREE.CylinderGeometry(0.32, 0.4, 1.3, 10);
    add(eng, dark, 0.8, 0, -1.0, Math.PI / 2);
    add(eng, dark, -0.8, 0, -1.0, Math.PI / 2);
    add(new THREE.BoxGeometry(3.4, 0.05, 0.08), glowMat(0xff8a00, 3), 0, 0.2, -1.2);
    engines.push(sprite(0xff8a20, 2.0, 0.8, 0, -1.8), sprite(0xff8a20, 2.0, -0.8, 0, -1.8));
  } else if(type === 'bomber'){
    add(new THREE.CapsuleGeometry(1.25, 4.2, 4, 12), hull, 0, 0, 0, Math.PI / 2);
    const pod = new THREE.CylinderGeometry(0.75, 0.9, 4.4, 12);
    add(pod, dark, 3.0, -0.3, -0.4, Math.PI / 2);
    add(pod, dark, -3.0, -0.3, -0.4, Math.PI / 2);
    add(new THREE.BoxGeometry(6.2, 0.3, 2.2), hull, 0, -0.2, -0.6);
    add(new THREE.BoxGeometry(1.4, 0.6, 2.2), glowMat(0xb040ff, 2.5), 0, -1.15, 0.2);
    add(new THREE.SphereGeometry(0.5, 12, 10), glowMat(0xd070ff, 3.5), 0, 0.6, 2.4);
    for(const x of [3.0, -3.0]) add(new THREE.TorusGeometry(0.8, 0.08, 6, 20), glowMat(0xb040ff, 3), x, -0.3, -2.6);
    engines.push(sprite(0xc060ff, 3.2, 3.0, -0.3, -2.8), sprite(0xc060ff, 3.2, -3.0, -0.3, -2.8), sprite(0xc060ff, 2.4, 0, 0, -3.4));
  } else if(type === 'phantom'){
    const sh = new THREE.Shape();
    sh.moveTo(0, 2.0); sh.quadraticCurveTo(2.6, 0.4, 3.0, -1.6); sh.quadraticCurveTo(1.4, -0.6, 0, -0.9);
    sh.quadraticCurveTo(-1.4, -0.6, -3.0, -1.6); sh.quadraticCurveTo(-2.6, 0.4, 0, 2.0);
    const geo = new THREE.ExtrudeGeometry(sh, {depth: 0.25, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2, curveSegments: 10});
    geo.translate(0, 0, -0.12);
    const iri = new THREE.MeshPhysicalMaterial({color: 0x2a3550, metalness: 0.9, roughness: 0.15, iridescence: 1, iridescenceIOR: 1.6,
      transparent: true, opacity: 1, emissive: 0x000000});
    flash.length = 0; flash.push(iri);
    add(geo, iri, 0, 0, 0, -Math.PI / 2);
    add(new THREE.SphereGeometry(0.35, 12, 10), glowMat(0x40fff0, 3), 0, 0.2, 0.6);
    engines.push(sprite(0x40fff0, 1.8, 0, 0, -1.0));
    g.userData.fade = [iri];
  } else if(type === 'torpedo'){
    add(new THREE.SphereGeometry(0.7, 16, 12), glowMat(0xff2060, 4));
    const spike = new THREE.ConeGeometry(0.18, 1.2, 5);
    for(let i = 0; i < 6; i++){
      const a = i / 6 * Math.PI * 2;
      add(spike, dark, Math.cos(a) * 0.8, Math.sin(a) * 0.8, -0.3, 0, 0, a - Math.PI / 2);
    }
    engines.push(sprite(0xff2060, 6, 0, 0, 0));
    g.userData.pulse = engines[0];
  } else if(type === 'crate'){
    const box = new THREE.BoxGeometry(2, 2, 2);
    add(box, hull);
    g.userData.panel = new THREE.MeshBasicMaterial({color: 0xffffff});
    for(const [x, y, z, ry, rx] of [[0, 0, 1.01, 0, 0], [0, 0, -1.01, Math.PI, 0], [1.01, 0, 0, Math.PI / 2, 0], [-1.01, 0, 0, -Math.PI / 2, 0], [0, 1.01, 0, 0, -Math.PI / 2], [0, -1.01, 0, 0, Math.PI / 2]])
      add(new THREE.PlaneGeometry(1.1, 1.1), g.userData.panel, x, y, z, rx, ry);
    g.userData.edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({color: 0xffffff}));
    g.userData.edges.scale.setScalar(1.04);
    g.add(g.userData.edges);
    g.userData.beacon = sprite(0xffffff, 4, 0, 0, 0);
    g.userData.spin = true;
  } else if(type === 'turret'){
    add(new THREE.CylinderGeometry(1.6, 2.0, 1.4, 12), dark, 0, 0, 0, Math.PI / 2);
    add(new THREE.SphereGeometry(1.4, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), hull, 0, 0, 0.6, Math.PI / 2);
    add(new THREE.BoxGeometry(0.3, 0.3, 3.2), dark, 0.5, 0, 2.0);
    add(new THREE.BoxGeometry(0.3, 0.3, 3.2), dark, -0.5, 0, 2.0);
    add(new THREE.SphereGeometry(0.45, 12, 10), glowMat(0xff2a1a, 4), 0, 0.6, 1.4);
    engines.push(sprite(0xff3020, 3, 0, 0.6, 1.4));
  } else if(type === 'boss'){
    add(new THREE.BoxGeometry(7, 4.5, 34), hull, 0, 0, 0);
    add(new THREE.BoxGeometry(5, 3, 10), hull, 0, 2.6, -6);
    add(new THREE.BoxGeometry(2.5, 3.5, 3), dark, 0, 5, -8);
    add(new THREE.CylinderGeometry(0.08, 0.08, 5, 4), dark, 0.6, 8, -8);
    add(new THREE.BoxGeometry(30, 1.2, 9), hull, 0, -0.5, -4);
    add(new THREE.BoxGeometry(32, 0.6, 3), dark, 0, -0.5, -9);
    for(const x of [-12, 12]) add(new THREE.BoxGeometry(3, 6, 12), dark, x, 0, -4);
    add(new THREE.ConeGeometry(3.6, 8, 4), hull, 0, 0, 20.5, Math.PI / 2, 0, Math.PI / 4);
    add(new THREE.BoxGeometry(5, 0.5, 14), glowMat(0xff2a1a, 2.2), 0, -2.4, 4);
    for(let i = 0; i < 8; i++) add(new THREE.BoxGeometry(0.4, 0.4, 0.4), glowMat(0xffd0a0, 3), 3.6, 1, -12 + i * 3.4);
    for(let i = 0; i < 8; i++) add(new THREE.BoxGeometry(0.4, 0.4, 0.4), glowMat(0xffd0a0, 3), -3.6, 1, -12 + i * 3.4);
    for(const [x, y] of [[-2, -1], [2, -1], [-2, 1.2], [2, 1.2], [-12, 0], [12, 0]]) engines.push(sprite(0xff6030, x === 12 || x === -12 ? 6 : 5, x, y, -17.5));
    const shield = new THREE.Mesh(new THREE.SphereGeometry(22, 48, 32), new THREE.ShaderMaterial({
      vertexShader: FRESNEL_VERT, fragmentShader: RIM_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      uniforms: {uColor: {value: new THREE.Color(1.2, 0.25, 0.15)}, uPow: {value: 2.5}, uAlpha: {value: 0.9}, uTime: {value: 0}}}));
    shield.scale.set(1, 0.7, 1.2);
    g.add(shield);
    g.userData.shield = shield;
  }
  g.userData.flash = flash;
  g.userData.engines = engines;
  return g;
}

/* ---------- the station ---------- */
function buildStation(glow){
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({color: 0x8a96a8, metalness: 0.75, roughness: 0.3});
  const dark = new THREE.MeshStandardMaterial({color: 0x2a3140, metalness: 0.6, roughness: 0.5});
  const lit = new THREE.MeshBasicMaterial({color: hot(0x9fd8ff, 2.5)});
  g.add(new THREE.Mesh(new THREE.SphereGeometry(1.5, 32, 24), hull));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.38, 14, 64), hull);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const band = new THREE.Mesh(new THREE.TorusGeometry(4, 0.4, 4, 64, Math.PI * 2), lit);
  band.rotation.x = Math.PI / 2; band.scale.set(1, 1, 0.12);
  g.add(band);
  for(let i = 0; i < 4; i++){
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 4, 8), dark);
    s.rotation.z = Math.PI / 2; s.rotation.y = i * Math.PI / 2;
    s.position.set(Math.cos(i * Math.PI / 2) * 2, 0, -Math.sin(i * Math.PI / 2) * 2);
    g.add(s);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 5, 8), dark);
  mast.position.y = 2.2; g.add(mast);
  const keel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.15, 4, 8), dark);
  keel.position.y = -2.2; g.add(keel);
  const tip = new THREE.Sprite(new THREE.SpriteMaterial({map: glow, color: hot(0xff3030, 2), blending: THREE.AdditiveBlending, depthWrite: false}));
  tip.position.y = 4.8; tip.scale.set(1.2, 1.2, 1); g.add(tip);
  g.userData.tip = tip;
  // a forward marker, so the TV view says which way is front
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 4), lit);
  nose.rotation.x = -Math.PI / 2; nose.position.set(0, 0, -5.2);
  g.add(nose);
  return g;
}

function seatAngle(c){ return Math.PI + c * Math.PI * 2 / 8 + Math.PI / 8; }

/* ================================================================ */
export class World {
  /* opts: {mode: 'phone' | 'tv', low: bool} */
  constructor(canvas, opts){
    this.mode = opts.mode;
    this.tv = opts.mode === 'tv';
    this.low = !!opts.low;
    this.canvas = canvas;
    this.myColor = -1;
    this.onEvent = null;
    this.ents = new Map();       // id -> entity
    this.bolts = new Map();
    this.msls = new Map();
    this.players = [];
    this.time = 0; this.last = performance.now();
    this.shake = 0;
    this.hullFrac = 1;
    this.snapAt = 0;

    const r = this.renderer = new THREE.WebGLRenderer({canvas, antialias: !this.low, powerPreference: 'high-performance'});
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.maxDpr = Math.min(window.devicePixelRatio || 1, this.low ? 1.25 : 2);
    this.dpr = this.maxDpr;
    r.setPixelRatio(this.dpr);

    const scene = this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(this.tv ? 50 : 66, 1, 0.1, 4000);
    this.cam.rotation.order = 'YXZ';
    this.glow = glowTex();
    this.ringT = ringTex();

    this.buildSky();
    this.buildLights();

    this.parts = new Particles(this.low ? 2500 : 5000);
    scene.add(this.parts.points);
    this.beams = [];
    for(let i = 0; i < 48; i++) this.beams.push(new Beam(scene));
    this.boltBeams = [];
    this.flashes = [];
    for(let i = 0; i < 12; i++){
      const f = new THREE.Sprite(new THREE.SpriteMaterial({map: this.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
      f.visible = false; f.userData = {t: 0, life: 0, size: 1};
      scene.add(f); this.flashes.push(f);
    }
    this.waves = [];
    for(let i = 0; i < 8; i++){
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({map: this.ringT, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
      w.visible = false; w.userData = {t: 0, life: 0, size: 1};
      scene.add(w); this.waves.push(w);
    }
    this.blasts = [new THREE.PointLight(0xffaa66, 0, 120, 1.6), new THREE.PointLight(0xffaa66, 0, 120, 1.6)];
    this.blasts.forEach(l => scene.add(l));
    this.blastNext = 0;

    // the shield round the station: from inside, only the ripples where it is hit show
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(6.5, 48, 32), new THREE.ShaderMaterial({
      vertexShader: FRESNEL_VERT, fragmentShader: SHIELD_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
      uniforms: {uHits: {value: Array.from({length: 6}, () => new THREE.Vector4(0, 0, 0, -10))}, uTime: {value: 0},
        uBase: {value: this.tv ? 0.4 : 0},
        // from inside, a hit straight ahead must not white the whole view out
        uHitGain: {value: this.tv ? 1.8 : 0.35}, uHitSize: {value: this.tv ? 0.75 : 0.4}, uColor: {value: new THREE.Color(0.35, 0.75, 1.3)}}}));
    this.hitNext = 0;
    scene.add(this.shield);

    this.shipScale = this.tv ? 3.4 : 1;
    if(this.tv){
      this.station = buildStation(this.glow);
      this.station.scale.setScalar(2.2);
      this.shield.scale.setScalar(2.2);
      scene.add(this.station);
      this.buildTactical();
      this.cam.position.set(0, 95, 265);
      this.cam.lookAt(0, -10, -10);
    } else {
      this.buildHorizon();
    }
    this.pointers = new Map();    // colour -> {beam line, dot}

    this.composer = null;
    this.setupComposer();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.frameTimes = [];
  }

  setupComposer(){
    if(this.low){ this.composer = null; return; }
    const c = this.composer = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.cam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.tv ? 0.95 : 0.85, 0.55, 0.72);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
  }

  resize(){
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    if(this.composer){ this.composer.setPixelRatio(this.dpr); this.composer.setSize(w, h); }
    this.cam.aspect = w / h;
    // a phone held upright gets a taller view; on its side, a wider one
    if(!this.tv) this.cam.fov = w < h ? 68 : 52;
    this.cam.updateProjectionMatrix();
    this.w = w; this.h = h;
    this.parts.mat.uniforms.uScale.value = h * this.dpr / (2 * Math.tan(this.cam.fov * Math.PI / 360));
    if(this.stars) this.stars.material.uniforms.uPx.value = this.dpr;
  }

  /* ---------- the sky ---------- */
  buildSky(){
    const scene = this.scene;
    const size = this.low ? 512 : 1024;
    const rt = new THREE.WebGLCubeRenderTarget(size, {type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter});
    const skyScene = new THREE.Scene();
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
      uniforms: {uNeb: {value: NEBULA_DIR}, uSun: {value: SUN_DIR}}});
    skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), skyMat));
    const cc = new THREE.CubeCamera(1, 1000, rt);
    cc.update(this.renderer, skyScene);
    scene.background = rt.texture;
    const pm = new THREE.PMREMGenerator(this.renderer);
    // the ships want more light off the sky than a dark nebula gives: brighten what they reflect
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 uSun; void main(){ vec3 d = normalize(vDir);
        vec3 c = mix(vec3(0.05, 0.06, 0.1), vec3(0.18, 0.2, 0.3), 0.5 + 0.5 * d.y);
        c += pow(max(0.0, dot(d, uSun)), 6.0) * vec3(2.5, 2.0, 1.5);
        c += pow(max(0.0, dot(d, normalize(vec3(0.62, -0.22, -0.75)))), 4.0) * vec3(0.5, 0.3, 0.15);
        gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, uniforms: {uSun: {value: SUN_DIR}}})));
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 1.4;

    // stars: real points, so they stay sharp whatever the cube map's size
    const n = this.low ? 2500 : 4500;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n), ph = new Float32Array(n);
    const gn = new THREE.Vector3(0.35, 0.9, 0.25).normalize();
    for(let i = 0; i < n; i++){
      let v;
      // a third of them crowd the galaxy's band
      for(;;){
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        v = new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a));
        if(i % 3 || Math.abs(v.dot(gn)) < 0.22) break;
      }
      v.multiplyScalar(1500);
      pos.set([v.x, v.y, v.z], i * 3);
      const m = Math.pow(Math.random(), 7);
      sz[i] = 1.0 + m * 4.0;
      const t = Math.random();
      const c = t < 0.15 ? [1.0, 0.75, 0.55] : t < 0.35 ? [0.7, 0.8, 1.0] : [1, 0.96, 0.92];
      const b = 0.25 + m * 2.6;
      col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
      ph[i] = Math.random();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      uniforms: {uTime: {value: 0}, uPx: {value: 1}}, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // the ringed planet
    const R = 170, P = PLANET_DIR.clone().multiplyScalar(1100);
    const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG, uniforms: {uSun: {value: SUN_DIR}}}));
    planet.position.copy(P);
    planet.rotation.set(0.25, 0, 0.35);
    scene.add(planet);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 64, 48), new THREE.ShaderMaterial({
      vertexShader: FRESNEL_VERT, fragmentShader: RIM_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.BackSide,
      uniforms: {uColor: {value: new THREE.Color(0.9, 0.55, 0.3)}, uPow: {value: 1.6}, uAlpha: {value: 0.55}, uTime: {value: 0}}}));
    atmo.position.copy(P);
    scene.add(atmo);
    const rIn = R * 1.35, rOut = R * 2.3;
    const ring = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 160, 1), new THREE.ShaderMaterial({
      vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {uSun: {value: SUN_DIR}, uPlanet: {value: P}, uR: {value: R}, uIn: {value: rIn}, uOut: {value: rOut}}}));
    ring.position.copy(P);
    // tilted towards the station, so it reads as rings and not a line
    ring.lookAt(P.clone().add(PLANET_DIR.clone().negate().lerp(new THREE.Vector3(0.3, 1, 0), 0.6).normalize()));
    scene.add(ring);

    // the sun: a glare and the light everything is lit by
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({map: this.glow, color: new THREE.Color(4, 3.4, 2.6), blending: THREE.AdditiveBlending, depthWrite: false}));
    sun.position.copy(SUN_DIR).multiplyScalar(1400);
    sun.scale.set(260, 260, 1);
    scene.add(sun);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({map: this.glow, color: new THREE.Color(0.5, 0.35, 0.2), blending: THREE.AdditiveBlending, depthWrite: false}));
    halo.position.copy(sun.position); halo.scale.set(900, 900, 1);
    scene.add(halo);

    // the moon
    const moon = new THREE.Mesh(new THREE.SphereGeometry(28, 48, 32), new THREE.MeshStandardMaterial({color: 0x9a9da6, roughness: 0.95, metalness: 0}));
    moon.position.copy(MOON_DIR).multiplyScalar(700);
    scene.add(moon);
  }

  buildLights(){
    const sun = new THREE.DirectionalLight(0xfff0dd, 3.2);
    sun.position.copy(SUN_DIR).multiplyScalar(100);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x5a78ff, 0.7);
    fill.position.copy(SUN_DIR).multiplyScalar(-100);
    this.scene.add(fill);
    const planetBounce = new THREE.DirectionalLight(0xffa060, 0.5);
    planetBounce.position.copy(PLANET_DIR).multiplyScalar(100);
    this.scene.add(planetBounce);
    this.scene.add(new THREE.HemisphereLight(0x8090c0, 0x302018, 0.7));
  }

  /* A phone's horizon: a faint line and the four words people call out. */
  buildHorizon(){
    const H = this.horizon = new THREE.Group();
    this.scene.add(H);
    const pts = [];
    for(let i = 0; i <= 256; i++){ const a = i / 256 * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(a) * 600, 0, -Math.cos(a) * 600)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({color: 0x6fa8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false}));
    H.add(line);
    const ticks = [];
    for(let i = 0; i < 24; i++){
      const a = i / 24 * Math.PI * 2, s = Math.sin(a), c = -Math.cos(a), h = i % 6 === 0 ? 14 : 6;
      ticks.push(new THREE.Vector3(s * 600, -h, c * 600), new THREE.Vector3(s * 600, h, c * 600));
    }
    H.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks),
      new THREE.LineBasicMaterial({color: 0x6fa8ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false})));
    const labels = [['FRONT', 0, '#7fe0ff'], ['RIGHT', 90, '#8fb0d8'], ['BEHIND', 180, '#8fb0d8'], ['LEFT', 270, '#8fb0d8']];
    for(const [t, deg, col] of labels){
      const a = deg * Math.PI / 180;
      const sp = textSprite(t, col, 26);
      sp.position.set(Math.sin(a) * 590, 30, -Math.cos(a) * 590);
      H.add(sp);
    }
    const up = textSprite('UP', '#8fb0d8', 22); up.position.set(0, 590, 0); H.add(up);
    const dn = textSprite('DOWN', '#8fb0d8', 22); dn.position.set(0, -590, 0); H.add(dn);
  }

  /* The TV's floor: range rings and the lines that drop from each ship to
     them, so a screen can show height. */
  buildTactical(){
    const g = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({color: 0x4f86c6, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false});
    for(const r of [40, 80, 120, 160]){
      const pts = [];
      for(let i = 0; i <= 128; i++){ const a = i / 128 * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r)); }
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    const sp = [];
    for(let i = 0; i < 12; i++){ const a = i / 12 * Math.PI * 2; sp.push(new THREE.Vector3(Math.sin(a) * 18, 0, Math.cos(a) * 18), new THREE.Vector3(Math.sin(a) * 160, 0, Math.cos(a) * 160)); }
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(sp), new THREE.LineBasicMaterial({color: 0x4f86c6, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false})));
    const front = textSprite('FRONT', '#7fe0ff', 12);
    front.position.set(0, 4, -175);
    g.add(front);
    this.scene.add(g);
    this.dropGeo = new THREE.BufferGeometry();
    this.dropPos = new Float32Array(2 * 3 * 64);
    this.dropGeo.setAttribute('position', new THREE.BufferAttribute(this.dropPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.drops = new THREE.LineSegments(this.dropGeo, new THREE.LineBasicMaterial({color: 0xff6a5a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false}));
    this.drops.frustumCulled = false;
    this.scene.add(this.drops);
    this.feet = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({color: 0xff6a5a, size: 3, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending}));
  }

  /* ---------- feeding it ---------- */
  setMe(color){ this.myColor = color; }

  feed(s){
    const now = performance.now();
    this.snapAt = now;
    this.hullFrac = s.hull / HULL_MAX;
    this.players = s.pl || [];
    const seen = new Set();
    const en = s.en || [];
    for(let i = 0; i < en.length; i += 10){
      const id = en[i], type = TYPE_LIST[en[i + 1]];
      seen.add(id);
      let e = this.ents.get(id);
      const p = new THREE.Vector3(en[i + 2], en[i + 3], en[i + 4]), v = new THREE.Vector3(en[i + 5], en[i + 6], en[i + 7]);
      if(!e){
        e = this.spawn(id, type, p, en[i + 9]);
        e.d.copy(p);
      }
      e.sp.copy(p); e.sv.copy(v); e.at = now;
      e.hp = en[i + 8] / 100;
      e.x = en[i + 9];
    }
    for(const [id, e] of this.ents) if(!seen.has(id)) this.despawn(id, e);
    // enemy bolts
    const bo = s.bo || [], bseen = new Set();
    for(let i = 0; i < bo.length; i += 7){
      const id = bo[i];
      bseen.add(id);
      let b = this.bolts.get(id);
      const p = new THREE.Vector3(bo[i + 1], bo[i + 2], bo[i + 3]);
      if(!b){
        b = {beam: this.takeBoltBeam(), d: p.clone(), sp: p.clone(), sv: new THREE.Vector3(), at: now};
        this.bolts.set(id, b);
        if(this.onBolt) this.onBolt(p);
      }
      b.sp.copy(p); b.sv.set(bo[i + 4], bo[i + 5], bo[i + 6]); b.at = now;
    }
    for(const [id, b] of this.bolts) if(!bseen.has(id)){ b.beam.mesh.visible = false; b.beam.free = true; this.bolts.delete(id); }
    // missiles
    const ms = s.ms || [], mseen = new Set();
    for(let i = 0; i < ms.length; i += 5){
      const id = ms[i];
      mseen.add(id);
      const p = new THREE.Vector3(ms[i + 1], ms[i + 2], ms[i + 3]);
      let m = this.msls.get(id);
      if(!m){
        const mesh = new THREE.Sprite(new THREE.SpriteMaterial({map: this.glow, color: hot(COLORS[ms[i + 4]] || '#fff', 3), blending: THREE.AdditiveBlending, depthWrite: false}));
        mesh.scale.setScalar(this.tv ? 4 : 2.2);
        this.scene.add(mesh);
        m = {mesh, d: p.clone(), sp: p.clone(), sv: new THREE.Vector3(), at: now, c: new THREE.Color(COLORS[ms[i + 4]] || '#fff')};
        this.msls.set(id, m);
      } else {
        const dt = Math.max(0.02, (now - m.at) / 1000);
        m.sv.subVectors(p, m.sp).divideScalar(dt);
      }
      m.sp.copy(p); m.at = now;
    }
    for(const [id, m] of this.msls) if(!mseen.has(id)){ this.scene.remove(m.mesh); m.mesh.material.dispose(); this.msls.delete(id); }
    for(const ev of s.ev || []) this.event(ev);
  }

  spawn(id, type, p, x){
    const mesh = buildShip(type, this.glow);
    mesh.scale.setScalar(this.shipScale * (type === 'boss' ? 1 : 1));
    mesh.position.copy(p);
    this.scene.add(mesh);
    const e = {id, type, mesh, d: p.clone(), sp: p.clone(), sv: new THREE.Vector3(), at: performance.now(),
      hp: 1, x, flash: 0, vis: type === 'phantom' ? 0.06 : 1, trail: 0, born: this.time};
    if(type === 'crate'){
      const col = ['#48ff7a', '#ffd23a', '#4db8ff'][x] || '#fff';
      mesh.userData.edges.material.color = hot(col, 2.5);
      mesh.userData.beacon.material.color = hot(col, 2);
      mesh.userData.panel.color = hot(col, 1.2);
      e.color = new THREE.Color(col);
    }
    this.ents.set(id, e);
    return e;
  }

  despawn(id, e){
    this.scene.remove(e.mesh);
    e.mesh.traverse(o => { if(o.material && o.material.dispose) o.material.dispose(); });
    this.ents.delete(id);
  }

  takeBoltBeam(){
    let b = this.boltBeams.find(x => x.free);
    if(!b){ b = new Beam(this.scene); this.boltBeams.push(b); }
    b.free = false;
    b.set(_v1.set(0, 0, 0), _v2.set(0, 0, 1), new THREE.Color(3, 0.6, 0.25), this.tv ? 0.8 : 0.35, 1e9);
    return b;
  }

  /* where a player's guns are: round the station's ring */
  seat(color, out){
    const a = seatAngle(color);
    if(this.tv) return out.set(Math.sin(a) * 4 * 2.2, 1.0 * 2.2, Math.cos(a) * 4 * 2.2);
    return out.set(Math.sin(a) * 2.2, -1.4, Math.cos(a) * 2.2);
  }

  posOf(id){ const e = this.ents.get(id); return e ? e.d : null; }

  event(ev){
    const k = ev[0];
    if(k === 'zap'){
      const [, color, dx, dy, dz, hit, dist] = ev;
      const e = hit && this.ents.get(hit);
      if(color === this.myColor && !this.tv){
        if(e) this.sparks(e.d, color);
      } else {
        const from = this.seat(color, new THREE.Vector3());
        const to = e ? e.d.clone() : new THREE.Vector3(dx, dy, dz).multiplyScalar(Math.min(dist, 220));
        this.laser(from, to, color, !!e);
      }
    } else if(k === 'hit'){
      const e = this.ents.get(ev[1]);
      if(e){ e.flash = 1; if(ev[2] >= 0 && ev[2] !== this.myColor) this.sparks(e.d, ev[2]); }
    } else if(k === 'boom'){
      const e = this.ents.get(ev[1]);
      const p = e ? e.d.clone() : new THREE.Vector3(ev[3], ev[4], ev[5]);
      this.explode(p, ev[2]);
      if(e) this.despawn(ev[1], e);
    } else if(k === 'mhit'){
      this.explode(new THREE.Vector3(ev[2], ev[3], ev[4]), 'small');
    } else if(k === 'hull'){
      const d = new THREE.Vector3(ev[2], ev[3], ev[4]).normalize();
      const h = this.shield.material.uniforms.uHits.value[this.hitNext++ % 6];
      h.set(d.x, d.y, d.z, this.time);
      this.shake = Math.min(1, this.shake + ev[1] / 10);
      this.parts.burst(d.clone().multiplyScalar(6.5 * (this.tv ? 2.2 : 1)), 14, 8, new THREE.Color(0.6, 1.2, 2.2), this.tv ? 2.5 : 0.8, 0.5);
    } else if(k === 'shield'){
      const e = this.ents.get(ev[1]);
      if(e && e.mesh.userData.shield){
        this.parts.burst(e.d, 160, 60 * this.shipScale, new THREE.Color(2.5, 0.6, 0.3), 3 * this.shipScale, 1.4, true);
        e.mesh.userData.shield.visible = false;
      }
    }
    if(this.onEvent) this.onEvent(ev);
  }

  /* ---------- effects ---------- */
  laser(from, to, color, hit){
    const b = this.beams.find(x => x.t <= 0) || this.beams[0];
    const c = new THREE.Color(COLORS[color] || '#fff').multiplyScalar(2.2);
    b.set(from, to, c, this.tv ? 0.9 : 0.28, 0.12);
    if(hit) this.sparks(to, color);
  }

  /* this phone's own shot, drawn the moment the trigger fires */
  localZap(dir, hitId, side){
    const muzzle = new THREE.Vector3(side * 0.45, -0.55, -0.4).applyQuaternion(this.cam.quaternion).add(this.cam.position);
    const e = hitId && this.ents.get(hitId);
    const to = e ? e.d.clone() : dir.clone().multiplyScalar(220).add(this.cam.position);
    this.laser(muzzle, to, this.myColor, false);
    if(e){ e.flash = Math.max(e.flash, 0.5); this.sparks(e.d, this.myColor); }
  }

  sparks(p, color){
    const c = new THREE.Color(COLORS[color] || '#fff').multiplyScalar(2.5);
    this.parts.burst(p, 10, 14 * this.shipScale, c, 0.7 * this.shipScale, 0.35);
  }

  explode(p, type){
    const s = this.shipScale * ({boss: 4, bomber: 1.8, turret: 1.6, torpedo: 1.1, small: 0.6, crate: 1}[type] || 1);
    const big = type === 'boss';
    this.parts.burst(p, big ? 400 : 90, 26 * s, new THREE.Color(3, 1.6, 0.6), 2.2 * s, big ? 2.2 : 1.1, true);
    this.parts.burst(p, big ? 160 : 40, 12 * s, new THREE.Color(2.4, 0.5, 0.2), 3.2 * s, big ? 2.6 : 1.4, true);
    this.parts.burst(p, big ? 60 : 16, 40 * s, new THREE.Color(3, 3, 3), 0.8 * s, 0.6);
    if(type === 'crate') this.parts.burst(p, 60, 20 * s, new THREE.Color(1.5, 3, 2), 1.5 * s, 1);
    const f = this.flashes.find(x => !x.visible) || this.flashes[0];
    f.visible = true; f.position.copy(p);
    f.material.color.setRGB(4, 2.6, 1.6);
    f.userData = {t: 0, life: big ? 0.9 : 0.3, size: 9 * s};
    const w = this.waves.find(x => !x.visible) || this.waves[0];
    w.visible = true; w.position.copy(p);
    w.material.color.setRGB(1.6, 1.0, 0.6);
    w.userData = {t: 0, life: big ? 1.4 : 0.6, size: 22 * s};
    const L = this.blasts[this.blastNext++ % 2];
    L.position.copy(p); L.intensity = big ? 4000 : 900 * s; L.distance = 60 * s;
    if(big) for(let i = 1; i < 7; i++) setTimeout(() => {
      const q = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 50, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 50).multiplyScalar(this.shipScale * 0.5));
      this.explode(q, 'bomber');
    }, i * 180);
  }

  /* ---------- the phone ---------- */
  setView(q){ this.cam.quaternion.copy(q); }
  forward(out){ return out.set(0, 0, -1).applyQuaternion(this.cam.quaternion); }

  /* What is under the crosshair, with a little help: a cone that widens
     with distance, the way the host allows. */
  pick(dir){
    let best = null, bestS = 1;
    for(const e of this.ents.values()){
      if(e.type === 'boss' && e.x === 1) continue;
      const to = _v1.copy(e.d).sub(this.cam.position);
      const dist = to.length();
      if(dist < 1) continue;
      const ang = dir.angleTo(to);
      let tol = Math.atan((TYPES[e.type].r * 1.25 + dist * 0.028) / dist);
      if(e.type === 'phantom' && e.vis < 0.3) tol *= 0.6;
      const s = ang / tol;
      if(s < bestS){ bestS = s; best = e; }
    }
    return best;
  }

  /* Screen position of a world point: x, y in CSS pixels, and whether it is in front. */
  project(p){
    const v = _v1.copy(p).project(this.cam);
    const inFront = _v2.copy(p).sub(this.cam.position).dot(this.forward(_v3)) > 0;
    return {x: (v.x + 1) / 2 * this.w, y: (1 - v.y) / 2 * this.h, front: inFront,
      on: inFront && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1};
  }
  /* For an arrow at the screen's edge: the direction to p in screen terms. */
  screenDir(p){
    const v = _v1.copy(p).applyMatrix4(this.cam.matrixWorldInverse);
    // in camera space x is right, y up, -z ahead; behind the camera, project onto the screen plane
    return {x: v.x, y: -v.y, behind: v.z > 0};
  }
  threats(){ return [...this.ents.values()]; }

  /* ---------- every frame ---------- */
  render(){
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const ease = 1 - Math.exp(-dt * 14);
    this.stars.material.uniforms.uTime.value = this.time;
    this.shield.material.uniforms.uTime.value = this.time;
    if(this.tv) this.shield.material.uniforms.uBase.value = 0.1 + 0.3 * this.hullFrac;

    for(const e of this.ents.values()){
      const age = Math.min(0.25, (now - e.at) / 1000);
      const pred = _v1.copy(e.sv).multiplyScalar(age).add(e.sp);
      e.d.lerp(pred, ease);
      const m = e.mesh;
      m.position.copy(e.d);
      // face where it is going (a turret and the boss face the station)
      if(e.type === 'boss' || e.type === 'turret' || e.type === 'crate'){
        _o.position.copy(e.d); _o.lookAt(0, 0, 0);
      } else if(e.sv.lengthSq() > 0.01){
        _o.position.copy(e.d); _o.lookAt(_v2.copy(e.d).add(e.sv));
      }
      if(e.type === 'crate'){ m.rotation.x += dt * 0.8; m.rotation.y += dt * 1.1; }
      else m.quaternion.slerp(_o.quaternion, 1 - Math.exp(-dt * 6));
      // hit flash
      if(e.flash > 0){
        e.flash = Math.max(0, e.flash - dt * 5);
        for(const mat of m.userData.flash) mat.emissive.setRGB(e.flash * 2, e.flash * 1.6, e.flash * 1.2);
      }
      // the phantom's cloak
      if(e.type === 'phantom'){
        const want = e.x / 100;
        e.vis += (want - e.vis) * Math.min(1, dt * 6);
        const v = Math.max(0.04, e.vis);
        for(const mat of m.userData.fade) mat.opacity = v;
        m.children.forEach(c => { if(c.isSprite) c.material.opacity = v; else if(c.material && c.material.isMeshBasicMaterial){ c.visible = e.vis > 0.3; } });
      }
      if(e.type === 'torpedo' && m.userData.pulse){
        const s = this.shipScale * (5 + Math.sin(this.time * 18) * 1.6);
        m.userData.pulse.scale.set(s, s, 1);
      }
      if(e.type === 'boss' && m.userData.shield){
        m.userData.shield.visible = e.x === 1;
        m.userData.shield.material.uniforms.uTime.value = this.time;
      }
      if(e.type === 'crate') m.userData.beacon.material.opacity = 0.6 + 0.4 * Math.sin(this.time * 6);
      // engine trails
      if(e.mesh.userData.engines.length && e.type !== 'crate' && e.type !== 'turret' && (e.type !== 'phantom' || e.vis > 0.4)){
        e.trail += dt * (e.type === 'boss' ? 20 : 40);
        // dim each one: dozens overlap, and bright stacks bloom into boxes
        const col = e.type === 'torpedo' ? [1.4, 0.18, 0.45] : e.type === 'phantom' ? [0.18, 1.1, 1.1] : e.type === 'bomber' ? [0.9, 0.35, 1.3] : [1.3, 0.5, 0.17];
        while(e.trail >= 1){
          e.trail -= 1;
          for(const en of m.userData.engines){
            const w = en.getWorldPosition(_v3);
            const j = 0.15 * this.shipScale;
            this.parts.emit(w.x + (Math.random() - 0.5) * j, w.y + (Math.random() - 0.5) * j, w.z + (Math.random() - 0.5) * j,
              -e.sv.x * 0.1, -e.sv.y * 0.1, -e.sv.z * 0.1, col[0], col[1], col[2],
              (e.type === 'boss' ? 4 : e.type === 'torpedo' ? 1.6 : 0.9) * this.shipScale, e.type === 'boss' ? 1.2 : 0.55, 1.5, 1.2);
          }
        }
      }
    }
    for(const b of this.bolts.values()){
      const age = Math.min(0.25, (now - b.at) / 1000);
      b.d.lerp(_v1.copy(b.sv).multiplyScalar(age).add(b.sp), ease);
      const tail = _v2.copy(b.sv).normalize().multiplyScalar(-(this.tv ? 7 : 3.5)).add(b.d);
      b.beam.a.copy(tail); b.beam.b.copy(b.d);
      b.beam.place(this.cam);
    }
    for(const m of this.msls.values()){
      const age = Math.min(0.25, (now - m.at) / 1000);
      m.d.lerp(_v1.copy(m.sv).multiplyScalar(age).add(m.sp), ease);
      m.mesh.position.copy(m.d);
      for(let i = 0; i < 2; i++) this.parts.emit(m.d.x, m.d.y, m.d.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2,
        m.c.r * 2, m.c.g * 2, m.c.b * 2, 1.0 * this.shipScale, 0.6, 1, 1.5);
    }
    for(const b of this.beams){
      if(b.t <= 0){ b.mesh.visible = false; continue; }
      b.t -= dt;
      b.mat.uniforms.uAlpha.value = Math.max(0, b.t / b.life);
      b.place(this.cam);
    }
    for(const f of this.flashes){
      if(!f.visible) continue;
      const u = f.userData; u.t += dt;
      const k = u.t / u.life;
      if(k >= 1){ f.visible = false; continue; }
      const s = u.size * (0.4 + k * 0.8);
      f.scale.set(s, s, 1);
      f.material.opacity = 1 - k;
    }
    for(const w of this.waves){
      if(!w.visible) continue;
      const u = w.userData; u.t += dt;
      const k = u.t / u.life;
      if(k >= 1){ w.visible = false; continue; }
      const s = u.size * (0.2 + k);
      w.scale.set(s, s, 1);
      w.quaternion.copy(this.cam.quaternion);
      w.material.opacity = (1 - k) * (1 - k);
    }
    for(const L of this.blasts) L.intensity *= Math.exp(-dt * 7);
    this.parts.update(dt);
    this.updatePointers();
    if(this.tv) this.updateTV(dt);
    else if(this.shake > 0){
      // a hit rocks the view a little; the sensors put it straight back
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const a = this.shake * 0.02;
      this.cam.quaternion.multiply(_q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, 0)));
    }
    this.cam.updateMatrixWorld();
    if(this.composer){
      this.composer.render(dt);
    } else this.renderer.render(this.scene, this.cam);
    this.adapt(dt);
  }

  /* Where everybody else is looking: a faint line in their colour. On the
     TV, everybody's. */
  updatePointers(){
    const want = new Set();
    for(const p of this.players){
      if(p.w || (!this.tv && p.c === this.myColor)) continue;
      want.add(p.c);
      let ptr = this.pointers.get(p.c);
      if(!ptr){
        const beam = new Beam(this.scene);
        const dot = new THREE.Sprite(new THREE.SpriteMaterial({map: this.glow, color: hot(COLORS[p.c], 2.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
        this.scene.add(dot);
        ptr = {beam, dot, a: new THREE.Vector3(p.a[0], p.a[1], p.a[2]), turret: null};
        if(this.tv){
          const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 2.2, 8).rotateX(Math.PI / 2).translate(0, 0, 1.1),
            new THREE.MeshBasicMaterial({color: hot(COLORS[p.c], 2)}));
          this.scene.add(t);
          ptr.turret = t;
        }
        this.pointers.set(p.c, ptr);
      }
      ptr.a.lerp(_v1.set(p.a[0], p.a[1], p.a[2]), 0.35).normalize();
      const seat = this.seat(p.c, _v2);
      // on a phone the line starts a little way out, or it would fill the view
      const from = _v4.copy(ptr.a).multiplyScalar(this.tv ? 0 : 14).add(seat);
      const len = this.tv ? 70 : 70;
      const to = _v3.copy(ptr.a).multiplyScalar(len).add(seat);
      const c = new THREE.Color(COLORS[p.c]).multiplyScalar(p.f ? 2.2 : 1.2);
      ptr.beam.set(from, to, c, this.tv ? 0.35 : 0.1, 1e9);
      ptr.beam.mat.uniforms.uAlpha.value = this.tv ? 0.5 : 0.22;
      ptr.beam.place(this.cam);
      ptr.dot.position.copy(to);
      ptr.dot.scale.setScalar(this.tv ? 6 : 3);
      if(ptr.turret){ ptr.turret.position.copy(seat); ptr.turret.lookAt(_v4.copy(seat).add(ptr.a)); ptr.turret.scale.setScalar(2.2); }
    }
    for(const [c, ptr] of this.pointers) if(!want.has(c)){
      this.scene.remove(ptr.beam.mesh, ptr.dot);
      if(ptr.turret) this.scene.remove(ptr.turret);
      this.pointers.delete(c);
    }
  }

  updateTV(dt){
    // a slow drift round behind the players, never so far that left stops being left
    const t = this.time;
    const yaw = Math.sin(t * 0.045) * 0.32, lift = 0.36 + Math.sin(t * 0.031) * 0.06;
    const r = 225;
    this.cam.position.set(Math.sin(yaw) * r * Math.cos(lift), Math.sin(lift) * r, Math.cos(yaw) * r * Math.cos(lift));
    if(this.shake > 0){
      this.shake = Math.max(0, this.shake - dt * 2.5);
      this.cam.position.x += (Math.random() - 0.5) * this.shake * 3;
      this.cam.position.y += (Math.random() - 0.5) * this.shake * 3;
    }
    this.cam.lookAt(0, -8, -15);
    this.station.rotation.y += dt * 0.05;
    this.station.userData.tip.material.opacity = 0.4 + 0.6 * (Math.sin(t * 4) > 0 ? 1 : 0);
    // drop lines to the floor
    let n = 0;
    for(const e of this.ents.values()){
      if(n >= 64) break;
      if(e.type === 'phantom' && e.vis < 0.3) continue;
      if(e.type === 'turret') continue;
      this.dropPos.set([e.d.x, e.d.y, e.d.z, e.d.x, 0, e.d.z], n * 6);
      n++;
    }
    this.dropGeo.setDrawRange(0, n * 2);
    this.dropGeo.attributes.position.needsUpdate = true;
  }

  /* A slow phone draws fewer pixels rather than fewer frames. */
  adapt(dt){
    this.frameTimes.push(dt);
    if(this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if(avg > 0.024 && this.dpr > 1){
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.resize();
    } else if(avg > 0.03 && this.dpr <= 1 && this.composer){
      this.composer = null;       // last resort: no bloom
    } else if(avg < 0.0135 && this.dpr < this.maxDpr){
      this.dpr = Math.min(this.maxDpr, this.dpr + 0.25);
      this.resize();
    }
  }
}
