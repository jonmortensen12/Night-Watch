/* Night Watch: Haunted House - the printed markers.

   A marker is a black square, six cells by six: a solid border one cell
   wide round a four-by-four block of black and white bits. Eighteen of them,
   chosen so that any two differ in at least five bits however either is
   turned - so a misread bit or two is never taken for another marker, and
   the way up is never in doubt. 0-11 mark a window or a door on their own;
   12-17 come in pairs (A, B, C), one at each edge of an opening too wide for
   one.

   Found in a camera frame by: an adaptive threshold (dark against the
   neighbourhood, so a dim room and a bright window both work), the dark
   blobs, each blob's convex hull reduced to four corners, the edges pulled
   onto the exact light-dark boundary, then the cells read through the
   square's perspective and matched against the list.

   Where a marker is, from where it is seen: its four corners and its known
   printed size give the camera's position and turn relative to it (a
   homography, polished by least squares, trying both of the two answers a
   flat square allows and keeping the one that fits). */

export const SIZE = 0.16;              // the black square, printed, metres
export const CODES = [9212, 55548, 39473, 10360, 43594, 6207, 50945, 32783, 20409, 26007, 61320, 12267, 54845, 3402, 57003, 24822, 28843, 47846];
export const SINGLES = 12;

/* 12 and 13 are pair A's left and right, 14/15 B, 16/17 C. */
export function pairOf(id){
  if(id < SINGLES || id >= CODES.length) return null;
  const k = (id - SINGLES) >> 1;
  return {pair: 'ABC'[k], side: (id - SINGLES) & 1 ? 'R' : 'L', mate: id ^ 1};
}
export function label(id){
  const p = pairOf(id);
  return p ? p.pair + (p.side === 'L' ? ' left' : ' right') : String(id + 1);
}

/* The six-by-six cells, row by row from the top, 1 for black. */
export function cells(id){
  const code = CODES[id], g = [];
  for(let y = 0; y < 6; y++){
    const row = [];
    for(let x = 0; x < 6; x++){
      if(x === 0 || y === 0 || x === 5 || y === 5) row.push(1);
      else row.push((code >> ((y - 1) * 4 + (x - 1))) & 1);
    }
    g.push(row);
  }
  return g;
}

/* Draw one onto a 2D canvas (black on whatever is there - draw it on white). */
/* Printing them without emptying the cartridge. The black square is most
   of a page of solid black, so two lighter styles: inside a solid frame
   round the outside, the black is hatched with diagonal lines (a little
   under half ink). From more than an arm's length the camera sees the
   hatching as a dark grey, which is all the cells need: they are read
   against each other, not against pure black. The frame keeps the square's
   edge sharp, and that edge is what gives the distance. Millimetres, for a
   160 mm square. In a synthetic test (blur, noise, dim light, at angles)
   all three are found as often out to 3.5 m; past that solid does a little
   better. Position errors, median, as a share of the distance:
     solid    79% ink   0.2-0.5%
     hatch    52% ink   0.3% to 2.5 m, ~1% to 3.5 m   (the default)
     light    41% ink   ~2-3% (the thin frame lets the grey soften the edge) */
export const STYLES = {
  solid: {name: 'Solid', frame: 80},
  hatch: {name: 'Ink saver', frame: 12, pitch: 2.2, line: 1.0},
  light: {name: 'Lightest', frame: 3, pitch: 2.2, line: 1.0},
};
const styleOf = st => STYLES[st] || STYLES.solid;

