/* Night Watch: Bunker - the Game Day look (BYU vs Utah).

   A lobby toggle ("Look": Halloween / Game Day) that keeps every rule and
   swaps what you see: the bunker stands on a floodlit football field, the
   monsters are Utah football - linemen, receivers, a nose tackle, flying
   footballs, a giant red foam finger that floats through the fence - and
   the witch is Swoop, the red-tailed hawk, circling overhead dropping
   football bombs. The guns fire miniature BYU players (and, from the
   scope, a miniature Cosmo) that fly to whatever they hit.

   Same shapes as yard.js's monsters: built from primitives, facing +z,
   feet at y = 0 (fliers centred), recording the materials to flash and the
   limbs to swing (legL/legR/armL/armR/head), so the yard animates them as
   it does the Halloween ones. Personal use, at a party. */
import * as THREE from 'three';

export const UTAH_RED = 0xcc0000, BYU_BLUE = 0x0b3d91, BYU_ROYAL = 0x1f5fd6;

/* what each monster is called, in the words the game says them */
export const NAMES = {pumpkin: 'Utah lineman', skeleton: 'Utah receiver', ghost: 'foam finger', brute: 'Utah nose tackle',
  bat: 'flying football', witch: 'Swoop', bomb: 'football bomb'};
export const GUN_NAMES = [['🏈', 'PLAYER'], ['👥', 'O-LINE'], ['🐾', 'COSMO']];

function mat(color, rough, metal, extra){ return new THREE.MeshStandardMaterial(Object.assign({color, roughness: rough == null ? 0.7 : rough, metalness: metal || 0}, extra || {})); }
function pivot(parent, x, y, z){ const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
function part(parent, geo, m, x, y, z, rx, ry, rz){
  const o = new THREE.Mesh(geo, m);
  o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0);
  parent.add(o); return o;
}
function canvasTex(w, h, draw){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const texCache = {};
/* a jersey: the team colour, the number front and back, stripes on the sleeves */
const css = c => typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c;
function jerseyTex(bg, fg, num){
  bg = css(bg); fg = css(fg);
  const key = bg + fg + num;
  if(texCache[key]) return texCache[key];
  return texCache[key] = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = '900 70px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    // the cylinder's texture wraps round: the front is u = 0 (split across
    // the two edges), the back u = 0.5
    g.fillText(num, 0, h * 0.55); g.fillText(num, w, h * 0.55); g.fillText(num, w * 0.5, h * 0.55);
    g.fillRect(0, 8, w, 6);
  });
}
/* Utah's interlocking U-U */
function uuTex(fg){
  const key = 'uu' + fg;
  if(texCache[key]) return texCache[key];
  return texCache[key] = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = fg; g.font = '900 84px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('U', 48, 58); g.fillText('U', 80, 74);
  });
}
/* a helmet decal: Utah's block U, BYU's Y */
function decalTex(letter, fg, ring){
  const key = 'd' + letter + fg + ring;
  if(texCache[key]) return texCache[key];
  return texCache[key] = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    if(ring){ g.fillStyle = ring; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = fg; g.font = '900 96px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, 64, 70);
  });
}
function footballGeo(len){
  // a prolate spheroid along z, pointed ends
  const g = new THREE.SphereGeometry(len / 2, 18, 12);
  const p = g.attributes.position;
  for(let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = Math.pow(1 - Math.abs(z) / (len / 2), 0.55);
    p.setXYZ(i, x * 0.58 * Math.max(0.05, k), y * 0.58 * Math.max(0.05, k), z);
  }
  g.computeVertexNormals();
  return g;
}

/* ---------- a football player ----------
   o: {jersey, num, numCol, pants, helmet, mask, decal, stripe, skin, w (width), h (height), mini} */
