/* Night Watch: Wagon - the trail, drawn.

   The cowboy game's renderer, for both kinds of screen, built on the same
   pieces as the others (world.js's particles, beams and glows). A phone is
   a first-person camera at its player's seat on the wagon (a grid of
   twelve, three across and four deep), turned
   by the phone's sensors; the TV looks over the wagon from behind and
   above, so left on the TV is left in the room.

   The wagon never moves: the West goes past it. Everything that belongs to
   the ground - rocks, cactus, canyon walls, mine timbers, the bridge - is a
   strip of scenery that scrolls towards the back and wraps round, at the
   wagon's speed, so a bandit's rock (which the simulation moves the same
   way) stays put on the ground.

   Fed snapshots from wsim.js through the host; foes are drawn where the
   last snapshot put them plus their velocity times its age, eased.

   No blood: a bandit who is shot loses his hat in a puff of dust. */
import * as THREE from 'three';
import {EffectComposer} from './lib/postprocessing/EffectComposer.js';
import {RenderPass} from './lib/postprocessing/RenderPass.js';
import {UnrealBloomPass} from './lib/postprocessing/UnrealBloomPass.js';
import {OutputPass} from './lib/postprocessing/OutputPass.js';
import {Particles, Beam, glowTex, canvasTex, textSprite, hot} from './world.js';
import {ENEMIES, ENEMY_LIST, STATES, STAGES, SPEED, EYE, BED, WAGON, COLORS, GUN, centre} from './wsim.js';
import * as M from './models.js';

/* Quaternius's CC0 models (web/models/, ASSETS.md), once loaded: name ->
   loaded model. Until then (or if one fails) everything is drawn the
   home-made way below, so the game never waits on them. */
const MODEL_NAMES = ['Horse', 'Horse_White', 'Revolver', 'Cactus_1', 'Cactus_2', 'Cactus_3', 'Cactus_4', 'Cactus_5',
  'Rock_1', 'Rock_2', 'Rock_3', 'Rock_4', 'Rock_5', 'Rock_6', 'Rock_7', 'DeadTree_1', 'DeadTree_2', 'Bush',
  'Barrel', 'Crate', 'Bones', 'Skull', 'TreeStump', 'WoodLog'];
const MOD = {};
let modelsAsked = null;
function askModels(){
  if(!modelsAsked) modelsAsked = M.preload(MODEL_NAMES).then(list => { MODEL_NAMES.forEach((n, i) => { if(list[i]) MOD[n] = list[i]; }); return MOD; });
  return modelsAsked;
}
const pickOf = names => { const have = names.filter(n => MOD[n]); return have.length ? MOD[have[Math.floor(Math.random() * have.length)]] : null; };
const ROCKS = ['Rock_1', 'Rock_2', 'Rock_3', 'Rock_4', 'Rock_5', 'Rock_6', 'Rock_7'];
/* the nature pack's rocks are grey granite: here they are red sandstone */
const SANDSTONE = new THREE.Color(0xc8774a);
function sandstone(obj, tint){
  M.ownMaterials(obj);
  for(const mt of M.materials(obj)) if(mt.color) mt.color.copy(tint || SANDSTONE);
  return obj;
}
/* A Quaternius horse, galloping. It faces +z in the file (glTF's way); here everything faces -z. */
const HORSE_H = 1.7, HORSE_BACK = 1.15;
function modelHorse(kind){
  const m = kind === 'white' ? MOD.Horse_White : MOD.Horse;
  if(!m) return null;
  const h = M.makeNow(m, {height: HORSE_H, rotY: Math.PI});
  if(kind === 'dark' || kind === 'pale'){
    M.ownMaterials(h);
    for(const mt of M.materials(h)) if(mt.color && /Main|Hair/.test(mt.name)) mt.color.multiplyScalar(kind === 'dark' ? 0.32 : 1.6);
  }
  h.userData.play('Gallop', 1.1);
  h.userData.mixer.update(Math.random() * 2);
  h.userData.flash = M.materials(h).filter(mt => mt.emissive);
  return h;
}
/* A rock of the size asked for, whatever shape the file's rock is. */
function boulder(m, w, h, d){
  const o = sandstone(M.makeNow(m, {height: h}));
  o.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(o), sz = b.getSize(new THREE.Vector3());
  o.scale.set(w / sz.x, 1, d / sz.z);
  return o;
}
/* The revolver from Quaternius's survival pack: barrel along +x in the file. */
function modelRevolver(len){
  if(!MOD.Revolver) return null;
  const g = M.makeNow(MOD.Revolver, {width: len, rotY: Math.PI / 2});
  g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g);
  g.position.y = -(b.min.y + b.max.y) / 2;
  g.userData.muzzle = new THREE.Vector3(0, g.position.y + b.max.y - (b.max.y - b.min.y) * 0.18, b.min.z);
  g.userData.cyl = new THREE.Object3D();
  return g;
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _gunHome = new THREE.Vector3(0.17, -0.17, -0.34);
const ST = n => STATES[n] || 'ride';

/* ---------- materials and shapes ---------- */
function mat(color, rough, metal, extra){ return new THREE.MeshStandardMaterial(Object.assign({color, roughness: rough == null ? 0.85 : rough, metalness: metal || 0}, extra || {})); }
function pivot(parent, x, y, z){ const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); parent.add(g); return g; }
function part(parent, geo, m, x, y, z, rx, ry, rz){
  const o = new THREE.Mesh(geo, m);
  o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0);
  parent.add(o); return o;
}
function tex(size, draw, rx, ry){
  const t = canvasTex(size, draw);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if(rx) t.repeat.set(rx, ry || rx);
  t.anisotropy = 4;
  return t;
}
/* a lumpy rock: an icosahedron pushed about */
function rockGeo(r, seed, flat){
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.attributes.position;
  let s = seed || 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const bumps = [];
  for(let i = 0; i < 6; i++) bumps.push([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, 0.15 + rnd() * 0.25]);
  for(let i = 0; i < p.count; i++){
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    let k = 1;
    for(const b of bumps) k += b[3] * Math.max(0, v.x * b[0] + v.y * b[1] + v.z * b[2]) ** 3;
    p.setXYZ(i, v.x * r * k, Math.max(-0.2 * r, v.y * r * k * (flat || 0.75)), v.z * r * k);
  }
  g.computeVertexNormals();
  return g;
}

/* ---------- textures, drawn once ---------- */
function sandTex(base, speck){
  return tex(256, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for(let i = 0; i < 9000; i++){
      const v = Math.random();
      g.fillStyle = v < 0.5 ? `rgba(255,240,210,${Math.random() * 0.12})` : `rgba(${speck},${Math.random() * 0.16})`;
      g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    for(let i = 0; i < 30; i++){
      g.fillStyle = `rgba(${speck},${0.05 + Math.random() * 0.08})`;
      g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, 10 + Math.random() * 30, 5 + Math.random() * 14, Math.random() * 3, 0, Math.PI * 2); g.fill();
    }
  });
}
function trailTex(){
  // the wagon road: two worn ruts in packed dirt
  return tex(256, (g, s) => {
    g.fillStyle = '#b08a5e'; g.fillRect(0, 0, s, s);
    for(let i = 0; i < 6000; i++){ g.fillStyle = `rgba(${Math.random() < 0.5 ? '80,55,30' : '230,200,160'},${Math.random() * 0.15})`; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
    for(const x of [0.27, 0.73]){
      const gr = g.createLinearGradient(s * (x - 0.08), 0, s * (x + 0.08), 0);
      gr.addColorStop(0, 'rgba(70,45,25,0)'); gr.addColorStop(0.5, 'rgba(70,45,25,0.45)'); gr.addColorStop(1, 'rgba(70,45,25,0)');
      g.fillStyle = gr; g.fillRect(s * (x - 0.08), 0, s * 0.16, s);
    }
    const edge = g.createLinearGradient(0, 0, s, 0);
    edge.addColorStop(0, 'rgba(0,0,0,0.25)'); edge.addColorStop(0.12, 'rgba(0,0,0,0)'); edge.addColorStop(0.88, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = edge; g.fillRect(0, 0, s, s);
  });
}
function strataTex(){
  // canyon rock in bands
  return tex(256, (g, s) => {
    for(let y = 0; y < s; y += 2){
      const k = Math.sin(y * 0.11) * 0.5 + Math.sin(y * 0.031 + 1) * 0.5;
      const r = 160 + k * 40, gg = 86 + k * 26, b = 54 + k * 18;
      g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`; g.fillRect(0, y, s, 2);
    }
    for(let i = 0; i < 3000; i++){ g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,20,10' : '255,220,190'},${Math.random() * 0.12})`; g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 6, 1 + Math.random() * 2); }
    for(let i = 0; i < 40; i++){ g.strokeStyle = 'rgba(60,30,15,0.25)'; g.lineWidth = 1; g.beginPath(); const x = Math.random() * s; g.moveTo(x, 0); g.lineTo(x + (Math.random() - 0.5) * 30, s); g.stroke(); }
  });
}
function plankTex(){
  return tex(256, (g, s) => {
    for(let i = 0; i < 8; i++){
      const shade = 95 + Math.random() * 35;
      g.fillStyle = `rgb(${shade | 0},${shade * 0.68 | 0},${shade * 0.42 | 0})`;
      g.fillRect(0, i * 32, s, 32);
      g.fillStyle = 'rgba(25,14,6,0.85)'; g.fillRect(0, i * 32, s, 2);
      for(let k = 0; k < 14; k++){ g.fillStyle = 'rgba(40,22,10,0.25)'; g.fillRect(Math.random() * s, i * 32 + 4 + Math.random() * 24, 20 + Math.random() * 80, 1); }
      g.fillStyle = 'rgba(30,30,30,0.7)'; g.fillRect(6, i * 32 + 14, 3, 3); g.fillRect(s - 10, i * 32 + 14, 3, 3);
    }
  });
}
function canvasClothTex(){
  return tex(128, (g, s) => {
    g.fillStyle = '#e8dcc0'; g.fillRect(0, 0, s, s);
    for(let i = 0; i < s; i += 3){ g.fillStyle = 'rgba(120,100,70,0.08)'; g.fillRect(i, 0, 1, s); g.fillRect(0, i, s, 1); }
    for(let i = 0; i < 12; i++){ g.fillStyle = 'rgba(140,110,70,0.12)'; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 4 + Math.random() * 12, 0, 7); g.fill(); }
  });
}
function stripeTex(){
  // the balloon: red and gold gores, patched
  return tex(256, (g, s) => {
    for(let i = 0; i < 8; i++){ g.fillStyle = i % 2 ? '#d9a33a' : '#b8282a'; g.fillRect(i * s / 8, 0, s / 8, s); }
    for(let i = 0; i < 7; i++){
      const x = Math.random() * s, y = s * 0.2 + Math.random() * s * 0.5;
      g.fillStyle = ['#5a4a7a', '#4a6a3a', '#8a6a4a'][i % 3]; g.fillRect(x, y, 22, 18);
      g.strokeStyle = '#222'; g.setLineDash([3, 3]); g.strokeRect(x, y, 22, 18); g.setLineDash([]);
    }
  });
}
function crateTex(){
  return canvasTex(128, (g, s) => {
    g.fillStyle = '#9a6a3a'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#5a3a1a'; g.lineWidth = 8; g.strokeRect(4, 4, s - 8, s - 8);
    g.beginPath(); g.moveTo(8, 8); g.lineTo(s - 8, s - 8); g.stroke();
    g.fillStyle = '#fff'; g.fillRect(s / 2 - 22, s / 2 - 8, 44, 16); g.fillRect(s / 2 - 8, s / 2 - 22, 16, 44);
    g.fillStyle = '#d02020'; g.fillRect(s / 2 - 18, s / 2 - 5, 36, 10); g.fillRect(s / 2 - 5, s / 2 - 18, 10, 36);
  });
}
function wantedTex(){
  // a little wanted poster for the post at the trailside
  return canvasTex(128, (g, s) => {
    g.fillStyle = '#e6d2a0'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#3a2410'; g.font = '900 22px serif'; g.textAlign = 'center';
    g.fillText('WANTED', s / 2, 26);
    g.fillStyle = '#7a5a3a'; g.fillRect(34, 34, 60, 54);
    g.fillStyle = '#3a2410'; g.font = '700 14px serif'; g.fillText('$500', s / 2, 110);
  });
}

