/* Night Watch: AR Bunker - where the phone is, from its camera.

   Our own tracker, written for this game (no third-party vision code). The
   trick that makes it small enough to write: the phone's motion sensors
   already know which way it is pointing, accurately, many times a second.
   So the camera only has to answer where the phone is - three numbers, not
   six - and that is a linear least-squares problem.

   How it works, frame by frame:
   - Corners (FAST) are found in the camera image and remembered as small
     patches. Seen from two places far enough apart, a corner becomes a
     landmark: a point in the room, triangulated.
   - Each new frame, every landmark's position on screen is predicted from
     the sensor rotation and where the phone was, and its patch is looked
     for nearby (normalised cross-correlation, coarse then fine). Because
     the rotation is known, a fast turn that blurs the picture does not lose
     the map: the landmarks are found again where they ought to be.
   - The phone's position is the point the rays to those landmarks agree on
     (RANSAC on pairs, then a small Gauss-Newton refinement that also nudges
     the sensor rotation and the camera's focal length, both of which are
     only approximately known).
   - Scale: one camera cannot tell a small room near from a big one far.
     The floor can: it is the lowest flat crowd of landmarks, and the phone
     is held at about chest height above it. Once the floor is found the
     whole map is rescaled to metres with the floor at y = 0.

   Axes as three.js: y up (gravity), the camera looks along its own -z.
   Rotations come in as quaternions [x, y, z, w], camera to world. Images
   come in as greyscale bytes, row by row. */

/* ---------- small linear algebra ---------- */
function qmat(q){
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
          2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
          2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
function mul(A, B){
  const C = new Array(9);
  for(let i = 0; i < 3; i++) for(let j = 0; j < 3; j++)
    C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return C;
}
const mv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const mtv = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/* Rodrigues: the rotation by angle |w| about w */
function expm(w){
  const th = len(w);
  if(th < 1e-12) return [1, -w[2], w[1], w[2], 1, -w[0], -w[1], w[0], 1];
  const k = scl(w, 1 / th), c = Math.cos(th), s = Math.sin(th), v = 1 - c;
  return [c + k[0] * k[0] * v, k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s,
          k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v, k[1] * k[2] * v - k[0] * s,
          k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v];
}
/* Solve A x = b for small dense systems (Gaussian elimination, partial pivoting). */
function solve(A, b, n){
  const M = A.slice(), x = b.slice();
  for(let i = 0; i < n; i++){
    let p = i;
    for(let r = i + 1; r < n; r++) if(Math.abs(M[r * n + i]) > Math.abs(M[p * n + i])) p = r;
    if(Math.abs(M[p * n + i]) < 1e-12) return null;
    if(p !== i){
      for(let k = 0; k < n; k++){ const t = M[i * n + k]; M[i * n + k] = M[p * n + k]; M[p * n + k] = t; }
      const t = x[i]; x[i] = x[p]; x[p] = t;
    }
    for(let r = i + 1; r < n; r++){
      const f = M[r * n + i] / M[i * n + i];
      if(!f) continue;
      for(let k = i; k < n; k++) M[r * n + k] -= f * M[i * n + k];
      x[r] -= f * x[i];
    }
  }
  for(let i = n - 1; i >= 0; i--){
    let s = x[i];
    for(let k = i + 1; k < n; k++) s -= M[i * n + k] * x[k];
    x[i] = s / M[i * n + i];
  }
  return x;
}
/* The point closest to a set of rays {c, b}. */
function rayPoint(rays){
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0], v = [0, 0, 0];
  for(const {c, b} of rays){
    const M = [1 - b[0] * b[0], -b[0] * b[1], -b[0] * b[2], -b[1] * b[0], 1 - b[1] * b[1], -b[1] * b[2], -b[2] * b[0], -b[2] * b[1], 1 - b[2] * b[2]];
    for(let i = 0; i < 9; i++) A[i] += M[i];
    const mc = mv(M, c);
    v[0] += mc[0]; v[1] += mc[1]; v[2] += mc[2];
  }
  const X = solve(A, v, 3);
  return X && X.every(Number.isFinite) ? X : null;
}
function inv3(m){
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if(Math.abs(det) < 1e-18) return null;
  const s = 1 / det;
  return [A * s, -(b * i - c * h) * s, (b * f - c * e) * s, B * s, (a * i - c * g) * s, -(a * f - c * d) * s, C * s, -(a * h - b * g) * s, (a * e - b * d) * s];
}
/* The closest meeting point of two rays p + s d (s > 0); null if they diverge. */
function meet(p1, d1, p2, d2){
  const w0 = sub(p1, p2), b = dot(d1, d2), d = dot(d1, w0), e = dot(d2, w0);
  const den = 1 - b * b;
  if(den < 1e-9) return null;
  const s = (b * e - d) / den, t = (e - b * d) / den;
  if(s <= 0 || t <= 0) return null;
  return {X: scl(add(add(p1, scl(d1, s)), add(p2, scl(d2, t))), 0.5), s, t};
}

/* ---------- images ---------- */
function half(src, w, h){
  const W = w >> 1, H = h >> 1, out = new Uint8Array(W * H);
  for(let y = 0; y < H; y++) for(let x = 0; x < W; x++){
    const i = (y * 2) * w + x * 2;
    out[y * W + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1] + 2) >> 2;
  }
  return out;
}

/* FAST-9 corners, the strongest in each cell of a grid. */
const CIRC = [[0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3], [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3]];
function fast(img, w, h, thr, cell, border){
  const off = CIRC.map(([dx, dy]) => dy * w + dx);
  const cw = Math.ceil(w / cell), best = new Map();
  for(let y = border; y < h - border; y++){
    for(let x = border; x < w - border; x++){
      const i = y * w + x, p = img[i], hi = p + thr, lo = p - thr;
      // quick test on the four compass points
      const a = img[i + off[0]], b = img[i + off[4]], c = img[i + off[8]], d = img[i + off[12]];
      let nb = (a > hi) + (b > hi) + (c > hi) + (d > hi), nd = (a < lo) + (b < lo) + (c < lo) + (d < lo);
      if(nb < 3 && nd < 3) continue;
      // nine in a row, brighter or darker, round the circle
      let run = 0, bestRun = 0, kind = nb >= 3 ? 1 : -1, score = 0;
      for(let k = 0; k < 25; k++){
        const q = img[i + off[k & 15]];
        if(kind > 0 ? q > hi : q < lo){ run++; if(run > bestRun) bestRun = run; }
        else run = 0;
      }
      if(bestRun < 9) continue;
      for(let k = 0; k < 16; k++) score += Math.abs(img[i + off[k]] - p);
      const key = ((y / cell) | 0) * cw + ((x / cell) | 0);
      const old = best.get(key);
      if(!old || old.s < score) best.set(key, {x, y, s: score});
    }
  }
  return [...best.values()];
}

