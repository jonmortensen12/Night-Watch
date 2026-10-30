/* Night Watch: Bunker - the graveyard, drawn.

   The zombie mode's renderer, for both kinds of screen, built on the same
   pieces as the space one (world.js's particles, beams and glows). A phone
   is a first-person camera at its player's eye, turned by the phone's
   sensors and carried about by the stick; the TV looks down on the bunker
   from behind the players, so left on the TV is left in the room.

   Fed snapshots from zsim.js through the host. Everything is drawn where
   the last snapshot put it plus its velocity times the snapshot's age,
   eased, as in space.

   No blood anywhere: a monster that is shot flashes and throws sparks; one
   that is finished goes "poof" in coloured smoke and sweets. */
import * as THREE from 'three';
import {EffectComposer} from './lib/postprocessing/EffectComposer.js';
import {RenderPass} from './lib/postprocessing/RenderPass.js';
import {UnrealBloomPass} from './lib/postprocessing/UnrealBloomPass.js';
import {OutputPass} from './lib/postprocessing/OutputPass.js';
import {Particles, Beam, glowTex, canvasTex, textSprite, hot} from './world.js';
import {MONSTERS, MONSTER_LIST, SECTIONS, HALF, EYE, COLORS, WEAPONS, centre} from './zsim.js';

export const MOON_DIR = new THREE.Vector3(0.45, 0.42, -0.78).normalize();   // front right, high

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

/* ---------- textures, drawn once ---------- */
function noiseTex(size, draw){
  const t = canvasTex(size, draw);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function grassTex(){
  return noiseTex(256, (g, s) => {
    g.fillStyle = '#1a2416'; g.fillRect(0, 0, s, s);
    for(let i = 0; i < 5000; i++){
      const x = Math.random() * s, y = Math.random() * s, l = 2 + Math.random() * 5;
      const c = Math.random();
      g.strokeStyle = c < 0.5 ? `rgba(40,62,30,${0.5 + Math.random() * 0.5})` : c < 0.8 ? `rgba(26,38,22,0.8)` : `rgba(60,52,34,0.6)`;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 2, y - l); g.stroke();
    }
    for(let i = 0; i < 40; i++){
      g.fillStyle = `rgba(48,40,28,${0.15 + Math.random() * 0.2})`;
      g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, 6 + Math.random() * 18, 4 + Math.random() * 10, Math.random() * 3, 0, Math.PI * 2); g.fill();
    }
  });
}
function woodTex(light){
  return noiseTex(256, (g, s) => {
    g.fillStyle = light ? '#7a5634' : '#5b3d24'; g.fillRect(0, 0, s, s);
    for(let i = 0; i < 70; i++){
      const y = Math.random() * s;
      g.strokeStyle = `rgba(${light ? 50 : 30},${light ? 32 : 18},10,${0.2 + Math.random() * 0.35})`;
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath(); g.moveTo(0, y);
      for(let x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 2);
      g.stroke();
    }
    for(let i = 0; i < 6; i++){
      g.fillStyle = 'rgba(30,18,8,0.45)';
      g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, 6, 3, 0, 0, Math.PI * 2); g.fill();
    }
  });
}
function plankFloorTex(){
  return noiseTex(256, (g, s) => {
    for(let i = 0; i < 8; i++){
      const shade = 70 + Math.random() * 25;
      g.fillStyle = `rgb(${shade},${shade * 0.7},${shade * 0.45})`;
      g.fillRect(0, i * 32, s, 32);
      g.fillStyle = 'rgba(20,12,6,0.8)'; g.fillRect(0, i * 32, s, 2);
      g.fillRect((i * 97) % s, i * 32, 2, 32);
      for(let k = 0; k < 10; k++){ g.fillStyle = 'rgba(30,18,8,0.2)'; g.fillRect(Math.random() * s, i * 32 + 4 + Math.random() * 24, 20 + Math.random() * 60, 1); }
    }
  });
}
function plaidTex(){
  return noiseTex(64, (g, s) => {
    g.fillStyle = '#7a1e1e'; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(20,10,10,0.6)';
    for(let i = 0; i < s; i += 16){ g.fillRect(i, 0, 6, s); g.fillRect(0, i, s, 6); }
    g.fillStyle = 'rgba(255,200,120,0.15)';
    for(let i = 8; i < s; i += 16){ g.fillRect(i, 0, 1, s); g.fillRect(0, i, s, 1); }
  });
}
function faceTex(){
  // a carved pumpkin face: glowing shapes on nothing
  const t = canvasTex(128, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(28, 52); g.lineTo(48, 52); g.lineTo(38, 32); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(80, 52); g.lineTo(100, 52); g.lineTo(90, 32); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(58, 66); g.lineTo(70, 66); g.lineTo(64, 56); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(22, 78);
    const teeth = [[34, 92], [42, 84], [52, 98], [62, 86], [72, 98], [82, 84], [92, 94], [106, 78]];
    teeth.forEach(([x, y]) => g.lineTo(x, y));
    g.lineTo(96, 106); g.lineTo(64, 112); g.lineTo(32, 106); g.closePath(); g.fill();
  });
  return t;
}
function moonTex(){
  return canvasTex(256, (g, s) => {
    const r = g.createRadialGradient(s * 0.45, s * 0.42, s * 0.05, s / 2, s / 2, s * 0.48);
    r.addColorStop(0, '#fffbe8'); r.addColorStop(0.85, '#e8dfc2'); r.addColorStop(1, '#c9bf9e');
    g.fillStyle = r; g.beginPath(); g.arc(s / 2, s / 2, s * 0.48, 0, Math.PI * 2); g.fill();
    for(let i = 0; i < 22; i++){
      const x = s / 2 + (Math.random() - 0.5) * s * 0.7, y = s / 2 + (Math.random() - 0.5) * s * 0.7, cr = 4 + Math.random() * 18;
      if(Math.hypot(x - s / 2, y - s / 2) + cr > s * 0.47) continue;
      g.fillStyle = `rgba(150,140,110,${0.15 + Math.random() * 0.25})`;
      g.beginPath(); g.arc(x, y, cr, 0, Math.PI * 2); g.fill();
    }
  });
}
function cloudTex(){
  return canvasTex(256, (g, s) => {
    for(let i = 0; i < 26; i++){
      const x = s * (0.2 + Math.random() * 0.6), y = s * (0.35 + Math.random() * 0.3), r = s * (0.08 + Math.random() * 0.14);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }
  });
}

const SKY_FRAG = `
varying vec3 vDir;
uniform vec3 uMoon;
float h(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
void main(){
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -0.1, 1.0);
  vec3 col = mix(vec3(0.10, 0.08, 0.16), vec3(0.012, 0.016, 0.045), pow(max(up, 0.0), 0.45));
  col += vec3(0.06, 0.04, 0.07) * exp(-max(up, 0.0) * 9.0);
  float m = max(0.0, dot(d, uMoon));
  col += pow(m, 12.0) * vec3(0.10, 0.10, 0.13) + pow(m, 200.0) * vec3(0.3, 0.3, 0.32);
  // stars, fewer near the moon and the horizon
  vec3 c = floor(d * 300.0);
  float s = step(0.9975, h(c));
  col += s * vec3(0.9, 0.9, 1.0) * smoothstep(0.05, 0.3, up) * (1.0 - smoothstep(0.9, 0.99, m)) * (0.4 + h(c + 7.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const MIST_VERT = `