/* ---------- the sky: a gradient, the sun, a haze at the horizon ---------- */
const SKY_FRAG = `
varying vec3 vDir;
uniform vec3 uTop, uHor, uSun, uSunCol;
uniform float uStars;
float h(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
void main(){
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHor, uTop, pow(max(up, 0.0), 0.55));
  if(up < 0.0) col = uHor * (1.0 + up * 1.5);
  float s = max(0.0, dot(d, uSun));
  col += uSunCol * (pow(s, 8.0) * 0.25 + pow(s, 64.0) * 0.6) + uSunCol * smoothstep(0.9993, 0.9997, s) * 4.0;
  vec3 c = floor(d * 300.0);
  float st = step(0.998, h(c)) * uStars * smoothstep(0.05, 0.4, up);
  col += vec3(st);
  gl_FragColor = vec4(col, 1.0);
}`;

/* Each stage's light, sky and ground. lap > 0 rides at dusk. */
const SETS = {
  flats:  {top: 0x3f86d0, hor: 0xf3d6a2, sun: [0.35, 0.62, -0.7], sunCol: 0xfff0d0, fog: 0xe9cf9e, fogD: 0.0048, ground: '#d4ad74', speck: '120,80,40', groundCol: 0xffffff, amb: 1.0},
  canyon: {top: 0x3a78c0, hor: 0xf0b88a, sun: [0.55, 0.5, -0.65], sunCol: 0xffe2c0, fog: 0xdca37a, fogD: 0.0075, ground: '#c98a5a', speck: '110,50,25', groundCol: 0xffffff, amb: 0.95},
  gulch:  {top: 0x7896b0, hor: 0xd6c09a, sun: [-0.4, 0.55, -0.7], sunCol: 0xfff0d8, fog: 0xc9b38f, fogD: 0.011, ground: '#b39a78', speck: '90,70,50', groundCol: 0xffffff, amb: 0.9},
  mine:   {top: 0x0b0806, hor: 0x120c08, sun: [0, 1, 0], sunCol: 0x000000, fog: 0x0e0906, fogD: 0.045, ground: '#5a4636', speck: '30,20,10', groundCol: 0xaaaaaa, amb: 0.22},
  gorge:  {top: 0x386cb0, hor: 0xf4c48c, sun: [-0.5, 0.35, -0.8], sunCol: 0xffd8a0, fog: 0xe2b88c, fogD: 0.004, ground: '#c49064', speck: '100,55,30', groundCol: 0xffffff, amb: 0.95},
  pass:   {top: 0x283a78, hor: 0xff8a4a, sun: [0.1, 0.1, -1], sunCol: 0xff9a50, fog: 0xd8784c, fogD: 0.0065, ground: '#b86a48', speck: '90,35,20', groundCol: 0xffffff, amb: 0.8},
};

/* ---------- the people of the West ---------- */
const SKIN = [0xc8946a, 0xa87250, 0xd8a880, 0x8a5a3a];
function buildHat(color, wide){
  const g = new THREE.Group();
  const m = mat(color, 0.9);
  part(g, new THREE.CylinderGeometry(wide ? 0.27 : 0.22, wide ? 0.27 : 0.22, 0.02, 20), m, 0, 0, 0);
  const crown = part(g, new THREE.CylinderGeometry(0.11, 0.13, 0.15, 14), m, 0, 0.08, 0);
  crown.scale.z = 0.85;
  part(g, new THREE.CylinderGeometry(0.135, 0.135, 0.03, 14), mat(0x2a1a10), 0, 0.02, 0);
  return g;
}
function buildRevolver(scale){
  const real = modelRevolver(0.26 * (scale || 1));
  if(real) return real;
  const g = new THREE.Group();
  const steel = mat(0x4a4e56, 0.45, 0.6), dark = mat(0x22242a, 0.6, 0.4), grip = mat(0x6a3a1a, 0.55);
  part(g, new THREE.CylinderGeometry(0.011, 0.011, 0.19, 10), steel, 0, 0.012, -0.12, Math.PI / 2);
  part(g, new THREE.BoxGeometry(0.018, 0.012, 0.19), steel, 0, 0.026, -0.12);
  const cyl = part(g, new THREE.CylinderGeometry(0.03, 0.03, 0.055, 6), steel, 0, 0.008, -0.005, Math.PI / 2);
  part(g, new THREE.BoxGeometry(0.03, 0.05, 0.09), dark, 0, 0.0, 0.035);
  part(g, new THREE.BoxGeometry(0.028, 0.1, 0.045), grip, 0, -0.06, 0.07, -0.35);
  part(g, new THREE.TorusGeometry(0.02, 0.004, 6, 12, Math.PI), dark, 0, -0.03, 0.02, 0, Math.PI / 2);
  part(g, new THREE.BoxGeometry(0.01, 0.025, 0.012), dark, 0, 0.04, 0.07, -0.5);
  g.userData.muzzle = new THREE.Vector3(0, 0.012, -0.22);
  g.userData.cyl = cyl;
  if(scale) g.scale.setScalar(scale);
  return g;
}
/* an outlaw: duster coat, bandana, hat. Pivot at his feet. */
function buildOutlaw(opts){
  const g = new THREE.Group();
  const coat = mat(opts.coat || 0x5a4430), shirt = mat(opts.shirt || 0x8a2a20), pants = mat(0x3a3028);
  const skin = mat(SKIN[(opts.seed || 0) % SKIN.length], 0.7), band = mat(opts.band || 0xb02020);
  const U = g.userData = {flash: [coat, shirt, pants, band], limbs: {}};
  const legs = [];
  for(const s of [-1, 1]){ const leg = pivot(g, s * 0.1, 0.85, 0); part(leg, new THREE.CylinderGeometry(0.07, 0.06, 0.85, 8), pants, 0, -0.42, 0); part(leg, new THREE.BoxGeometry(0.11, 0.1, 0.22), mat(0x2a1a10), 0, -0.82, -0.04); legs.push(leg); }
  part(g, new THREE.CylinderGeometry(0.2, 0.27, 0.75, 10), coat, 0, 1.18, 0);        // the duster
  part(g, new THREE.CylinderGeometry(0.16, 0.19, 0.5, 10), shirt, 0, 1.3, -0.04);
  const head = pivot(g, 0, 1.68, 0);
  part(head, new THREE.SphereGeometry(0.14, 14, 10), skin, 0, 0, 0);
  part(head, new THREE.ConeGeometry(0.15, 0.16, 12, 1, true), band, 0, -0.06, -0.02, Math.PI);   // bandana over the face
  part(head, new THREE.BoxGeometry(0.16, 0.03, 0.04), mat(0x101010), 0, 0.03, -0.12);            // eyes in shadow
  const hat = buildHat(opts.hat || 0x2a2018, true);
  hat.position.y = 0.11; head.add(hat);
  U.hat = hat; U.head = head;
  const arms = [];
  for(const s of [-1, 1]){
    const arm = pivot(g, s * 0.25, 1.45, 0);
    part(arm, new THREE.CylinderGeometry(0.06, 0.055, 0.55, 8), coat, 0, -0.27, 0);
    part(arm, new THREE.SphereGeometry(0.05, 8, 6), skin, 0, -0.56, 0);
    arms.push(arm);
  }
  U.limbs = {legs, arms};
  if(opts.gun !== false){
    const gun = buildRevolver(2.2);
    gun.position.set(0, -0.55, -0.06); gun.rotation.x = Math.PI / 2;
    arms[1].add(gun); U.gun = gun;
  }
  if(opts.dynamite){
    const stick = new THREE.Group();
    part(stick, new THREE.CylinderGeometry(0.035, 0.035, 0.24, 8), mat(0xc02018, 0.6), 0, 0, 0);
    stick.position.set(0, -0.62, 0); arms[1].add(stick);
    U.stick = stick;
  }
  return g;
}
function buildHorse(color){
  const g = new THREE.Group();
  const hide = mat(color || 0x6a4026, 0.75), dark = mat(0x1a1410), mane = mat(0x2a1a10);
  const U = g.userData = {flash: [hide], legs: []};
  const body = part(g, new THREE.CapsuleGeometry(0.33, 1.15, 4, 12), hide, 0, 1.35, 0, Math.PI / 2);
  const neck = pivot(g, 0, 1.55, -0.65);
  part(neck, new THREE.CylinderGeometry(0.16, 0.24, 0.8, 10), hide, 0, 0.3, -0.18, -0.6);
  const head = part(neck, new THREE.BoxGeometry(0.2, 0.22, 0.55), hide, 0, 0.62, -0.52, 0.35);
  part(neck, new THREE.BoxGeometry(0.06, 0.4, 0.5), mane, 0, 0.42, -0.08, -0.6);
  part(head, new THREE.ConeGeometry(0.05, 0.12, 6), hide, 0.07, 0.15, 0.15);
  part(head, new THREE.ConeGeometry(0.05, 0.12, 6), hide, -0.07, 0.15, 0.15);
  U.neck = neck;
  for(const [x, z] of [[-0.2, -0.6], [0.2, -0.6], [-0.2, 0.6], [0.2, 0.6]]){
    const leg = pivot(g, x, 1.15, z);
    part(leg, new THREE.CylinderGeometry(0.07, 0.05, 1.1, 8), hide, 0, -0.55, 0);
    part(leg, new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), dark, 0, -1.1, 0);
    U.legs.push(leg);
  }
  const tail = pivot(g, 0, 1.5, 0.85);
  part(tail, new THREE.CylinderGeometry(0.04, 0.09, 0.7, 6), mane, 0, -0.3, 0.12, 0.4);
  U.tail = tail;
  return g;
}
/* gallop: legs in pairs, the body bobbing */
function gallop(h, t, k){
  const U = h.userData;
  U.legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 11 + (i < 2 ? 0 : 1.9) + (i % 2) * 0.5) * 0.65 * k; });
  if(U.neck) U.neck.rotation.x = Math.sin(t * 11) * 0.12 * k;
  if(U.tail) U.tail.rotation.x = 0.3 + Math.sin(t * 11 + 1) * 0.2 * k;
}