/* A patch, zero-mean and unit-norm, so matching is a single dot product. */
function patch(img, w, h, cx, cy, r){
  const n = 2 * r + 1, out = new Float32Array(n * n);
  if(cx - r < 0 || cy - r < 0 || cx + r >= w || cy + r >= h) return null;
  let s = 0;
  for(let y = -r, k = 0; y <= r; y++) for(let x = -r; x <= r; x++, k++){ out[k] = img[(cy + y) * w + cx + x]; s += out[k]; }
  const m = s / (n * n);
  let q = 0;
  for(let k = 0; k < n * n; k++){ out[k] -= m; q += out[k] * out[k]; }
  if(q < n * n * 16) return null;       // too flat to find again
  const inv = 1 / Math.sqrt(q);
  for(let k = 0; k < n * n; k++) out[k] *= inv;
  return out;
}
/* A bigger snapshot, kept raw, so the template can be made at any scale:
   a landmark the phone has walked up to looks bigger than when it was first
   seen, and matching the old small patch makes it slip. */
function rawPatch(img, w, h, cx, cy, R){
  if(cx - R < 0 || cy - R < 0 || cx + R >= w || cy + R >= h) return null;
  const n = 2 * R + 1, out = new Float32Array(n * n);
  for(let y = -R, k = 0; y <= R; y++) for(let x = -R; x <= R; x++, k++) out[k] = img[(cy + y) * w + cx + x];
  return out;
}
/* A matching template of radius r from a raw snapshot of radius R, seen
   `scale` times bigger than when it was taken. Zero-mean, unit-norm. */
function warp(raw, R, scale, r){
  if(r / scale > R - 1) return null;
  const n = 2 * R + 1, m = 2 * r + 1, out = new Float32Array(m * m);
  let s = 0;
  for(let y = -r, k = 0; y <= r; y++) for(let x = -r; x <= r; x++, k++){
    const fx = R + x / scale, fy = R + y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const i = y0 * n + x0;
    const v = raw[i] * (1 - ax) * (1 - ay) + raw[i + 1] * ax * (1 - ay) + raw[i + n] * (1 - ax) * ay + raw[i + n + 1] * ax * ay;
    out[k] = v; s += v;
  }
  const mean = s / (m * m);
  let q = 0;
  for(let k = 0; k < m * m; k++){ out[k] -= mean; q += out[k] * out[k]; }
  if(q < m * m * 16) return null;
  const inv = 1 / Math.sqrt(q);
  for(let k = 0; k < m * m; k++) out[k] *= inv;
  return out;
}
function ncc(img, w, cx, cy, pt, r){
  const n = 2 * r + 1, N = n * n;
  let sxy = 0, s = 0, ss = 0;
  for(let y = -r, k = 0; y <= r; y++){
    const row = (cy + y) * w + cx;
    for(let x = -r; x <= r; x++, k++){ const v = img[row + x]; sxy += pt[k] * v; s += v; ss += v * v; }
  }
  const varr = ss - s * s / N;
  return varr <= 1 ? -1 : sxy / Math.sqrt(varr);
}
/* Best match within radius rad of (px, py); returns {x, y, s, s2} or null.
   s2 is the best score at least three pixels away from the winner: on a
   repeating pattern (floorboards, tiles) it is nearly as good, and the
   match cannot be trusted. */
const SCORES = new Float32Array(160 * 160);
function search(img, w, h, px, py, rad, pt, r, step){
  let best = -2, bx = 0, by = 0;
  const x0 = Math.max(r, Math.round(px - rad)), x1 = Math.min(w - r - 1, Math.round(px + rad));
  const y0 = Math.max(r, Math.round(py - rad)), y1 = Math.min(h - r - 1, Math.round(py + rad));
  const sw = x1 - x0 + 1;
  for(let y = y0; y <= y1; y += step) for(let x = x0; x <= x1; x += step){
    const s = ncc(img, w, x, y, pt, r);
    SCORES[(y - y0) * sw + (x - x0)] = s;
    if(s > best){ best = s; bx = x; by = y; }
  }
  if(best < -1) return null;
  let s2 = -1;
  if(step === 1 && sw * (y1 - y0 + 1) <= SCORES.length){
    for(let y = y0; y <= y1; y++) for(let x = x0; x <= x1; x++){
      if(Math.abs(x - bx) < 3 && Math.abs(y - by) < 3) continue;
      const s = SCORES[(y - y0) * sw + (x - x0)];
      if(s > s2) s2 = s;
    }
  }
  if(step > 1){
    // tighten round the coarse best
    for(let y = by - step + 1; y < by + step; y++) for(let x = bx - step + 1; x < bx + step; x++){
      if(x < r || y < r || x >= w - r || y >= h - r) continue;
      const s = ncc(img, w, x, y, pt, r);
      if(s > best){ best = s; bx = x; by = y; }
    }
  }
  return {x: bx, y: by, s: best, s2};
}
/* Sub-pixel: a parabola through the scores either side. */
function subpix(img, w, h, m, pt, r){
  if(m.x <= r || m.y <= r || m.x >= w - r - 1 || m.y >= h - r - 1) return m;
  const c = m.s;
  const l = ncc(img, w, m.x - 1, m.y, pt, r), rr = ncc(img, w, m.x + 1, m.y, pt, r);
  const u = ncc(img, w, m.x, m.y - 1, pt, r), d = ncc(img, w, m.x, m.y + 1, pt, r);
  const dx = (l - rr) / (2 * (l - 2 * c + rr) || 1), dy = (u - d) / (2 * (u - 2 * c + d) || 1);
  return {x: m.x + Math.max(-0.5, Math.min(0.5, dx)), y: m.y + Math.max(-0.5, Math.min(0.5, dy)), s: c};
}

/* ================================================================ */
export class Tracker {
  /* opts: {width, height, focal (pixels, a first guess), eye (metres the
     phone is held above the floor)} */
  constructor(opts){
    this.w = opts.width; this.h = opts.height;
    this.f = opts.focal || this.h * 0.75;
    this.cx = this.w / 2; this.cy = this.h / 2;
    this.eye = opts.eye || 1.35;
    this.reset();
  }

