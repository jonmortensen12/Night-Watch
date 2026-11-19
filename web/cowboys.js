/* Night Watch: Wagon - cowboys and cowgirls.

   Quaternius's animated characters (Cowboy_Hair, Cowboy_Female; CC0), from
   the model bundle (models.js). Every one is dressed differently - jacket,
   shirt, bandana, hat, trousers and hair drawn from palettes - so a gang
   does not look like clones, and a player's own colour goes on their jacket.

   Animations (each model has 17): Idle, Walk, Run, Jump, Punch, SwordSlash,
   Shoot_OneHanded, SitDown, StandUp, Death, Victory, ... A pose that none of
   them has (both hands up on a rope; sitting astride a horse) is made by
   setting bones after the mixer has run: override(). */
import * as THREE from 'three';
import * as M from './models.js';

export const COWBOYS = ['Cowboy_Hair', 'Cowboy_Female'];

const PAL = {
  Jacket: [0x5a3418, 0x2a2420, 0x4a5568, 0x55603a, 0x8a6a40, 0x6a2418, 0x3a3048, 0x7a5a3a],
  Top:    [0xe8dcc0, 0x8a2a20, 0x3a5a8a, 0x6a6a6a, 0xc8a060, 0x2a4a3a, 0xd8d0b0],
  Scarf:  [0xb02020, 0x2050a0, 0x202020, 0xd0a020, 0x308040, 0x7a2a8a, 0xe0e0e0],
  HatBrown: [0x6a4020, 0x2a2018, 0x8a8070, 0xc0a070, 0x4a3020, 0x1a1a1a],
  Pants:  [0x2a3a5a, 0x3a2a1a, 0x1e1e22, 0x7a6a4a, 0x4a4030],
  Hair:   [0x1a1410, 0x4a2a14, 0xc8a050, 0x8a8880, 0x6a2a10],
  Skin:   [0xe8b896, 0xd09a74, 0xb07850, 0x8a5838, 0xf0c8a8, 0x6a4028],     // the file's own is near black
};
const pick = (list, r) => list[Math.floor(r() * list.length) % list.length];
function rng(seed){ let s = (seed * 2654435761) >>> 0 || 1; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); }

/* A hat for those whose model has none (Cowboy_Hair is bare-headed). */
function hat(color){
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({color, roughness: 0.9});
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.025, 20), m);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.17, 14), m);
  crown.position.y = 0.09; crown.scale.z = 0.85;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.035, 14), new THREE.MeshStandardMaterial({color: 0x2a1a10}));
  band.position.y = 0.025;
  g.add(brim, crown, band);
  return g;
}

/* opts: {model (one of COWBOYS, else picked), seed, height, jacket (a colour:
   a player's), gun (true: a revolver in the right hand), dynamite} */
export function makeCowboy(opts){
  opts = opts || {};
  const r = rng(opts.seed == null ? Math.floor(Math.random() * 1e6) : opts.seed);
  const name = opts.model || pick(COWBOYS, r);
  return M.load(name).then(m => {
    if(!m) return null;
    const g = M.makeNow(m, {height: opts.height || 1.8, rotY: Math.PI});
    M.ownMaterials(g);
    const look = {};
    for(const mt of M.materials(g)){
      const want = mt.name === 'Jacket' && opts.jacket != null ? opts.jacket : PAL[mt.name] ? pick(PAL[mt.name], r) : null;
      if(want != null && mt.color){ mt.color.set(want); look[mt.name] = mt.color.getHex(); }
    }
    const bones = {};
    // names are made unique across the bundle (UpperArm.L -> UpperArmL1): strip that
    g.traverse(o => { if(o.isBone){ const k = o.name.replace(/[._]/g, '').replace(/\d+$/, ''); if(!bones[k]) bones[k] = o; } });
    const U = g.userData;
    U.bones = bones;
    U.look = look;
    U.flash = M.materials(g).filter(mt => mt.emissive);
    U.hatColor = look.HatBrown || 0x6a4020;
    if(name === 'Cowboy_Hair' && bones.Head){
      const h = hat(U.hatColor);
      // the bone is in the model's own scale: undo it, then sit on the hair
      const s = 1 / g.userData.model.scale.x;
      h.scale.setScalar(s * 1.15);
      h.position.set(0, 0.62 * s, 0.02 * s);
      bones.Head.add(h);
      U.hat = h;
    }
    U.hand = bones.FistR || null;
    U.over = {};
    /* Bone overrides, set after every mixer update: {bone: [x, y, z]} in
       radians, absolute. Pass null to clear. */
    U.override = o => { U.over = o || {}; };
    U.update = dt => {
      if(U.mixer) U.mixer.update(dt);
      for(const k in U.over){ const b = bones[k]; if(b) b.rotation.set(U.over[k][0], U.over[k][1], U.over[k][2]); }
    };
    /* play a clip; once: stop at its last frame (SitDown, Death) */
    U.pose = (clip, once, speed) => {
      const act = U.play(clip, speed);
      if(act){
        act.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
        act.clampWhenFinished = !!once;
        if(once && U.lastOnce !== clip){ act.reset().play(); U.lastOnce = clip; }
        if(!once) U.lastOnce = null;
      }
      return act;
    };
    U.pose('Idle');
    U.mixer.update(Math.random());
    return g;
  });
}

/* Things to hold, put in the right fist (in the bone's own scale). */
export function holdInHand(g, obj, offset){
  const hand = g.userData.hand;
  if(!hand) return false;
  const s = 1 / g.userData.model.scale.x;
  obj.scale.multiplyScalar(s);
  if(offset) obj.position.copy(offset).multiplyScalar(s);
  hand.add(obj);
  return true;
}