function buildFoe(type, T){
  const g = new THREE.Group();
  let U = g.userData = {flash: [], type};
  const glow = (color, size, parent, x, y, z) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: T.glow, color: hot(color, 1.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
    sp.scale.set(size, size, 1); sp.position.set(x, y, z); (parent || g).add(sp); return sp;
  };
  if(type === 'bandit' || type === 'thrower'){
    // his rock, and him behind it: he rises to shoot, ducks to hide
    let rock;
    const rm = pickOf(ROCKS);
    if(rm){ rock = boulder(rm, 2.1, 1.45, 1.3); rock.position.y = -0.08; g.add(rock); }
    else { rock = part(g, rockGeo(1.1, 7 + Math.floor(Math.random() * 50), 0.85), T.rockMat, 0, 0.35, 0); rock.scale.set(1.25, 1, 0.9); }
    const man = buildOutlaw({coat: type === 'thrower' ? 0x3a3a48 : 0x5a4430, shirt: type === 'thrower' ? 0x405a80 : 0x8a2a20,
      dynamite: type === 'thrower', gun: type !== 'thrower', seed: Math.floor(Math.random() * 9)});
    const lift = pivot(g, 0, 0, 0.55);
    lift.add(man);
    U = Object.assign(g.userData, {flash: man.userData.flash, man, lift, rock, hat: man.userData.hat, arms: man.userData.limbs.arms});
    U.glint = glow(0xffe0a0, 0.6, man.userData.limbs.arms[1], 0, -0.9, -0.2);
    U.glint.visible = false;
    if(type === 'thrower'){ U.fuse = glow(0xffa030, 0.35, man.userData.stick, 0, 0.16, 0); }
  } else if(type === 'rider' || type === 'cart'){
    let mount;
    if(type === 'rider'){
      mount = modelHorse(['brown', 'dark', 'white', 'brown'][Math.floor(Math.random() * 4)]) || buildHorse([0x6a4026, 0x2a1e18, 0x9a7050, 0xd8d0c0][Math.floor(Math.random() * 4)]);
      g.add(mount);
    } else {
      mount = new THREE.Group();
      const iron = mat(0x4a4a4e, 0.5, 0.6), rust = mat(0x6a3a22, 0.8, 0.3);
      part(mount, new THREE.BoxGeometry(1.1, 0.7, 1.5), rust, 0, 0.75, 0);
      part(mount, new THREE.BoxGeometry(1.2, 0.08, 1.6), iron, 0, 1.12, 0);
      const wheels = [];
      for(const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) wheels.push(part(mount, new THREE.CylinderGeometry(0.22, 0.22, 0.08, 12), iron, x, 0.25, z, 0, 0, Math.PI / 2));
      mount.userData = {flash: [rust], wheels};
      g.add(mount);
    }
    const man = buildOutlaw({seed: Math.floor(Math.random() * 9), coat: type === 'cart' ? 0x4a3a2a : 0x5a4430});
    const real = !!mount.userData.mixer;
    man.position.set(0, type === 'rider' ? (real ? HORSE_BACK - 0.85 : 0.75) : 0.25, type === 'rider' ? (real ? 0.1 : 0.05) : 0.1);
    if(type === 'rider') man.userData.limbs.legs.forEach((l, i) => { l.rotation.z = (i ? 1 : -1) * 0.5; l.rotation.x = -0.4; });
    g.add(man);
    U = Object.assign(g.userData, {flash: man.userData.flash.concat(mount.userData.flash), man, mount, hat: man.userData.hat, arms: man.userData.limbs.arms});
    U.glint = glow(0xffe0a0, 0.6, man.userData.limbs.arms[1], 0, -0.9, -0.2);
    U.glint.visible = false;
  } else if(type === 'dynamite'){
    const red = mat(0xd02818, 0.5);
    for(const [x, z] of [[-0.05, 0], [0.05, 0], [0, 0.07]]) part(g, new THREE.CylinderGeometry(0.045, 0.045, 0.36, 10), red, x, 0, z);
    part(g, new THREE.TorusGeometry(0.08, 0.012, 6, 16), mat(0x8a7a5a), 0, 0, 0.02, Math.PI / 2);
    U.fuse = glow(0xffa030, 0.55, g, 0, 0.24, 0);
    U.flash = [red];
  } else if(type === 'vulture'){
    const body = mat(0x2a2224, 0.9), head = mat(0xc87a72, 0.7), ruff = mat(0xd8d0c0, 0.9);
    part(g, new THREE.CapsuleGeometry(0.2, 0.45, 4, 10), body, 0, 0, 0, Math.PI / 2);
    part(g, new THREE.SphereGeometry(0.13, 10, 8), ruff, 0, 0.05, -0.34);
    const hd = part(g, new THREE.SphereGeometry(0.09, 10, 8), head, 0, 0.12, -0.46);
    part(hd, new THREE.ConeGeometry(0.035, 0.12, 6), mat(0xe0d0a0), 0, -0.02, -0.1, -Math.PI / 2);
    const wings = [];
    for(const s of [-1, 1]){
      const w = pivot(g, s * 0.15, 0.06, -0.05);
      const wm = part(w, new THREE.BoxGeometry(1.0, 0.04, 0.42), body, s * 0.5, 0, 0);
      part(w, new THREE.BoxGeometry(0.4, 0.03, 0.3), body, s * 1.15, 0, 0.05, 0, s * 0.3, 0);
      wings.push(w);
    }
    part(g, new THREE.BoxGeometry(0.3, 0.03, 0.35), body, 0, 0, 0.42);
    U.wings = wings; U.flash = [body, head];
  } else if(type === 'bat'){
    const body = mat(0x1a1418, 0.9);
    part(g, new THREE.SphereGeometry(0.1, 8, 6), body, 0, 0, 0);
    const wings = [];
    for(const s of [-1, 1]){
      const w = pivot(g, s * 0.06, 0, 0);
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(s * 0.35, 0.12); sh.lineTo(s * 0.3, -0.02); sh.lineTo(s * 0.22, 0.02); sh.lineTo(s * 0.15, -0.05); sh.lineTo(0, -0.04);
      part(w, new THREE.ShapeGeometry(sh), new THREE.MeshStandardMaterial({color: 0x2a1e24, side: THREE.DoubleSide, roughness: 0.9}), 0, 0, 0, -Math.PI / 2);
      wings.push(w);
    }
    for(const s of [-1, 1]) glow(0xff4030, 0.08, g, s * 0.035, 0.03, -0.09);
    U.wings = wings; U.flash = [body];
  } else if(type === 'swinger'){
    // a rope bandit: on a rock pillar, rope in both hands, then a swing for the wagon
    const man = buildOutlaw({seed: Math.floor(Math.random() * 9), coat: 0x6a5040, gun: true});
    g.add(man);
    U = Object.assign(g.userData, {flash: man.userData.flash, man, hat: man.userData.hat, arms: man.userData.limbs.arms, legs: man.userData.limbs.legs});
  } else if(type === 'balloon'){
    const env = new THREE.SphereGeometry(4.2, 28, 20);
    const p = env.attributes.position;
    for(let i = 0; i < p.count; i++){ const y = p.getY(i); if(y < 0) p.setXYZ(i, p.getX(i) * (1 + y / 4.2 * 0.55), y * 1.2, p.getZ(i) * (1 + y / 4.2 * 0.55)); }
    env.computeVertexNormals();
    const cloth = mat(0xffffff, 0.8, 0, {map: T.stripes});
    const envelope = part(g, env, cloth, 0, 3.6, 0);
    const basket = part(g, new THREE.BoxGeometry(1.6, 1.0, 1.6), mat(0x8a6a3a, 0.9, 0, {map: T.wicker}), 0, -1.6, 0);
    const rope = mat(0x6a5a40);
    for(const [x, z] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]]){
      const l = part(g, new THREE.CylinderGeometry(0.02, 0.02, 3.0, 4), rope, x * 1.2, 0, z * 1.2);
      l.rotation.set(z * 0.18, 0, -x * 0.18);
    }
    for(let i = 0; i < 6; i++){ const a = i / 6 * Math.PI * 2; part(g, new THREE.SphereGeometry(0.17, 8, 6), mat(0xb8a070), Math.sin(a) * 0.85, -1.7, Math.cos(a) * 0.85); }
    // the Baron: top hat, big moustache
    const baron = new THREE.Group();
    part(baron, new THREE.CylinderGeometry(0.28, 0.32, 0.6, 12), mat(0x2a1a3a), 0, 0, 0);
    const hd = part(baron, new THREE.SphereGeometry(0.2, 14, 10), mat(0xd8a880, 0.7), 0, 0.48, 0);
    part(hd, new THREE.TorusGeometry(0.1, 0.035, 6, 12, Math.PI), mat(0x1a1010), 0, -0.05, -0.17, 0, 0, Math.PI);
    part(hd, new THREE.CylinderGeometry(0.17, 0.17, 0.36, 14), mat(0x111111), 0, 0.3, 0);
    part(hd, new THREE.CylinderGeometry(0.3, 0.3, 0.025, 16), mat(0x111111), 0, 0.13, 0);
    part(hd, new THREE.CylinderGeometry(0.175, 0.175, 0.06, 14), mat(0xb02020), 0, 0.17, 0);
    baron.position.set(0, -0.9, 0);
    g.add(baron);
    U.flame = glow(0xffa040, 1.6, g, 0, -0.5, 0);
    U.envelope = envelope; U.flash = [cloth]; U.baron = baron;
  } else if(type === 'crate'){
    if(MOD.Crate){
      g.add(M.makeNow(MOD.Crate, {height: 0.8}));
      const cross = new THREE.MeshBasicMaterial({color: 0xd02020});
      for(const r of [0, Math.PI / 2]) part(g, new THREE.BoxGeometry(0.42, 0.12, 0.02), cross, 0, 0.42, 0.42, 0, 0, r);
    } else part(g, new THREE.BoxGeometry(0.8, 0.8, 0.8), mat(0xffffff, 0.8, 0, {map: T.crate}), 0, 0.4, 0);
    U.beacon = glow(0x60ff80, 1.2, g, 0, 1.3, 0);
    U.flash = [];
  } else if(type === 'tumble'){
    const twig = new THREE.MeshStandardMaterial({color: 0x9a7a4a, roughness: 1, wireframe: true});
    part(g, new THREE.IcosahedronGeometry(0.55, 1), twig, 0, 0.55, 0);
    part(g, new THREE.IcosahedronGeometry(0.42, 1), twig, 0, 0.55, 0, 0.5, 0.3, 0);
    U.flash = [];
  }
  return g;
}

/* a friend on the bench: hat, coat in their colour */
function buildPartner(color, name, ghost){
  const g = new THREE.Group();
  const c = new THREE.Color(COLORS[color] || '#fff');
  const coat = new THREE.MeshStandardMaterial({color: c.clone().multiplyScalar(0.75), roughness: 0.7, emissive: c, emissiveIntensity: 0.1});
  part(g, new THREE.CylinderGeometry(0.2, 0.24, 0.62, 10), coat, 0, 0.36, 0);
  // what they sit on: a sack of flour on the wagon bed
  part(g, new THREE.CylinderGeometry(0.24, 0.27, 0.44, 10), mat(0xb8a078, 1), 0, -0.25, 0.05).scale.z = 0.8;
  for(const s of [-1, 1]) part(g, new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), mat(0x3a4a6a), s * 0.1, 0.05, -0.25, Math.PI / 2);
  const head = part(g, new THREE.SphereGeometry(0.14, 14, 10), mat(0xd8b090, 0.7), 0, 0.78, 0);
  const hat = buildHat(c.clone().multiplyScalar(0.55).getHex(), true);
  hat.position.y = 0.1; head.add(hat);
  const arm = pivot(g, 0.2, 0.6, 0);
  const gun = buildRevolver(1.2); gun.position.set(0, 0, -0.32); arm.add(gun);
  part(arm, new THREE.CylinderGeometry(0.06, 0.06, 0.32, 8), coat, 0, 0, -0.16, Math.PI / 2);
  g.userData.arm = arm;
  const tag = textSprite(name, COLORS[color], 0.14);
  tag.material.opacity = 0.75; tag.position.y = 1.25; g.add(tag);
  // on a phone, the person beside you is right beside you: see through them
  if(ghost) g.traverse(o => { if(o.isMesh){ o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false; } });
  return g;
}