export function buildPlayer(o, flashList){
  const g = new THREE.Group();
  const U = g.userData = g.userData || {};
  U.flash = flashList || []; U.limbs = U.limbs || {};
  const add = m => { U.flash.push(m); return m; };
  const k = (o.h || 1.9) / 1.9, w = o.w || 1;
  const jersey = add(mat(0xffffff, 0.75, 0, {map: jerseyTex(o.jersey, o.numCol, o.num)}));
  const solid = add(mat(o.jersey, 0.75));
  const pants = add(mat(o.pants, 0.6)), skin = add(mat(o.skin || 0x9a6a4a, 0.7));
  const shoe = mat(0x161616, 0.5), sock = mat(o.sock || o.jersey, 0.8);
  const helmet = add(mat(o.helmet, 0.5, 0.05)), mask = mat(o.mask || 0x222222, 0.5, 0.3);
  for(const s of [-1, 1]){
    const hip = U.limbs[s < 0 ? 'legL' : 'legR'] = pivot(g, s * 0.13 * w * k, 0.92 * k, 0);
    part(hip, new THREE.CylinderGeometry(0.1 * w * k, 0.085 * w * k, 0.5 * k, 10), pants, 0, -0.22 * k, 0);
    part(hip, new THREE.CylinderGeometry(0.07 * w * k, 0.06 * w * k, 0.42 * k, 8), sock, 0, -0.66 * k, 0);
    part(hip, new THREE.BoxGeometry(0.13 * w * k, 0.09 * k, 0.26 * k), shoe, 0, -0.88 * k, 0.05 * k);
  }
  // the body and shoulder pads
  part(g, new THREE.CylinderGeometry(0.25 * w * k, 0.22 * w * k, 0.62 * k, 16), jersey, 0, 1.22 * k, 0);
  part(g, new THREE.BoxGeometry(0.72 * w * k, 0.2 * k, 0.4 * k), solid, 0, 1.5 * k, 0);
  part(g, new THREE.BoxGeometry(0.36 * w * k, 0.08 * k, 0.3 * k), pants, 0, 0.9 * k, 0);
  for(const s of [-1, 1]){
    const sh = U.limbs[s < 0 ? 'armL' : 'armR'] = pivot(g, s * 0.36 * w * k, 1.5 * k, 0);
    part(sh, new THREE.CylinderGeometry(0.075 * w * k, 0.065 * w * k, 0.3 * k, 8), solid, 0, -0.12 * k, 0.02 * k);
    part(sh, new THREE.CylinderGeometry(0.055 * w * k, 0.05 * w * k, 0.36 * k, 8), skin, 0, -0.42 * k, 0.1 * k, -0.35);
    part(sh, new THREE.SphereGeometry(0.06 * w * k, 8, 6), mat(o.glove != null ? o.glove : 0x111111, 0.6), 0, -0.62 * k, 0.17 * k);
    // sleeve stripes
    if(o.sleeve != null) part(sh, new THREE.CylinderGeometry(0.078 * w * k, 0.076 * w * k, 0.035 * k, 10), mat(o.sleeve, 0.7), 0, -0.2 * k, 0.03 * k);
  }
  // the helmet: shell, stripe, decals, facemask, and a face behind it
  const head = U.limbs.head = pivot(g, 0, 1.78 * k, 0);
  part(head, new THREE.SphereGeometry(0.2 * k, 18, 14), helmet, 0, 0, -0.01 * k).scale.set(1, 1.02, 1.1);
  part(head, new THREE.SphereGeometry(0.13 * k, 12, 10), skin, 0, -0.03 * k, 0.07 * k);
  if(o.stripe != null) part(head, new THREE.CylinderGeometry(0.205 * k, 0.205 * k, 0.05 * k, 18, 1, true, -Math.PI / 2, Math.PI), mat(o.stripe, 0.3), 0, 0, -0.01 * k, 0, Math.PI / 2, Math.PI / 2);
  if(o.decal){
    for(const s of [-1, 1]){
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.17 * k, 0.17 * k), new THREE.MeshBasicMaterial({map: o.decal, transparent: true, depthWrite: false}));
      d.position.set(s * 0.215 * k, 0.02 * k, -0.02 * k); d.rotation.y = s * Math.PI / 2; head.add(d);
    }
  }
  for(let i = 0; i < 3; i++) part(head, new THREE.TorusGeometry(0.15 * k, 0.012 * k, 4, 14, Math.PI), mask, 0, -0.04 * k - i * 0.05 * k, 0.14 * k, Math.PI / 2 - 0.25, 0, 0);
  part(head, new THREE.CylinderGeometry(0.012 * k, 0.012 * k, 0.17 * k, 4), mask, 0, -0.08 * k, 0.215 * k);
  // eye black, and a stare
  for(const s of [-1, 1]){
    part(head, new THREE.BoxGeometry(0.04 * k, 0.012 * k, 0.01 * k), mat(0x080808, 0.9), s * 0.05 * k, -0.04 * k, 0.195 * k);
    part(head, new THREE.SphereGeometry(0.016 * k, 6, 4), new THREE.MeshBasicMaterial({color: 0xffffff}), s * 0.05 * k, 0.0, 0.19 * k);
  }
  return g;
}

