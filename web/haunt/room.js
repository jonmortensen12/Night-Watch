/* Night Watch: Haunted House - the room, from its markers.

   Three jobs.

   The survey. One person stands in the middle of the room and turns slowly
   round, pointing the camera at every marker. The phone's own motion sensors
   say which way it points; each marker's corners say how far away it is and
   how it lies. A marker seen alongside one already placed also corrects
   where the phone is, so stepping about a little does no harm. The room's
   frame is that phone's: y up from the floor, x and z level, the middle of
   the room where the survey began.

   The plan. Each marker becomes a portal: one on a wall is a hole in the
   wall the size of a window, centred on it; one on the floor is a doorway
   standing on it, facing the way its arrow points (the way monsters come
   from). A pair (A, B or C, left and right) spans the gap between them, for
   a wide window or a big doorway.

   Finding yourself. Every phone, every frame: the markers in view say where
   the phone is in the room. The motion sensors say which way it points, but
   from a starting direction of their own; the markers say how far round
   that is (yaw), and that is kept and slowly corrected. Between sightings
   the phone stays where it was last seen to be, still turning freely.

   Plain arrays, no three.js: rotations are row-major 3x3, quaternions
   [x, y, z, w]. Frames as in three.js: a camera looks down its -z. */
import {solvePose, focalFrom, pairOf, label, SINGLES} from './markers.js';

export const WINDOW = 1.2;           // a wall marker's hole, metres square
export const DOOR_W = 1.0, DOOR_H = 2.05;
export const EYE_GUESS = 1.35;       // the phone's height when the survey had no floor marker
export const CEIL = 2.4;

