/* Night Watch - models made by somebody who can model.

   Quaternius's free (CC0) low-poly packs, as GLB files in web/models/ (see
   ASSETS.md for where they come from and what else there is). Each file is
   loaded once; every use is a clone. A skinned, animated model (the horses)
   is cloned with SkeletonUtils so each copy has its own skeleton and its own
   AnimationMixer.

   Loading is in the background: callers build their own stand-in first and
   swap the real model in when ready() resolves, so a slow connection (or a
   missing file) never stops the game - it just looks plainer. */
import * as THREE from 'three';
import {GLTFLoader} from './lib/loaders/GLTFLoader.js';
import {clone as skinClone} from './lib/utils/SkeletonUtils.js';

const DIR = new URL('models/', import.meta.url).href;
const loader = new GLTFLoader();
const cache = new Map();      // name -> Promise<{scene, animations, size}>

export function load(name){
  if(!cache.has(name)){
    cache.set(name, new Promise(res => {
      loader.load(DIR + name + '.glb', g => {
        const box = new THREE.Box3().setFromObject(g.scene);
        const size = box.getSize(new THREE.Vector3());
        g.scene.traverse(o => { if(o.isMesh){ o.frustumCulled = !o.isSkinnedMesh; } });
        res({scene: g.scene, animations: g.animations, size, box});
      }, undefined, () => res(null));
    }));
  }
  return cache.get(name);
}

/* All of them, at once; resolves when every one has loaded (or failed). */
export function preload(names){ return Promise.all(names.map(load)); }

/* A copy of a loaded model, scaled so it is `height` metres tall (or `length`
   metres long in z), standing on y = 0, centred in x and z. Returns null if
   the file did not load. opts: {height | length | width, rotY, skinned}. */
export async function make(name, opts){
  const m = await load(name);
  if(!m) return null;
  return place(m, opts || {});
}
export function makeNow(m, opts){ return m ? place(m, opts || {}) : null; }

function place(m, opts){
  const inner = opts.skinned || m.animations.length ? skinClone(m.scene) : m.scene.clone(true);
  const s = opts.height ? opts.height / m.size.y : opts.length ? opts.length / m.size.z : opts.width ? opts.width / m.size.x : (opts.scale || 1);
  inner.scale.setScalar(s);
  const c = m.box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x * s, -m.box.min.y * s, -c.z * s);
  const g = new THREE.Group();
  if(opts.rotY){ const r = new THREE.Group(); r.rotation.y = opts.rotY; r.add(inner); g.add(r); }
  else g.add(inner);
  g.userData.model = inner;
  if(m.animations.length){
    const mixer = new THREE.AnimationMixer(inner);
    g.userData.mixer = mixer;
    g.userData.clips = Object.fromEntries(m.animations.map(a => [a.name.split('|').pop(), a]));
    g.userData.play = (clip, speed) => {
      const a = g.userData.clips[clip];
      if(!a) return null;
      if(g.userData.action && g.userData.action.getClip() === a){ g.userData.action.timeScale = speed || 1; return g.userData.action; }
      const act = mixer.clipAction(a);
      act.reset().setEffectiveTimeScale(speed || 1).play();
      if(g.userData.action) g.userData.action.crossFadeTo(act, 0.25, false);
      g.userData.action = act;
      return act;
    };
  }
  return g;
}

/* The materials of a model, to tint (a black horse, a flash when hit). */
export function materials(obj){
  const out = [];
  obj.traverse(o => { if(o.isMesh) for(const mt of [].concat(o.material)) if(out.indexOf(mt) < 0) out.push(mt); });
  return out;
}
/* Give a clone its own materials, so tinting one does not tint them all. */
export function ownMaterials(obj){
  obj.traverse(o => { if(o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone(); });
  return obj;
}