  /* Start again: the phone at chest height over the floor (y = 0), at the
     origin. Metres from the first frame - the floor gives the scale. */
  reset(){
    this.state = 'start';
    this.seed = 12345;
    this.lms = [];       // landmarks: {X, raw0, raw1 (snapshots), cap (where they were taken), seen, miss, u, v, vis, floor, tent}
    this.cands = [];     // corners waiting for a second view: {c0, b0, raw0, raw1, u, v, miss, n}
    this.c = [0, this.eye, 0]; this.vel = [0, 0, 0];
    this.bias = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    this.frame = 0; this.coast = 0; this.goodFrames = 0;
    this.last = {inliers: 0, tracked: 0};
    this.R = this.Rc = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    this.kfs = [];       // the last few keyframes: {c, R, obs: [{lm, x, y}], fixed}
    this.lag = 0;        // seconds the sensors run behind (+) or ahead (-) of the camera, learnt
    this.Rs0 = null; this.omega = [0, 0, 0];
  }

  /* the same choices every run (RANSAC picks pairs at random) */
  rand(){
    let t = (this.seed = (this.seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  ray(u, v){ return [(u - this.cx) / this.f, -(v - this.cy) / this.f, -1]; }
  /* screen position of world point X from a camera at c turned by R; null if behind */
  proj(R, c, X){
    const d = mtv(R, sub(X, c));
    if(d[2] > -0.05) return null;
    return [this.cx + this.f * d[0] / -d[2], this.cy - this.f * d[1] / -d[2], -d[2]];
  }
  median(a){ if(!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }
  inView(p, m){ return p && p[0] >= m && p[1] >= m && p[0] < this.w - m && p[1] < this.h - m; }

  /* One camera frame. img: greyscale Uint8Array (width x height); q: the
     sensor rotation for that moment, camera to world, [x, y, z, w]; dt:
     seconds since the last frame. */
  update(img, q, dt, acc){
    dt = dt || 1 / 30;
    // the accelerometer, if given: world-frame acceleration (gravity taken
    // out), averaged over the frame. It carries the position between
    // frames and through moments the camera has nothing to go on.
    const a = acc && acc.every(Number.isFinite) ? acc : null;
    if(a) this.vel = add(this.vel, scl(a, dt));
    this.frame++;
    const {w, h} = this;
    this.img0 = img; this.img1 = half(img, w, h);
    // how fast the phone is turning (from the sensors), so a sensor reading
    // that is a little late or early can be turned on to the camera's moment
    const Rs = qmat(q);
    if(this.Rs0){
      const D = mul(Rs, [this.Rs0[0], this.Rs0[3], this.Rs0[6], this.Rs0[1], this.Rs0[4], this.Rs0[7], this.Rs0[2], this.Rs0[5], this.Rs0[8]]);
      const ang = Math.acos(Math.max(-1, Math.min(1, (D[0] + D[4] + D[8] - 1) / 2)));
      const ax = [D[7] - D[5], D[2] - D[6], D[3] - D[1]], al = len(ax);
      this.omega = ang > 1e-6 && al > 1e-9 ? scl(ax, ang / al / dt) : [0, 0, 0];
    }
    this.Rs0 = Rs;
    let R = mul(this.bias, mul(expm(scl(this.omega, this.lag)), Rs));
    // where the phone probably is now
    const cp = add(this.c, scl(this.vel, dt));
    // look further when moving (a near point sweeps across the picture) or unsure
    const sp = len(this.vel);
    let ms = this.matchAll(R, cp, this.coast > 0 ? 28 : Math.min(28, 16 + sp * 20 + len(this.omega) * 6));
    // first the rotation: line the expected directions up with the seen ones
    // (measured but not applied: with the position only guessed, a position
    // error looks like a turn, and correcting for it made things worse)
    const dR = null;
    if(dR){
      R = mul(expm(dR), R);
      for(const m of ms) m.b = nrm(mv(R, this.ray(m.u, m.v)));
    }
    this.R = R;
    this.last.tracked = ms.length;
    // floor guesses on probation do not move the phone, unless there is nothing else
    const proven = ms.filter(m => !m.lm.prob);
    const pose = this.lms.length ? this.solvePose(R, cp, proven.length >= 8 ? proven : ms) : null;
    if(pose && pose.inliers.length >= 8 && pose.inliers.length >= ms.length * 0.35){
      const v = scl(sub(pose.c, this.c), 1 / dt);
      this.vel = this.coast > 0 && !a ? [0, 0, 0] : add(scl(this.vel, 0.5), scl(v, 0.5));
      this.c = pose.c;
      this.Rc = mul(expm(pose.w), R);
      this.coast = 0; this.goodFrames++;
      this.state = 'track';
      this.last.inliers = pose.inliers.length;
      // learn, slowly and from good frames only: the sensors' steady error
      // (while still), their timing (while turning) and the lens
      if(pose.inliers.length >= 25 && !this.noLearn){
        const corr = add(dR || [0, 0, 0], pose.w), om = len(this.omega);
        if(om < 0.25) this.bias = mul(expm(scl(corr, 0.05)), this.bias);
        else this.lag = Math.max(-0.2, Math.min(0.2, this.lag + 0.08 * Math.max(-0.05, Math.min(0.05, dot(corr, this.omega) / (om * om)))));
        this.f *= 1 + Math.max(-0.004, Math.min(0.004, pose.df * 0.05));
      }
      for(const m of pose.inliers) this.seen(m, R);
      for(const m of pose.outliers) if(!m.lm.prob) m.lm.miss += 2;
      this.probation(ms);
      this.maybeKeyframe(pose.inliers);
      if(this.frame % 20 === 0) this.reanchor(R);
    } else {
      // nothing to go on (a blank wall, a blur, somewhere new): hold still and wait
      this.last.inliers = pose ? pose.inliers.length : 0;
      // without the camera, the accelerometer alone drifts: trust it for a moment only
      this.vel = scl(this.vel, a && this.coast < 0.6 ? 0.92 : 0.5);
      this.c = this.lms.length ? cp : this.c;
      this.Rc = R;
      if(this.lms.length) this.coast += dt;
      this.state = this.lms.length < 8 ? 'start' : this.coast > 0.5 ? 'lost' : 'track';
      if(this.coast > 0.3 && this.frame % 2 === 0) this.relocate(R);
    }
    // a landmark that has been seen many times and confirmed is kept through
    // a long run of misses: it is probably the position that is wrong
    this.lms = this.lms.filter(l => !(l.tent || l.seen < 25 ? l.miss > 10 && l.miss > l.seen * 0.6 : l.miss > 45 && l.miss > l.seen));
    if(this.frame % 30 === 0) this.findWalls();
    // lost for a while with nothing known in view: carry on from here with
    // new landmarks rather than wait for old ones that may never come back
    if(this.coast === 0 || this.lms.length < 8 || this.coast > 0.6) this.grow(this.Rc);
    return this.result();
  }

  result(){
    return {state: this.state, pos: this.c.slice(), metric: true, landmarks: this.lms.length, inliers: this.last.inliers, focal: this.f, lag: this.lag};
  }

  /* Every landmark that should be on screen, looked for near where it should be. */
  matchAll(R, cp, rad){
    const ms = [];
    let n = 0;
    const order = this.lms.slice().sort((a, b) => (b.seen - b.miss) - (a.seen - a.miss));
    for(const lm of order){
      const p = this.proj(R, cp, lm.X);
      lm.vis = this.inView(p, 8);
      if(!lm.vis) continue;
      if(++n > 200) continue;
      // nearer than when its snapshot was taken looks bigger
      const scale = len(sub(lm.X, lm.cap)) / Math.max(0.05, p[2]);
      if(scale > 1.7 || scale < 0.6){ lm.miss++; continue; }
      // back in view after a while (the phone turned away and back): the
      // position has probably drifted meanwhile, so look further, and do not
      // count it against the landmark if it is not found straight away
      const back = this.frame - (lm.lastF || 0) > 20;
      const m = this.find(lm, p[0], p[1], back ? Math.min(44, rad * 1.8) : rad, scale);
      if(!m || m.s < 0.72){ if(!back || lm.tent) lm.miss++; continue; }
      ms.push({lm, u: m.x, v: m.y, b: nrm(mv(R, this.ray(m.x, m.y))), s: m.s});
    }
    return ms;
  }

  /* The templates for something seen `scale` times bigger than when its
     snapshot was taken (cached, in steps of 5%). */
  templates(o, scale){
    const k = Math.round(Math.log(scale || 1) / 0.05);
    if(o.tk !== k){
      const s = Math.exp(k * 0.05);
      o.t0 = warp(o.raw0, 8, s, 4); o.t1 = warp(o.raw1, 6, s, 3); o.tk = k;
    }
    return o.t0 && o.t1;
  }
  /* coarse search at half size, then fine at full size */
  find(o, pu, pv, rad, scale){
    const {w, h} = this;
    if(!this.templates(o, scale)) return null;
    const c = search(this.img1, w >> 1, h >> 1, pu / 2, pv / 2, Math.max(2, rad / 2), o.t1, 3, 1);
    if(!c || c.s < 0.55) return null;
    // two nearly equal places it could be: a repeating pattern, not to be trusted
    if(c.s2 > c.s - 0.07) return null;
    const f = search(this.img0, w, h, c.x * 2, c.y * 2, 2, o.t0, 4, 1);
    if(!f) return null;
    return subpix(this.img0, w, h, f, o.t0, 4);
  }
  /* snapshots of a corner, raw, at both sizes */
  snap(o, u, v){
    const {w, h} = this;
    const r0 = rawPatch(this.img0, w, h, Math.round(u), Math.round(v), 8);
    const r1 = rawPatch(this.img1, w >> 1, h >> 1, Math.round(u) >> 1, Math.round(v) >> 1, 6);
    if(!r0 || !r1) return false;
    o.raw0 = r0; o.raw1 = r1; o.tk = null;
    return this.templates(o, 1);
  }

  /* A landmark found and agreed with: count it, and when the phone is
     seeing it from much nearer, further or more from the side than when its
     patch was taken, take the patch again so it can still be found. */
  seen(m, R){
    const lm = m.lm;
    lm.seen++; lm.miss = Math.max(0, lm.miss - 1); lm.u = m.u; lm.v = m.v;
    lm.lastU = m.u; lm.lastV = m.v; lm.lastF = this.frame;
    const d0 = sub(lm.cap, lm.X), d1 = sub(this.c, lm.X);
    const ratio = len(d1) / len(d0), ang = Math.acos(Math.min(1, dot(nrm(d0), nrm(d1))));
    // only when the scaling cannot cope any more: every retake lets it slip a little
    if(m.s > 0.88 && (ratio > 1.45 || ratio < 0.7 || ang > 0.45)){
      const keep = {raw0: lm.raw0, raw1: lm.raw1};
      if(this.snap(lm, m.u, m.v)) lm.cap = this.c.slice();
      else { lm.raw0 = keep.raw0; lm.raw1 = keep.raw1; lm.tk = null; }
    }
  }

  addRay(lm, c, b){
    if(!lm.A){ lm.A = [0, 0, 0, 0, 0, 0, 0, 0, 0]; lm.v3 = [0, 0, 0]; lm.nr = 0; lm.b0 = b; }
    // (I - b b^T) X = (I - b b^T) c for a point X on the ray c + t b
    const M = [1 - b[0] * b[0], -b[0] * b[1], -b[0] * b[2], -b[1] * b[0], 1 - b[1] * b[1], -b[1] * b[2], -b[2] * b[0], -b[2] * b[1], 1 - b[2] * b[2]];
    for(let i = 0; i < 9; i++) lm.A[i] += M[i];
    const mc = mv(M, c);
    lm.v3[0] += mc[0]; lm.v3[1] += mc[1]; lm.v3[2] += mc[2];
    lm.nr++;
  }

  /* ---------- keyframes and bundle adjustment ----------
     Every so often (moved 15 cm, turned 12 degrees, or a second has
     passed) the current view becomes a keyframe, remembering which
     landmarks it saw where. Then the last ten keyframes' positions and all
     the landmarks they saw are adjusted together until every sighting
     agrees as well as it can - "bundle adjustment". The sensors give the
     rotations, so only positions are solved: three numbers a camera, three
     a landmark, and the cameras' system is tiny once the landmarks are
     eliminated (the Schur complement). The oldest keyframe is held still,
     and floor landmarks are gently held to the floor, which keeps the
     scale. */
  maybeKeyframe(inliers){
    const last = this.kfs[this.kfs.length - 1];
    if(last){
      const moved = len(sub(this.c, last.c));
      const turned = Math.acos(Math.max(-1, Math.min(1, dot(mv(this.Rc, [0, 0, -1]), mv(last.R, [0, 0, -1])))));
      if(moved < 0.15 && turned < 0.21 && this.frame - last.frame < 30) return;
    }
    const obs = inliers.map(m => ({lm: m.lm, x: (m.u - this.cx) / this.f, y: -(m.v - this.cy) / this.f}));
    // landmarks made since the last keyframe, seen here too
    for(const lm of this.lms) if(lm.born === this.frame || (lm.born > (last ? last.frame : 0) && lm.lastF === this.frame && !obs.find(o => o.lm === lm)))
      obs.push({lm, x: ((lm.lastU ?? lm.u) - this.cx) / this.f, y: -((lm.lastV ?? lm.v) - this.cy) / this.f});
    this.kfs.push({c: this.c.slice(), R: this.Rc.slice(), obs, frame: this.frame});
    if(this.kfs.length > 10) this.kfs.shift();
    if(this.kfs.length >= 3) this.adjust();
  }

  adjust(){
    const kfs = this.kfs, nk = kfs.length;
    // the floor pull is gentle: a table top taken for floor must not drag the cameras about
    const sig = 1.5 / this.f, sigFloor = 0.15;
    // landmarks seen by at least two keyframes are adjusted; the rest stay put
    const count = new Map();
    for(const k of kfs) for(const o of k.obs) count.set(o.lm, (count.get(o.lm) || 0) + 1);
    const lms = [...count.keys()].filter(l => count.get(l) >= 2 && this.lms.indexOf(l) >= 0);
    const li = new Map(lms.map((l, i) => [l, i]));
    const nc = nk - 1;                  // keyframe 0 is held still
    for(let iter = 0; iter < 4; iter++){
      const Hcc = new Float64Array(9 * nc * nc), gc = new Float64Array(3 * nc);
      const Hll = lms.map(() => new Float64Array(9)), gl = lms.map(() => new Float64Array(3));
      const Hcl = new Map();            // key k*N+j -> 3x3 (camera rows, landmark cols)
      let cost = 0;
      for(let k = 0; k < nk; k++){
        const K = kfs[k], R = K.R;
        for(const o of K.obs){
          if(this.lms.indexOf(o.lm) < 0) continue;
          const d = mtv(R, sub(o.lm.X, K.c));
          if(d[2] > -0.05) continue;
          const iz = 1 / -d[2];
          const rx = d[0] * iz - o.x, ry = d[1] * iz - o.y;
          const e = Math.hypot(rx, ry) / sig;
          const wgt = (e < 2 ? 1 : 2 / e) / (sig * sig);
          cost += Math.min(e * e, 2 * e);
          // d(x, y)/d(d), then through R^T to d/dX (and minus that for d/dc)
          const Jd = [iz, 0, d[0] * iz * iz, 0, iz, d[1] * iz * iz];
          const JX = new Array(6);
          for(let r = 0; r < 2; r++) for(let c2 = 0; c2 < 3; c2++)
            JX[r * 3 + c2] = Jd[r * 3] * R[c2 * 3] + Jd[r * 3 + 1] * R[c2 * 3 + 1] + Jd[r * 3 + 2] * R[c2 * 3 + 2];
          const j = li.has(o.lm) ? li.get(o.lm) : -1, kc = k - 1;
          for(let a = 0; a < 3; a++){
            const ga = JX[a] * rx + JX[3 + a] * ry;
            if(j >= 0) gl[j][a] += wgt * ga;
            if(kc >= 0) gc[kc * 3 + a] -= wgt * ga;
            for(let b = 0; b < 3; b++){
              const hab = wgt * (JX[a] * JX[b] + JX[3 + a] * JX[3 + b]);
              if(j >= 0) Hll[j][a * 3 + b] += hab;
              if(kc >= 0) Hcc[(kc * 3 + a) * 3 * nc + kc * 3 + b] += hab;
              if(j >= 0 && kc >= 0){
                const key = kc * lms.length + j;
                let m = Hcl.get(key);
                if(!m){ m = new Float64Array(9); Hcl.set(key, m); }
                m[a * 3 + b] -= hab;
              }
            }
          }
        }
      }
      // floor landmarks are held to the floor; every landmark a little to where it is
      lms.forEach((l, j) => {
        if(l.floor){ Hll[j][4] += 1 / (sigFloor * sigFloor); gl[j][1] += l.X[1] / (sigFloor * sigFloor); }
        for(let a = 0; a < 3; a++) Hll[j][a * 4] += 1e-4;
      });
      for(let a = 0; a < 3 * nc; a++) Hcc[a * 3 * nc + a] += 1e-6;
      // eliminate the landmarks: S = Hcc - sum Hcl Hll^-1 Hlc, b = gc - sum Hcl Hll^-1 gl
      const inv = Hll.map(H => inv3(H));
      const S = Hcc.slice(), bS = Array.from(gc, x => -x);
      const byLm = new Map();
      for(const [key, m] of Hcl){ const j = key % lms.length, k = (key - j) / lms.length; if(!byLm.has(j)) byLm.set(j, []); byLm.get(j).push([k, m]); }
      for(const [j, list] of byLm){
        const Hi = inv[j];
        if(!Hi) continue;
        const Hig = mv(Hi, gl[j]);
        for(const [k1, m1] of list){
          const A = mul(m1, Hi);              // Hcl Hll^-1
          const t = mv(A, Hig.map(x => x));   // (Hcl Hll^-1)(Hll^-1 g)? no: A * g
          const Ag = mv(A, gl[j]);
          for(let a = 0; a < 3; a++) bS[k1 * 3 + a] += Ag[a];
          void t;
          for(const [k2, m2] of list){
            // A * Hlc(k2) where Hlc = Hcl(k2)^T
            for(let a = 0; a < 3; a++) for(let b = 0; b < 3; b++){
              let v = 0;
              for(let c2 = 0; c2 < 3; c2++) v += A[a * 3 + c2] * m2[b * 3 + c2];
              S[(k1 * 3 + a) * 3 * nc + k2 * 3 + b] -= v;
            }
          }
        }
      }
      const dc = solve(Array.from(S), bS, 3 * nc);
      if(!dc) return;
      // back-substitute: dX_j = Hll^-1 (-gl_j - sum Hlc dc)
      const dX = lms.map((l, j) => {
        const r = [-gl[j][0], -gl[j][1], -gl[j][2]];
        for(const [k, m] of byLm.get(j) || []) for(let a = 0; a < 3; a++) for(let b = 0; b < 3; b++) r[a] -= m[b * 3 + a] * dc[k * 3 + b];
        return inv[j] ? mv(inv[j], r) : [0, 0, 0];
      });
      let step = 0;
      for(let k = 1; k < nk; k++){ const d = [dc[(k - 1) * 3], dc[(k - 1) * 3 + 1], dc[(k - 1) * 3 + 2]]; kfs[k].c = add(kfs[k].c, d); step = Math.max(step, len(d)); }
      lms.forEach((l, j) => { if(len(dX[j]) < 1) l.X = add(l.X, dX[j]); });
      if(step < 1e-4) break;
    }
    // the newest keyframe is (nearly) now: bring the current position along
    const newest = kfs[nk - 1];
    if(this.frame - newest.frame < 2) this.c = newest.c.slice();
    // landmarks the window has seen from well apart are confirmed; floor
    // guesses that ended up off the floor were not floor
    for(const l of lms){
      l.kc = count.get(l);
      if(l.floor && Math.abs(l.X[1]) > 0.1) l.floor = false;
      if(l.kc >= 3) l.tent = false;
    }
  }

  /* The rotation error, from the matches: the small turn that best lines up
     where each landmark should be (from the predicted position) with where
     it was seen. Distant landmarks count for most - the position guess
     barely affects their direction. Returns a small rotation vector or null. */
  alignRotation(ms, cp){
    if(ms.length < 8) return null;
    let d = [0, 0, 0];
    for(let it = 0; it < 4; it++){
      const H = [0, 0, 0, 0, 0, 0, 0, 0, 0], g = [0, 0, 0];
      const Rd = expm(d);
      for(const m of ms){
        const p = sub(m.lm.X, cp), dist = len(p);
        if(dist < 0.3) continue;
        const pn = scl(p, 1 / dist), b = mv(Rd, m.b);
        const r = sub(pn, b);
        const e = len(r);
        const w = Math.min(1, dist / 2.5) * (e < 0.03 ? 1 : 0.03 / e) * (m.lm.prob ? 0.3 : 1);
        // r ~ d x b: the rows of [b]x
        const B = [0, b[2], -b[1], -b[2], 0, b[0], b[1], -b[0], 0];
        for(let i = 0; i < 3; i++){
          for(let j = 0; j < 3; j++) H[i * 3 + j] += w * (B[0 * 3 + i] * B[0 * 3 + j] + B[1 * 3 + i] * B[1 * 3 + j] + B[2 * 3 + i] * B[2 * 3 + j]);
          g[i] += w * (B[0 * 3 + i] * r[0] + B[1 * 3 + i] * r[1] + B[2 * 3 + i] * r[2]);
        }
      }
      for(let i = 0; i < 3; i++) H[i * 4] += 1e-3;
      const dd = solve(H, g, 3);
      if(!dd) return null;
      d = add(d, dd);
      if(len(dd) < 1e-4) break;
    }
    return len(d) < 0.15 ? d : null;
  }

  /* A floor guess is on probation until the phone has moved: a real floor
     point then shows up where the floor says it should; a table top or the
     bottom of a wall does not. Those become ordinary corners, to be placed
     properly from several views. */
  probation(ms){
    const Rc = this.Rc;
    for(const m of ms){
      const lm = m.lm;
      if(!lm.prob) continue;
      if(len(sub(this.c, lm.cap0)) < 0.1) continue;
      const pr = this.proj(Rc, this.c, lm.X);
      const e = pr ? Math.hypot(pr[0] - m.u, pr[1] - m.v) : 99;
      if(e < 3){ if(++lm.ok >= 3){ lm.prob = false; } }
      else if(++lm.bad >= 2){
        lm.dead = true;
        const cd = {c0: lm.cap0, b0: lm.b0, raw0: lm.raw0, raw1: lm.raw1, u: m.u, v: m.v, miss: 0, n: 0, tk: null};
        cd.rays = [{c: lm.cap0, b: lm.b0}];
        this.cands.push(cd);
      }
    }
    if(ms.some(m => m.lm.dead)) this.lms = this.lms.filter(l => !l.dead);
  }

  /* Where the phone is: RANSAC on pairs of rays (the rotation is known, so
     two landmarks fix the position), then Gauss-Newton on the reprojection
     error over position, a small rotation correction and the focal length. */
  solvePose(R, cp, ms){
    if(ms.length < 6) return null;
    const thr = 0.035;
    const angErr = (c, m) => { const d = nrm(sub(m.lm.X, c)); return Math.acos(Math.max(-1, Math.min(1, dot(d, m.b)))); };
    // guesses (on the floor, or from two views not far apart) count for
    // much less than landmarks confirmed from many views
    const solid = ms.filter(m => !m.lm.tent);
    const seenTwice = ms.filter(m => (m.lm.kc || 0) >= 2);
    // with enough to go on, a guess seen from only one keyframe barely counts
    const score = m => !m.lm.tent ? 1 : (m.lm.kc || 0) >= 2 ? 0.4 : seenTwice.length >= 15 ? 0.1 : 0.3;
    const pool = solid.length >= 6 ? solid : seenTwice.length >= 6 ? seenTwice : ms;
    let bestC = cp, bestN = -1;
    const tryC = c => { let n = 0; for(const m of ms) if(angErr(c, m) < thr) n += score(m); if(n > bestN){ bestN = n; bestC = c; } };
    tryC(cp);
    for(let it = 0; it < 80; it++){
      const a = pool[(this.rand() * pool.length) | 0], b = pool[(this.rand() * pool.length) | 0];
      if(a === b) continue;
      const mt = meet(a.lm.X, scl(a.b, -1), b.lm.X, scl(b.b, -1));
      if(mt && len(sub(mt.X, cp)) < 1.5) tryC(mt.X);
    }
    let inl = ms.filter(m => angErr(bestC, m) < thr);
    if(inl.length < 6) return null;
    let p = [0, 0, 0, bestC[0], bestC[1], bestC[2], 0];
    const sigPx = 1.2 / this.f, sigW = 0.02, sigF = 0.02;
    const resid = (pp, m) => {
      const Rw = mul(expm([pp[0], pp[1], pp[2]]), R);
      const d = mtv(Rw, sub(m.lm.X, [pp[3], pp[4], pp[5]]));
      if(d[2] > -1e-3) return null;
      const f = this.f * (1 + pp[6]);
      return [d[0] / -d[2] - (m.u - this.cx) / f, d[1] / -d[2] + (m.v - this.cy) / f];
    };
    const eps = [1e-5, 1e-5, 1e-5, 1e-5, 1e-5, 1e-5, 1e-5];
    for(let iter = 0; iter < 5; iter++){
      const H = new Array(49).fill(0), g = new Array(7).fill(0);
      for(const m of inl){
        const r0 = resid(p, m);
        if(!r0) continue;
        const J = [];
        for(let k = 0; k < 7; k++){
          const q = p.slice(); q[k] += eps[k];
          const r1 = resid(q, m) || r0;
          J.push([(r1[0] - r0[0]) / eps[k], (r1[1] - r0[1]) / eps[k]]);
        }
        const e = Math.hypot(r0[0], r0[1]) / sigPx;
        const wgt = (e < 2 ? 1 : 2 / e) * score(m);
        for(let a = 0; a < 7; a++){
          g[a] += wgt * (J[a][0] * r0[0] + J[a][1] * r0[1]) / (sigPx * sigPx);
          for(let b = 0; b < 7; b++) H[a * 7 + b] += wgt * (J[a][0] * J[b][0] + J[a][1] * J[b][1]) / (sigPx * sigPx);
        }
      }
      for(let a = 0; a < 3; a++){ H[a * 7 + a] += 1 / (sigW * sigW); g[a] += p[a] / (sigW * sigW); }
      H[48] += 1 / (sigF * sigF); g[6] += p[6] / (sigF * sigF);
      for(let a = 3; a < 6; a++) H[a * 7 + a] += 1e-6;
      const dx = solve(H, g.map(x => -x), 7);
      if(!dx) break;
      p = p.map((v, i) => v + dx[i]);
      if(Math.hypot(dx[3], dx[4], dx[5]) < 1e-4) break;
    }
    const c = [p[3], p[4], p[5]];
    const Rw = mul(expm([p[0], p[1], p[2]]), R);
    const inliers = [], outliers = [];
    for(const m of ms){
      const pr = this.proj(Rw, c, m.lm.X);
      const e = pr ? Math.hypot(pr[0] - m.u, pr[1] - m.v) : 1e9;
      (e < 4 ? inliers : outliers).push(m);
    }
    return {c, w: [p[0], p[1], p[2]], df: p[6], inliers, outliers};
  }

  /* Lost: look for the landmarks by appearance alone (corners in this
     picture against every landmark that could be in this direction), then
     the same two-ray RANSAC. */
  relocate(R, need){
    const {w, h} = this;
    const corners = fast(this.img0, w, h, 16, 18, 10).slice(0, 160);
    const fwd = mv(R, [0, 0, -1]);
    const cand = this.lms.filter(l => dot(nrm(sub(l.X, this.c)), fwd) > 0.55 && l.seen > 3);
    if(cand.length < 8) return;
    const ms = [];
    for(const k of corners){
      const pt = patch(this.img0, w, h, k.x, k.y, 4);
      if(!pt) continue;
      let best = 0.8, bl = null;
      for(const l of cand){
        if(!this.templates(l, 1)) continue;
        let s = 0;
        for(let i = 0; i < 81; i++) s += pt[i] * l.t0[i];
        if(s > best){ best = s; bl = l; }
      }
      if(bl) ms.push({lm: bl, u: k.x, v: k.y, b: nrm(mv(R, this.ray(k.x, k.y))), s: best});
    }
    if(ms.length < 8) return;
    const thr = 0.03;
    let bestC = null, bestN = 0;
    for(let it = 0; it < 150; it++){
      const a = ms[(this.rand() * ms.length) | 0], b = ms[(this.rand() * ms.length) | 0];
      if(a === b || a.lm === b.lm) continue;
      const mt = meet(a.lm.X, scl(a.b, -1), b.lm.X, scl(b.b, -1));
      if(!mt || len(sub(mt.X, this.c)) > 6) continue;
      let n = 0;
      for(const m of ms){ const d = nrm(sub(m.lm.X, mt.X)); if(Math.acos(Math.max(-1, Math.min(1, dot(d, m.b)))) < thr) n++; }
      if(n > bestN){ bestN = n; bestC = mt.X; }
    }
    if(bestC && bestN >= (need || 10)){ this.c = bestC; this.vel = [0, 0, 0]; this.coast = 0.31; }
  }

  /* Back on the old map: after being lost and starting again, the phone
     may be carrying on from the wrong place. Every so often, landmarks not
     seen for a while are looked for by appearance; if enough of them agree
     the phone is somewhere else, it is. */
  reanchor(R){
    const old = this.lms.filter(l => !l.tent && this.frame - (l.lastF || 0) > 45);
    if(old.length < 15) return;
    const keep = this.lms;
    this.lms = old;
    const c0 = this.c.slice(), coast = this.coast;
    this.relocate(R, 15);
    const moved = len(sub(this.c, c0));
    this.lms = keep;
    if(moved > 0.25){
      // the newer landmarks were placed from the wrong place: trust them less
      for(const l of keep) if(this.frame - (l.born || 0) < 400 && old.indexOf(l) < 0){ l.tent = true; l.kc = 0; }
      this.kfs = [];
      this.vel = [0, 0, 0];
    } else { this.c = c0; this.coast = coast; }
  }

  /* New landmarks, where the picture has none. A corner below the horizon
     is put on the floor at once (the floor is y = 0 and we know which way
     is down); anything else waits for a second view from far enough away. */
  grow(R){
    const {w, h} = this;
    const D = this.median(this.lms.filter(l => l.vis).map(l => len(sub(l.X, this.c)))) || 2.5;
    // follow the candidates
    const keep = [];
    for(const cd of this.cands){
      const p = this.proj(R, this.c, add(cd.c0, scl(cd.b0, D)));
      if(!this.inView(p, 8)){ if(++cd.miss > 30) continue; keep.push(cd); continue; }
      const m = this.find(cd, (p[0] + cd.u) / 2, (p[1] + cd.v) / 2, 28, 1);
      if(!m || m.s < 0.8){ if(++cd.miss > 8) continue; keep.push(cd); continue; }
      cd.u = m.x; cd.v = m.y; cd.miss = 0; cd.n++;
      const b = nrm(mv(R, this.ray(m.x, m.y)));
      // keep a sighting every few frames: all of them must agree before it is believed
      if(cd.n % 4 === 0){ cd.rays = cd.rays || [{c: cd.c0, b: cd.b0}]; cd.rays.push({c: this.c.slice(), b}); if(cd.rays.length > 8) cd.rays.splice(1, 1); }
      const par = Math.acos(Math.min(1, dot(cd.b0, b)));
      if(par > 0.07 && len(sub(this.c, cd.c0)) > 0.22 && cd.rays && cd.rays.length >= 3){
        const rays = cd.rays.concat([{c: this.c, b}]);
        const X = rayPoint(rays);
        if(X && len(sub(X, this.c)) < 9 && len(sub(X, this.c)) > 0.3 && X[1] > -0.2 && X[1] < 3.5 &&
           rays.every(r => { const d = sub(X, r.c), t = dot(d, r.b); return t > 0 && len(sub(d, scl(r.b, t))) / t < 0.018; })){
          this.addLandmark(m.x, m.y, X, false, {c: cd.c0, b: cd.b0}, cd);
          continue;
        }
      }
      // two seconds without enough to place it: it was not a good one
      if(cd.n > 60) continue;
      keep.push(cd);
    }
    this.cands = keep;
    const few = this.lms.filter(l => l.vis).length < 40;
    if(this.frame % (few ? 2 : 3) !== 0 || this.lms.length > 800) return;
    const cell = 26, cw = Math.ceil(w / cell);
    const taken = new Set();
    const mark = (u, v) => taken.add(((v / cell) | 0) * cw + ((u / cell) | 0));
    for(const lm of this.lms) if(lm.vis) mark(lm.u, lm.v);
    for(const cd of this.cands) mark(cd.u, cd.v);
    // plain painted walls have few strong corners: take weaker ones when short
    let corners = fast(this.img0, w, h, 16, cell, 10);
    if(few && corners.length < 30) corners = fast(this.img0, w, h, 9, cell, 10);
    for(const k of corners){
      const key = ((k.y / cell) | 0) * cw + ((k.x / cell) | 0);
      if(taken.has(key)) continue;
      taken.add(key);
      const b = nrm(mv(R, this.ray(k.x, k.y)));
      // on a wall already found: placed at once, like the floor (and on
      // probation the same way - a chair in front of the wall is not on it)
      const wh = b[1] > -0.4 ? this.wallHit(this.c, b) : null;
      if(wh){ this.addLandmark(k.x, k.y, wh, false, null, null, b, true); continue; }
      // on the floor, if it is low enough in the picture and not too far
      // (steeply: the lower half of every wall and all the furniture is below
      // eye level too, but not this far below it, this close)
      if(b[1] < -0.4){
        const t = this.c[1] / -b[1];
        if(t < 3.2){ this.addLandmark(k.x, k.y, add(this.c, scl(b, t)), true, null, null, b); continue; }
      }
      if(this.cands.length > 160) continue;
      const cd = {c0: this.c.slice(), b0: b, u: k.x, v: k.y, miss: 0, n: 0};
      if(!this.snap(cd, k.x, k.y)) continue;
      this.cands.push(cd);
    }
  }

  addLandmark(u, v, X, floor, first, from, b, wall){
    const lm = {X, seen: 1, miss: 0, u, v, vis: true, floor, wall: !!wall, tent: true, cap: this.c.slice(), cap0: this.c.slice(), born: this.frame, lastU: u, lastV: v, lastF: this.frame,
      prob: !!floor || !!wall, ok: 0, bad: 0, b0: b || nrm(sub(X, this.c))};
    if(!this.snap(lm, u, v)) return;
    if(first) this.addRay(lm, first.c, first.b);
    this.addRay(lm, this.c, nrm(sub(X, this.c)));
    this.lms.push(lm);
  }

  /* ---------- the walls ----------
     Upright flat surfaces, found among the confirmed landmarks: RANSAC on
     pairs (an upright plane through two points), then the next wall among
     what is left, up to six. Each remembers how far along it the landmarks
     reach, so a corner is only put on it within that stretch. */
  findWalls(){
    let pts = this.lms.filter(l => !l.tent && !l.floor && !l.prob && l.X[1] > 0.15 && l.X[1] < 2.8).map(l => l.X);
    const walls = [];
    for(let wn = 0; wn < 6 && pts.length >= 12; wn++){
      let best = null, bestIn = [];
      for(let it = 0; it < 120; it++){
        const a = pts[(this.rand() * pts.length) | 0], b = pts[(this.rand() * pts.length) | 0];
        const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz);
        if(l < 0.4) continue;
        const n = [dz / l, 0, -dx / l], d = dot(n, a);
        const inl = pts.filter(p => Math.abs(dot(n, p) - d) < 0.05);
        if(inl.length > bestIn.length){ bestIn = inl; best = {n, d}; }
      }
      if(!best || bestIn.length < 12) break;
      // refit through all of them (the mean point; the direction from the spread along it)
      const t = [-best.n[2], 0, best.n[0]];
      const along = bestIn.map(p => dot(t, p)).sort((x, y) => x - y);
      const mean = scl(bestIn.reduce((acc, p) => add(acc, p), [0, 0, 0]), 1 / bestIn.length);
      best.d = dot(best.n, mean);
      best.t = t; best.a0 = along[0] - 0.6; best.a1 = along[along.length - 1] + 0.6;
      walls.push(best);
      pts = pts.filter(p => bestIn.indexOf(p) < 0);
    }
    if(walls.length || this.frame % 300 === 0) this.walls = walls;
  }
  /* Where a ray from c along b meets a known wall first, or null. */
  wallHit(c, b){
    let best = null, bt = 8;
    for(const W of this.walls || []){
      const den = dot(W.n, b);
      if(Math.abs(den) < 0.15) continue;            // too glancing to trust
      const t = (W.d - dot(W.n, c)) / den;
      if(t < 0.4 || t > bt) continue;
      const X = add(c, scl(b, t)), a = dot(W.t, X);
      if(a < W.a0 || a > W.a1 || X[1] < 0.03 || X[1] > 2.7) continue;
      bt = t; best = X;
    }
    return best;
  }

  /* ---------- for the game ---------- */
  /* The room point under a screen position (pixel u, v): the median depth
     of the landmarks close to that ray. null if there are none. */
  pointAt(u, v){
    const b = nrm(mv(this.Rc, this.ray(u, v)));
    const ds = [];
    for(const l of this.lms){
      if(l.seen < 3) continue;
      const d = sub(l.X, this.c), t = dot(d, b);
      if(t <= 0) continue;
      if(len(sub(d, scl(b, t))) / t < 0.07) ds.push(t);
    }
    if(ds.length < 2) return null;
    return add(this.c, scl(b, this.median(ds)));
  }
  /* The camera's rotation with the sensors' learnt error taken out, as a 3x3 row-major matrix. */
  rotation(){ return this.Rc; }
  /* Tracked points on screen, for drawing the dots that show it working. */
  points(){ return this.lms.filter(l => l.vis && l.miss === 0).map(l => [l.u, l.v]); }
}