/* ---------- kit ---------- */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
export const mul = (A, B) => { const C = new Array(9); for(let i = 0; i < 3; i++) for(let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return C; };
export const tr = A => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
export function matOfQuat(q){
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
export function quatOfMat(m){
  const t = m[0] + m[4] + m[8];
  let x, y, z, w;
  if(t > 0){ const s = 0.5 / Math.sqrt(t + 1); w = 0.25 / s; x = (m[7] - m[5]) * s; y = (m[2] - m[6]) * s; z = (m[3] - m[1]) * s; }
  else if(m[0] > m[4] && m[0] > m[8]){ const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]); w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s; }
  else if(m[4] > m[8]){ const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]); w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s; }
  else { const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]); w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s; }
  return [x, y, z, w];
}
export function yawMat(a){ const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
const colOf = (R, k) => [R[k], R[3 + k], R[6 + k]];
const wrap = a => { while(a > Math.PI) a -= 2 * Math.PI; while(a < -Math.PI) a += 2 * Math.PI; return a; };

/* A weighted, outlier-proof middle of some 3D points. */
function robustMean(samples, key, keep){
  if(!samples.length) return null;
  const med = [0, 1, 2].map(k => samples.map(s => s[key][k]).sort((a, b) => a - b)[samples.length >> 1]);
  let s = [0, 0, 0], w = 0;
  for(const x of samples){
    if(Math.hypot(x[key][0] - med[0], x[key][1] - med[1], x[key][2] - med[2]) > keep) continue;
    s = add(s, scale(x[key], x.w)); w += x.w;
  }
  return w ? scale(s, 1 / w) : med;
}

/* A marker's sighting: where it is and how it lies, in a frame where the
   camera turns by Rc (camera to frame) and stands at P. */
function sighting(d, Rc, P, cam){
  const pose = solvePose(d.c, cam.f, cam.cx, cam.cy);
  if(!pose || pose.err > 2.5) return null;
  const Rw = mul(Rc, pose.R);
  return {id: d.id, pose, Rw, off: mv(Rc, pose.t), p: P ? add(P, mv(Rc, pose.t)) : null, px: d.px};
}

/* ================= the survey ================= */
export class Survey {
  constructor(){
    this.log = [];           // every frame with a marker in it, to go over again at the end
    this.reset();
  }
  reset(){
    this.seen = {};          // id -> {samples: [{p, n, up, w}]}
    this.P = [0, 0, 0];      // where the phone is, in the survey's frame
    this.cams = [];
    this.frames = 0;
  }
  /* dets: from the detector. Rc: the camera's rotation (sensors), row-major.
     cam: {f, cx, cy}. */
  add(dets, Rc, cam){
    if(dets.length){
      this.log.push({dets: dets.map(d => ({id: d.id, c: d.c, px: d.px, ctr: d.ctr})), Rc});
      if(this.log.length > 900) this.log.splice(0, 100);
    }
    return this.process(dets, Rc, cam);
  }
  process(dets, Rc, cam){
    this.frames++;
    const S = [];
    for(const d of dets){ const s = sighting(d, Rc, null, cam); if(s) S.push(s); }
    if(!S.length) return [];
    // where the phone is: from the markers already placed that are in view
    const known = S.filter(s => this.placed(s.id));
    if(known.length){
      let P = [0, 0, 0], w = 0;
      for(const s of known){ const c = this.where(s.id); const k = s.px * s.px; P = add(P, scale(sub(c, s.off), k)); w += k; }
      this.P = scale(P, 1 / w);
    }
    this.cams.push(this.P.slice());
    for(const s of S){
      const m = this.seen[s.id] || (this.seen[s.id] = {samples: []});
      const turnW = Math.max(0.05, 1 - Math.min(1, s.pose.amb * 1.3));
      m.samples.push({p: add(this.P, s.off), n: colOf(s.Rw, 2), up: colOf(s.Rw, 1), w: s.px * s.px / (1 + s.pose.err), tw: turnW * s.px});
      if(m.samples.length > 240) m.samples.splice(0, 40);
      m.est = null;
    }
    return S.map(s => s.id);
  }
  placed(id){ const m = this.seen[id]; return !!m && m.samples.length >= 6; }
  where(id){
    const m = this.seen[id];
    if(!m.est) m.est = robustMean(m.samples, 'p', 0.25);
    return m.est;
  }
  /* The markers found so far, as the survey screen lists them. */
  list(){
    return Object.keys(this.seen).map(Number).sort((a, b) => a - b).map(id => {
      const m = this.seen[id], o = orient(m.samples);
      return {id, label: label(id), n: m.samples.length, ok: this.placed(id), kind: o ? o.kind : '?'};
    });
  }
  /* The camera's focal length, from the survey itself. Turning on the spot,
     a marker sweeps across the picture; with the wrong focal length its
     direction (sensors plus where it is in the picture) wanders as it goes,
     most at the edges. The right one holds every marker still. */
  calibrate(cam){
    const rows = [];
    for(const fr of this.log) for(const d of fr.dets) rows.push({id: d.id, u: d.ctr[0] - cam.cx, v: d.ctr[1] - cam.cy, Rc: fr.Rc});
    const ids = [...new Set(rows.map(r => r.id))];
    if(rows.length < 30) return null;
    // only markers seen across a fair part of the picture say anything
    const spreadOf = f => {
      let tot = 0, n = 0;
      for(const id of ids){
        const R = rows.filter(r => r.id === id);
        if(R.length < 5) continue;
        const dirs = R.map(r => norm(mv(r.Rc, norm([r.u / f, -r.v / f, -1]))));
        const m = norm(dirs.reduce((a, d) => add(a, d), [0, 0, 0]));
        for(const d of dirs){ const c = Math.min(1, dot(d, m)); tot += Math.acos(c) ** 2; n++; }
      }
      return n ? tot / n : null;
    };
    let best = null, bs = Infinity;
    const L = 2 * Math.max(cam.cx, cam.cy);
    for(let k = 0.5; k <= 1.3; k += 0.01){
      const s = spreadOf(k * L);
      if(s != null && s < bs){ bs = s; best = k * L; }
    }
    if(best == null) return null;
    // a finer look round the best
    for(let f = best * 0.985; f <= best * 1.015; f += best * 0.002){ const s = spreadOf(f); if(s < bs){ bs = s; best = f; } }
    return best;
  }

  /* The finished plan: everything gone over again with the best focal
     length. Returns the layout (with .f, the focal length it used). */
  build(cam){
    if(cam){
      const f = this.calibrate(cam);
      const use = Object.assign({}, cam, {f: f || cam.f});
      this.reset();
      for(const fr of this.log) this.process(fr.dets, fr.Rc, use);
      this.f = use.f;
    }
    const marks = {};
    for(const id of Object.keys(this.seen).map(Number)){
      if(!this.placed(id)) continue;
      const m = this.seen[id], o = orient(m.samples);
      if(!o) continue;
      marks[id] = {p: this.where(id), R: o.R, kind: o.kind};
    }
    const floors = Object.values(marks).filter(m => m.kind === 'floor');
    const camY = this.cams.length ? this.cams.reduce((a, c) => a + c[1], 0) / this.cams.length : 0;
    const floorY = floors.length ? floors.reduce((a, m) => a + m.p[1], 0) / floors.length : camY - EYE_GUESS;
    // the middle: where the survey was done from
    const cx = this.cams.length ? this.cams.reduce((a, c) => a + c[0], 0) / this.cams.length : 0;
    const cz = this.cams.length ? this.cams.reduce((a, c) => a + c[2], 0) / this.cams.length : 0;
    const out = {};
    for(const id in marks){
      const m = marks[id];
      out[id] = {p: [m.p[0] - cx, m.kind === 'floor' ? 0 : m.p[1] - floorY, m.p[2] - cz].map(v => Math.round(v * 1000) / 1000),
        q: quatOfMat(m.R).map(v => Math.round(v * 10000) / 10000), kind: m.kind};
    }
    const L = makeLayout(out);
    if(this.f) L.f = Math.round(this.f * 10) / 10;
    return L;
  }
}

/* How a marker lies, from its sightings: a wall or the floor, and its turn
   squared up to the room (walls stand straight, the floor is level). */
function orient(samples){
  let n = [0, 0, 0], up = [0, 0, 0];
  for(const s of samples){ n = add(n, scale(s.n, s.tw)); up = add(up, scale(s.up, s.tw)); }
  if(Math.hypot(...n) < 1e-6) return null;
  n = norm(n);
  if(Math.abs(n[1]) < 0.5){
    // a wall: facing level; its own up stays in the wall
    const Z = norm([n[0], 0, n[2]]);
    let Y = sub(up, scale(Z, dot(up, Z)));
    if(Math.hypot(...Y) < 1e-6) Y = [0, 1, 0];
    Y = norm(Y);
    const X = cross(Y, Z);
    return {kind: 'wall', R: [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]]};
  }
  if(n[1] > 0.7){
    const Z = [0, 1, 0];
    let Y = [up[0], 0, up[2]];
    if(Math.hypot(...Y) < 1e-6) Y = [0, 0, -1];
    Y = norm(Y);
    const X = cross(Y, Z);
    return {kind: 'floor', R: [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]]};
  }
  return null;
}