/* Draw one onto a 2D canvas (draw it on white). */
export function drawMarker(g, id, x, y, size, style){
  const c = cells(id), s = size / 6, H = styleOf(style);
  g.fillStyle = '#000';
  if(!H.pitch){
    for(let j = 0; j < 6; j++) for(let i = 0; i < 6; i++)
      if(c[j][i]) g.fillRect(x + i * s - 0.25, y + j * s - 0.25, s + 0.5, s + 0.5);
    return;
  }
  const mm = size / 160;
  g.save();
  g.beginPath();
  for(let j = 0; j < 6; j++) for(let i = 0; i < 6; i++) if(c[j][i]) g.rect(x + i * s - 0.25, y + j * s - 0.25, s + 0.5, s + 0.5);
  g.clip();
  g.strokeStyle = '#000'; g.lineWidth = H.line * mm;
  g.beginPath();
  // the pitch is measured across the lines
  for(let t = -size; t < size * 2; t += H.pitch * mm * Math.SQRT2){ g.moveTo(x + t, y); g.lineTo(x + t - size, y + size); }
  g.stroke();
  g.restore();
  const f = H.frame * mm;
  g.fillRect(x, y, size, f); g.fillRect(x, y + size - f, size, f);
  g.fillRect(x, y, f, size); g.fillRect(x + size - f, y, f, size);
}
/* The same as SVG, for the print page: crisp at any printer resolution. */
export function markerSVG(id, style){
  const c = cells(id), H = styleOf(style);
  let p = '';
  for(let j = 0; j < 6; j++) for(let i = 0; i < 6; i++) if(c[j][i]) p += `M${i} ${j}h1v1h-1z`;
  if(!H.pitch)
    return `<svg viewBox="0 0 6 6" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><path d="${p}" fill="#000"/></svg>`;
  const k = 6 / 160, F = H.frame * k, P = H.pitch * k * Math.SQRT2, L = H.line * k;
  let lines = '';
  for(let t = -6; t < 12; t += P) lines += `M${t.toFixed(4)} 0L${(t - 6).toFixed(4)} 6`;
  return `<svg viewBox="0 0 6 6" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="m${id}"><path d="${p}"/></clipPath></defs>` +
    `<path d="${lines}" stroke="#000" stroke-width="${L.toFixed(4)}" fill="none" clip-path="url(#m${id})"/>` +
    `<path d="M0 0h6v6h-6zM${F} ${F}v${6 - 2 * F}h${6 - 2 * F}v${-(6 - 2 * F)}z" fill="#000" fill-rule="evenodd"/></svg>`;
}
/* How much of the square is ink, 0..1. */
export function inkOf(id, style){
  const c = cells(id), H = styleOf(style);
  let black = 0;
  for(let j = 0; j < 6; j++) for(let i = 0; i < 6; i++) black += c[j][i];
  const solid = black / 36;
  if(!H.pitch) return solid;
  const fr = H.frame / 160, frame = 1 - (1 - 2 * fr) ** 2;
  return frame + (solid - frame) * Math.min(1, H.line / H.pitch);
}

/* ================= finding them ================= */
const pc = x => { let n = 0; while(x){ n += x & 1; x >>>= 1; } return n; };