const UTAH = (num, extra) => Object.assign({jersey: UTAH_RED, num, numCol: '#ffffff', pants: 0xf2f2f2, helmet: UTAH_RED, mask: 0x111111,
  stripe: 0xffffff, sock: 0xcc0000, decal: uuTex('#ffffff'), sleeve: 0xffffff}, extra || {});
const BYU = (num, extra) => Object.assign({jersey: BYU_BLUE, num, numCol: '#ffffff', pants: 0xf4f4f4, helmet: 0xf6f6f6, mask: 0x0b3d91,
  stripe: BYU_BLUE, sock: 0x0b3d91, decal: decalTex('Y', '#0b3d91', null), sleeve: 0xffffff, glove: 0xf4f4f4}, extra || {});

/* ---------- the monsters ---------- */
export function buildGameDayMonster(type, T, glowTex, hot){
  const g = new THREE.Group();
  let U = {flash: [], limbs: {}, type, glow: null};
  g.userData = U;
  const glowSprite = (color, size, x, y, z, parent) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTex, color: hot(color, 1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true}));
    sp.scale.set(size, size, 1); sp.position.set(x, y, z); (parent || g).add(sp); return sp;
  };
  if(type === 'pumpkin' || type === 'skeleton' || type === 'brute'){
    const spec = type === 'pumpkin' ? UTAH('7' + (1 + Math.floor(Math.random() * 9)), {h: 1.9, w: 1.35})
      : type === 'skeleton' ? UTAH(String(1 + Math.floor(Math.random() * 19)), {h: 1.8, w: 0.9})
      : UTAH('99', {h: 2.6, w: 1.6});
    const p = buildPlayer(spec);
    // the yard animates these by their limbs
    U = p.userData; U.type = type; U.glow = null;
    if(type === 'skeleton'){
      // a receiver carries the ball
      const ball = part(U.limbs.armR, footballGeo(0.28), mat(0x6b3a1a, 0.6), 0, -0.55, 0.22, 0.4);
      ball.scale.setScalar(1);
    }
    return p;
  }
  if(type === 'ghost'){
    // a giant red foam finger, "U" on the palm, drifting through the fence
    const foam = new THREE.MeshStandardMaterial({color: UTAH_RED, roughness: 0.95, emissive: 0x400000, emissiveIntensity: 0.5});
    U.flash.push(foam);
    const body = U.body = new THREE.Group(); g.add(body);
    part(body, new THREE.CylinderGeometry(0.16, 0.2, 0.55, 14), foam, 0, 0.1, 0);                 // the wrist
    const palm = part(body, new THREE.BoxGeometry(0.62, 0.55, 0.26), foam, 0, 0.62, 0);
    palm.geometry.translate(0, 0, 0);
    for(let i = 0; i < 3; i++) part(body, new THREE.SphereGeometry(0.11, 10, 8), foam, -0.18 + i * 0.15, 0.95, 0.06).scale.set(1, 0.8, 1.1);   // curled fingers
    part(body, new THREE.CapsuleGeometry(0.1, 0.62, 6, 12), foam, 0.21, 1.25, 0);                 // number one
    part(body, new THREE.CapsuleGeometry(0.08, 0.2, 6, 10), foam, -0.36, 0.62, 0.08, 0, 0, 0.9);  // thumb
    const text = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42), new THREE.MeshBasicMaterial({map: canvasTex(256, 216, (c, w, h) => {
      c.fillStyle = '#ffffff'; c.font = '900 120px Impact, Arial Black'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('#1', w / 2, h * 0.32); c.font = '900 64px Impact, Arial Black'; c.fillText('UTES', w / 2, h * 0.8);
    }), transparent: true, depthWrite: false}));
    text.position.set(0, 0.62, 0.135); body.add(text);
    U.glow = glowSprite(0xff3030, 2.2, 0, 0.7, 0);
    return g;
  }
  if(type === 'bat'){
    // a flying football with hawk-feather wings
    g.userData.scale = 1.9;
    const leather = mat(0x6b3a1a, 0.55);
    U.flash.push(leather);
    part(g, footballGeo(0.3), leather, 0, 0, 0);
    for(const z of [-0.075, 0.075]) part(g, new THREE.TorusGeometry(0.105, 0.012, 4, 20), mat(0xffffff, 0.6), 0, 0, z).scale.set(1, 1, 1);
    part(g, new THREE.BoxGeometry(0.012, 0.012, 0.12), mat(0xffffff, 0.6), 0, 0.087, 0);
    for(const s of [-1, 1]){
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(0.42, 0.1); sh.lineTo(0.38, -0.02); sh.lineTo(0.3, -0.06); sh.lineTo(0.22, -0.09); sh.lineTo(0, -0.08); sh.closePath();
      const wing = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshStandardMaterial({color: UTAH_RED, side: THREE.DoubleSide, roughness: 0.9}));
      wing.rotation.x = -Math.PI / 2;
      const p = U.limbs[s < 0 ? 'armL' : 'armR'] = pivot(g, s * 0.07, 0.03, 0);
      if(s < 0) wing.scale.x = -1;
      p.add(wing);
    }
    return g;
  }
  if(type === 'witch'){
    // Swoop, flying: the mascot as he is - a brown red-tailed hawk in Utah's
    // red No. 96 and white pants, gold beak wide open, gold round the eyes,
    // a white ruff at the neck, white gloves - stretched out like a dive,
    // wings out, along +z. The number is on his belly: you look up at him.
    const brown = mat(0x7a3d1e, 0.95), dark = mat(0x4a2210, 0.95), light = mat(0xa8673a, 0.95);
    const gold = mat(0xe7b52c, 0.45), black = mat(0x1a1a1a, 0.5), white = mat(0xf6f3ec, 0.9), mouth = mat(0xb01818, 0.6);
    U.flash.push(brown, gold);
    const jersey = add2(mat(0xffffff, 0.75, 0, {map: jerseyTex(UTAH_RED, '#ffffff', '96')}));
    function add2(m){ U.flash.push(m); return m; }
    const torso = part(g, new THREE.CylinderGeometry(0.36, 0.32, 0.95, 18), jersey, 0, 0, 0.05, Math.PI / 2);
    part(g, new THREE.BoxGeometry(0.9, 0.28, 0.42), mat(UTAH_RED, 0.75), 0, 0.02, 0.38);                       // shoulder pads
    part(g, new THREE.TorusGeometry(0.26, 0.12, 8, 16), white, 0, 0.02, 0.58);                                    // the ruff
    // legs trailing, white pants, brown feathered feet
    for(const s of [-1, 1]){
      part(g, new THREE.CylinderGeometry(0.12, 0.1, 0.7, 10), white, s * 0.14, -0.02, -0.75, Math.PI / 2);
      part(g, new THREE.ConeGeometry(0.11, 0.3, 8), gold, s * 0.14, -0.04, -1.2, -Math.PI / 2);
    }
    // the tail: red-tailed - rust feathers fanned between the legs
    for(let i = -2; i <= 2; i++){
      const f = part(g, new THREE.BoxGeometry(0.15, 0.03, 0.7), i % 2 ? light : brown, i * 0.08, 0.14, -0.85, 0.15, i * 0.16, 0);
      f.geometry.translate(0, 0, -0.15);
    }
    // the head: big and furry, the beak wide open
    const head = U.limbs.head = pivot(g, 0, 0.12, 0.92);
    part(head, new THREE.SphereGeometry(0.36, 20, 16), brown, 0, 0, 0).scale.set(1, 0.95, 1);
    for(let i = 0; i < 7; i++) part(head, new THREE.ConeGeometry(0.06, 0.26, 5), i % 2 ? dark : light, (i - 3) * 0.09, 0.25 + Math.cos((i - 3) / 3) * 0.04, -0.2, -Math.PI / 2.4);  // tufts
    for(const s of [-1, 1]){
      const ring = part(head, new THREE.SphereGeometry(0.12, 12, 10), gold, s * 0.15, 0.08, 0.24); ring.scale.set(1.1, 0.9, 0.6);
      part(head, new THREE.SphereGeometry(0.06, 10, 8), black, s * 0.15, 0.09, 0.3);
      part(head, new THREE.SphereGeometry(0.018, 6, 4), white, s * 0.15 + 0.02, 0.11, 0.355);
      part(head, new THREE.BoxGeometry(0.17, 0.05, 0.06), dark, s * 0.15, 0.2, 0.28, 0, 0, -s * 0.3);                   // brow
    }
    // the beak: an open gold beak with a dark hooked tip, red inside
    const upper = pivot(head, 0, 0.0, 0.3);
    part(upper, new THREE.ConeGeometry(0.22, 0.5, 12), gold, 0, 0, 0.2, Math.PI / 2).scale.set(1.15, 1, 0.75);
    part(upper, new THREE.ConeGeometry(0.08, 0.16, 8), black, 0, -0.05, 0.47, Math.PI * 0.62);
    upper.rotation.x = -0.25;
    const lower = U.limbs.jaw = pivot(head, 0, -0.1, 0.28);
    part(lower, new THREE.ConeGeometry(0.17, 0.36, 12), gold, 0, 0, 0.14, Math.PI / 2).scale.set(1.15, 1, 0.5);
    lower.rotation.x = 0.45;
    part(head, new THREE.SphereGeometry(0.15, 10, 8), mouth, 0, -0.08, 0.32).scale.set(1.1, 0.7, 1);
    // wings: his arms - brown, feathered, gloved
    U.wings = [];
    for(const s of [-1, 1]){
      const wp = pivot(g, s * 0.38, 0.06, 0.32);
      const sh = new THREE.Shape();
      sh.moveTo(0, 0.18); sh.quadraticCurveTo(0.8, 0.28, 1.5, 0.18); sh.lineTo(1.7, 0.02);
      for(let i = 0; i < 6; i++){ const x = 1.6 - i * 0.26; sh.lineTo(x, -0.42 - (i % 2) * 0.08); sh.lineTo(x - 0.12, -0.24); }
      sh.lineTo(0, -0.3); sh.closePath();
      const wing = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshStandardMaterial({color: 0x7a3d1e, side: THREE.DoubleSide, roughness: 0.95}));
      wing.rotation.x = -Math.PI / 2;
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.12), new THREE.MeshStandardMaterial({color: 0xa8673a, side: THREE.DoubleSide, roughness: 0.95}));
      edge.rotation.x = -Math.PI / 2; edge.position.set(0.85, 0.006, 0.28);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.9, 8), new THREE.MeshStandardMaterial({color: UTAH_RED, roughness: 0.75}));
      arm.rotation.z = Math.PI / 2; arm.position.set(0.45, 0.04, 0.12);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshStandardMaterial({color: 0xf6f3ec, roughness: 0.8}));
      glove.position.set(1.0, 0.06, 0.14);
      const holder = new THREE.Group(); holder.add(wing, edge, arm, glove);
      if(s < 0) holder.scale.x = -1;
      wp.add(holder);
      U.wings.push(wp);
      U.limbs[s < 0 ? 'armL' : 'armR'] = new THREE.Group();          // the yard swings these; Swoop flaps instead
    }
    U.glow = glowSprite(0xff6a30, 3.0, 0, 0, -0.6);
    U.trail = [2.6, 0.9, 0.4];
    g.userData.scale = 1.25;
    return g;
  }
  if(type === 'bomb'){
    // a football bomb: Utah red, white stripes, a lit fuse
    const red = mat(UTAH_RED, 0.5);
    U.flash.push(red);
    part(g, footballGeo(0.5), red, 0, 0, 0);
    for(const z of [-0.12, 0.12]) part(g, new THREE.TorusGeometry(0.15, 0.018, 4, 20), mat(0xffffff, 0.6), 0, 0, z);
    part(g, new THREE.CylinderGeometry(0.012, 0.012, 0.16, 5), mat(0x222222, 0.8), 0, 0.2, 0, 0.3);
    U.glow = glowSprite(0xffd060, 0.9, 0, 0.3, 0.03);
    return g;
  }
  return g;
}