/* ================= the plan ================= */
/* markers: {id: {p, q, kind}} in the room's frame. Portals as zsim.js wants
   them: {name, a, b, n (the way out), y0, y1, ids}. */
export function makeLayout(markers){
  const portals = [];
  const used = new Set();
  const r3 = v => Math.round(v * 1000) / 1000;
  const flat = v => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, v[2] / l]; };
  const ids = Object.keys(markers).map(Number).sort((a, b) => a - b);
  const outOf = m => {
    const R = matOfQuat(m.q);
    // a wall marker faces into the room, so out is behind it; a floor
    // marker's arrow (the top of the page) points out
    return m.kind === 'wall' ? flat(scale(colOf(R, 2), -1)) : flat(colOf(R, 1));
  };
  for(const id of ids){
    if(used.has(id)) continue;
    const m = markers[id], pr = pairOf(id), mate = pr && markers[pr.mate];
    if(mate && mate.kind === m.kind){
      used.add(id); used.add(pr.mate);
      const L = pr.side === 'L' ? m : mate, Rm = pr.side === 'L' ? mate : m;
      const a = [L.p[0], L.p[2]], b = [Rm.p[0], Rm.p[2]];
      const o1 = outOf(L), o2 = outOf(Rm), o = [o1[0] + o2[0], o1[1] + o2[1]];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      let n = [dz / l, -dx / l];
      if(n[0] * o[0] + n[1] * o[1] < 0) n = [-n[0], -n[1]];
      let y0 = 0, y1 = DOOR_H;
      if(m.kind === 'wall'){ const y = (L.p[1] + Rm.p[1]) / 2; [y0, y1] = windowSpan(y); }
      portals.push({name: (m.kind === 'wall' ? 'wide window ' : 'wide door ') + pr.pair, kind: m.kind === 'wall' ? 'window' : 'door',
        a: a.map(r3), b: b.map(r3), n: n.map(r3), y0: r3(y0), y1: r3(y1), ids: [Math.min(id, pr.mate), Math.max(id, pr.mate)]});
      continue;
    }
    used.add(id);
    const n = outOf(m), along = [-n[1], n[0]];      // to the right, seen from inside
    const half = (m.kind === 'wall' ? WINDOW : DOOR_W) / 2;
    const a = [m.p[0] - along[0] * half, m.p[2] - along[1] * half], b = [m.p[0] + along[0] * half, m.p[2] + along[1] * half];
    const [y0, y1] = m.kind === 'wall' ? windowSpan(m.p[1]) : [0, DOOR_H];
    portals.push({name: (m.kind === 'wall' ? 'window ' : 'door ') + label(id), kind: m.kind === 'wall' ? 'window' : 'door',
      a: a.map(r3), b: b.map(r3), n: n.map(r3), y0: r3(y0), y1: r3(y1), ids: [id]});
  }
  const top = portals.reduce((a, p) => Math.max(a, p.y1), 0);
  return {v: 1, markers, portals, ceil: Math.max(CEIL, top + 0.25)};
}
function windowSpan(y){
  let y0 = y - WINDOW / 2, y1 = y + WINDOW / 2;
  if(y0 < 0.3){ y0 = 0; y1 = Math.max(y1, 1.1); }
  return [y0, y1];
}