export class Detector {
  constructor(w, h){
    this.resize(w, h);
  }
  resize(w, h){
    if(w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.integ = new Uint32Array((w + 1) * (h + 1));
    this.dark = new Uint8Array(w * h);
    this.lab = new Int32Array(w * h);
    this.stack = new Int32Array(w * h);
    this.r = Math.max(4, Math.round(Math.max(w, h) / 48));
  }

  /* gray: Uint8Array w*h. Returns [{id, c: [[x, y] x4: the printed top
     left, top right, bottom right, bottom left], ctr: [x, y], px: side in pixels}] */
  detect(gray){
    const {w, h, integ, dark, lab, stack} = this, W1 = w + 1;
    // integral image
    for(let y = 0; y < h; y++){
      let row = 0;
      const o = y * w, io = (y + 1) * W1;
      for(let x = 0; x < w; x++){ row += gray[o + x]; integ[io + x + 1] = integ[io - W1 + x + 1] + row; }
    }
    // dark against the neighbourhood
    const r = this.r, C = 7;
    for(let y = 0; y < h; y++){
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for(let x = 0; x < w; x++){
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const sum = integ[y1 * W1 + x1] - integ[y0 * W1 + x1] - integ[y1 * W1 + x0] + integ[y0 * W1 + x0];
        const n = (y1 - y0) * (x1 - x0);
        dark[y * w + x] = gray[y * w + x] * n < sum - C * n ? 1 : 0;
      }
    }
    // the dark blobs
    lab.fill(0);
    const blobs = [];
    let next = 1;
    const minSide = 9, maxSide = Math.min(w, h) * 0.95;
    for(let i = 0; i < w * h; i++){
      if(!dark[i] || lab[i]) continue;
      const id = next++;
      let sp = 0, n = 0, bx0 = w, bx1 = 0, by0 = h, by1 = 0;
      stack[sp++] = i; lab[i] = id;
      while(sp){
        const k = stack[--sp], x = k % w, y = (k - x) / w;
        n++;
        if(x < bx0) bx0 = x; if(x > bx1) bx1 = x; if(y < by0) by0 = y; if(y > by1) by1 = y;
        if(x > 0 && dark[k - 1] && !lab[k - 1]){ lab[k - 1] = id; stack[sp++] = k - 1; }
        if(x < w - 1 && dark[k + 1] && !lab[k + 1]){ lab[k + 1] = id; stack[sp++] = k + 1; }
        if(y > 0 && dark[k - w] && !lab[k - w]){ lab[k - w] = id; stack[sp++] = k - w; }
        if(y < h - 1 && dark[k + w] && !lab[k + w]){ lab[k + w] = id; stack[sp++] = k + w; }
      }
      const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
      if(bw < minSide || bh < minSide || bw > maxSide || bh > maxSide || n < 30) continue;
      if(bw > bh * 5 || bh > bw * 5) continue;
      blobs.push({id, bx0, bx1, by0, by1, n});
    }
    const out = [];
    for(const b of blobs){
      const q = this.quad(b);
      if(!q) continue;
      const m = this.read(gray, q);
      if(m) out.push(m);
    }
    // the same marker found twice (a ring inside a ring): keep the larger
    out.sort((a, b) => b.px - a.px);
    const seen = new Set();
    return out.filter(m => { if(seen.has(m.id)) return false; seen.add(m.id); return true; });
  }

  /* A blob's outline as four corners, clockwise on screen, or null. */
  quad(b){
    const {w, lab} = this, pts = [];
    for(let y = b.by0; y <= b.by1; y++){
      let l = -1, r = -1;
      const o = y * w;
      for(let x = b.bx0; x <= b.bx1; x++) if(lab[o + x] === b.id){ if(l < 0) l = x; r = x; }
      if(l >= 0){ pts.push([l, y]); if(r !== l) pts.push([r + 1, y]); }
    }
    const hull = convexHull(pts);
    if(hull.length < 4) return null;
    // the two points furthest apart, then the furthest either side of them
    let a = 0, c = 0, best = -1;
    for(let i = 0; i < hull.length; i++) for(let j = i + 1; j < hull.length; j++){
      const d = (hull[i][0] - hull[j][0]) ** 2 + (hull[i][1] - hull[j][1]) ** 2;
      if(d > best){ best = d; a = i; c = j; }
    }
    const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    let bI = -1, dI = -1, bv = 0, dv = 0;
    for(let i = 0; i < hull.length; i++){
      const s = side(hull[a], hull[c], hull[i]);
      if(s > bv){ bv = s; bI = i; }
      if(s < dv){ dv = s; dI = i; }
    }
    if(bI < 0 || dI < 0) return null;
    let idx = [a, bI, c, dI];
    // polish: each corner in turn moves to whichever hull point makes the biggest quad
    const area = q => { let s = 0; for(let i = 0; i < 4; i++){ const p = hull[q[i]], r = hull[q[(i + 1) % 4]]; s += p[0] * r[1] - r[0] * p[1]; } return Math.abs(s) / 2; };
    for(let it = 0; it < 2; it++) for(let k = 0; k < 4; k++){
      let ba = area(idx), bi = idx[k];
      for(let i = 0; i < hull.length; i++){ const t = idx.slice(); t[k] = i; const ar = area(t); if(ar > ba){ ba = ar; bi = i; } }
      idx[k] = bi;
    }
    let q = idx.map(i => hull[i].slice());
    // clockwise on screen (y down): positive signed area
    let sa = 0;
    for(let i = 0; i < 4; i++){ const p = q[i], r = q[(i + 1) % 4]; sa += p[0] * r[1] - r[0] * p[1]; }
    if(sa < 0) q = [q[0], q[3], q[2], q[1]];
    const qa = Math.abs(sa) / 2;
    let ha = 0;
    for(let i = 0; i < hull.length; i++){ const p = hull[i], r = hull[(i + 1) % hull.length]; ha += p[0] * r[1] - r[0] * p[1]; }
    ha = Math.abs(ha) / 2;
    // a small square's corners are rounded off by blur, so its outline
    // overshoots the four corners more
    if(ha > qa * (1.1 + 3 / Math.sqrt(qa)) || qa < 60) return null;
    let mn = Infinity, mx = 0;
    for(let i = 0; i < 4; i++){
      const p = q[i], r = q[(i + 1) % 4], l = Math.hypot(r[0] - p[0], r[1] - p[1]);
      mn = Math.min(mn, l); mx = Math.max(mx, l);
      // convex: every turn the same way
      const t = q[(i + 2) % 4];
      if(side(p, r, t) <= 0) return null;
    }
    if(mn < 8 || mx > mn * 4.5) return null;
    return this.refine(q);
  }

  /* Pull each edge onto the strongest light-dark step near it, and the
     corners onto where the edges meet. */
  refine(q){
    const g = this.gray;
    const lines = [];
    for(let i = 0; i < 4; i++){
      const p = q[i], r = q[(i + 1) % 4];
      const dx = r[0] - p[0], dy = r[1] - p[1], l = Math.hypot(dx, dy);
      const nx = dy / l, ny = -dx / l;       // outward, for a clockwise quad on screen
      const pts = [];
      const N = Math.max(6, Math.min(16, Math.round(l / 4)));
      for(let k = 1; k < N; k++){
        const t = 0.1 + 0.8 * k / N;
        const x0 = p[0] + dx * t, y0 = p[1] + dy * t;
        let bestS = 0, bestO = null, prev = null;
        const vals = [];
        for(let o = -3.5; o <= 3.5; o += 0.5) vals.push(bilin(g, this.w, this.h, x0 + nx * o, y0 + ny * o));
        for(let j = 1; j < vals.length - 1; j++){
          const s = vals[j + 1] - vals[j - 1];   // dark inside, light outside: rising outwards
          if(s > bestS){ bestS = s; bestO = j; }
        }
        if(bestO == null || bestS < 12) continue;
        // a parabola through the step's peak for a finer position
        const s0 = vals[bestO] - vals[Math.max(0, bestO - 2)], s2 = vals[Math.min(vals.length - 1, bestO + 2)] - vals[bestO];
        const sm = bestS, den = s0 - 2 * sm + s2;
        const sub = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (s0 - s2) / den)) : 0;
        const o = -3.5 + (bestO + sub) * 0.5;
        pts.push([x0 + nx * o, y0 + ny * o]);
        prev = o;
      }
      if(pts.length < 3) return q;
      lines.push(fitLine(pts));
    }
    const out = [];
    for(let i = 0; i < 4; i++){
      const a = lines[(i + 3) % 4], b = lines[i];
      const p = meet(a, b);
      if(!p || Math.hypot(p[0] - q[i][0], p[1] - q[i][1]) > 4) return q;
      out.push(p);
    }
    return out;
  }

  /* The cells, read through the quad's perspective, in each of the four
     ways up; the marker if one matches. */
  read(gray, q){
    const {w, h} = this;
    for(let k = 0; k < 4; k++){
      const c = [q[k], q[(k + 1) % 4], q[(k + 2) % 4], q[(k + 3) % 4]];
      const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], c);
      if(!H) return null;
      const at = (u, v) => { const z = H[6] * u + H[7] * v + H[8]; return [(H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z]; };
      const cell = (i, j) => {
        let s = 0;
        // sixteen points across the middle of the cell: hatching, seen
        // close, averages out
        for(const a of [-0.3, -0.1, 0.1, 0.3]) for(const b of [-0.3, -0.1, 0.1, 0.3]){ const p = at((i + 0.5 + a) / 6, (j + 0.5 + b) / 6); s += bilin(gray, w, h, p[0], p[1]); }
        return s / 16;
      };
      if(k === 0){
        // light and dark levels: the border, and the paper just outside it
        let dk = 0, nd = 0, lt = 0, nl = 0;
        const vals = [];
        for(let j = 0; j < 6; j++) for(let i = 0; i < 6; i++) vals.push(cell(i, j));
        this._vals = vals;
        for(let j = 0; j < 6; j++) for(let i = 0; i < 6; i++) if(i === 0 || j === 0 || i === 5 || j === 5){ dk += vals[j * 6 + i]; nd++; }
        for(let t = 0; t < 12; t++){
          const u = (t + 0.5) / 12;
          for(const p of [at(u, -0.08), at(u, 1.08), at(-0.08, u), at(1.08, u)]){ lt += bilin(gray, w, h, p[0], p[1]); nl++; }
        }
        dk /= nd; lt /= nl;
        if(lt - dk < 22) return null;
        // Black and white for the bits come from the bits themselves - every
        // marker has some of each - split where they divide best. (The
        // border is no guide to them: an ink-saver marker's border has a
        // solid frame, its bits are only hatched, and blur mixes the two.)
        const inner = [];
        for(let j = 1; j < 5; j++) for(let i = 1; i < 5; i++) inner.push(vals[j * 6 + i]);
        const so = inner.slice().sort((a, b) => a - b);
        let best = -1, cut = 0;
        for(let n = 4; n <= 12; n++){
          const m0 = so.slice(0, n).reduce((a, x) => a + x, 0) / n, m1 = so.slice(n).reduce((a, x) => a + x, 0) / (16 - n);
          const score = n * (16 - n) * (m1 - m0) ** 2;
          if(score > best){ best = score; cut = n; this._m0 = m0; this._m1 = m1; }
        }
        const span = this._m1 - this._m0;
        this._thr = (this._m0 + this._m1) / 2;
        // the white bits are paper, the black ones well down towards the border
        if(span < 12 || span < (lt - dk) * 0.3 || this._m1 < dk + (lt - dk) * 0.55) return null;
        let bad = 0;
        for(let j = 0; j < 6; j++) for(let i = 0; i < 6; i++) if((i === 0 || j === 0 || i === 5 || j === 5) && vals[j * 6 + i] > this._thr) bad++;
        if(bad > 2) return null;
        // every bit clearly one or the other (a picture on the wall is mostly neither)
        for(const x of inner) if(Math.abs(x - this._thr) < span * 0.2) return null;
      }
      // the inner bits, read with this corner as the top left
      let code = 0;
      const v = this._vals;
      for(let j = 1; j < 5; j++) for(let i = 1; i < 5; i++){
        // cell (i, j) seen from corner k is cell rot^-k of the k=0 reading
        let ii = i, jj = j;
        for(let r = 0; r < k; r++){ const t = ii; ii = 5 - jj; jj = t; }
        if(v[jj * 6 + ii] < this._thr) code |= 1 << ((j - 1) * 4 + (i - 1));
      }
      for(let id = 0; id < CODES.length; id++){
        if(pc(code ^ CODES[id]) <= 1){
          const ctrP = at(0.5, 0.5);
          let px = 0;
          for(let i = 0; i < 4; i++) px += Math.hypot(c[(i + 1) % 4][0] - c[i][0], c[(i + 1) % 4][1] - c[i][1]);
          return {id, c, ctr: ctrP, px: px / 4};
        }
      }
    }
    return null;
  }
}
// read() and refine() need the frame; detect() lends it
const _detect = Detector.prototype.detect;
Detector.prototype.detect = function(gray){ this.gray = gray; return _detect.call(this, gray); };

