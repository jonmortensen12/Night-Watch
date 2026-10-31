/* Night Watch: AR Bunker - a pretend living room, for testing without a
   phone.

   A textured room drawn with three.js, and a walk through it, so the
   tracker can be tested against the truth (trackcheck.mjs) and the AR
   Bunker page can be played end to end with a "camera" that is really this
   room (play.html?arsim=1, used by netcheck). Nothing in a real game loads
   it.

   The room: 5.6 m wide (x), 6 m deep (z), 2.5 m high, floor at y = 0, the
   player starting at (0, 1.35, 1.5) facing -z. Windows on the front and
   left walls, a door on the right: the barricades a test tags. */
export const ROOM = {w: 5.6, d: 6, h: 2.5};
export const WINDOWS = [
  {name: 'front window', p: [-0.9, 1.3, -3], n: [0, 0, 1]},
  {name: 'left window', p: [-2.8, 1.3, 0.2], n: [1, 0, 0]},
  {name: 'right door', p: [2.8, 1.0, -0.8], n: [-1, 0, 0]},
];

function rng(seed){ let s = seed; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }

function tex(THREE, size, seed, draw){
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
/* wallpaper with things on it: frames, posters, switches, scuffs */
function wall(g, s, r, base){
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for(let i = 0; i < 3000; i++){ g.fillStyle = `rgba(${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},0.05)`; g.fillRect(r() * s, r() * s, 2 + r() * 6, 2 + r() * 6); }
  for(let i = 0; i < 14; i++){
    const w = 30 + r() * 160, h = 30 + r() * 160, x = r() * (s - w), y = r() * (s - h);
    g.fillStyle = `hsl(${r() * 360},${20 + r() * 60}%,${15 + r() * 60}%)`;
    g.fillRect(x, y, w, h);
    g.strokeStyle = r() < 0.5 ? '#111' : '#eee'; g.lineWidth = 3 + r() * 6; g.strokeRect(x, y, w, h);
    for(let k = 0; k < 6; k++){
      g.fillStyle = `hsl(${r() * 360},${40 + r() * 50}%,${20 + r() * 60}%)`;
      g.beginPath(); g.arc(x + r() * w, y + r() * h, 4 + r() * Math.min(w, h) / 4, 0, 6.3); g.fill();
    }
  }
}

export function buildRoom(THREE){
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202020);
  const {w, d, h} = ROOM;
  const mat = (t, rep) => { if(rep){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } return new THREE.MeshBasicMaterial({map: t, side: THREE.DoubleSide}); };
  const plane = (W, H, m, pos, rot) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(W, H), m); o.position.set(...pos); o.rotation.set(...rot); scene.add(o); return o; };
  // floor: boards and a rug
  plane(w, d, mat(tex(THREE, 1024, 3, (g, s, r) => {
    for(let i = 0; i < 16; i++){
      const sh = 90 + r() * 50;
      g.fillStyle = `rgb(${sh},${sh * 0.68},${sh * 0.42})`; g.fillRect(0, i * s / 16, s, s / 16);
      g.fillStyle = '#2a1a0c'; g.fillRect(0, i * s / 16, s, 2); g.fillRect(r() * s, i * s / 16, 3, s / 16);
      for(let k = 0; k < 30; k++){ g.fillStyle = `rgba(40,20,5,${0.2 + r() * 0.3})`; g.fillRect(r() * s, i * s / 16 + r() * s / 16, 10 + r() * 60, 1 + r() * 2); }
    }
    g.save(); g.translate(s * 0.25, s * 0.3);
    for(let k = 0; k < 12; k++){ g.strokeStyle = `hsl(${r() * 360},50%,${30 + r() * 40}%)`; g.lineWidth = 6 + r() * 8; g.strokeRect(k * 10, k * 10, s * 0.5 - k * 20, s * 0.4 - k * 20); }
    for(let k = 0; k < 40; k++){ g.fillStyle = `hsl(${r() * 360},60%,${30 + r() * 40}%)`; g.fillRect(r() * s * 0.5, r() * s * 0.4, 8 + r() * 20, 8 + r() * 20); }
    g.restore();
  })), [0, 0, 0], [-Math.PI / 2, 0, 0]);
  plane(w, d, mat(tex(THREE, 512, 5, (g, s, r) => { g.fillStyle = '#d8d4cc'; g.fillRect(0, 0, s, s); for(let i = 0; i < 400; i++){ g.fillStyle = `rgba(0,0,0,${r() * 0.15})`; g.fillRect(r() * s, r() * s, 3 + r() * 10, 3 + r() * 10); } })), [0, h, 0], [Math.PI / 2, 0, 0]);
  const wallMat = seed => mat(tex(THREE, 1024, seed, (g, s, r) => wall(g, s, r, ['#8a7f6e', '#6f7f8a', '#7d8a6f', '#8a6f7a'][seed % 4])));
  plane(w, h, wallMat(11), [0, h / 2, -d / 2], [0, 0, 0]);
  plane(w, h, wallMat(12), [0, h / 2, d / 2], [0, Math.PI, 0]);
  plane(d, h, wallMat(13), [-w / 2, h / 2, 0], [0, Math.PI / 2, 0]);
  plane(d, h, wallMat(14), [w / 2, h / 2, 0], [0, -Math.PI / 2, 0]);
  // windows and a door, drawn on the walls
  const win = (W, H) => mat(tex(THREE, 256, 21, (g, s, r) => {
    g.fillStyle = '#1b2633'; g.fillRect(0, 0, s, s);
    for(let i = 0; i < 60; i++){ g.fillStyle = `rgba(200,220,255,${r() * 0.6})`; g.fillRect(r() * s, r() * s, 2, 2); }
    g.strokeStyle = '#f2efe8'; g.lineWidth = 18; g.strokeRect(9, 9, s - 18, s - 18);
    g.lineWidth = 10; g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  }));
  for(const W of WINDOWS){
    const big = W.name.indexOf('door') >= 0;
    const o = plane(big ? 0.9 : 1.1, big ? 2.0 : 1.1, win(), [W.p[0] + W.n[0] * 0.01, W.p[1], W.p[2] + W.n[2] * 0.01], [0, Math.atan2(W.n[0], W.n[2]), 0]);
    o.renderOrder = 1;
  }
  // furniture: a couch, a table, a bookcase
  const boxTex = seed => mat(tex(THREE, 256, seed, (g, s, r) => {
    g.fillStyle = `hsl(${r() * 360},30%,35%)`; g.fillRect(0, 0, s, s);
    for(let i = 0; i < 80; i++){ g.fillStyle = `hsl(${r() * 360},${30 + r() * 50}%,${20 + r() * 60}%)`; g.fillRect(r() * s, r() * s, 6 + r() * 40, 6 + r() * 40); }
  }));
  const box = (sx, sy, sz, x, y, z, seed) => { const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), boxTex(seed)); o.position.set(x, y, z); scene.add(o); };
  box(2.0, 0.8, 0.9, 0.6, 0.4, 2.4, 31);
  box(1.0, 0.45, 0.6, 0.4, 0.22, -0.4, 32);
  box(0.4, 1.9, 1.2, 2.55, 0.95, 1.6, 33);
  box(0.5, 0.7, 0.5, -2.3, 0.35, -2.3, 34);
  return scene;
}