/* ================= finding yourself ================= */
export class Locator {
  constructor(layout, opts){
    this.setLayout(layout);
    this.yaw = opts && opts.yaw != null ? opts.yaw : null;   // the survey phone knows its own
    // ...and keeps believing it, unless markers seen in pairs say otherwise
    // (one marker's turn alone is a noisy witness)
    this.prior = this.yaw;
    this.yaws = [];
    this.P = null;
    this.fixT = -1e9; this.t = 0;
    this.pending = null;
    this.seen = [];
  }
  setLayout(L){
    this.L = L;
    this.M = {};
    for(const id in (L && L.markers) || {}){ const m = L.markers[id]; this.M[id] = {p: m.p, R: matOfQuat(m.q)}; }
  }
  /* dets: this frame's markers (or [] / null on a frame not looked at).
     Rs: the sensors' camera rotation. Returns {P, yaw, fix (seconds since
     the last sighting), seen: ids}. */
  update(dets, Rs, cam, dt){
    this.t += dt;
    const S = [];
    for(const d of dets || []){
      if(!this.M[d.id]) continue;
      const pose = solvePose(d.c, cam.f, cam.cx, cam.cy);
      if(!pose || pose.err > 2.5) continue;
      S.push({id: d.id, pose, px: d.px, off: mv(Rs, pose.t)});
    }
    this.seen = S.map(s => s.id);
    // two markers in view: the focal length that puts the phone in the same
    // place by both is the right one
    if(S.length >= 2 && dets.length >= 2){
      this.pairs = this.pairs || [];
      this.pairs.push({Rs, cam, ds: S.map(s => { const d = dets.find(x => x.id === s.id); return {id: s.id, ctr: d.ctr, r: Math.hypot(...s.pose.t), f0: cam.f}; })});
      if(this.pairs.length > 200) this.pairs.splice(0, 50);
      if(this.pairs.length % 10 === 0 && this.yaw != null) this.fSuggest = this.pairFocal();
    }
    if(S.length){
      // how far round the sensors' world is from the room's
      for(const s of S){
        const Rroom = mul(this.M[s.id].R, tr(s.pose.R));        // the camera in the room, by this marker
        const A = mul(Rroom, tr(Rs));
        const y = Math.atan2(A[2] - A[6], A[0] + A[8]);
        this.yaws.push({y, w: Math.max(0.02, 1 - Math.min(1, s.pose.amb * 1.3)) * Math.min(1, s.px / 40), t: this.t});
      }
      // two in view at once: the line between them says it best
      for(let i = 0; i < S.length; i++) for(let j = i + 1; j < S.length; j++){
        const a = S[i], b = S[j];
        const room = sub(this.M[b.id].p, this.M[a.id].p), seen = sub(b.off, a.off);
        if(Math.hypot(room[0], room[2]) < 0.6) continue;
        const y = Math.atan2(seen[2], seen[0]) - Math.atan2(room[2], room[0]);
        this.yaws.push({y: wrap(y), w: 2.5, t: this.t});
      }
      this.yaws = this.yaws.filter(e => this.t - e.t < 20).slice(-80);
      const est = circularMedian(this.prior != null ? this.yaws.concat([{y: this.prior, w: 30, t: this.t}]) : this.yaws);
      if(this.yaw == null) this.yaw = est;
      else this.yaw = wrap(this.yaw + wrap(est - this.yaw) * Math.min(1, dt * 1.5));
      // where the phone is
      const Y = yawMat(this.yaw);
      let P = [0, 0, 0], w = 0;
      for(const s of S){ const k = s.px * s.px; P = add(P, scale(sub(this.M[s.id].p, mv(Y, s.off)), k)); w += k; }
      P = scale(P, 1 / w);
      const fresh = this.t - this.fixT < 1.5;
      if(this.P && fresh && Math.hypot(P[0] - this.P[0], P[2] - this.P[2]) > 1.5){
        // a leap: believe it only if the next sightings agree
        if(this.pending && Math.hypot(P[0] - this.pending[0], P[2] - this.pending[2]) < 0.4){ this.pendN++; }
        else { this.pending = P; this.pendN = 1; }
        if(this.pendN >= 4){ this.P = P; this.pending = null; }
      } else {
        this.pending = null;
        if(!this.P || !fresh) this.P = P;
        else {
          // glide there over about a tenth of a second, however often frames come
          const k = 1 - Math.exp(-(this.t - this.fixT) / 0.1);
          this.P = add(this.P, scale(sub(P, this.P), k));
        }
      }
      this.fixT = this.t;
    }
    return {P: this.P, yaw: this.yaw, fix: this.t - this.fixT, seen: this.seen};
  }
}