function bilin(g, w, h, x, y){
  x -= 0.5; y -= 0.5;
  if(x < 0) x = 0; if(y < 0) y = 0;
  if(x > w - 1.001) x = w - 1.001; if(y > h - 1.001) y = h - 1.001;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
}

function convexHull(pts){
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for(const p of pts){ while(lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for(let i = pts.length - 1; i >= 0; i--){ const p = pts[i]; while(up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

/* Least-squares line through points: {p: a point on it, d: its direction}. */
function fitLine(pts){
  let mx = 0, my = 0;
  for(const p of pts){ mx += p[0]; my += p[1]; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for(const p of pts){ const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return {p: [mx, my], d: [Math.cos(a), Math.sin(a)]};
}
function meet(a, b){
  const den = a.d[0] * b.d[1] - a.d[1] * b.d[0];
  if(Math.abs(den) < 1e-6) return null;
  const t = ((b.p[0] - a.p[0]) * b.d[1] - (b.p[1] - a.p[1]) * b.d[0]) / den;
  return [a.p[0] + a.d[0] * t, a.p[1] + a.d[1] * t];
}

/* The 3x3 homography (row-major, H[8] = 1) taking four points to four. */
export function homography(src, dst){
  const A = [], B = [];
  for(let i = 0; i < 4; i++){
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  const h = solve(A, B);
  return h ? h.concat([1]) : null;
}
function solve(A, B){
  const n = B.length, M = A.map((r, i) => r.concat([B[i]]));
  for(let c = 0; c < n; c++){
    let p = c;
    for(let r = c + 1; r < n; r++) if(Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if(Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for(let r = 0; r < n; r++){
      if(r === c) continue;
      const f = M[r][c] / M[c][c];
      if(f) for(let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/* ================= where it is ================= */
/* Small rotation kit: matrices are row-major arrays of 9. */
const mul = (A, B) => { const C = new Array(9); for(let i = 0; i < 3; i++) for(let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return C; };
const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
function rodrigues(w){
  const th = Math.hypot(w[0], w[1], w[2]);
  if(th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const k = [w[0] / th, w[1] / th, w[2] / th], c = Math.cos(th), s = Math.sin(th), v = 1 - c;
  return [c + k[0] * k[0] * v, k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s,
    k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v, k[1] * k[2] * v - k[0] * s,
    k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v];
}

/* Camera-vision frames inside: x right, y down, z ahead; the marker's x to
   its printed right, y down the page, z into the paper. */
function project(R, t, X, f, cx, cy){
  const p = mv(R, X);
  const z = p[2] + t[2];
  return [f * (p[0] + t[0]) / z + cx, f * (p[1] + t[1]) / z + cy, z];
}
function residual(R, t, obj, img, f, cx, cy){
  let e = 0;
  const r = [];
  for(let i = 0; i < 4; i++){
    const p = project(R, t, obj[i], f, cx, cy);
    if(p[2] <= 0.01) return {e: 1e9, r: null};
    r.push(p[0] - img[i][0], p[1] - img[i][1]);
    e += (p[0] - img[i][0]) ** 2 + (p[1] - img[i][1]) ** 2;
  }
  return {e, r};
}
function polish(R, t, obj, img, f, cx, cy){
  let cur = residual(R, t, obj, img, f, cx, cy), lam = 1e-3;
  for(let it = 0; it < 12 && cur.r; it++){
    // numeric Jacobian, six parameters: a small turn, then a shift
    const J = [], h = 1e-5;
    for(let k = 0; k < 6; k++){
      const d = [0, 0, 0, 0, 0, 0]; d[k] = h;
      const R2 = mul(rodrigues(d.slice(0, 3)), R), t2 = [t[0] + d[3], t[1] + d[4], t[2] + d[5]];
      const r2 = residual(R2, t2, obj, img, f, cx, cy).r;
      if(!r2) return {R, t, e: cur.e};
      J.push(r2.map((v, i) => (v - cur.r[i]) / h));
    }
    const A = [], g = [];
    for(let a = 0; a < 6; a++){
      A.push([]);
      for(let b = 0; b < 6; b++){ let s = 0; for(let i = 0; i < 8; i++) s += J[a][i] * J[b][i]; A[a].push(s + (a === b ? lam * (s + 1e-9) : 0)); }
      let s = 0; for(let i = 0; i < 8; i++) s += J[a][i] * cur.r[i]; g.push(-s);
    }
    const d = solve(A, g);
    if(!d) break;
    const R2 = mul(rodrigues(d.slice(0, 3)), R), t2 = [t[0] + d[3], t[1] + d[4], t[2] + d[5]];
    const nx = residual(R2, t2, obj, img, f, cx, cy);
    if(nx.e < cur.e){ R = R2; t = t2; cur = nx; lam = Math.max(1e-7, lam / 4); if(Math.hypot(...d) < 1e-7) break; }
    else lam *= 8;
  }
  return {R, t, e: cur.e};
}

/* The marker's pose seen from the camera, in three.js's frames (x right, y
   up, z toward the viewer, for both): R turns marker directions into camera
   ones and t is the marker's centre. err: pixels, rms. amb: how close the
   other possible answer came (near 1: the turn is not to be trusted much). */
export function solvePose(c, f, cx, cy, size){
  const s = (size || SIZE) / 2;
  const obj = [[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0]];
  const nrm = c.map(p => [(p[0] - cx) / f, (p[1] - cy) / f]);
  const H = homography(obj.map(o => [o[0], o[1]]), nrm);
  if(!H) return null;
  let h1 = [H[0], H[3], H[6]], h2 = [H[1], H[4], H[7]], h3 = [H[2], H[5], H[8]];
  let lam = 2 / (Math.hypot(...h1) + Math.hypot(...h2));
  if(h3[2] * lam < 0) lam = -lam;
  const r1 = h1.map(v => v * lam), r2 = h2.map(v => v * lam), t0 = h3.map(v => v * lam);
  const n1 = norm(r1), r2o = norm(sub(r2, scale(n1, dot(r2, n1)))), r3 = cross(n1, r2o);
  const R0 = [n1[0], r2o[0], r3[0], n1[1], r2o[1], r3[1], n1[2], r2o[2], r3[2]];
  // the other answer: the paper's normal mirrored about the line of sight
  const v = norm(t0), n = [R0[2], R0[5], R0[8]];
  const nr = sub(scale(v, 2 * dot(n, v)), n);
  const ax = cross(n, nr), sa = Math.hypot(...ax), ca = dot(n, nr);
  const Q = sa > 1e-9 ? rodrigues(scale(norm(ax), Math.atan2(sa, ca))) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const a = polish(R0, t0, obj, c, f, cx, cy), b = polish(mul(Q, R0), t0, obj, c, f, cx, cy);
  const best = a.e <= b.e ? a : b, other = a.e <= b.e ? b : a;
  // into three.js's frames: flip y and z on both sides
  const D = [1, 0, 0, 0, -1, 0, 0, 0, -1];
  return {R: mul(mul(D, best.R), D), t: [best.t[0], -best.t[1], -best.t[2]],
    err: Math.sqrt(best.e / 4), amb: (best.e + 0.05) / (other.e + 0.05)};
}

/* The camera's focal length, in pixels, from one square seen at a slant -
   null when the view is too square-on to say. */
export function focalFrom(c, cx, cy){
  const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], c.map(p => [p[0] - cx, p[1] - cy]));
  if(!H) return null;
  const [a, b, , d, e, , g, h] = H;
  const out = [];
  const d1 = g * h, n1 = -(a * b + d * e);
  if(Math.abs(d1) > 1e-7 && n1 / d1 > 0) out.push([Math.sqrt(n1 / d1), Math.abs(d1)]);
  const d2 = g * g - h * h, n2 = -(a * a + d * d - b * b - e * e);
  if(Math.abs(d2) > 1e-7 && n2 / d2 > 0) out.push([Math.sqrt(n2 / d2), Math.abs(d2)]);
  if(!out.length) return null;
  let s = 0, wsum = 0;
  for(const [f, w] of out){ s += f * w; wsum += w; }
  return {f: s / wsum, w: wsum};
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