/* ---------- what the guns fire ----------
   A miniature BYU player, flying arms-out like Superman; or (the scope's)
   a miniature Cosmo the Cougar, royal blue, No. 00. About 40 cm long. */
export function buildMini(kind){
  const p = kind === 'cosmo' ? cosmoFigure() : buildPlayer(BYU(String([2, 5, 8, 10, 12, 18, 22, 33][Math.floor(Math.random() * 8)])), []);
  const L = p.userData.limbs;
  // the Superman, arms ahead - tipped up 45 degrees off the line it flies
  // along, so from behind the gun you see the jersey and the face, not the
  // soles of the shoes
  L.armL.rotation.x = L.armR.rotation.x = -Math.PI * 0.95;
  L.armL.rotation.z = 0.15; L.armR.rotation.z = -0.15;
  L.legL.rotation.x = 0.15; L.legR.rotation.x = -0.1;
  const g = new THREE.Group();
  p.rotation.x = -Math.PI / 4; p.position.set(0, -0.5, 0.65);
  g.add(p);
  g.scale.setScalar(kind === 'cosmo' ? 0.4 : 0.32);
  return g;
}

/* Cosmo the Cougar: golden-tan and shaggy, a big cream muzzle and beard,
   white bushy brows over squinting eyes, a pink nose, round ears; navy
   No. 00 with white sleeve stripes, blue pants, white gloves. */