Locator.prototype.pairFocal = function(){
  const Y = yawMat(this.yaw);
  const errOf = f => {
    let e = 0, n = 0;
    for(const fr of this.pairs){
      const Ps = fr.ds.map(d => {
        const dir = norm([(d.ctr[0] - fr.cam.cx) / f, -(d.ctr[1] - fr.cam.cy) / f, -1]);
        return sub(this.M[d.id].p, mv(Y, mv(fr.Rs, scale(dir, d.r * f / d.f0))));
      });
      for(let i = 1; i < Ps.length; i++){ e += dot(sub(Ps[i], Ps[0]), sub(Ps[i], Ps[0])); n++; }
    }
    return e / Math.max(1, n);
  };
  const L = 2 * Math.max(this.pairs[0].cam.cx, this.pairs[0].cam.cy);
  let best = null, be = Infinity;
  for(let k = 0.5; k <= 1.3; k += 0.01){ const e = errOf(k * L); if(e < be){ be = e; best = k * L; } }
  return be < 0.04 ? best : null;
};

function circularMedian(list){
  // the weighted mean of the directions within 25 degrees of the best-supported one
  let best = null, bw = -1;
  for(const a of list){
    let w = 0;
    for(const b of list) if(Math.abs(wrap(a.y - b.y)) < 0.2) w += b.w;
    if(w > bw){ bw = w; best = a.y; }
  }
  let s = 0, c = 0;
  for(const b of list) if(Math.abs(wrap(b.y - best)) < 0.44){ s += Math.sin(b.y) * b.w; c += Math.cos(b.y) * b.w; }
  return Math.atan2(s, c);
}

/* The camera's focal length: a guess from the frame size until enough
   slanted views of markers have said better. Kept per phone. */
export class Focal {
  constructor(w, h, kept){
    this.w = w; this.h = h;
    this.guess = 0.76 * Math.max(w, h);
    this.list = [];
    this.f = kept && kept.long === Math.max(w, h) ? kept.f : this.guess;
    this.sure = !!(kept && kept.long === Math.max(w, h) && kept.n >= 30);
  }
  /* A marker seen well askew says something about the focal length on its
     own (a square-on one says nothing). Only a fallback: the survey, and
     pairs of markers in view at once, say it better. */
  add(dets){
    if(this.sure) return;
    for(const d of dets){
      if(d.px < 26) continue;
      const pose = solvePose(d.c, this.f, this.w / 2, this.h / 2);
      if(!pose || pose.amb > 0.3) continue;
      const nz = Math.abs(pose.R[8]), slant = Math.sqrt(Math.max(0, 1 - nz * nz));
      if(slant < 0.6) continue;
      const e = focalFrom(d.c, this.w / 2, this.h / 2);
      if(!e || e.f < this.guess * 0.55 || e.f > this.guess * 1.7) continue;
      this.list.push([e.f, slant * d.px]);
    }
    if(this.list.length > 400) this.list.splice(0, 100);
    if(this.list.length >= 25){
      const s = this.list.slice().sort((a, b) => a[0] - b[0]);
      const half = s.reduce((a, x) => a + x[1], 0) / 2;
      let acc = 0;
      for(const x of s){ acc += x[1]; if(acc >= half){ this.f = this.f * 0.8 + x[0] * 0.2; break; } }
    }
  }
  set(f, sure){ this.f = f; if(sure) this.sure = true; }
  keep(){ return {long: Math.max(this.w, this.h), f: Math.round(this.f), n: this.sure ? 60 : 0}; }
}

export {SINGLES};