/* The walk: look round, step aside (the tracker needs to see things from
   two places), look down at the floor, walk to the front, turn round fast,
   walk back. t in seconds; returns {p: [x, y, z], yaw, pitch}. */
export const WALK_TIME = 22;
export function walk(t){
  const E = 1.35;
  const lerp = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));
  const sm = k => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
  let x = 0, z = 1.5, yaw = 0, pitch = -0.15;
  // 0-3: sway and look round, a step to the side
  yaw = Math.sin(t * 1.1) * 0.5 * sm(t / 1.5);
  x = lerp(0, 0.45, sm(t / 3));
  // 3-6: look down at the floor while stepping back
  if(t > 3){ pitch = lerp(-0.15, -0.75, sm((t - 3) / 1.2)) ; x = lerp(0.45, 0.0, sm((t - 3) / 3)); }
  if(t > 5.5) pitch = lerp(-0.75, -0.2, sm((t - 5.5) / 1));
  // 7-13: walk to the front, looking about
  if(t > 7){ z = lerp(1.5, -1.6, sm((t - 7) / 6)); x = lerp(0, -0.5, sm((t - 7) / 6)); yaw = Math.sin(t * 0.9) * 0.6; }
  // 13-14: a fast turn round
  if(t > 13){ yaw = Math.sin(13 * 0.9) * 0.6 + lerp(0, Math.PI, sm((t - 13) / 0.7)); }
  // 14-22: walk back, looking about
  if(t > 14){ z = lerp(-1.6, 1.2, sm((t - 14) / 7)); x = lerp(-0.5, 0.8, sm((t - 14) / 7)); yaw = Math.sin(13 * 0.9) * 0.6 + Math.PI + Math.sin((t - 14) * 0.8) * 0.5; }
  const y = E + Math.sin(t * 6.5) * 0.015 * (t > 7 ? 1 : 0.2);   // a little bob as you walk
  return {p: [x, y, z], yaw, pitch};
}