export function cosmoFigure(){
  const tan = 0xc99a52;
  const p = buildPlayer(BYU('00', {helmet: tan, stripe: null, decal: null, mask: tan, skin: tan, pants: BYU_BLUE, jersey: 0x14306a, glove: 0xf6f6f6, sock: 0x14306a}), []);
  const head = p.userData.limbs.head;
  head.clear();
  const fur = mat(tan, 0.95), dark = mat(0x9a6f35, 0.95), cream = mat(0xf2ead8, 0.95), white = mat(0xffffff, 0.9), nose = mat(0xd88a8a, 0.6), ink = mat(0x2a1a10, 0.6);
  head.position.y += 0.06;
  part(head, new THREE.SphereGeometry(0.3, 20, 16), fur, 0, 0.04, 0).scale.set(1.05, 1, 0.95);
  part(head, new THREE.SphereGeometry(0.18, 14, 10), dark, 0, 0.2, 0.08).scale.set(0.5, 0.5, 0.9);         // the darker forehead
  part(head, new THREE.SphereGeometry(0.2, 16, 12), cream, 0, -0.1, 0.16).scale.set(1.25, 0.95, 0.85);     // muzzle and beard
  part(head, new THREE.SphereGeometry(0.06, 10, 8), nose, 0, -0.01, 0.33).scale.set(1.4, 0.8, 0.8);
  part(head, new THREE.BoxGeometry(0.08, 0.012, 0.01), ink, 0, -0.13, 0.33);                                 // the mouth
  for(const s of [-1, 1]){
    part(head, new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14), fur, s * 0.21, 0.27, -0.03, Math.PI / 2, 0, 0);           // round ears
    part(head, new THREE.CylinderGeometry(0.055, 0.055, 0.052, 12), dark, s * 0.21, 0.27, -0.02, Math.PI / 2, 0, 0);
    part(head, new THREE.SphereGeometry(0.05, 10, 6), ink, s * 0.1, 0.08, 0.25).scale.set(1.2, 0.35, 0.5);                 // squinting eyes
    part(head, new THREE.SphereGeometry(0.07, 10, 6), white, s * 0.11, 0.15, 0.24).scale.set(1.5, 0.55, 0.7);              // bushy white brows
  }
  // a tail
  const tail = part(p, new THREE.CylinderGeometry(0.03, 0.045, 0.6, 6), fur, 0, 0.75, -0.3, -0.9);
  part(tail, new THREE.SphereGeometry(0.055, 6, 4), dark, 0, 0.3, 0);
  return p;
}
export function buildCosmo(size){
  const g = new THREE.Group(), p = cosmoFigure();
  g.add(p); g.scale.setScalar(size / 1.9);
  return g;
}