/* ================================================================ */
export class Trail {
  constructor(canvas, opts){
    this.opts = opts;
    this.tv = opts.mode === 'tv';
    this.low = !!opts.low;
    this.canvas = canvas;
    this.myColor = -1;
    this.onEvent = null;
    this.foes = new Map();
    this.partners = new Map();
    this.time = 0; this.last = performance.now(); this.dist = 0;
    this.players = [];
    this.recoil = 0; this.spin = 0; this.hp = 100; this.hurtT = 0;
    this.frameTimes = [];
    this.pillars = [];
    this.set = null; this.stage = -1; this.lap = 0; this.fade = 0; this.phase = 'lobby';

    const r = this.renderer = new THREE.WebGLRenderer({canvas, antialias: !this.low, powerPreference: 'high-performance'});
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.maxDpr = Math.min(window.devicePixelRatio || 1, this.low ? 1.25 : 2);
    this.dpr = this.maxDpr;
    r.setPixelRatio(this.dpr);

    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xe9cf9e, 0.0065);
    this.baseFov = this.tv ? 50 : 70;
    this.cam = new THREE.PerspectiveCamera(this.baseFov, 1, 0.05, 1200);
    this.cam.rotation.order = 'YXZ';
    scene.add(this.cam);
    this.T = {glow: glowTex(), stripes: stripeTex(), crate: crateTex(),
      wicker: tex(64, (g, s) => { g.fillStyle = '#9a7a4a'; g.fillRect(0, 0, s, s); for(let i = 0; i < s; i += 6){ g.fillStyle = 'rgba(60,40,20,0.5)'; g.fillRect(0, i, s, 2); g.fillRect(i, 0, 1, s); } })};
    this.T.rockMat = mat(0xffffff, 0.95, 0, {map: strataTex()});
    this.T.rockMat.map.repeat.set(1, 1);

