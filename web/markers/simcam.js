/* Night Watch: Haunted House - a pretend camera, for testing without a phone.

   The pretend living room from the AR experiments (../ar/fakeroom.js) with
   printed markers taped up in it, drawn from wherever the test says the
   phone is. Its picture stands in for the camera's, and the way it points
   stands in for the motion sensors - turned by a yaw of the test's choosing,
   as real sensors are (they start from a direction of their own), and a
   little noisy. Only ?sim=1 loads this; hauntcheck.mjs drives it.

   The markers: a window on the front wall, one on the left wall (beside
   the painted windows, not on them), a doorway
   on the floor by the right wall (its arrow pointing at the wall: monsters
   come from there), and pair A spanning a wide window in the back wall. */
import * as THREE from 'three';
import {buildRoom} from '../ar/fakeroom.js';
import {drawMarker, SIZE} from './markers.js';

export const SIM_MARKERS = [
  {id: 0, p: [0.9, 1.3, -2.985], face: 'front'},
  {id: 1, p: [-2.785, 1.2, -1.4], face: 'left'},
  {id: 2, p: [2.0, 0.002, -0.6], floor: true},
  {id: 12, p: [-1.1, 1.05, 2.99], face: 'back'},
  {id: 13, p: [0.6, 1.05, 2.99], face: 'back'},
];

function paper(THREE, id, style){
  // a sheet of A4 at 2 px a millimetre, the marker 16 cm, an arrow above
  const c = document.createElement('canvas');
  c.width = 420; c.height = 594;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, c.width, c.height);
  const s = SIZE * 2000, x = (c.width - s) / 2, y = 150;
  drawMarker(g, id, x, y, s, style);
  g.strokeStyle = '#bbb'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(210, 60); g.lineTo(240, 95); g.lineTo(222, 95); g.lineTo(222, 120); g.lineTo(198, 120); g.lineTo(198, 95); g.lineTo(180, 95); g.closePath(); g.stroke();
  g.fillStyle = '#222'; g.font = '900 40px system-ui'; g.textAlign = 'center'; g.fillText(String(id + 1), 210, 48);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  // the plane, shifted so the marker's centre is its origin
  const W = 0.21, H = 0.297, cy = (y + s / 2) / 2000;
  const geo = new THREE.PlaneGeometry(W, H).translate(0, H / 2 - cy, 0);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({map: t}));
}

export function createSimCam(opts){
  const W = opts.w || 480, H = opts.h || 640;
  const F = opts.f || 0.7 * Math.max(W, H);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const renderer = new THREE.WebGLRenderer({canvas, preserveDrawingBuffer: true, antialias: true});
  renderer.setSize(W, H, false);
  const scene = buildRoom(THREE, {plain: true});
  for(const m of SIM_MARKERS){
    const mesh = paper(THREE, m.id, opts.style || 'hatch');
    mesh.position.set(...m.p);
    if(m.floor){ mesh.rotation.order = 'YXZ'; mesh.rotation.set(-Math.PI / 2, -Math.PI / 2, 0); }
    else mesh.rotation.y = {front: 0, left: Math.PI / 2, right: -Math.PI / 2, back: Math.PI}[m.face];
    scene.add(mesh);
  }
  const cam = new THREE.PerspectiveCamera(2 * Math.atan(H / 2 / F) * 180 / Math.PI, W / H, 0.05, 50);
  cam.rotation.order = 'YXZ';
  const pose = {p: [0, 1.4, 0.3], yaw: 0, pitch: 0, roll: 0};
  const sensorYaw = opts.sensorYaw || 0;
  const q = new THREE.Quaternion(), qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sensorYaw);
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
  return {
    canvas, w: W, h: H, F, pose,
    set(p, yaw, pitch, roll){ if(p) pose.p = p.slice(); if(yaw != null) pose.yaw = yaw; if(pitch != null) pose.pitch = pitch; if(roll != null) pose.roll = roll; },
    render(){
      cam.position.set(...pose.p);
      cam.rotation.set(pose.pitch, pose.yaw, pose.roll);
      renderer.render(scene, cam);
    },
    /* What the motion sensors would say: the true turn, from their own
       starting direction, with a little jitter. */
    sensor(out){
      q.setFromEuler(new THREE.Euler(pose.pitch + rnd() * 0.004, pose.yaw + rnd() * 0.004, pose.roll, 'YXZ'));
      return out.copy(qy).multiply(q);
    },
  };
}