/* ---------- the t-shirt cannons ----------
   What you hold, in place of the guns: a t-shirt cannon (one barrel), a
   triple-barrel "O-line" cannon, and a long Cosmo cannon with a scope.
   Same frame as yard.js's guns: pointing -z, muzzle in userData. */
export function buildCannon(key){
  const g = new THREE.Group();
  const navy = mat(BYU_BLUE, 0.6, 0.15), silver = mat(0xb8bec8, 0.4, 0.6), black = mat(0x18181c, 0.7), white = mat(0xf4f4f4, 0.85);
  const tank = mat(0x9aa4b4, 0.35, 0.6);
  let muzzle;
  // a barrel: navy with a white stripe, flared at the mouth, a rolled
  // t-shirt (white, a blue band) loaded in it
  const barrel = (x, y, z0, z1, r) => {
    const len = z0 - z1;
    part(g, new THREE.CylinderGeometry(r, r, len, 14), navy, x, y, (z0 + z1) / 2, Math.PI / 2);
    part(g, new THREE.CylinderGeometry(r * 1.02, r * 1.02, len * 0.12, 14), white, x, y, z1 + len * 0.3, Math.PI / 2);
    part(g, new THREE.CylinderGeometry(r * 1.45, r, 0.07, 14, 1, true), silver, x, y, z1 - 0.02, -Math.PI / 2);
    part(g, new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.05, 12), white, x, y, z1 - 0.01, Math.PI / 2);
    part(g, new THREE.TorusGeometry(r * 0.6, r * 0.2, 6, 12), navy, x, y, z1 - 0.04);
  };
  if(key === 'pistol'){
    barrel(0, 0.01, -0.12, -0.46, 0.034);
    part(g, new THREE.CylinderGeometry(0.024, 0.024, 0.14, 12), tank, 0, -0.05, -0.16, Math.PI / 2);
    part(g, new THREE.BoxGeometry(0.035, 0.11, 0.05), black, 0, -0.07, -0.06, -0.25);
    muzzle = new THREE.Vector3(0, 0.01, -0.5);
  } else if(key === 'shotgun'){
    for(const [x, y] of [[-0.04, 0.025], [0.04, 0.025], [0, -0.042]]) barrel(x, y, -0.14, -0.6, 0.03);
    part(g, new THREE.CylinderGeometry(0.04, 0.04, 0.16, 14), tank, 0, -0.03, -0.1, Math.PI / 2);
    part(g, new THREE.BoxGeometry(0.04, 0.12, 0.06), black, 0, -0.12, -0.04, -0.25);
    muzzle = new THREE.Vector3(0, 0.0, -0.64);
  } else {
    barrel(0, 0.01, -0.1, -0.82, 0.03);
    part(g, new THREE.CylinderGeometry(0.022, 0.022, 0.22, 12), black, 0, 0.07, -0.12, Math.PI / 2);
    part(g, new THREE.CircleGeometry(0.02, 16), new THREE.MeshBasicMaterial({color: 0x5ab0ff}), 0, 0.07, -0.231);
    part(g, new THREE.CylinderGeometry(0.03, 0.03, 0.16, 12), tank, 0, -0.045, -0.08, Math.PI / 2);
    part(g, new THREE.BoxGeometry(0.04, 0.1, 0.26), black, 0, -0.04, 0.12, 0.15);
    muzzle = new THREE.Vector3(0, 0.01, -0.86);
  }
  g.userData.muzzle = muzzle;
  return g;
}