    this.sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
    this.sun.position.set(30, 50, -40);
    scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a6a4a, 1.0);
    scene.add(this.hemi);

    this.buildSky();
    this.buildGround();
    this.buildScenery();
    this.buildWagon();

    this.parts = new Particles(this.low ? 2000 : 4000);
    scene.add(this.parts.points);
    this.beams = [];
    for(let i = 0; i < 30; i++) this.beams.push(new Beam(scene));
    const smokeT = canvasTex(128, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
    this.smoke = [];
    for(let i = 0; i < 50; i++){
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: smokeT, transparent: true, depthWrite: false, opacity: 0}));
      sp.visible = false; sp.userData = {t: 0, life: 1, v: new THREE.Vector3(), s0: 1};
      scene.add(sp); this.smoke.push(sp);
    }
    // hats knocked off, tumbling away
    this.hats = [];
    this.blast = new THREE.PointLight(0xff9a40, 0, 20, 1.6);
    scene.add(this.blast);
    this.flashLight = new THREE.PointLight(0xffd090, 0, 8, 1.8);
    scene.add(this.flashLight);

    if(!this.tv){
      // the revolver in this player's hand
      this.gun = buildRevolver(1);
      this.gun.position.set(0.17, -0.17, -0.34);
      this.cam.add(this.gun);
      this.muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({map: this.T.glow, color: hot(0xffc060, 3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
      this.muzzleFlash.visible = false;
      this.cam.add(this.muzzleFlash);
      // a lantern for the mine, hung on the wagon - and a hand torch for the phone
      this.torch = new THREE.SpotLight(0xffe0b0, 0, 40, 0.5, 0.6, 1);
      this.torch.position.set(0, -0.1, -0.5);
      this.torch.target.position.set(0, -0.4, -10);
      this.cam.add(this.torch); this.cam.add(this.torch.target);
    }
    this.lantern = new THREE.PointLight(0xffb060, 0, 14, 1.5);
    this.lantern.position.set(0, BED + 2.6, -3.2);
    scene.add(this.lantern);

    this.composer = null;
    if(!this.low && !opts.noBloom){
      const c = this.composer = new EffectComposer(r);
      c.addPass(new RenderPass(scene, this.cam));
      c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.4, 0.9));
      c.addPass(new OutputPass());
    }
    this.resize();
    this._resize = () => this.resize();
    addEventListener('resize', this._resize);
    this.setStage(0, 0, true);
    askModels().then(() => this.useModels());
    if(this.tv){ this.cam.position.set(0, 7.5, 12); this.cam.lookAt(0, 1.5, -10); }
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
    this.cam.fov = this.baseFov;
    this.cam.updateProjectionMatrix();
    this.parts.mat && (this.parts.mat.uniforms.uScale.value = h * this.dpr / (2 * Math.tan(this.cam.fov * Math.PI / 360)));
    this.w = w; this.h = h;
  }

  /* ---------- the land ---------- */
  buildSky(){
    this.skyU = {uTop: {value: new THREE.Color()}, uHor: {value: new THREE.Color()}, uSun: {value: new THREE.Vector3(0, 1, 0)}, uSunCol: {value: new THREE.Color()}, uStars: {value: 0}};
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 40, 20), new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyU}));
    sky.renderOrder = -10;
    this.scene.add(sky);
    this.sky = sky;
    // far buttes and mesas, all round, in the haze
    const far = new THREE.Group();
    const fm = new THREE.MeshLambertMaterial({color: 0xb07050, fog: false});
    this.farMat = fm;
    for(let i = 0; i < 26; i++){
      const a = i / 26 * Math.PI * 2 + Math.random() * 0.15, r = 520 + Math.random() * 180;
      const w = 30 + Math.random() * 90, h = 25 + Math.random() * 70;
      const b = new THREE.Group();
      part(b, new THREE.BoxGeometry(w, h, w * 0.6), fm, 0, h / 2, 0);
      part(b, new THREE.CylinderGeometry(w * 0.45, w * 0.75, h * 0.35, 6), fm, 0, h * 0.17, 0);
      if(Math.random() < 0.4) part(b, new THREE.BoxGeometry(w * 0.2, h * 0.5, w * 0.2), fm, w * 0.6, h * 0.25, 0);
      b.position.set(Math.sin(a) * r, -5, -Math.cos(a) * r);
      b.rotation.y = -a;
      far.add(b);
    }
    this.scene.add(far);
    this.far = far;
  }

  buildGround(){
    this.groundTex = sandTex('#d4ad74', '120,80,40');
    this.groundTex.repeat.set(90, 90);
    const ground = this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), mat(0xffffff, 1, 0, {map: this.groundTex}));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    // the trail: a strip of road under the wagon
    this.trailTex = trailTex(); this.trailTex.repeat.set(1, 60);
    const road = this.road = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 600), mat(0xffffff, 1, 0, {map: this.trailTex, transparent: true, opacity: 0.95}));
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0.01, -200);
    this.scene.add(road);
  }

  /* Scenery that scrolls: each kind a set of pieces placed along z between
     -260 and +60, moved back at the wagon's speed and sent round again. */
  buildScenery(){
    this.strips = {};
    const S = this.strips;
    const LEN = 320, FROM = -260;
    const strip = (key, make, n, place) => {
      const g = new THREE.Group();
      const items = [];
      for(let i = 0; i < n; i++){
        const o = make(i);
        o.userData.z0 = FROM + (i + Math.random() * 0.8) * LEN / n;
        place(o, i);
        g.add(o); items.push(o);
      }
      g.visible = false;
      this.scene.add(g);
      S[key] = {g, items, LEN, FROM};
      return S[key];
    };
    const sideX = (a, b) => (Math.random() < 0.5 ? -1 : 1) * (a + Math.random() * (b - a));
    // cactus: saguaros with arms
    const cactusMat = mat(0x4a7a3a, 0.8), cactus = () => {
      const g = new THREE.Group();
      const h = 2.5 + Math.random() * 3;
      part(g, new THREE.CapsuleGeometry(0.25, h, 4, 8), cactusMat, 0, h / 2 + 0.2, 0);
      for(const s of [-1, 1]) if(Math.random() < 0.75){
        const y = h * (0.35 + Math.random() * 0.3), l = 0.6 + Math.random() * 1.0;
        part(g, new THREE.CapsuleGeometry(0.16, 0.5, 4, 6), cactusMat, s * 0.45, y, 0, 0, 0, Math.PI / 2);
        part(g, new THREE.CapsuleGeometry(0.16, l, 4, 6), cactusMat, s * 0.7, y + l / 2, 0);
      }
      return g;
    };
    strip('cactus', cactus, 40, o => { o.position.x = sideX(5, 60); o.rotation.y = Math.random() * 6; });
    const brushMat = mat(0x8a8a5a, 1), brush = () => { const g = new THREE.Group(); for(let i = 0; i < 3; i++) part(g, new THREE.IcosahedronGeometry(0.35 + Math.random() * 0.3, 0), brushMat, (Math.random() - 0.5) * 0.6, 0.25, (Math.random() - 0.5) * 0.6); return g; };
    strip('brush', brush, 70, o => { o.position.x = sideX(2.6, 50); });
    const rocks = () => { const g = new THREE.Group(); part(g, rockGeo(0.5 + Math.random() * 1.6, Math.floor(Math.random() * 1000)), this.T.rockMat, 0, 0.2, 0); return g; };
    strip('rocks', rocks, 40, o => { o.position.x = sideX(4, 40); o.rotation.y = Math.random() * 6; });
    // signposts and the odd wanted poster
    const postMat = mat(0x6a4a2a), wanted = new THREE.MeshBasicMaterial({map: wantedTex()});
    strip('posts', () => { const g = new THREE.Group(); part(g, new THREE.BoxGeometry(0.15, 2.2, 0.15), postMat, 0, 1.1, 0); part(g, new THREE.BoxGeometry(0.6, 0.6, 0.03), wanted, 0, 1.7, 0.09); return g; }, 4,
      o => { o.position.x = (Math.random() < 0.5 ? -1 : 1) * 3.4; o.rotation.y = o.position.x > 0 ? -Math.PI / 2 : Math.PI / 2; });
    // bones in the gulch
    const boneMat = mat(0xe8e0cc, 0.8);
    strip('bones', () => {
      const g = new THREE.Group();
      part(g, new THREE.SphereGeometry(0.28, 10, 8), boneMat, 0, 0.2, 0).scale.set(1, 0.8, 1.4);
      for(const s of [-1, 1]) part(g, new THREE.ConeGeometry(0.06, 0.6, 6), boneMat, s * 0.3, 0.35, -0.1, 0, 0, s * -1.1);
      for(let i = 0; i < 4; i++) part(g, new THREE.TorusGeometry(0.3, 0.03, 4, 10, Math.PI), boneMat, 0.8 + i * 0.18, 0.05, 0, 0, Math.PI / 2, 0);
      return g;
    }, 18, o => { o.position.x = sideX(3, 9); o.rotation.y = Math.random() * 6; });
    // the mine: timber frames and hanging lanterns
    const timber = mat(0x5a3c22, 0.9);
    this.mineLights = [];
    strip('timbers', i => {
      const g = new THREE.Group();
      for(const s of [-1, 1]) part(g, new THREE.BoxGeometry(0.35, 6.5, 0.35), timber, s * 4.4, 3.25, 0);
      part(g, new THREE.BoxGeometry(9.2, 0.4, 0.4), timber, 0, 6.3, 0);
      if(i % 2 === 0){
        const lamp = new THREE.Sprite(new THREE.SpriteMaterial({map: this.T.glow, color: hot(0xffa040, 2.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
        lamp.scale.set(1.3, 1.3, 1); lamp.position.set(i % 4 ? 3.9 : -3.9, 4.6, 0.3);
        g.add(lamp);
        part(g, new THREE.BoxGeometry(0.18, 0.28, 0.18), mat(0x2a2a2a, 0.6, 0.5), lamp.position.x, 4.6, 0.3);
        g.userData.lamp = lamp;
      }
      return g;
    }, 32, () => {});
    for(let i = 0; i < 4; i++){ const l = new THREE.PointLight(0xffa040, 0, 16, 1.6); this.scene.add(l); this.mineLights.push(l); }
    // the mine's rails, either side
    const railMat = mat(0x5a5a60, 0.4, 0.7), tieMat = mat(0x4a3220, 1);
    strip('rails', () => {
      const g = new THREE.Group();
      for(const s of [-1, 1]){
        part(g, new THREE.BoxGeometry(1.3, 0.1, 0.22), tieMat, s * 3.4, 0.05, 0);
        for(const r of [-0.45, 0.45]) part(g, new THREE.BoxGeometry(0.07, 0.1, 5.05), railMat, s * 3.4 + r, 0.12, 0);
      }
      return g;
    }, 64, () => {});
    // the bridge: deck, rails and trestle towers down into the gorge
    const deckTex = plankTex(); deckTex.repeat.set(1, 2);
    const deckMat = mat(0xffffff, 0.9, 0, {map: deckTex}), wood = mat(0x6a4a2a, 0.9);
    strip('bridge', i => {
      const g = new THREE.Group();
      part(g, new THREE.BoxGeometry(5.2, 0.25, 5.05), deckMat, 0, -0.12, 0);
      for(const s of [-1, 1]){
        part(g, new THREE.BoxGeometry(0.15, 1.1, 0.15), wood, s * 2.6, 0.55, 0);
        part(g, new THREE.BoxGeometry(0.1, 0.1, 5.05), wood, s * 2.6, 1.05, 0);
      }
      if(i % 3 === 0){
        for(const s of [-1, 1]) part(g, new THREE.BoxGeometry(0.4, 80, 0.4), wood, s * 2.2, -40, 0, 0, 0, s * 0.04);
        for(let k = 1; k < 8; k++){
          part(g, new THREE.BoxGeometry(4.8 + k * 0.5, 0.25, 0.25), wood, 0, -k * 9, 0);
          part(g, new THREE.BoxGeometry(0.2, 12.5, 0.2), wood, 0, -k * 9 + 4.5, 0, 0, 0, 0.75);
        }
      }
      return g;
    }, 64, () => {});
    // sandstone pillars standing up out of the gorge, beside the bridge
    strip('pillars', () => {
      const g = new THREE.Group();
      const h = 85 + Math.random() * 12, r = 1.2 + Math.random() * 1.2;
      part(g, new THREE.CylinderGeometry(r * 0.85, r * 1.3, h, 7), this.T.rockMat, 0, h / 2 - 80, 0);
      return g;
    }, 10, o => { o.position.x = (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 14); });
    // the walls: canyon, gulch, mine, gorge. Built once each, shown by stage.
    this.walls = {};
    for(const key of ['canyon', 'gulch', 'mine', 'gorge', 'pass']) this.walls[key] = this.buildWalls(key);
    // the gorge: the river far below
    const river = this.river = new THREE.Mesh(new THREE.PlaneGeometry(90, 1200), mat(0x4a7a9a, 0.3, 0.2, {emissive: 0x0a2030}));
    river.rotation.x = -Math.PI / 2; river.position.set(0, -78, -200); river.visible = false;
    this.scene.add(river);
    this.ceiling = new THREE.Mesh(new THREE.PlaneGeometry(10, 1200), mat(0x2a1e16, 1, 0, {map: sandTex('#3a2a1e', '10,5,0')}));
    this.ceiling.rotation.x = Math.PI / 2; this.ceiling.position.set(0, 6.6, -200); this.ceiling.visible = false;
    this.ceiling.material.map.repeat.set(2, 200);
    this.scene.add(this.ceiling);
  }

  /* A canyon wall: rock faces in 40 m segments, rough and banded, repeating
     seamlessly (the roughness repeats every segment), with the mesa top
     flat behind the rim. */
  buildWalls(key){
    const st = STAGES.find(s => s.key === key);
    const W = key === 'gorge' ? 48 : st.walls, H = key === 'mine' ? 6.6 : key === 'gorge' ? 90 : st.rim;
    const base = key === 'gorge' ? -80 : 0;
    const group = new THREE.Group();
    const segLen = 40, segs = 9;
    const tint = {canyon: 0xffffff, gulch: 0xc8c0b0, mine: 0x6a5a4a, gorge: 0xf0d0b8, pass: 0xffc0a0}[key];
    const m = mat(tint, 0.95, 0, {map: strataTex()});
    m.map.repeat.set(segLen / 20, H / 20);
    const geo = new THREE.PlaneGeometry(segLen, H, 40, Math.max(6, Math.round(H / 2)));
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for(let i = 0; i < p.count; i++){
      const x = p.getX(i), y = p.getY(i);
      const u = (x / segLen + 0.5) * Math.PI * 2, v = (y / H + 0.5);
      // periodic along the segment, so neighbours meet
      let d = Math.sin(u * 2 + 1) * 1.2 + Math.sin(u * 5 + v * 7) * 0.6 + Math.sin(u * 11 + v * 13) * 0.25 + Math.sin(u * 3) * Math.sin(v * 9) * 0.8;
      d *= key === 'mine' ? 0.4 : 1;
      let yy = y;
      if(v > 0.98 && key !== 'mine') yy += Math.sin(u * 3 + 2) * 1.2 + Math.sin(u * 7) * 0.6;   // a ragged rim
      p.setXYZ(i, x, yy, Math.max(0, d + 1.5) * (1 - Math.abs(v - 0.5) * 0.3) + (v > 0.92 && key !== 'mine' ? -(v - 0.92) * 20 : 0));
      uv.setXY(i, uv.getX(i), uv.getY(i));
    }
    geo.computeVertexNormals();
    const items = [];
    for(const s of [-1, 1]){
      for(let i = 0; i < segs; i++){
        const w = new THREE.Mesh(geo, m);
        // the face looks into the canyon
        w.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
        w.position.set(s * (W + 1.5), base + H / 2, 0);
        w.userData.z0 = -280 + i * segLen;
        group.add(w); items.push(w);
      }
      if(key !== 'mine' && key !== 'gorge'){
        const top = new THREE.Mesh(new THREE.PlaneGeometry(500, 1200), mat(tint, 1, 0, {map: sandTex('#b8805a', '90,40,20')}));
        top.material.map.repeat.set(40, 100);
        top.rotation.x = -Math.PI / 2; top.position.set(s * (W + 251.5), H - 0.3, -200);
        group.add(top);
      }
    }
    group.visible = false;
    this.scene.add(group);
    return {g: group, items, LEN: segLen * segs, FROM: -280};
  }

  buildWagon(){
    const g = this.wagon = new THREE.Group();
    const woodTex = plankTex(); woodTex.repeat.set(2, 2);
    const wood = mat(0xffffff, 0.85, 0, {map: woodTex}), dark = mat(0x4a3018, 0.9), iron = mat(0x3a3a3e, 0.5, 0.6);
    const L = WAGON.back - WAGON.front, hw = WAGON.hw;
    part(g, new THREE.BoxGeometry(hw * 2, 0.15, L), wood, 0, BED - 0.08, (WAGON.back + WAGON.front) / 2);
    for(const s of [-1, 1]) part(g, new THREE.BoxGeometry(0.08, 0.4, L), wood, s * hw, BED + 0.2, (WAGON.back + WAGON.front) / 2);
    part(g, new THREE.BoxGeometry(hw * 2, 0.4, 0.08), wood, 0, BED + 0.2, WAGON.back);
    part(g, new THREE.BoxGeometry(hw * 2, 0.45, 0.08), wood, 0, BED + 0.22, WAGON.front);
    // wheels
    this.wheels = [];
    const wheel = (x, z, r) => {
      const w = pivot(g, x, r, z);
      part(w, new THREE.TorusGeometry(r, 0.06, 6, 20), dark, 0, 0, 0, 0, Math.PI / 2, 0);
      part(w, new THREE.CylinderGeometry(0.12, 0.12, 0.2, 8), iron, 0, 0, 0, 0, 0, Math.PI / 2);
      for(let i = 0; i < 6; i++) part(w, new THREE.BoxGeometry(0.04, r * 2, 0.05), dark, 0, 0, 0, i * Math.PI / 6, 0, 0);
      w.userData.r = r;
      this.wheels.push(w);
    };
    for(const s of [-1, 1]){ wheel(s * (hw + 0.08), -1.6, 0.6); wheel(s * (hw + 0.08), 2.3, 0.8); }
    // cargo: crates, barrels and the gold
    const crateMat = mat(0x9a6a3a, 0.85), barrel = mat(0x7a4a28, 0.8), hoop = mat(0x3a3a3a, 0.5, 0.5);
    // behind the back row: what the gang is after
    const cargo = this.cargo = new THREE.Group();
    g.add(cargo);
    part(cargo, new THREE.BoxGeometry(0.8, 0.7, 0.7), crateMat, -0.75, BED + 0.35, 2.95);
    part(cargo, new THREE.BoxGeometry(0.7, 0.55, 0.6), crateMat, -0.7, BED + 0.97, 2.95, 0, 0.2, 0);
    for(const [x, z] of [[0.75, 2.95], [0.75, 2.35]]){
      part(cargo, new THREE.CylinderGeometry(0.3, 0.3, 0.8, 12), barrel, x, BED + 0.4, z);
      part(cargo, new THREE.TorusGeometry(0.3, 0.02, 4, 16), hoop, x, BED + 0.2, z, Math.PI / 2);
      part(cargo, new THREE.TorusGeometry(0.3, 0.02, 4, 16), hoop, x, BED + 0.6, z, Math.PI / 2);
    }
    const box = pivot(g, 0, BED + 0.25, 2.9);
    part(box, new THREE.BoxGeometry(0.7, 0.4, 0.45), mat(0x2a3a5a, 0.6, 0.3), 0, 0, 0);
    part(box, new THREE.BoxGeometry(0.72, 0.06, 0.47), mat(0xd8b040, 0.3, 0.8), 0, 0.12, 0);
    const gold = part(box, new THREE.BoxGeometry(0.12, 0.12, 0.05), new THREE.MeshBasicMaterial({color: hot(0xffc040, 1.2)}), 0, 0, -0.24);
    this.goldBox = box;
    // no driver: the reins are tied off to the front board
    // the team: four horses
    this.team = [];
    for(const [x, z] of [[-0.8, -5.2], [0.8, -5.2], [-0.8, -7.9], [0.8, -7.9]]){
      const h = buildHorse([0x7a4a2a, 0x5a3420, 0x8a5a3a, 0x3a2418][this.team.length]);
      h.position.set(x, 0, z);
      h.userData.ph = Math.random();
      g.add(h); this.team.push(h);
    }
    part(g, new THREE.BoxGeometry(0.12, 0.12, 6), dark, 0, 1.0, -5.4);     // the tongue
    // reins
    const rein = mat(0x3a2a1a);
    for(const s of [-1, 1]) part(g, new THREE.CylinderGeometry(0.012, 0.012, 3.6, 4), rein, s * 0.4, 1.5, -4.2, Math.PI / 2 - 0.08);
    this.scene.add(g);
  }

  /* ---------- the real models, once they have loaded ---------- */
  useModels(){
    // the team: four galloping horses in place of the home-made ones
    if(MOD.Horse){
      this.team = this.team.map((h, i) => {
        const real = modelHorse(['brown', 'dark', 'brown', 'pale'][i]);
        if(!real) return h;
        real.position.copy(h.position);
        real.userData.ph = h.userData.ph;
        this.wagon.remove(h); this.wagon.add(real);
        return real;
      });
    }
    // what is going by
    const refill = (key, make) => {
      const st = this.strips[key];
      if(!st) return;
      for(const o of st.items){
        const m = make();
        if(!m) return;
        o.clear(); o.add(m);
      }
    };
    refill('cactus', () => { const m = pickOf(['Cactus_2', 'Cactus_3', 'Cactus_4', 'Cactus_5', 'Cactus_3']); return m && M.makeNow(m, {height: 2.2 + Math.random() * 3.2}); });
    refill('rocks', () => { const m = pickOf(ROCKS); return m && sandstone(M.makeNow(m, {height: 0.6 + Math.random() * 2.2})); });
    const sage = new THREE.Color(0x9aa070);
    refill('brush', () => MOD.Bush && sandstone(M.makeNow(MOD.Bush, {height: 0.4 + Math.random() * 0.5}), sage));
    refill('bones', () => { const m = pickOf(['Bones', 'Skull', 'Bones']); return m && M.makeNow(m, {height: m === MOD.Skull ? 0.35 : 0.3}); });
    // dead trees: the gulch, the flats and the pass
    if(MOD.DeadTree_1 || MOD.DeadTree_2){
      const g = new THREE.Group(), items = [], LEN = 320, FROM = -260, n = 16;
      for(let i = 0; i < n; i++){
        const o = new THREE.Group();
        const m = pickOf(['DeadTree_1', 'DeadTree_2', 'TreeStump']);
        o.add(M.makeNow(m, {height: m === MOD.TreeStump ? 0.7 : 3 + Math.random() * 3}));
        o.userData.z0 = FROM + (i + Math.random() * 0.8) * LEN / n;
        o.position.x = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 30);
        o.rotation.y = Math.random() * 6;
        g.add(o); items.push(o);
      }
      this.scene.add(g);
      this.strips.trees = {g, items, LEN, FROM};
    }
    // the cargo: real crates and barrels
    if(MOD.Crate && MOD.Barrel){
      this.cargo.clear();
      const put = (name, h, x, y, z, ry) => { const o = M.makeNow(MOD[name], {height: h}); o.position.set(x, y, z); o.rotation.y = ry || 0; this.cargo.add(o); };
      put('Crate', 0.7, -0.75, BED, 2.95); put('Crate', 0.55, -0.7, BED + 0.7, 2.95, 0.3);
      put('Barrel', 0.85, 0.75, BED, 2.95); put('Barrel', 0.85, 0.75, BED, 2.35, 1);
    }
    // the gun in this player's hand
    if(this.gun && MOD.Revolver){
      const real = modelRevolver(0.2);
      this.cam.remove(this.gun);
      this.gun = real; this.gun.position.set(0.17, -0.17, -0.34);
      this.gunHome = new THREE.Vector3(0.19, -0.2, -0.4);
      this.cam.add(this.gun);
    }
    // show what this stage shows
    const k = this.stage, l = this.lap;
    this.stage = -1; this.setStage(k, l, true);
  }

  /* ---------- the stage: which scenery, which sky ---------- */
  setStage(i, lap, now){
    if(i === this.stage && lap === this.lap) return;
    const st = STAGES[i] || STAGES[0], P = SETS[st.key];
    this.stage = i; this.lap = lap;
    const dusk = lap > 0 ? Math.min(1, 0.55 + 0.15 * (lap - 1)) : 0;
    const top = new THREE.Color(P.top), hor = new THREE.Color(P.hor), sunCol = new THREE.Color(P.sunCol), fog = new THREE.Color(P.fog);
    if(dusk && st.key !== 'mine'){
      top.lerp(new THREE.Color(0x141838), dusk); hor.lerp(new THREE.Color(0xc0604a), dusk * 0.8);
      sunCol.lerp(new THREE.Color(0xff7040), dusk); fog.lerp(new THREE.Color(0x6a4050), dusk * 0.8);
    }
    this.skyU.uTop.value.copy(top); this.skyU.uHor.value.copy(hor); this.skyU.uSunCol.value.copy(sunCol);
    const sd = new THREE.Vector3(...P.sun).normalize();
    if(dusk) sd.y = Math.max(0.04, sd.y * (1 - dusk * 0.8));
    this.skyU.uSun.value.copy(sd.normalize());
    this.skyU.uStars.value = dusk * 0.8;
    this.scene.fog.color.copy(fog); this.scene.fog.density = P.fogD * (this.tv ? 0.85 : 1);
    this.renderer.setClearColor(fog);
    this.sun.position.copy(sd).multiplyScalar(100);
    this.sun.color.copy(sunCol.clone().lerp(new THREE.Color(0xffffff), 0.4));
    this.sun.intensity = st.key === 'mine' ? 0 : 2.4 * (1 - dusk * 0.45);
    this.hemi.intensity = P.amb * (1 - dusk * 0.35);
    this.hemi.color.set(st.key === 'mine' ? 0x403020 : 0xbfd8ff);
    this.farMat.color.copy(hor).lerp(new THREE.Color(0xa05038), 0.6);
    this.groundTex.image = sandTex(P.ground, P.speck).image; this.groundTex.needsUpdate = true;
    this.ground.visible = st.key !== 'gorge';
    this.road.visible = st.key !== 'gorge';
    this.far.visible = st.key !== 'mine' && st.key !== 'gorge';     // the gorge has no ground for them to stand on
    const show = {
      cactus: st.key === 'flats' || st.key === 'pass', brush: st.key !== 'mine' && st.key !== 'gorge', rocks: st.key !== 'mine' && st.key !== 'gorge',
      posts: st.key === 'flats' || st.key === 'pass', bones: st.key === 'gulch', timbers: st.key === 'mine', rails: st.key === 'mine',
      bridge: st.key === 'gorge', pillars: st.key === 'gorge', trees: st.key === 'gulch' || st.key === 'pass' || st.key === 'flats',
    };
    for(const k in this.strips) this.strips[k].g.visible = !!show[k];
    for(const k in this.walls) this.walls[k].g.visible = k === st.key;
    this.river.visible = st.key === 'gorge';
    this.ceiling.visible = st.key === 'mine';
    this.lantern.intensity = st.key === 'mine' ? 14 : dusk > 0.5 ? 6 : 0;
    if(this.torch) this.torch.intensity = st.key === 'mine' ? 16 : 0;
    this.mineLights.forEach(l => { l.intensity = st.key === 'mine' ? 26 : 0; });
    this.key = st.key;
    if(!now) this.fade = 1;
  }

  /* ---------- snapshots ---------- */
  setMe(color){ this.myColor = color; }
  feed(s){
    const now = performance.now();
    this.players = s.pl || [];
    this.phase = s.ph;
    if(Number.isFinite(s.hp)) this.hp = s.hp;
    if(Number.isFinite(s.dist)) this.distSnap = s.dist, this.distAt = now;
    // the scenery: during the stop between stages, the next stage comes up
    if(Number.isFinite(s.sg)){
      const w = s.w || 1;
      const next = s.ph === 'break' ? (s.sg + 1) % STAGES.length : s.ph === 'lobby' || s.ph === 'count' ? 0 : s.sg;
      const lap = Math.floor((s.ph === 'break' ? w : Math.max(0, w - 1)) / STAGES.length);
      this.setStage(next, s.ph === 'lobby' ? 0 : lap);
    }
    const seen = new Set();
    const m = s.m || [];
    for(let i = 0; i < m.length; i += 11){
      const id = m[i], type = ENEMY_LIST[m[i + 1]];
      if(!type) continue;
      seen.add(id);
      let e = this.foes.get(id);
      const p = new THREE.Vector3(m[i + 2], m[i + 3], m[i + 4]);
      if(!e){
        const mesh = buildFoe(type, this.T);
        if(this.tv && type !== 'balloon') mesh.scale.setScalar(1.15);
        mesh.position.copy(p);
        this.scene.add(mesh);
        e = {id, type, mesh, d: p.clone(), sp: p.clone(), sv: new THREE.Vector3(), at: now, face: m[i + 5] / 100, hp: 1, st: 'ride', aux: 0, flash: 0, ph: Math.random() * 10, rise: 0};
        if(type === 'swinger') e.anchor = null;
        this.foes.set(id, e);
      } else {
        // velocity from the last two snapshots: dynamite and diving birds move in 3D
        const dt = (now - e.at) / 1000;
        if(dt > 0.02 && dt < 0.5) e.sv.lerp(_v1.subVectors(p, e.sp).divideScalar(dt), 0.6);
      }
      e.sp.copy(p); e.at = now;
      e.faceT = m[i + 5] / 100;
      e.hp = m[i + 6] / 100; e.st = ST(m[i + 7]);
      const aux = m[i + 8];
      e.side = aux >= 1000 ? -1 : 1; e.aux = (aux % 1000) / 100;
    }
    for(const [id, e] of this.foes) if(!seen.has(id)) this.remove(id, e);
    // friends on the bench
    const want = new Set();
    for(const p of this.players){
      if(p.aw || (!this.tv && p.c === this.myColor)) continue;
      want.add(p.c);
      let a = this.partners.get(p.c);
      if(!a){
        const mesh = buildPartner(p.c, p.n, !this.tv);
        this.scene.add(mesh);
        a = {mesh, x: p.x, z: p.z, aim: new THREE.Vector3(0, 0, -1)};
        this.partners.set(p.c, a);
      }
      a.xT = p.x; a.zT = p.z; a.aimT = p.a; a.f = p.f;
    }
    for(const [c, a] of this.partners) if(!want.has(c)){ this.scene.remove(a.mesh); this.partners.delete(c); }
    for(const ev of s.ev || []) this.event(ev);
  }
  remove(id, e){ this.scene.remove(e.mesh); if(e.onRemove) e.onRemove(); this.foes.delete(id); }
  posOf(id){ const e = this.foes.get(id); return e ? e.d : null; }

  event(ev){
    const k = ev[0];
    if(k === 'shot'){
      const [, color, ox, oy, oz, dx, dy, dz, dist] = ev;
      if(color !== this.myColor || this.tv){
        const from = new THREE.Vector3(ox, oy, oz).add(_v1.set(dx, dy, dz).multiplyScalar(0.5));
        const to = new THREE.Vector3(dx, dy, dz).multiplyScalar(dist).add(_v2.set(ox, oy, oz));
        this.tracer(from, to);
        this.parts.burst(from, 4, 1.5, new THREE.Color(2.5, 1.8, 0.8), 0.1, 0.15);
      }
    } else if(k === 'hit'){
      const e = this.foes.get(ev[1]);
      if(e){ e.flash = 1; this.parts.burst(this.centreOf(e), 8, 3, new THREE.Color(2.4, 1.6, 0.6), 0.1, 0.3); }
    } else if(k === 'poof'){
      const e = this.foes.get(ev[1]);
      const p = e ? this.centreOf(e) : new THREE.Vector3(ev[3], ev[4], ev[5]);
      this.poof(p, ev[2], e);
      if(e) this.remove(ev[1], e);
    } else if(k === 'blast'){
      const p = new THREE.Vector3(ev[1], ev[2], ev[3]);
      this.parts.burst(p, 60, 7, new THREE.Color(3, 1.5, 0.4), 0.45, 0.8, true);
      this.parts.burst(p, 30, 4, new THREE.Color(2.5, 0.7, 0.2), 0.3, 1.0, true);
      this.puff(p, 8, new THREE.Color(0.35, 0.3, 0.27), 2.4, 1.4);
      this.blast.position.copy(p); this.blast.intensity = 80;
      this.shake = 0.6;
    } else if(k === 'bang'){
      // an outlaw's shot: a flash at his gun, and a puff at the wagon
      const e = this.foes.get(ev[1]);
      if(e){
        const c = this.centreOf(e);
        this.parts.burst(c, 10, 2, new THREE.Color(3, 2.2, 0.8), 0.2, 0.2);
        const to = _v2.set((Math.random() - 0.5) * 1.6, BED + 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 3);
        this.tracer(c, to.clone(), true);
        this.parts.burst(to, 6, 2, new THREE.Color(1.8, 1.4, 1.0), 0.08, 0.3);
      }
    } else if(k === 'ouch'){
      this.hurtT = 0.4;
    } else if(k === 'torn'){
      for(const e of this.foes.values()) if(e.type === 'balloon'){ this.puff(this.centreOf(e).add(_v1.set(0, 3, 0)), 6, new THREE.Color(0.5, 0.45, 0.4), 2.5, 1.5); e.torn = ev[1]; }
    }
    if(this.onEvent) this.onEvent(ev);
  }

  /* ---------- effects ---------- */
  tracer(from, to, enemy){
    const b = this.beams.find(x => x.t <= 0) || this.beams[0];
    b.set(from, to, enemy ? new THREE.Color(2.6, 1.2, 0.6) : new THREE.Color(2.6, 2.0, 1.0), 0.014, 0.06);
  }
  localShot(dir, hitPoint){
    const g = this.gun;
    const muzzle = g.userData.muzzle.clone().applyMatrix4(g.matrixWorld);
    const to = hitPoint || dir.clone().multiplyScalar(GUN.range).add(this.cam.position);
    this.tracer(muzzle, to);
    if(hitPoint) this.parts.burst(hitPoint, 6, 3, new THREE.Color(2.4, 1.6, 0.6), 0.1, 0.3);
    this.parts.burst(muzzle, 6, 1.2, new THREE.Color(1.2, 1.1, 1.0), 0.06, 0.4);
    this.recoil = 1;
    this.muzzleFlash.visible = true;
    this.muzzleFlash.position.copy(g.position).add(g.userData.muzzle);
    this.muzzleFlash.scale.set(0.22, 0.22, 1);
    this.flashT = 0.05;
    this.flashLight.position.copy(muzzle);
    this.flashLight.intensity = 6;
  }
  /* the reload: the gun flips up and the cylinder spins */
  reloading(on){ this.reload = on; }

  poof(p, type, e){
    const dusty = new THREE.Color(0.9, 0.75, 0.55);
    if(type === 'dynamite'){
      this.parts.burst(p, 40, 6, new THREE.Color(3, 1.6, 0.4), 0.3, 0.6, true);
      this.puff(p, 4, new THREE.Color(0.4, 0.38, 0.35), 1.4, 1.0);
      this.blast.position.copy(p); this.blast.intensity = 40;
      return;
    }
    if(type === 'crate'){
      this.parts.burst(p, 40, 4, new THREE.Color(0.6, 3, 0.9), 0.2, 0.9, true);
      for(let i = 0; i < 10; i++) this.parts.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 4, Math.random() * 5 + 1, (Math.random() - 0.5) * 4, 1.8, 1.2, 0.6, 0.12, 1.0, 0.5, 0);
      return;
    }
    if(type === 'vulture' || type === 'bat'){
      // feathers
      for(let i = 0; i < 24; i++) this.parts.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4, 0.5, 0.45, 0.45, 0.12, 1.6, 1.2, 0.3);
      this.puff(p, 2, new THREE.Color(0.5, 0.45, 0.4), 0.8, 0.8);
      return;
    }
    if(type === 'balloon'){
      this.parts.burst(p, 160, 10, new THREE.Color(3, 1.6, 0.5), 0.5, 1.4, true);
      this.parts.burst(p, 80, 6, new THREE.Color(3, 0.6, 0.4), 0.4, 1.6, true);
      this.puff(p, 12, new THREE.Color(0.5, 0.45, 0.4), 4, 2);
      this.blast.position.copy(p); this.blast.intensity = 160;
      if(e) this.flyHat(e, p, 3);
      return;
    }
    // an outlaw: a puff of dust, and away goes his hat
    this.parts.burst(p, 26, 3, dusty, 0.22, 0.9, true);
    this.puff(p, 4, new THREE.Color(0.7, 0.62, 0.5), 1.3, 1.1);
    for(let i = 0; i < 6; i++) this.parts.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3, 3, 2.4, 0.4, 0.08, 0.8, 0.8, 0);   // stars
    if(e) this.flyHat(e, p, 1);
  }
  flyHat(e, p, big){
    const h = buildHat(0x2a2018, true);
    h.scale.setScalar(big * (this.tv ? 1.3 : 1));
    h.position.copy(p).add(_v1.set(0, 0.5, 0));
    this.scene.add(h);
    this.hats.push({mesh: h, v: new THREE.Vector3((Math.random() - 0.5) * 3, 5 + Math.random() * 2, (Math.random() - 0.5) * 3 + SPEED * 0.3), spin: new THREE.Vector3(Math.random() * 8, Math.random() * 10, Math.random() * 6), t: 0});
  }
  puff(p, n, color, size, life){
    for(let i = 0; i < n; i++){
      const s = this.smoke.find(x => !x.visible) || this.smoke[0];
      s.visible = true;
      s.position.copy(p).add(_v1.set((Math.random() - 0.5) * 0.5, Math.random() * 0.4, (Math.random() - 0.5) * 0.5));
      s.material.color.copy(color);
      s.userData = {t: 0, life: life * (0.7 + Math.random() * 0.6), v: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8 + SPEED * 0.6), s0: size * (0.6 + Math.random() * 0.6)};
    }
  }

  /* ---------- the phone ---------- */
  setView(q, x, z, y){
    this.cam.quaternion.copy(q);
    this.cam.position.set(x, y == null ? EYE : y, z);
    // a little jolt from the trail
    this.cam.position.y += Math.sin(this.time * 9) * 0.012 + (this.shake || 0) * (Math.random() - 0.5) * 0.08;
  }
  /* What the sight is on (as the host judges it). */
  pick(dir){
    const o = this.cam.position;
    let best = null, bs = 1;
    for(const e of this.foes.values()){
      if(!this.canHit(e)) continue;
      const c = this.centreOf(e);
      const vx = c.x - o.x, vy = c.y - (o.y - 0.1), vz = c.z - o.z;
      const t = vx * dir.x + vy * dir.y + vz * dir.z;
      if(t <= 0 || t > GUN.range) continue;
      const miss = Math.hypot(vx - dir.x * t, vy - dir.y * t, vz - dir.z * t);
      const r = ENEMIES[e.type].r * GUN.assist + 0.15 + t * 0.007;
      const s = miss / r;
      if(s < bs){ bs = s; best = e; best.t = t; }
    }
    return best;
  }
  /* A rock pillar out of the gorge for a rope bandit to stand on, with an
     arm of rock overhanging the bridge side, high above him, where his rope
     is tied. Its position is his feet; userData.tip is the rope's knot. */
  ropePillar(feet){
    const g = new THREE.Group(), s = feet.x < 0 ? -1 : 1, H = feet.y + 80;
    part(g, new THREE.CylinderGeometry(1.1, 1.5, H, 7), this.T.rockMat, 0, -H / 2 - 0.05, 0);
    // the spire behind him, and the overhang reaching out over the drop
    const reach = Math.max(1.5, (Math.abs(feet.x) - 1.2) / 2);
    part(g, new THREE.CylinderGeometry(0.7, 1.0, 9, 6), this.T.rockMat, s * 1.4, 4.4, 0);
    const arm = part(g, new THREE.BoxGeometry(reach + 1.6, 0.9, 1.3), this.T.rockMat, s * 1.4 - s * (reach + 1.6) / 2, 8.5, 0);
    arm.rotation.z = s * 0.06;
    const tip = new THREE.Object3D();
    tip.position.set(-s * reach, 8.0, 0);
    g.add(tip);
    g.userData.tip = tip;
    g.position.copy(feet);
    this.scene.add(g);
    return g;
  }
  /* a pillar some bandit is still standing on */
  foesOn(p){ for(const e of this.foes.values()) if(e.mesh.userData.pillar === p && e.st === 'wait') return true; return false; }
  canHit(e){ return !((e.type === 'bandit' || e.type === 'thrower') && e.st === 'hide' && e.rise < 0.5); }
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
    const rolling = this.phase !== 'lobby' && this.phase !== 'over';
    const v = rolling ? SPEED : this.phase === 'lobby' ? 2.5 : 0;
    this.dist += v * dt;
    this.shake = Math.max(0, (this.shake || 0) - dt);

    // the land going by
    this.groundTex.offset.y = this.dist / (1200 / 90);
    this.trailTex.offset.y = this.dist / (600 / 60);
    const scroll = (st) => {
      if(!st.g.visible) return;
      for(const o of st.items){
        let z = o.userData.z0 + this.dist;
        z = st.FROM + ((z - st.FROM) % st.LEN + st.LEN) % st.LEN;
        o.position.z = z;
      }
    };
    for(const k in this.strips) scroll(this.strips[k]);
    for(const k in this.walls) scroll(this.walls[k]);
    if(this.ceiling.visible){ this.ceiling.material.map.offset.y = this.dist / 6; }
    if(this.river.visible) this.river.position.z = -200 + (this.dist * 0.2) % 10;
    // the mine's real lights ride along with the nearest lamps
    if(this.strips.timbers.g.visible){
      const lamps = this.strips.timbers.items.filter(o => o.userData.lamp && o.position.z > -40 && o.position.z < 30).sort((a, b) => Math.abs(a.position.z) - Math.abs(b.position.z));
      this.mineLights.forEach((l, i) => {
        const o = lamps[i];
        if(!o){ l.intensity = 0; return; }
        l.position.set(o.userData.lamp.position.x, 4.4, o.position.z);
        l.intensity = 22 * (0.85 + 0.15 * Math.sin(t * 9 + i));
      });
    }

    // the wagon and the team
    for(const w of this.wheels) w.rotation.x -= v * dt / w.userData.r;
    for(const h of this.team){
      if(h.userData.mixer){
        h.userData.play(v > 3 ? 'Gallop' : v > 0.5 ? 'Walk' : 'Idle', v > 3 ? 1.1 : 1);
        h.userData.mixer.update(dt);
        continue;
      }
      gallop(h, t + h.userData.ph, v > 1 ? 1 : 0.15); h.position.y = v > 1 ? Math.abs(Math.sin((t + h.userData.ph) * 11)) * 0.06 : 0;
    }
    this.wagon.position.y = v > 1 ? Math.sin(t * 13) * 0.015 : 0;
    this.wagon.rotation.z = v > 1 ? Math.sin(t * 2.3) * 0.006 : 0;
    // dust off the wheels and hooves
    if(v > 1 && this.key !== 'gorge' && Math.random() < dt * 30){
      const dc = this.key === 'mine' ? [0.25, 0.2, 0.15] : [0.9, 0.75, 0.55];
      const x = (Math.random() < 0.5 ? -1 : 1) * (WAGON.hw + 0.1), z = Math.random() < 0.6 ? 2.4 : -6 + Math.random() * 3;
      this.parts.emit(x, 0.15, z, (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.5, SPEED * 0.8, dc[0] * 0.35, dc[1] * 0.35, dc[2] * 0.35, 0.5, 1.4, 0.6, 2.5);
    }

    // foes
    for(const e of this.foes.values()){
      const age = Math.min(0.25, (now - e.at) / 1000);
      _v1.copy(e.sp).addScaledVector(e.sv, age);
      e.d.lerp(_v1, ease);
      e.mesh.position.copy(e.d);
      let df = e.faceT - e.face;
      while(df > Math.PI) df -= Math.PI * 2;
      while(df < -Math.PI) df += Math.PI * 2;
      e.face += df * ease;
      e.mesh.rotation.y = e.face + Math.PI;
      e.flash = Math.max(0, e.flash - dt * 5);
      for(const m of e.mesh.userData.flash || []) if(m.emissive) m.emissive.setRGB(e.flash * 1.5, e.flash * 0.9, e.flash * 0.4);
      this.animate(e, dt, t);
    }
    // hats in the air
    for(let i = this.hats.length - 1; i >= 0; i--){
      const h = this.hats[i];
      h.t += dt; h.v.y -= 9 * dt;
      h.mesh.position.addScaledVector(h.v, dt);
      h.mesh.rotation.x += h.spin.x * dt; h.mesh.rotation.y += h.spin.y * dt; h.mesh.rotation.z += h.spin.z * dt;
      if(h.mesh.position.y < 0.05 && h.v.y < 0){ h.mesh.position.y = 0.05; h.v.set(0, 0, SPEED); h.spin.set(0, 0, 0); }
      if(h.t > 4){ this.scene.remove(h.mesh); this.hats.splice(i, 1); }
    }
    // friends on the bench
    for(const a of this.partners.values()){
      a.x += (a.xT - a.x) * ease;
      a.z += (a.zT - a.z) * ease;
      a.mesh.position.set(a.x, BED + 0.47, a.z);
      if(a.aimT){
        _v1.set(a.aimT[0], a.aimT[1], a.aimT[2]);
        a.aim.lerp(_v1, ease).normalize();
        a.mesh.rotation.y = Math.atan2(-a.aim.x, -a.aim.z);
        a.mesh.userData.arm.rotation.x = Math.asin(Math.max(-1, Math.min(1, a.aim.y)));
      }
    }
    // the gun
    if(this.gun){
      this.recoil = Math.max(0, this.recoil - dt * 7);
      const rl = this.reload ? 1 : 0;
      this.spin += ((rl ? 1 : 0) - this.spin) * Math.min(1, dt * 10);
      const home = this.gunHome || _gunHome;
      this.gun.position.set(home.x, home.y + this.recoil * 0.02 + this.spin * 0.05, home.z + this.recoil * 0.05);
      this.gun.rotation.set(this.recoil * 0.4 + this.spin * 0.9, 0, this.spin * 0.6);
      if(this.reload) this.gun.userData.cyl.rotation.y += dt * 20;
      if(this.flashT > 0){ this.flashT -= dt; if(this.flashT <= 0){ this.muzzleFlash.visible = false; this.flashLight.intensity = 0; } }
    }
    this.blast.intensity *= Math.exp(-dt * 6);
    this.hurtT = Math.max(0, this.hurtT - dt);
    // the TV: over the wagon from behind, drifting a little
    if(this.tv){
      this.cam.position.set(Math.sin(t * 0.1) * 1.5, 8.5 + Math.sin(t * 0.13) * 0.4, 12.5);
      this.cam.lookAt(0, 1.6, -10);
    }
    // the bits that fade
    for(const b of this.beams){ if(b.t > 0){ b.t -= dt; b.mat.uniforms.uAlpha.value = Math.max(0, b.t / b.life); b.place(this.cam); if(b.t <= 0) b.mesh.visible = false; } }
    for(const s of this.smoke){
      if(!s.visible) continue;
      const u = s.userData; u.t += dt;
      const k = u.t / u.life;
      if(k >= 1){ s.visible = false; continue; }
      s.position.addScaledVector(u.v, dt);
      const sc = u.s0 * (0.6 + k * 1.4); s.scale.set(sc, sc, 1);
      s.material.opacity = (1 - k) * 0.6;
    }
    // pillars left behind by bandits who have jumped go by with the land
    for(let i = this.pillars.length - 1; i >= 0; i--){
      const p = this.pillars[i];
      if(!this.foesOn(p)) p.position.z += SPEED * dt;
      if(p.position.z > 60){ this.scene.remove(p); this.pillars.splice(i, 1); }
    }
    this.parts.update(dt);
    this.adapt(dt);
    if(this.composer) this.composer.render(); else this.renderer.render(this.scene, this.cam);
  }

  animate(e, dt, t){
    const U = e.mesh.userData;
    switch(e.type){
      case 'bandit': case 'thrower': {
        // up off the ground with no canyon rim to stand on (the gorge's
        // cliff throwers): a rock pillar under him, so he is never seen in
        // mid-air - and never dangling below his rock when he ducks
        if(!U.column && e.d.y > 0.5 && this.key === 'gorge'){
          U.column = part(e.mesh, new THREE.CylinderGeometry(1.5, 2.0, 90, 7), this.T.rockMat, 0, -45 - 0.2, 0.3);
        }
        const up = e.st === 'up' ? 1 : 0;
        e.rise += (up - e.rise) * Math.min(1, dt * 9);
        U.lift.position.y = -1.5 + e.rise * 1.5;
        // the rock looks at the wagon so he is behind it
        U.lift.position.z = 0.55;
        U.arms[1].rotation.x = e.type === 'thrower' ? -2.5 + e.aux * 2.5 * up : -1.5 * e.rise;
        U.glint.visible = e.type === 'bandit' && e.st === 'up' && e.aux > 0.45;
        if(U.glint.visible) U.glint.scale.setScalar(0.4 + e.aux * 0.8 + Math.sin(t * 30) * 0.1);
        if(U.fuse) U.fuse.material.opacity = 0.6 + Math.random() * 0.4;
        break;
      }
      case 'rider': case 'cart': {
        if(e.type === 'rider'){ if(U.mount.userData.mixer) U.mount.userData.mixer.update(dt); else gallop(U.mount, t + e.ph, 1); }
        else for(const w of U.mount.userData.wheels) w.rotation.y += dt * 10;
        const aiming = e.st === 'aim';
        U.arms[1].rotation.x = aiming ? -1.5 : -0.3;
        U.glint.visible = aiming && e.aux > 0.35;
        if(U.glint.visible) U.glint.scale.setScalar(0.4 + e.aux * 0.8 + Math.sin(t * 30) * 0.1);
        if(e.st === 'board' || e.st === 'aboard'){
          // up and over the side: once aboard the horse runs off
          if(e.st === 'aboard' && U.mount.visible && e.type === 'rider') U.mount.visible = false;
          U.man.position.y = e.st === 'aboard' ? 0 : 0.75;
          U.arms.forEach(a => { a.rotation.x = -2.6 + Math.sin(t * 8) * 0.4; });
        }
        if(e.type === 'rider' && !U.mount.userData.mixer) e.mesh.position.y += Math.abs(Math.sin((t + e.ph) * 11)) * 0.08;
        break;
      }
      case 'dynamite':
        e.mesh.rotation.x += dt * 9; e.mesh.rotation.z += dt * 5;
        U.fuse.scale.setScalar(0.4 + Math.random() * 0.3);
        if(Math.random() < 0.6) this.parts.emit(e.d.x, e.d.y + 0.2, e.d.z, (Math.random() - 0.5), Math.random() * 1.5, (Math.random() - 0.5), 3, 1.8, 0.4, 0.06, 0.25, 1, 0);
        break;
      case 'vulture': {
        const flap = e.st === 'circle' ? Math.sin(t * 2 + e.ph) * 0.15 : Math.sin(t * 8 + e.ph) * 0.6;
        U.wings[0].rotation.z = flap + (e.st === 'dive' ? 0.6 : 0); U.wings[1].rotation.z = -flap - (e.st === 'dive' ? 0.6 : 0);
        e.mesh.rotation.z = e.st === 'circle' ? 0.35 : 0;
        if(e.st === 'peck') e.mesh.rotation.x = Math.sin(t * 14) * 0.4;
        break;
      }
      case 'bat': {
        const flap = Math.sin(t * 28 + e.ph) * 0.9;
        U.wings[0].rotation.z = flap; U.wings[1].rotation.z = -flap;
        break;
      }
      case 'swinger': {
        /* A rope bandit, Tarzan-style. The rope is ALWAYS held in both hands
           above his head and runs from his hands up to where it is tied - an
           overhanging arm of his rock pillar, or the Baron's basket. Never
           near the head or neck, nobody ever shown dangling, no gallows
           (asked for: HANDOFF.md, "Nothing hanging"). Waiting, he stands on
           top of his pillar; the pillar stays in the gorge as the land goes by. */
        let balloon = null;
        for(const o of this.foes.values()) if(o.type === 'balloon') balloon = o;
        const nearBalloon = balloon && Math.hypot(balloon.d.x - e.d.x, balloon.d.z - e.d.z) < 6;
        if(e.st === 'wait' && !U.pillar && e.d.y > 1.5 && !nearBalloon){
          U.pillar = this.ropePillar(e.d);
          this.pillars.push(U.pillar);
        }
        if(U.pillar && e.st === 'wait') U.pillar.position.set(e.d.x, U.pillar.position.y, e.d.z);
        const swing = e.st === 'swing', aboard = e.st === 'aboard';
        // the rope: hands to anchor
        const anchor = U.pillar && !aboard ? U.pillar.userData.tip.getWorldPosition(_v3) : balloon && !aboard && (U.fromBalloon || nearBalloon) ? _v3.copy(balloon.d).add(_v1.set(0, -1.7, 0)) : null;
        if(balloon && nearBalloon) U.fromBalloon = true;
        if(!U.rope){
          U.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 5).translate(0, 0.5, 0), mat(0x8a7a5a));
          this.scene.add(U.rope);
          e.onRemove = () => this.scene.remove(U.rope);
        }
        U.rope.visible = !!anchor;
        if(anchor){
          const hand = _v2.copy(e.d).add(_v1.set(0, 2.15, 0));
          const d = _v1.subVectors(anchor, hand);
          U.rope.position.copy(hand);
          U.rope.scale.set(1, Math.max(0.01, d.length()), 1);
          U.rope.quaternion.setFromUnitVectors(_v2.set(0, 1, 0), d.normalize());
        }
        // both hands up on the rope; legs out in the swing; fists up once aboard
        U.man.position.y = 0;
        U.arms[0].rotation.x = aboard ? -1.2 + Math.sin(t * 8) * 0.4 : Math.PI;
        U.arms[1].rotation.x = aboard ? -2.4 + Math.cos(t * 8) * 0.4 : Math.PI;
        U.arms[0].rotation.z = U.arms[1].rotation.z = 0;
        U.legs.forEach(l => { l.rotation.x = swing ? -0.7 : 0; });
        e.mesh.rotation.x = 0;
        break;
      }
      case 'balloon': {
        U.flame.scale.setScalar(1.2 + Math.random() * 0.8);
        e.mesh.rotation.z = Math.sin(t * 0.7) * 0.05 + (e.torn || 0) * 0.08;
        U.envelope.scale.set(1, 1 - (e.torn || 0) * 0.07, 1);
        U.baron.rotation.y = Math.sin(t * 0.8) * 0.8;
        break;
      }
      case 'crate': U.beacon.material.opacity = 0.5 + 0.5 * Math.sin(t * 5); break;
      case 'tumble': e.mesh.rotation.y = 0; e.mesh.rotation.z = -t * 4 * e.side; break;
    }
  }

  /* hold the frame rate up on a slow phone */
  adapt(dt){
    this.frameTimes.push(dt);
    if(this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if(avg > 1 / 40 && this.dpr > 1){ this.dpr = Math.max(1, this.dpr - 0.25); this.resize(); }
    else if(avg < 1 / 58 && this.dpr < this.maxDpr){ this.dpr = Math.min(this.maxDpr, this.dpr + 0.25); this.resize(); }
  }
}