attribute float aSize; attribute float aPhase;
uniform float uTime; uniform float uScale;
varying float vA;
void main(){
  vec3 p = position;
  p.x += sin(uTime * 0.07 + aPhase * 6.0) * 3.0;
  p.z += cos(uTime * 0.05 + aPhase * 4.0) * 3.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.5, -mv.z), 1.0, 600.0);
  vA = 0.5 + 0.5 * sin(uTime * 0.3 + aPhase * 10.0);
}`;
const MIST_FRAG = `
varying float vA;
uniform vec3 uColor;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(uColor, a * a * 0.07 * (0.6 + 0.4 * vA));
}`;

/* ---------- the monsters ----------
   Built from primitives, facing +z. Each records the materials to flash
   when hit and the limbs to swing. */
function mat(color, rough, metal, extra){ return new THREE.MeshStandardMaterial(Object.assign({color, roughness: rough == null ? 0.8 : rough, metalness: metal || 0}, extra || {})); }

function pivot(parent, x, y, z){ const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
function part(parent, geo, m, x, y, z, rx, ry, rz){
  const o = new THREE.Mesh(geo, m);
  o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0);
  parent.add(o); return o;
}

function pumpkinGeo(r){
  const g = new THREE.SphereGeometry(r, 24, 16);
  const p = g.attributes.position;
  for(let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x), rib = 1 + 0.06 * Math.cos(a * 8);
    p.setXYZ(i, x * rib, y * 0.82, z * rib);
  }
  g.computeVertexNormals();
  return g;
}

function buildMonster(type, T){
  const g = new THREE.Group();
  const U = g.userData = {flash: [], limbs: {}, type, glow: null};
  const add = m => { U.flash.push(m); return m; };
  const glowSprite = (color, size, x, y, z) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: T.glow, color: hot(color, 1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
    sp.scale.set(size, size, 1); sp.position.set(x, y, z); g.add(sp); return sp;
  };
  if(type === 'pumpkin'){
    const denim = add(mat(0x2a3550)), shirt = add(mat(0xffffff, 0.9, 0, {map: T.plaid})), straw = add(mat(0xc9a34a));
    const orange = add(mat(0xe0701a, 0.6)), green = add(mat(0x2f5a1e));
    for(const s of [-1, 1]){
      const hip = U.limbs[s < 0 ? 'legL' : 'legR'] = pivot(g, s * 0.13, 0.9, 0);
      part(hip, new THREE.CylinderGeometry(0.08, 0.07, 0.88, 8), denim, 0, -0.44, 0);
      part(hip, new THREE.ConeGeometry(0.09, 0.18, 6), straw, 0, -0.9, 0.04, Math.PI);
    }
    part(g, new THREE.CylinderGeometry(0.22, 0.26, 0.72, 10), shirt, 0, 1.25, 0);
    for(const s of [-1, 1]){
      const sh = U.limbs[s < 0 ? 'armL' : 'armR'] = pivot(g, s * 0.27, 1.5, 0);
      part(sh, new THREE.CylinderGeometry(0.06, 0.05, 0.62, 8), shirt, 0, -0.05, 0.28, Math.PI / 2.4);
      part(sh, new THREE.ConeGeometry(0.07, 0.22, 6), straw, 0, -0.2, 0.62, -Math.PI / 2.2);
    }
    const head = U.limbs.head = pivot(g, 0, 1.82, 0);
    part(head, pumpkinGeo(0.3), orange, 0, 0, 0);
    part(head, new THREE.CylinderGeometry(0.03, 0.05, 0.14, 6), green, 0, 0.28, 0, 0.2);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), new THREE.MeshBasicMaterial({map: T.face, color: hot(0xffb030, 2.2), transparent: true, depthWrite: false}));
    face.position.set(0, -0.02, 0.27); head.add(face);
    U.glow = glowSprite(0xff9a20, 1.1, 0, 1.82, 0.3);
  } else if(type === 'skeleton'){
    const bone = add(mat(0xe9e2cc, 0.55));
    const dark = mat(0x111111, 1);
    const head = U.limbs.head = pivot(g, 0, 1.6, 0);
    part(head, new THREE.SphereGeometry(0.15, 16, 12), bone, 0, 0.04, 0);
    U.limbs.jaw = part(head, new THREE.BoxGeometry(0.16, 0.06, 0.12), bone, 0, -0.1, 0.04);
    for(const s of [-1, 1]){
      part(head, new THREE.SphereGeometry(0.045, 8, 6), dark, s * 0.055, 0.05, 0.12);
      part(head, new THREE.SphereGeometry(0.018, 6, 4), new THREE.MeshBasicMaterial({color: hot(0xff3a2a, 3)}), s * 0.055, 0.05, 0.155);
    }
    part(g, new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), bone, 0, 1.12, 0);
    for(let i = 0; i < 4; i++){
      const r = part(g, new THREE.TorusGeometry(0.15 - i * 0.012, 0.02, 6, 16), bone, 0, 1.38 - i * 0.08, 0.02, Math.PI / 2);
      r.scale.set(1, 0.75, 1);
    }
    part(g, new THREE.BoxGeometry(0.3, 0.1, 0.12), bone, 0, 0.82, 0);
    for(const s of [-1, 1]){
      const hip = U.limbs[s < 0 ? 'legL' : 'legR'] = pivot(g, s * 0.1, 0.8, 0);
      part(hip, new THREE.CylinderGeometry(0.028, 0.025, 0.4, 6), bone, 0, -0.2, 0);
      part(hip, new THREE.CylinderGeometry(0.025, 0.022, 0.38, 6), bone, 0, -0.6, 0);
      part(hip, new THREE.BoxGeometry(0.08, 0.04, 0.16), bone, 0, -0.8, 0.04);
      const sh = U.limbs[s < 0 ? 'armL' : 'armR'] = pivot(g, s * 0.2, 1.45, 0);
      part(sh, new THREE.CylinderGeometry(0.022, 0.02, 0.32, 6), bone, 0, -0.16, 0);
      part(sh, new THREE.CylinderGeometry(0.02, 0.018, 0.3, 6), bone, 0, -0.42, 0.08, -0.5);
    }
  } else if(type === 'ghost'){
    const pts = [];
    for(let i = 0; i <= 10; i++){ const a = i / 10 * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * 0.4, 0.75 + Math.cos(a) * 0.4)); }
    for(let i = 1; i <= 8; i++){ const t = i / 8; pts.push(new THREE.Vector2(0.4 + t * t * 0.2, 0.75 - t * 0.95)); }
    const lathe = new THREE.LatheGeometry(pts, 32);
    // a wavy hem
    const lp = lathe.attributes.position;
    for(let i = 0; i < lp.count; i++){
      const y = lp.getY(i);
      if(y < -0.1){ const a = Math.atan2(lp.getZ(i), lp.getX(i)); lp.setY(i, y + Math.sin(a * 7) * 0.07); }
    }
    lathe.computeVertexNormals();
    const sheet = new THREE.MeshStandardMaterial({color: 0xf2f8ff, emissive: 0x7ab0ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.9,
      roughness: 0.45, side: THREE.DoubleSide, depthWrite: false});
    add(sheet);
    U.body = part(g, lathe, sheet, 0, 0, 0);
    const black = new THREE.MeshBasicMaterial({color: 0x05060a});
    for(const s of [-1, 1]){
      const e = part(g, new THREE.SphereGeometry(0.075, 10, 8), black, s * 0.14, 0.88, 0.33); e.scale.set(0.8, 1.4, 0.4);
      U.limbs[s < 0 ? 'armL' : 'armR'] = part(g, new THREE.ConeGeometry(0.11, 0.45, 8), sheet, s * 0.48, 0.45, 0.05, 0, 0, s * 1.2);
    }
    const mo = part(g, new THREE.TorusGeometry(0.06, 0.025, 6, 12), black, 0, 0.66, 0.38); mo.scale.set(1, 1.4, 1);
    U.glow = glowSprite(0x7ab8ff, 2.4, 0, 0.6, 0);
  } else if(type === 'brute'){
    const skin = add(mat(0x8fc070, 0.7)), coat = add(mat(0x4a4660, 0.85)), trousers = add(mat(0x5a4c3a, 0.9)), boot = add(mat(0x2a2420, 0.6));
    const hair = mat(0x0d0d0d, 0.9), metal = mat(0x888888, 0.3, 0.9);
    for(const s of [-1, 1]){
      const hip = U.limbs[s < 0 ? 'legL' : 'legR'] = pivot(g, s * 0.24, 1.15, 0);
      part(hip, new THREE.BoxGeometry(0.3, 1.0, 0.32), trousers, 0, -0.5, 0);
      part(hip, new THREE.BoxGeometry(0.36, 0.22, 0.5), boot, 0, -1.05, 0.06);
    }
    part(g, new THREE.BoxGeometry(0.9, 0.95, 0.5), coat, 0, 1.6, 0);
    part(g, new THREE.BoxGeometry(0.16, 0.1, 0.16), skin, 0, 2.12, 0);
    const head = U.limbs.head = pivot(g, 0, 2.38, 0);
    part(head, new THREE.BoxGeometry(0.42, 0.44, 0.4), skin, 0, 0, 0);
    part(head, new THREE.BoxGeometry(0.44, 0.1, 0.42), hair, 0, 0.25, 0);
    part(head, new THREE.BoxGeometry(0.44, 0.06, 0.06), hair, 0, 0.12, 0.2);
    for(const s of [-1, 1]){
      part(head, new THREE.CylinderGeometry(0.035, 0.035, 0.14, 8), metal, s * 0.26, -0.15, 0, 0, 0, Math.PI / 2);
      part(head, new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({color: hot(0xfff070, 3)}), s * 0.1, 0.03, 0.205);
      const sh = U.limbs[s < 0 ? 'armL' : 'armR'] = pivot(g, s * 0.55, 1.95, 0);
      part(sh, new THREE.BoxGeometry(0.24, 0.24, 0.85), coat, 0, -0.05, 0.38);
      part(sh, new THREE.BoxGeometry(0.2, 0.2, 0.2), skin, 0, -0.05, 0.86);
    }
  } else if(type === 'bat'){
    g.userData.scale = 1.8;
    const fur = add(mat(0x4a2a60, 0.9));
    part(g, new THREE.SphereGeometry(0.12, 10, 8), fur, 0, 0, 0).scale.set(1, 1, 1.3);
    part(g, new THREE.SphereGeometry(0.09, 10, 8), fur, 0, 0.06, 0.13);
    for(const s of [-1, 1]){
      part(g, new THREE.ConeGeometry(0.03, 0.09, 4), fur, s * 0.05, 0.15, 0.13);
      part(g, new THREE.SphereGeometry(0.018, 6, 4), new THREE.MeshBasicMaterial({color: hot(0xff2020, 3)}), s * 0.035, 0.08, 0.21);
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(0.5, 0.12); sh.quadraticCurveTo(0.42, -0.02, 0.36, -0.12); sh.quadraticCurveTo(0.26, -0.04, 0.2, -0.13); sh.quadraticCurveTo(0.12, -0.04, 0, -0.1); sh.closePath();
      const wing = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshStandardMaterial({color: 0x1d1028, side: THREE.DoubleSide, roughness: 0.9}));
      wing.rotation.x = -Math.PI / 2;
      const p = U.limbs[s < 0 ? 'armL' : 'armR'] = pivot(g, s * 0.06, 0.02, 0);
      if(s < 0) wing.scale.x = -1;
      p.add(wing);
    }
  } else if(type === 'witch'){
    const cloak = add(mat(0x2a1640, 0.85)), skin = add(mat(0x7fbf5a, 0.7)), hat = add(mat(0x15101e, 0.8)), wood = add(mat(0x5a3a1e, 0.8)), straw = add(mat(0xb08a3a, 0.9));
    part(g, new THREE.CylinderGeometry(0.035, 0.035, 2.0, 6), wood, 0, 0, 0, Math.PI / 2);
    part(g, new THREE.ConeGeometry(0.22, 0.6, 10), straw, 0, 0, -1.2, -Math.PI / 2);
    part(g, new THREE.ConeGeometry(0.32, 0.8, 10), cloak, 0, 0.32, -0.1);
    const head = U.limbs.head = pivot(g, 0, 0.82, 0.02);
    part(head, new THREE.SphereGeometry(0.15, 14, 10), skin, 0, 0, 0);
    part(head, new THREE.ConeGeometry(0.04, 0.14, 6), skin, 0, -0.02, 0.17, Math.PI / 2.2);
    part(head, new THREE.CylinderGeometry(0.34, 0.34, 0.02, 20), hat, 0, 0.1, 0);
    part(head, new THREE.ConeGeometry(0.16, 0.55, 12), hat, 0, 0.38, -0.05, -0.25);
    part(head, new THREE.CylinderGeometry(0.155, 0.16, 0.05, 16), new THREE.MeshBasicMaterial({color: hot(0xa040ff, 1.5)}), 0, 0.14, 0);
    for(const s of [-1, 1]) part(head, new THREE.SphereGeometry(0.02, 6, 4), new THREE.MeshBasicMaterial({color: hot(0x9cff40, 3)}), s * 0.05, 0.03, 0.13);
    for(const s of [-1, 1]) U.limbs[s < 0 ? 'armL' : 'armR'] = part(g, new THREE.CylinderGeometry(0.04, 0.035, 0.45, 6), cloak, s * 0.15, 0.4, 0.25, Math.PI / 2.4);
    U.glow = glowSprite(0x9cff40, 2.6, 0, 0.3, -1.2);
  } else if(type === 'bomb'){
    const orange = add(mat(0xe0701a, 0.6));
    part(g, pumpkinGeo(0.22), orange, 0, 0, 0);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), new THREE.MeshBasicMaterial({map: T.face, color: hot(0xff5020, 2.5), transparent: true, depthWrite: false}));
    face.position.set(0, 0, 0.2); g.add(face);
    U.glow = glowSprite(0xffd060, 0.9, 0, 0.3, 0);
  }
  return g;
}

/* ---------- the guns, held ---------- */
function buildGun(key){
  const g = new THREE.Group();
  // matte: a shiny gun this close catches the moon and glares
  const dark = new THREE.MeshStandardMaterial({color: 0x2c3036, metalness: 0.2, roughness: 0.75});
  const black = new THREE.MeshStandardMaterial({color: 0x15161a, metalness: 0.15, roughness: 0.85});
  const wood = new THREE.MeshStandardMaterial({color: 0x6b4426, roughness: 0.6});
  let muzzle;
  if(key === 'pistol'){
    part(g, new THREE.BoxGeometry(0.05, 0.06, 0.24), dark, 0, 0, 0);
    part(g, new THREE.BoxGeometry(0.045, 0.12, 0.07), black, 0, -0.08, 0.06, -0.25);
    part(g, new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), black, 0, 0.01, -0.13, Math.PI / 2);
    part(g, new THREE.BoxGeometry(0.01, 0.015, 0.01), new THREE.MeshBasicMaterial({color: hot(0x7cff9a, 2)}), 0, 0.04, -0.1);
    muzzle = new THREE.Vector3(0, 0.01, -0.17);
  } else if(key === 'shotgun'){
    for(const s of [-1, 1]) part(g, new THREE.CylinderGeometry(0.018, 0.018, 0.62, 10), dark, s * 0.02, 0.02, -0.2, Math.PI / 2);
    part(g, new THREE.BoxGeometry(0.07, 0.07, 0.2), black, 0, 0, 0.12);
    part(g, new THREE.BoxGeometry(0.06, 0.05, 0.22), wood, 0, -0.03, -0.15);
    part(g, new THREE.BoxGeometry(0.055, 0.1, 0.3), wood, 0, -0.04, 0.33, 0.25);
    muzzle = new THREE.Vector3(0, 0.02, -0.52);
  } else {
    part(g, new THREE.CylinderGeometry(0.012, 0.014, 0.75, 10), dark, 0, 0.01, -0.3, Math.PI / 2);
    part(g, new THREE.BoxGeometry(0.06, 0.07, 0.3), black, 0, 0, 0.12);
    part(g, new THREE.BoxGeometry(0.05, 0.11, 0.3), black, 0, -0.03, 0.4, 0.15);
    part(g, new THREE.CylinderGeometry(0.03, 0.03, 0.26, 12), black, 0, 0.075, 0.08, Math.PI / 2);
    part(g, new THREE.CircleGeometry(0.026, 16), new THREE.MeshBasicMaterial({color: hot(0x5ab0ff, 1.4)}), 0, 0.075, -0.051);
    muzzle = new THREE.Vector3(0, 0.01, -0.68);
  }
  g.userData.muzzle = muzzle;
  return g;
}

/* a friend in the bunker */
function buildAvatar(color, name){
  const g = new THREE.Group();
  const c = new THREE.Color(COLORS[color] || '#fff');
  const body = new THREE.MeshStandardMaterial({color: c.clone().multiplyScalar(0.7), roughness: 0.6, emissive: c, emissiveIntensity: 0.12});
  part(g, new THREE.CapsuleGeometry(0.22, 0.75, 4, 12), body, 0, 0.75, 0);
  const head = part(g, new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshStandardMaterial({color: 0xd8b49a, roughness: 0.7}), 0, 1.45, 0);
  part(head, new THREE.BoxGeometry(0.24, 0.06, 0.08), new THREE.MeshBasicMaterial({color: hot(COLORS[color], 1.8)}), 0, 0.02, 0.14);
  const arm = pivot(g, 0.18, 1.25, 0);
  arm.add(Object.assign(buildGun('pistol'), {}));
  arm.children[0].position.set(0, 0, -0.2); arm.children[0].scale.setScalar(1.6);
  g.userData.arm = arm;
  const tag = textSprite(name, COLORS[color], 0.16);
  tag.material.opacity = 0.7;
  tag.position.y = 2.0; g.add(tag);
  g.userData.tag = tag;
  return g;
}

/* ================================================================ */
export class Yard {
  constructor(canvas, opts){
    this.mode = opts.mode;
    this.tv = opts.mode === 'tv';
    this.low = !!opts.low;
    this.canvas = canvas;
    this.myColor = -1;
    this.onEvent = null;
    this.mons = new Map();
    this.avatars = new Map();
    this.time = 0; this.last = performance.now();
    this.secs = [100, 100, 100, 100, 100, 100, 100, 100];
    this.secHit = [0, 0, 0, 0, 0, 0, 0, 0];
    this.players = [];
    this.weapon = 0; this.zoom = false; this.recoil = 0; this.swap = 0;
    this.pos = new THREE.Vector3(0, EYE, 0);

    const r = this.renderer = new THREE.WebGLRenderer({canvas, antialias: !this.low, powerPreference: 'high-performance'});
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.55;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.maxDpr = Math.min(window.devicePixelRatio || 1, this.low ? 1.25 : 2);
    this.dpr = this.maxDpr;
    r.setPixelRatio(this.dpr);

    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x161426, this.tv ? 0.016 : 0.03);
    scene.background = new THREE.Color(0x05060f);
    this.baseFov = this.tv ? 48 : 70;
    this.cam = new THREE.PerspectiveCamera(this.baseFov, 1, 0.05, 900);
    this.cam.rotation.order = 'YXZ';
    scene.add(this.cam);
    this.T = {glow: glowTex(), plaid: plaidTex(), face: faceTex()};

    this.buildSky();
    this.buildGround();
    this.buildBunker();
    this.buildProps();

    this.parts = new Particles(this.low ? 2500 : 5000);
    scene.add(this.parts.points);
    this.beams = [];
    for(let i = 0; i < 40; i++) this.beams.push(new Beam(scene));
    this.smoke = [];
    const smokeT = canvasTex(128, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
    for(let i = 0; i < 40; i++){
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: smokeT, transparent: true, depthWrite: false, opacity: 0}));
      sp.visible = false; sp.userData = {t: 0, life: 1, v: new THREE.Vector3(), s0: 1};
      scene.add(sp); this.smoke.push(sp);
    }
    this.flashLight = new THREE.PointLight(0xffd090, 0, 9, 1.8);
    scene.add(this.flashLight);
    this.blast = new THREE.PointLight(0xff9a40, 0, 16, 1.6);
    scene.add(this.blast);

    if(!this.tv){
      // the gun in this player's hands
      this.guns = WEAPONS.map(w => { const g = buildGun(w.key); g.visible = false; this.cam.add(g); return g; });
      this.muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({map: this.T.glow, color: hot(0xffc060, 3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
      this.muzzleFlash.visible = false;
      this.cam.add(this.muzzleFlash);
      // a torch: lights up whatever you point at. It sits a little way in
      // front of the camera so the gun in your hands is behind it, and it
      // fades gently with distance - a friend a metre away is not blinding.
      const torch = this.torch = new THREE.SpotLight(0xfff0d8, 8, 34, 0.42, 0.6, 0.7);
      torch.position.set(0, -0.1, -0.6);
      torch.target.position.set(0, -0.6, -10);
      this.cam.add(torch); this.cam.add(torch.target);
    }
    this.composer = null;
    if(!this.low){
      const c = this.composer = new EffectComposer(r);
      c.addPass(new RenderPass(scene, this.cam));
      c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.5, 0.78));
      c.addPass(new OutputPass());
    }
    this.resize();
    this._resize = () => this.resize();
    addEventListener('resize', this._resize);
    this.frameTimes = [];
  }

  dispose(){
    removeEventListener('resize', this._resize);
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch(e){}
  }

  resize(){
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    if(this.composer){ this.composer.setPixelRatio(this.dpr); this.composer.setSize(w, h); }
    this.cam.aspect = w / h;
    if(!this.tv) this.baseFov = w < h ? 72 : 56;
    this.applyFov();
    this.w = w; this.h = h;
  }
  applyFov(){
    this.cam.fov = this.zoom ? 14 : this.baseFov;
    this.cam.updateProjectionMatrix();
    this.parts.mat && (this.parts.mat.uniforms.uScale.value = (this.h || innerHeight) * this.dpr / (2 * Math.tan(this.cam.fov * Math.PI / 360)));
    if(this.mist) this.mist.material.uniforms.uScale.value = (this.h || innerHeight) * this.dpr / (2 * Math.tan(this.cam.fov * Math.PI / 360));
  }

  /* ---------- the night ---------- */
  buildSky(){
    const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {uMoon: {value: MOON_DIR}}}));
    sky.renderOrder = -10;
    this.scene.add(sky);
    this.sky = sky;
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({map: moonTex(), color: new THREE.Color(1.6, 1.55, 1.4), fog: false, depthWrite: false}));
    moon.position.copy(MOON_DIR).multiplyScalar(400); moon.scale.set(46, 46, 1);
    this.scene.add(moon);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({map: this.T.glow, color: new THREE.Color(0.35, 0.36, 0.45), blending: THREE.AdditiveBlending, fog: false, depthWrite: false}));
    halo.position.copy(moon.position).multiplyScalar(1.01); halo.scale.set(220, 220, 1);
    this.scene.add(halo);
    this.moon = moon;
    // clouds that cross the moon now and then
    const ct = cloudTex();
    this.clouds = [];
    for(let i = 0; i < 9; i++){
      const c = new THREE.Sprite(new THREE.SpriteMaterial({map: ct, color: new THREE.Color(0.16, 0.15, 0.24), fog: false, depthWrite: false, transparent: true, opacity: 0.85}));
      const a = Math.random() * Math.PI * 2, el = 0.25 + Math.random() * 0.35;
      c.userData = {a, el, sp: 0.004 + Math.random() * 0.004};
      c.scale.set(220 + Math.random() * 140, 90 + Math.random() * 50, 1);
      this.scene.add(c); this.clouds.push(c);
    }
    // moonlight, and the cold light off the sky
    const moonLight = new THREE.DirectionalLight(0xa8bcff, 1.9);
    moonLight.position.copy(MOON_DIR).multiplyScalar(50);
    this.scene.add(moonLight);
    this.scene.add(new THREE.HemisphereLight(0x5a66a0, 0x2a2018, 1.1));
  }

  buildGround(){
    const gt = grassTex(); gt.repeat.set(70, 70);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({map: gt, roughness: 1, color: 0x9aa890}));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    // low mist drifting over the field
    const n = this.low ? 120 : 260;
    const pos = new Float32Array(n * 3), size = new Float32Array(n), ph = new Float32Array(n);
    for(let i = 0; i < n; i++){
      const a = Math.random() * Math.PI * 2, r = 6 + Math.pow(Math.random(), 0.7) * 55;
      pos.set([Math.sin(a) * r, 0.3 + Math.random() * 1.2, Math.cos(a) * r], i * 3);
      size[i] = 6 + Math.random() * 10; ph[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    this.mist = new THREE.Points(g, new THREE.ShaderMaterial({vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, transparent: true, depthWrite: false,
      uniforms: {uTime: {value: 0}, uScale: {value: 600}, uColor: {value: new THREE.Color(0.55, 0.6, 0.8)}}}));
    this.mist.frustumCulled = false;
    // seen from above, on the TV, low mist is just smears
    if(!this.tv) this.scene.add(this.mist);
  }

  buildBunker(){
    const floorT = plankFloorTex(); floorT.repeat.set(2, 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshStandardMaterial({map: floorT, roughness: 0.85}));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01;
    this.scene.add(floor);
    const wood = new THREE.MeshStandardMaterial({map: woodTex(true), roughness: 0.8, color: 0xffe0c8});
    const post = new THREE.MeshStandardMaterial({map: woodTex(false), roughness: 0.85, color: 0xffd8c0});
    const iron = new THREE.MeshStandardMaterial({color: 0x30302e, metalness: 0.7, roughness: 0.4});
    this.wood = wood;
    // posts at the corners (with lanterns) and between each pair of sections
    this.lanterns = [];
    const posts = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF], [0, -HALF], [HALF, 0], [0, HALF], [-HALF, 0]];
    posts.forEach(([x, z], i) => {
      const corner = i < 4;
      part(this.scene, new THREE.BoxGeometry(0.22, corner ? 1.75 : 1.45, 0.22), post, x, corner ? 0.875 : 0.725, z, 0, (i * 0.37) % 0.2);
      if(corner){
        const l = new THREE.Group(); l.position.set(x, 1.95, z); this.scene.add(l);
        part(l, new THREE.BoxGeometry(0.2, 0.04, 0.2), iron, 0, -0.14, 0);
        part(l, new THREE.BoxGeometry(0.2, 0.04, 0.2), iron, 0, 0.14, 0);
        part(l, new THREE.BoxGeometry(0.13, 0.22, 0.13), new THREE.MeshBasicMaterial({color: hot(0xffb050, 2.4)}), 0, 0, 0);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: this.T.glow, color: hot(0xff9a40, 1.2), blending: THREE.AdditiveBlending, depthWrite: false}));
        sp.scale.set(1.6, 1.6, 1); l.add(sp);
        const light = new THREE.PointLight(0xffa050, 22, 14, 1.5);
        l.add(light);
        this.lanterns.push({light, sp, ph: Math.random() * 10});
      }
    });
    // the sections: four planks each, and a health bar over each
    this.sections = SECTIONS.map((S, i) => {
      const g = new THREE.Group();
      const dx = S.b[0] - S.a[0], dz = S.b[1] - S.a[1], len = Math.hypot(dx, dz);
      g.position.set(S.mid[0], 0, S.mid[1]);
      g.rotation.y = Math.atan2(-dz, dx);
      this.scene.add(g);
      const planks = [0.28, 0.58, 0.88, 1.18].map((y, k) => {
        const p = part(g, new THREE.BoxGeometry(len - 0.26, 0.22, 0.07), wood, (Math.random() - 0.5) * 0.06, y + (Math.random() - 0.5) * 0.04, 0, 0, 0, (Math.random() - 0.5) * 0.06);
        p.userData.home = p.position.clone();
        return p;
      });
      // a red glow on the ground where a section is down
      const warn = part(g, new THREE.PlaneGeometry(len, 1.2), new THREE.MeshBasicMaterial({map: this.T.glow, color: hot(0xff2020, 1.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0}), 0, 0.03, 0, -Math.PI / 2);
      const bar = this.makeBar();
      bar.sprite.position.set(S.mid[0] + S.n[0] * 0.1, this.tv ? 2.6 : 1.72, S.mid[1] + S.n[1] * 0.1);
      this.scene.add(bar.sprite);
      return {g, planks, warn, bar, shown: 4, hp: 100, shake: 0};
    });
    this.debris = [];
  }

  makeBar(){
    const c = document.createElement('canvas');
    c.width = 256; c.height = 48;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: t, transparent: true, depthWrite: false, fog: false}));
    const k = this.tv ? 2.6 : 1;
    sprite.scale.set(1.5 * k, 0.28 * k, 1);
    return {c, t, sprite, drawn: null};
  }
  drawBar(bar, hp, flash){
    const key = hp + ':' + (hp < 0 ? flash : 0);
    if(bar.drawn === key) return;
    bar.drawn = key;
    const g = bar.c.getContext('2d');
    g.clearRect(0, 0, 256, 48);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.beginPath(); g.roundRect(4, 10, 248, 28, 10); g.fill();
    if(hp < 0){
      g.fillStyle = flash ? '#ff2a3a' : '#7a0a14';
      g.beginPath(); g.roundRect(8, 14, 240, 20, 8); g.fill();
      g.fillStyle = '#fff'; g.font = '900 20px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('BROKEN', 128, 25);
    } else {
      const k = hp / 100;
      g.fillStyle = k > 0.6 ? '#4cff7a' : k > 0.3 ? '#ffd23a' : '#ff4a3a';
      g.beginPath(); g.roundRect(8, 14, Math.max(6, 240 * k), 20, 8); g.fill();
    }
    bar.t.needsUpdate = true;
  }

  buildProps(){
    const rnd = (a, b) => a + Math.random() * (b - a);
    const clear = (x, z, r) => Math.abs(x) > HALF + r || Math.abs(z) > HALF + r;
    // gravestones
    const stone = new THREE.MeshStandardMaterial({color: 0x6e7078, roughness: 0.95});
    const mossy = new THREE.MeshStandardMaterial({color: 0x56604e, roughness: 1});
    for(let i = 0; i < 46; i++){
      const a = rnd(0, Math.PI * 2), r = rnd(9, 48);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const g = new THREE.Group();
      const m = Math.random() < 0.3 ? mossy : stone;
      const kind = Math.random();
      if(kind < 0.55){
        part(g, new THREE.BoxGeometry(0.6, 0.75, 0.14), m, 0, 0.37, 0);
        part(g, new THREE.CylinderGeometry(0.3, 0.3, 0.14, 16, 1, false, 0, Math.PI), m, 0, 0.75, 0, Math.PI / 2, 0, Math.PI / 2);
      } else if(kind < 0.8){
        part(g, new THREE.BoxGeometry(0.14, 1.1, 0.14), m, 0, 0.55, 0);
        part(g, new THREE.BoxGeometry(0.55, 0.14, 0.14), m, 0, 0.78, 0);
      } else {
        part(g, new THREE.BoxGeometry(0.5, 0.35, 0.9), m, 0, 0.17, 0);
        part(g, new THREE.BoxGeometry(0.6, 0.6, 0.12), m, 0, 0.5, -0.4);
      }
      g.position.set(x, 0, z);
      g.rotation.set(rnd(-0.12, 0.12), rnd(-0.6, 0.6) + Math.atan2(x, z), rnd(-0.12, 0.12));
      this.scene.add(g);
    }
    // dead trees
    const bark = new THREE.MeshStandardMaterial({color: 0x2b2420, roughness: 1});
    const branch = (parent, len, rad, depth) => {
      const b = part(parent, new THREE.CylinderGeometry(rad * 0.6, rad, len, 6).translate(0, len / 2, 0), bark);
      if(depth > 0){
        const n = 2 + Math.floor(Math.random() * 2);
        for(let i = 0; i < n; i++){
          const c = new THREE.Group();
          c.position.y = len * (0.55 + Math.random() * 0.4);
          c.rotation.set(rnd(0.5, 1.1), rnd(0, Math.PI * 2), 0);
          b.add(c);
          branch(c, len * rnd(0.45, 0.65), rad * 0.55, depth - 1);
        }
      }
      return b;
    };
    for(let i = 0; i < 13; i++){
      const a = rnd(0, Math.PI * 2), r = rnd(16, 55);
      const t = new THREE.Group(); t.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
      t.rotation.set(rnd(-0.08, 0.08), rnd(0, 6), rnd(-0.08, 0.08));
      branch(t, rnd(2.5, 4.5), rnd(0.18, 0.3), 3);
      this.scene.add(t);
    }
    // jack-o'-lanterns round the bunker
    const orange = new THREE.MeshStandardMaterial({color: 0xd8641a, roughness: 0.6});
    this.jacks = [];
    for(let i = 0; i < 10; i++){
      const a = i / 10 * Math.PI * 2 + rnd(-0.2, 0.2), r = rnd(6.5, 9);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if(!clear(x, z, 1)) continue;
      const g = new THREE.Group(); g.position.set(x, 0.22, z);
      g.rotation.y = Math.atan2(-x, -z) + Math.PI + rnd(-0.4, 0.4);
      part(g, pumpkinGeo(0.26), orange);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.38), new THREE.MeshBasicMaterial({map: this.T.face, color: hot(0xffa030, 2), transparent: true, depthWrite: false}));
      face.position.set(0, 0, 0.23); face.rotation.y = 0; g.add(face);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: this.T.glow, color: hot(0xff8a20, 0.9), blending: THREE.AdditiveBlending, depthWrite: false}));
      sp.scale.set(1.4, 1.4, 1); sp.position.z = 0.25; g.add(sp);
      this.scene.add(g); this.jacks.push({sp, ph: Math.random() * 10});
    }
    // will-o'-the-wisps
    this.wisps = [];
    for(let i = 0; i < 7; i++){
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: this.T.glow, color: hot(0x7affd0, 1.6), blending: THREE.AdditiveBlending, depthWrite: false}));
      sp.scale.set(0.5, 0.5, 1);
      sp.userData = {a: rnd(0, 6.28), r: rnd(12, 30), sp: rnd(0.03, 0.08) * (Math.random() < 0.5 ? 1 : -1), h: rnd(0.6, 2)};
      this.scene.add(sp); this.wisps.push(sp);
    }
  }

  /* ---------- snapshots ---------- */
  setMe(color){ this.myColor = color; }

  feed(s){
    const now = performance.now();
    this.players = s.pl || [];
    const seen = new Set();
    const m = s.m || [];
    for(let i = 0; i < m.length; i += 11){
      const id = m[i], type = MONSTER_LIST[m[i + 1]];
      seen.add(id);
      let e = this.mons.get(id);
      const p = new THREE.Vector3(m[i + 2], m[i + 3], m[i + 4]);
      if(!e){
        const mesh = buildMonster(type, this.T);
        mesh.scale.setScalar((mesh.userData.scale || 1) * (this.tv ? 1.25 : 1));
        mesh.position.copy(p);
        this.scene.add(mesh);
        e = {id, type, mesh, d: p.clone(), sp: p.clone(), sv: new THREE.Vector3(), at: now, face: m[i + 5] / 100, hp: 1, st: 0, sec: 0, flash: 0, ph: Math.random() * 10, walk: 0};
        this.mons.set(id, e);
      }
      e.sp.copy(p); e.sv.set(m[i + 9], 0, m[i + 10]); e.at = now;
      e.faceT = m[i + 5] / 100;
      e.hp = m[i + 6] / 100; e.st = m[i + 7]; e.sec = m[i + 8];
    }
    for(const [id, e] of this.mons) if(!seen.has(id)) this.remove(id, e);
    if(s.sec){
      s.sec.forEach((hp, i) => {
        const sec = this.sections[i];
        if(s.hit && s.hit[i]) sec.shake = 0.25;
        this.secs[i] = hp;
      });
    }
    // friends
    const want = new Set();
    for(const p of this.players){
      if(p.aw || (!this.tv && p.c === this.myColor)) continue;
      want.add(p.c);
      let a = this.avatars.get(p.c);
      if(!a){
        const mesh = buildAvatar(p.c, p.n);
        this.scene.add(mesh);
        a = {mesh, d: new THREE.Vector3(p.x, 0, p.z), sp: new THREE.Vector3(), aim: new THREE.Vector3(0, 0, -1)};
        this.avatars.set(p.c, a);
      }
      a.sp.set(p.x, 0, p.z); a.aimT = p.a; a.rep = p.r && p.fx >= 0; a.w = p.w;
    }
    for(const [c, a] of this.avatars) if(!want.has(c)){ this.scene.remove(a.mesh); this.avatars.delete(c); }
    for(const ev of s.ev || []) this.event(ev);
  }

  remove(id, e){
    this.scene.remove(e.mesh);
    this.mons.delete(id);
  }

  posOf(id){ const e = this.mons.get(id); return e ? e.d : null; }

  event(ev){
    const k = ev[0];
    if(k === 'shot'){
      const [, color, w, ox, oy, oz, dx, dy, dz, dist, hit] = ev;
      if(color !== this.myColor || this.tv){
        const from = new THREE.Vector3(ox, oy, oz).add(_v1.set(dx, dy, dz).multiplyScalar(0.6));
        const to = new THREE.Vector3(dx, dy, dz).multiplyScalar(dist).add(_v2.set(ox, oy, oz));
        this.tracer(from, to, w, color);
      }
    } else if(k === 'hit'){
      const e = this.mons.get(ev[1]);
      if(e){
        e.flash = 1;
        const c = centre({type: e.type, x: e.d.x, y: e.d.y, z: e.d.z});
        this.parts.burst(_v1.set(c[0], c[1], c[2]), 8, 3, new THREE.Color(2.2, 1.4, 0.5), 0.12, 0.35);
      }
    } else if(k === 'poof'){
      const e = this.mons.get(ev[1]);
      const p = e ? (() => { const c = centre({type: e.type, x: e.d.x, y: e.d.y, z: e.d.z}); return new THREE.Vector3(c[0], c[1], c[2]); })() : new THREE.Vector3(ev[3], ev[4], ev[5]);
      this.poof(p, ev[2]);
      if(e) this.remove(ev[1], e);
    } else if(k === 'blast'){
      const p = new THREE.Vector3(ev[1], 0.4, ev[2]);
      this.parts.burst(p, 70, 7, new THREE.Color(3, 1.4, 0.4), 0.5, 0.9, true);
      this.parts.burst(p, 30, 3, new THREE.Color(0.6, 1.8, 0.4), 0.3, 1.0, true);
      this.puff(p, 6, new THREE.Color(0.25, 0.2, 0.15), 2.2, 1.2);
      this.blast.position.copy(p); this.blast.intensity = 60;
      this.sections[ev[3]].shake = 0.6;
    }
    if(this.onEvent) this.onEvent(ev);
  }

  /* ---------- effects ---------- */
  tracer(from, to, w, color){
    const b = this.beams.find(x => x.t <= 0) || this.beams[0];
    const c = w === 2 ? new THREE.Color(1.6, 1.8, 2.6) : new THREE.Color(2.4, 1.8, 0.9);
    b.set(from, to, c, w === 2 ? 0.03 : 0.018, w === 2 ? 0.16 : 0.06);
  }

  /* this phone's own shot, the moment the trigger goes */
  localShot(w, dirs, hitPoints){
    const g = this.guns[w];
    const muzzle = g.userData.muzzle.clone().applyMatrix4(g.matrixWorld);
    dirs.forEach((d, i) => {
      const to = hitPoints[i] || d.clone().multiplyScalar(WEAPONS[w].range * (w === 1 ? 0.5 : 1)).add(this.cam.position);
      this.tracer(muzzle, to, w, this.myColor);
      if(hitPoints[i]) this.parts.burst(hitPoints[i], 6, 3, new THREE.Color(2.4, 1.6, 0.6), 0.1, 0.3);
    });
    this.recoil = w === 2 ? 1 : w === 1 ? 0.9 : 0.5;
    this.muzzleFlash.visible = true;
    this.muzzleFlash.position.copy(g.position).add(g.userData.muzzle);
    const s = w === 1 ? 0.5 : w === 2 ? 0.4 : 0.25;
    this.muzzleFlash.scale.set(s, s, 1);
    this.flashT = 0.05;
    this.flashLight.position.copy(muzzle);
    this.flashLight.intensity = w === 1 ? 14 : 8;
  }

  poof(p, type){
    const cols = {pumpkin: [[3, 1.3, 0.2], [0.5, 1.6, 0.3]], skeleton: [[2.2, 2.1, 1.8], [1, 1, 1.1]], ghost: [[0.8, 1.6, 3], [2, 2.4, 3]],
      brute: [[0.7, 2.2, 0.5], [1.6, 1.4, 0.4]], bat: [[1.6, 0.5, 2.4], [2.6, 0.4, 0.5]], witch: [[0.7, 2.6, 0.4], [2, 0.6, 3]], bomb: [[3, 1.3, 0.2], [2, 2, 0.6]]}[type] || [[2, 2, 2], [1, 1, 1]];
    const big = type === 'witch' ? 3 : type === 'brute' ? 1.6 : 1;
    this.parts.burst(p, Math.round(40 * big), 4 * big, new THREE.Color(...cols[0]), 0.28 * big, 0.9, true);
    this.parts.burst(p, Math.round(26 * big), 2.5 * big, new THREE.Color(...cols[1]), 0.22 * big, 1.2, true);
    // sweets
    for(let i = 0; i < 14 * big; i++){
      const c = [[3, 0.4, 0.6], [3, 2.2, 0.3], [0.4, 2.6, 1], [0.6, 1.2, 3], [2.6, 0.6, 2.4]][i % 5];
      this.parts.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 5, Math.random() * 4 + 1, (Math.random() - 0.5) * 5, c[0], c[1], c[2], 0.09, 1.1, 0.8, 0);
    }
    const sm = {ghost: [0.5, 0.6, 0.8], witch: [0.3, 0.5, 0.25], pumpkin: [0.35, 0.25, 0.4], skeleton: [0.4, 0.4, 0.42]}[type] || [0.32, 0.25, 0.4];
    this.puff(p, Math.round(5 * big), new THREE.Color(...sm), 1.2 * big, 1.1);
    if(type === 'witch'){ this.blast.position.copy(p); this.blast.intensity = 120; this.blast.color.set(0x9cff40); }
  }
  puff(p, n, color, size, life){
    for(let i = 0; i < n; i++){
      const s = this.smoke.find(x => !x.visible) || this.smoke[0];
      s.visible = true;
      s.position.copy(p).add(_v1.set((Math.random() - 0.5) * 0.5, Math.random() * 0.4, (Math.random() - 0.5) * 0.5));
      s.material.color.copy(color);
      s.userData = {t: 0, life: life * (0.7 + Math.random() * 0.6), v: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8), s0: size * (0.6 + Math.random() * 0.6)};
    }
  }

  /* ---------- the phone ---------- */
  setView(q, x, z){
    this.cam.quaternion.copy(q);
    this.cam.position.set(x, EYE, z);
  }
  setWeapon(w){ if(w !== this.weapon){ this.weapon = w; this.swap = 1; } }
  setZoom(z){ if(z !== this.zoom){ this.zoom = z; this.applyFov(); } }

  /* What the crosshair is on, with the help each gun gives (as the host does). */
  pick(dir, w){
    const W = WEAPONS[w || 0];
    const o = this.cam.position;
    let best = null, bs = 1;
    for(const e of this.mons.values()){
      const c = centre({type: e.type, x: e.d.x, y: e.d.y, z: e.d.z});
      const vx = c[0] - o.x, vy = c[1] - (o.y - 0.1), vz = c[2] - o.z;
      const t = vx * dir.x + vy * dir.y + vz * dir.z;
      if(t <= 0 || t > W.range) continue;
      const miss = Math.hypot(vx - dir.x * t, vy - dir.y * t, vz - dir.z * t);
      const T = MONSTERS[e.type];
      const r = (T.r + (T.fly ? 0.15 : 0.25)) * W.assist * (this.zoom ? 0.8 : 1) + t * 0.006;
      const s = miss / r;
      if(s < bs){ bs = s; best = e; best.t = t; }
    }
    return best;
  }
  centreOf(e){ const c = centre({type: e.type, x: e.d.x, y: e.d.y, z: e.d.z}); return new THREE.Vector3(c[0], c[1], c[2]); }

  project(p){
    const v = _v1.copy(p).project(this.cam);
    const inFront = _v2.copy(p).sub(this.cam.position).dot(_v3.set(0, 0, -1).applyQuaternion(this.cam.quaternion)) > 0;
    return {x: (v.x + 1) / 2 * this.w, y: (1 - v.y) / 2 * this.h, front: inFront, on: inFront && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1};
  }
  screenDir(p){
    const v = _v1.copy(p).applyMatrix4(this.cam.matrixWorldInverse);
    return {x: v.x, y: -v.y, behind: v.z > 0};
  }

  /* ---------- every frame ---------- */
  render(){
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const t = this.time, ease = 1 - Math.exp(-dt * 12);
    this.mist.material.uniforms.uTime.value = t;
    for(const c of this.clouds){
      c.userData.a += c.userData.sp * dt;
      const el = c.userData.el;
      c.position.set(Math.sin(c.userData.a) * Math.cos(el) * 380, Math.sin(el) * 380, -Math.cos(c.userData.a) * Math.cos(el) * 380);
    }
    for(const l of this.lanterns){
      const f = 0.85 + 0.15 * Math.sin(t * 9 + l.ph) * Math.sin(t * 13.3 + l.ph * 2);
      l.light.intensity = 22 * f; l.sp.material.opacity = f;
    }
    for(const j of this.jacks) j.sp.material.opacity = 0.7 + 0.3 * Math.sin(t * 7 + j.ph) * Math.sin(t * 11 + j.ph);
    for(const w of this.wisps){
      const u = w.userData; u.a += u.sp * dt;
      w.position.set(Math.sin(u.a) * u.r, u.h + Math.sin(t * 1.3 + u.r) * 0.4, Math.cos(u.a) * u.r);
      w.material.opacity = 0.5 + 0.5 * Math.sin(t * 2 + u.r);
    }

    // the sections: planks fall away as a section weakens
    this.sections.forEach((sec, i) => {
      const hp = this.secs[i];
      const want = hp < 0 ? 0 : Math.max(1, Math.ceil(hp / 25));
      while(sec.shown > want){
        const p = sec.planks[--sec.shown];
        p.visible = false;
        this.dropPlank(p, SECTIONS[i]);
      }
      while(sec.shown < want){
        const p = sec.planks[sec.shown++];
        p.visible = true;
        this.parts.burst(p.getWorldPosition(_v1), 10, 1.5, new THREE.Color(1.6, 1.2, 0.6), 0.08, 0.5);
      }
      if(sec.shake > 0){
        sec.shake = Math.max(0, sec.shake - dt);
        const a = sec.shake * 0.06;
        sec.planks.forEach(p => { p.position.copy(p.userData.home); p.position.x += (Math.random() - 0.5) * a; p.position.y += (Math.random() - 0.5) * a; });
        if(Math.random() < dt * 20){
          const S = SECTIONS[i];
          this.parts.emit(S.mid[0] + S.n[0] * 0.1 + (Math.random() - 0.5) * 3, 0.4 + Math.random() * 0.8, S.mid[1] + S.n[1] * 0.1 + (Math.random() - 0.5) * 3,
            S.n[0] * 2 + (Math.random() - 0.5), 1 + Math.random(), S.n[1] * 2 + (Math.random() - 0.5), 0.8, 0.55, 0.3, 0.07, 0.5, 1, 0);
        }
      }
      const broken = hp < 0;
      sec.warn.material.opacity = broken ? 0.5 + 0.5 * Math.sin(t * 8) : hp < 30 ? 0.18 + 0.12 * Math.sin(t * 5) : 0;
      this.drawBar(sec.bar, hp, Math.floor(t * 3) % 2);
    });
    for(const d of this.debris){
      d.v.y -= 9.8 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.z += d.spin.z * dt;
      if(d.mesh.position.y < 0.05){ d.mesh.position.y = 0.05; d.v.set(0, 0, 0); d.spin.set(0, 0, 0); d.rest += dt; }
      if(d.rest > 4){ this.scene.remove(d.mesh); d.gone = true; }
    }
    this.debris = this.debris.filter(d => !d.gone);

    for(const e of this.mons.values()){
      const age = Math.min(0.25, (now - e.at) / 1000);
      e.d.lerp(_v1.copy(e.sv).multiplyScalar(age).add(e.sp), ease);
      const m = e.mesh, U = m.userData;
      m.position.copy(e.d);
      // turn the short way round
      let df = e.faceT - e.face;
      while(df > Math.PI) df -= Math.PI * 2;
      while(df < -Math.PI) df += Math.PI * 2;
      e.face += df * Math.min(1, dt * 8);
      m.rotation.y = e.face;
      const moving = e.sv.lengthSq() > 0.01, attacking = e.st === 1, climbing = e.st === 2;
      e.walk += dt * (moving ? Math.sqrt(e.sv.lengthSq()) * 3.2 : attacking ? 6 : 0);
      const L = U.limbs, sw = Math.sin(e.walk + e.ph);
      if(e.type === 'pumpkin' || e.type === 'skeleton' || e.type === 'brute'){
        const amp = e.type === 'brute' ? 0.45 : 0.6;
        if(L.legL){ L.legL.rotation.x = sw * amp * (moving ? 1 : 0.2); L.legR.rotation.x = -sw * amp * (moving ? 1 : 0.2); }
        if(attacking){
          // pounding on the planks
          const pound = Math.sin(t * 7 + e.ph);
          if(L.armL){ L.armL.rotation.x = -0.6 + pound * 0.7; L.armR.rotation.x = -0.6 - pound * 0.7; }
        } else if(L.armL){
          const base = e.type === 'brute' ? -0.1 : e.type === 'pumpkin' ? 0 : 0;
          L.armL.rotation.x = base - sw * 0.35; L.armR.rotation.x = base + sw * 0.35;
        }
        m.position.y += Math.abs(Math.cos(e.walk + e.ph)) * (e.type === 'brute' ? 0.07 : 0.05);
        if(L.head) L.head.rotation.z = Math.sin(t * 1.7 + e.ph) * 0.12;
        if(L.jaw) L.jaw.position.y = -0.1 - Math.abs(Math.sin(t * 14 + e.ph)) * 0.04;
        if(climbing){ m.rotation.x = -0.35; m.position.y += 0.35; } else m.rotation.x = 0;
      } else if(e.type === 'ghost'){
        U.body.scale.set(1 + Math.sin(t * 3 + e.ph) * 0.04, 1, 1 + Math.cos(t * 3 + e.ph) * 0.04);
        if(L.armL){ L.armL.rotation.z = -1.2 + Math.sin(t * 2.2 + e.ph) * 0.3; L.armR.rotation.z = 1.2 - Math.sin(t * 2.2 + e.ph) * 0.3; }
        m.rotation.z = Math.sin(t * 1.4 + e.ph) * 0.08;
        if(Math.random() < dt * 8) this.parts.emit(e.d.x, e.d.y + 0.2, e.d.z, 0, 0.3, 0, 0.4, 0.7, 1.4, 0.35, 1.2, 0.5, 1);
      } else if(e.type === 'bat'){
        const f = Math.sin(t * 22 + e.ph);
        L.armL.rotation.z = f * 0.9; L.armR.rotation.z = -f * 0.9;
      } else if(e.type === 'witch'){
        m.rotation.z = Math.sin(t * 0.9) * 0.25;
        L.armL.rotation.x = Math.PI / 2.4 + Math.sin(t * 3) * 0.1;
        if(Math.random() < dt * 30) this.parts.emit(e.d.x, e.d.y, e.d.z, (Math.random() - 0.5), -0.4, (Math.random() - 0.5), 0.6, 2.4, 0.4, 0.22, 1.2, 0.6, 0.5);
      } else if(e.type === 'bomb'){
        m.rotation.x += dt * 5; m.rotation.z += dt * 3;
        if(Math.random() < dt * 30) this.parts.emit(e.d.x, e.d.y + 0.2, e.d.z, (Math.random() - 0.5), 0.5, (Math.random() - 0.5), 3, 2, 0.6, 0.08, 0.4, 1, 0);
      }
      if(U.glow && e.type !== 'witch') U.glow.material.opacity = 0.75 + 0.25 * Math.sin(t * 8 + e.ph);
      if(e.flash > 0){
        e.flash = Math.max(0, e.flash - dt * 6);
        for(const mt of U.flash) mt.emissive && mt.emissive.setRGB(e.flash * 1.4, e.flash * 1.2, e.flash);
      }
    }
    for(const a of this.avatars.values()){
      a.d.lerp(a.sp, ease);
      a.mesh.position.copy(a.d);
      if(a.aimT){
        a.aim.lerp(_v1.set(a.aimT[0], a.aimT[1], a.aimT[2]), 0.3).normalize();
        a.mesh.rotation.y = Math.atan2(-a.aim.x, -a.aim.z);
        a.mesh.userData.arm.rotation.x = a.rep ? -0.9 + Math.abs(Math.sin(t * 10)) * 0.8 : Math.asin(Math.max(-1, Math.min(1, a.aim.y)));
      }
    }
    // smoke
    for(const s of this.smoke){
      if(!s.visible) continue;
      const u = s.userData; u.t += dt;
      const k = u.t / u.life;
      if(k >= 1){ s.visible = false; continue; }
      s.position.addScaledVector(u.v, dt);
      const sz = u.s0 * (0.6 + k * 1.2);
      s.scale.set(sz, sz, 1);
      s.material.opacity = 0.75 * (1 - k);
    }
    for(const b of this.beams){
      if(b.t <= 0){ b.mesh.visible = false; continue; }
      b.t -= dt;
      b.mat.uniforms.uAlpha.value = Math.max(0, b.t / b.life);
      b.place(this.cam);
    }
    this.flashLight.intensity *= Math.exp(-dt * 30);
    this.blast.intensity *= Math.exp(-dt * 5);
    if(this.blast.intensity < 1) this.blast.color.set(0xff9a40);
    this.parts.update(dt);

    if(this.tv) this.updateTV(dt);
    else this.updateHands(dt);
    this.cam.updateMatrixWorld();
    if(this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.cam);
    this.adapt(dt);
  }

  dropPlank(p, S){
    const m = p.clone();
    p.getWorldPosition(m.position);
    p.getWorldQuaternion(m.quaternion);
    this.scene.add(m);
    this.debris.push({mesh: m, v: new THREE.Vector3(S.n[0] * 1.5 + (Math.random() - 0.5), 1.5, S.n[1] * 1.5 + (Math.random() - 0.5)),
      spin: new THREE.Vector3(Math.random() * 4, 0, Math.random() * 4), rest: 0});
    this.parts.burst(m.position, 16, 2.5, new THREE.Color(1.2, 0.8, 0.4), 0.1, 0.6);
  }

  updateHands(dt){
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.swap = Math.max(0, this.swap - dt * 4);
    this.guns.forEach((g, i) => {
      g.visible = i === this.weapon && !this.zoom;
      if(!g.visible) return;
      const bob = Math.sin(this.time * 2) * 0.004;
      // just inside the bottom right of whatever shape the screen is
      const hx = Math.tan(this.cam.fov * Math.PI / 360) * this.cam.aspect * 0.38;
      g.scale.setScalar(0.75);
      g.position.set(Math.min(0.17, hx * 0.6), -0.16 - this.swap * 0.25 + bob + this.recoil * 0.02, -0.42 + this.recoil * 0.06);
      g.rotation.set(this.recoil * 0.25 - this.swap * 0.6, 0.04, 0);
    });
    if(this.flashT > 0){ this.flashT -= dt; if(this.flashT <= 0) this.muzzleFlash.visible = false; }
  }

  updateTV(dt){
    // from behind and above the players, drifting a little
    const yaw = Math.sin(this.time * 0.05) * 0.22;
    const r = 25;
    this.cam.position.set(Math.sin(yaw) * r, 21, Math.cos(yaw) * r);
    this.cam.lookAt(0, 0, -2.5);
  }

  adapt(dt){
    this.frameTimes.push(dt);
    if(this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if(avg > 0.024 && this.dpr > 1){ this.dpr = Math.max(1, this.dpr - 0.25); this.resize(); }
    else if(avg > 0.03 && this.dpr <= 1 && this.composer) this.composer = null;
    else if(avg < 0.0135 && this.dpr < this.maxDpr){ this.dpr = Math.min(this.maxDpr, this.dpr + 0.25); this.resize(); }
  }
}