/* A friend in the bunker, as a BYU player holding a t-shirt cannon, facing
   -z (as yard.js's avatars do); userData.arm is the aiming arm. */
export function buildByuAvatar(color, hexColor, tag){
  const g = new THREE.Group();
  const p = buildPlayer(BYU(String(10 + color * 7), {stripe: new THREE.Color(hexColor).getHex()}), []);
  p.rotation.y = Math.PI;
  p.userData.limbs.armR.visible = false;
  g.add(p);
  const arm = new THREE.Group(); arm.position.set(-0.36, 1.5, 0); g.add(arm);
  part(arm, new THREE.CylinderGeometry(0.075, 0.065, 0.55, 8), mat(BYU_BLUE, 0.75), 0, 0, -0.25, Math.PI / 2);
  const c = buildCannon('pistol'); c.position.set(0, -0.02, -0.3); arm.add(c);
  g.userData.arm = arm;
  if(tag){ tag.position.y = 2.15; g.add(tag); g.userData.tag = tag; }
  return g;
}

/* ---------- the field ---------- */
export function fieldTex(){
  const t = canvasTex(1024, 1024, (g, w, h) => {
    // mowed stripes, a yard line every five yards (here: every 4.6 m tile, two lines)
    for(let i = 0; i < 8; i++){ g.fillStyle = i % 2 ? '#2f6b2a' : '#367a30'; g.fillRect(0, i * h / 8, w, h / 8); }
    for(let i = 0; i < 3000; i++){ g.fillStyle = `rgba(${Math.random() < 0.5 ? 20 : 90},${80 + Math.random() * 60},20,0.12)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 5); }
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(0, 0, w, 8); g.fillRect(0, h / 2 - 4, w, 8);
    for(let x = 0; x < w; x += w / 16){ g.fillRect(x, h * 0.24, 4, 18); g.fillRect(x, h * 0.74, 4, 18); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* Goal posts, floodlights, end zones painted COUGARS and UTES. Returns a group. */
export function buildStadium(glowTex, hot){
  const g = new THREE.Group();
  const yellow = mat(0xffd21f, 0.4, 0.3);
  for(const z of [-30, 30]){
    const post = new THREE.Group(); post.position.set(0, 0, z); g.add(post);
    part(post, new THREE.CylinderGeometry(0.12, 0.12, 3, 8), yellow, 0, 1.5, 0);
    part(post, new THREE.CylinderGeometry(0.09, 0.09, 5.6, 8), yellow, 0, 3, 0, 0, 0, Math.PI / 2);
    for(const s of [-1, 1]) part(post, new THREE.CylinderGeometry(0.07, 0.07, 9, 8), yellow, s * 2.8, 7.5, 0);
  }
  // the end zones
  const words = (word, col) => canvasTex(1024, 256, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = col; c.font = '900 200px Impact, Arial Black'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(word, w / 2, h / 2 + 10); });
  const ez = (word, col, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(22, 5.5), new THREE.MeshStandardMaterial({map: words(word, col), transparent: true, depthWrite: false, roughness: 1}));
    m.rotation.set(-Math.PI / 2, 0, ry); m.position.set(0, 0.02, z); g.add(m);
  };
  ez('COUGARS', '#1f5fd6', -19, 0);
  ez('UTES', '#d81818', 19, Math.PI);
  // floodlights on towers at the corners
  const steel = mat(0x8a8f99, 0.5, 0.6);
  for(const [x, z] of [[-24, -24], [24, -24], [-24, 24], [24, 24]]){
    const t = new THREE.Group(); t.position.set(x, 0, z); t.lookAt(0, 0, 0); g.add(t);
    part(t, new THREE.CylinderGeometry(0.25, 0.4, 20, 8), steel, 0, 10, 0);
    part(t, new THREE.BoxGeometry(5, 2.6, 0.3), steel, 0, 20.5, 0.3);
    for(let i = 0; i < 4; i++) for(let j = 0; j < 2; j++){
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTex, color: hot(0xfff4dc, 3), blending: THREE.AdditiveBlending, depthWrite: false}));
      sp.scale.set(2.4, 2.4, 1); sp.position.set(-1.8 + i * 1.2, 19.9 + j * 1.2, 0.6); t.add(sp);
    }
  }
  return g;
}