/* How AR Bunker is really played: stand in the middle and look all the way
   round, walk over to the front window facing it, look about there, turn
   and walk to the left window, then back to the middle. */
export const GAME_TIME = 26;
export function gameWalk(t){
  const E = 1.35;
  const sm = k => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
  const lerp = (a, b, k) => a + (b - a) * sm(k);
  let x = 0, z = 1.5, yaw = 0, pitch = -0.2;
  // 0-2: look down at the floor, a small sway (how the game asks to start)
  pitch = -0.2 - 0.45 * Math.sin(Math.min(1, t / 2) * Math.PI);
  x = Math.sin(t * 1.3) * 0.08;
  // 2-9: all the way round, stepping in a small circle (what the scan asks for:
  // seeing the walls from more than one spot is what places them)
  if(t > 2){
    yaw = lerp(0, Math.PI * 2, (t - 2) / 7);
    const k = Math.min(1, (t - 2) / 1.5) * (1 - Math.max(0, Math.min(1, (t - 8) / 1)));
    x = Math.sin(yaw + 1.2) * 0.35 * k; z = 1.5 + (Math.cos(yaw + 1.2) - Math.cos(1.2)) * 0.35 * k;
  }
  // 9-14: walk to the front window, looking at it (about half a metre a second)
  if(t > 9){ yaw = Math.PI * 2 + Math.sin((t - 9) * 0.8) * 0.15; x = lerp(0, -0.7, (t - 9) / 5); z = lerp(1.5, -1.6, (t - 9) / 5); pitch = -0.1; }
  // 14-16: look about by the window
  if(t > 14){ yaw = Math.PI * 2 + Math.sin((t - 13) * 1.2) * 0.7; pitch = -0.1 + Math.sin((t - 13) * 2) * 0.2; }
  // 16-17: turn to face the left window
  if(t > 16) yaw = lerp(Math.PI * 2 + Math.sin(2 * 1.2) * 0.7, Math.PI * 2 + Math.PI / 2, t - 16);
  // 17-21: walk to it
  if(t > 17){ x = lerp(-0.7, -2.0, (t - 17) / 4); z = lerp(-1.6, 0.2, (t - 17) / 4); pitch = -0.15; }
  // 21-26: back to the middle, looking about
  if(t > 21){ x = lerp(-2.0, 0, (t - 21) / 5); z = lerp(0.2, 1.0, (t - 21) / 5); yaw = Math.PI * 2 + Math.PI / 2 - lerp(0, Math.PI * 1.5, (t - 21) / 5); }
  return {p: [x, E + Math.sin(t * 6.5) * 0.01, z], yaw, pitch};
}
