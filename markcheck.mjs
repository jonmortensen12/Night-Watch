/* Night Watch - printed markers in Space and the Bunker, end to end in
   Chromium, with a pretend camera.

   node markcheck.mjs           (serves web/ itself on a spare port)

   Every phone is a tab at play.html?local=1&sim=1: the network is a
   BroadcastChannel between tabs, and the camera is the pretend living room
   with markers taped up (web/markers/simcam.js), drawn from wherever this
   script stands the phone. Each phone's pretend motion sensors start from a
   different direction, as real ones do.

   The Bunker, "Walk the room", hosted by a TV: one phone sets up the
   markers (point at FRONT, turn round) and taps the corners of a bunker on
   the floor; the host builds the bunker on that shape and the TV draws it;
   the phone knows where it is from the markers and walks the bunker for
   real; a phone with no camera joins and walks with the stick, kept inside
   the drawn fence; a game plays, monsters come at every side, and walking
   to a wall and holding REPAIR fixes it.

   Space, "Face the same way": one phone sets up; a second phone, its
   sensors pointing somewhere else entirely and never locked, squares itself
   up from a marker in the lobby; the camera is off during a wave and back
   on between waves.

   And "Off" is the game as it was (LOCK FRONT, the stick): netcheck covers
   that. Screenshots go to shots/. */
import {createRequire} from 'module';
import {createServer} from 'http';
import {readFile, mkdir} from 'fs/promises';
import {extname, join, dirname} from 'path';
import {fileURLToPath} from 'url';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'web');
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json'};
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if(path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, {'content-type': TYPES[extname(path)] || 'application/octet-stream'});
    res.end(body);
  } catch(e){ res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://localhost:' + server.address().port + '/';
await mkdir('shots', {recursive: true});

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if(!c) fails++; };
const errors = [];
const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']});
const ctx = await browser.newContext();
ctx.setDefaultTimeout(90000);
function watchErrors(page, who){
  page.on('pageerror', e => errors.push(who + ': ' + e.message));
  page.on('console', m => { if(m.type() === 'error' && !/404|Failed to load resource|camera|getUserMedia|NotFound|NotAllowed|Requested device/i.test(m.text())) errors.push(who + ': ' + m.text()); });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(page, fn, arg, ms = 15000){
  const t = Date.now();
  while(Date.now() - t < ms){ if(await page.evaluate(fn, arg)) return true; await wait(150); }
  return false;
}
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

async function tvHost(game){
  const p = await ctx.newPage();
  await p.setViewportSize({width: 800, height: 450});     // software 3D: a big TV starves the phones
  watchErrors(p, 'tv');
  await p.goto(BASE + `tv.html?local=1&q=low&game=${game}`);
  await until(p, () => NW_TV.state().room && NW_TV.state().room.code, null, 30000);
  return p;
}
async function phone(code, name, game, syaw, camera = true){
  const p = await ctx.newPage();
  await p.setViewportSize({width: 390, height: 780});
  watchErrors(p, name);
  await p.goto(BASE + `play.html?local=1&q=low&game=${game}${camera ? '&sim=1&syaw=' + syaw : ''}#${code}`);
  await p.fill('#nameIn', name);
  await p.click('#joinBtn');
  if(camera) await p.evaluate(() => NW_TEST.sensors());
  await until(p, () => NW_TEST.state().me >= 0, null, 30000);
  return p;
}
/* Stand the pretend phone somewhere, looking some way, and give it a moment. */
async function stand(p, pos, yaw, pitch, ms = 500){
  await until(p, () => !!NW_TEST.kit().test.sim(), null, 15000);
  await p.evaluate(([pos, yaw, pitch]) => NW_TEST.kit().test.sim().set(pos, yaw, pitch, 0), [pos, yaw, pitch]);
  await wait(ms);
}
const look = (from, to) => { const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], l = Math.hypot(...d); return [Math.atan2(-d[0], -d[2]), Math.asin(d[1] / l)]; };
const MID = [0, 1.4, 0.2];
// the pretend room's markers (web/markers/simcam.js)
const MARKS = {0: [0.9, 1.3, -2.985], 1: [-2.785, 1.2, -1.4], 2: [2.0, 0, -0.6], 12: [-1.1, 1.05, 2.99], 13: [0.6, 1.05, 2.99]};

/* Point at FRONT (the front wall), then turn slowly round, twice. */
async function setUp(p, walk){
  await p.click('#mkSetup');
  await until(p, () => NW_TEST.kit().test.setup() && NW_TEST.kit().camOn, null, 15000);
  await stand(p, MID, 0, 0, 600);
  await p.evaluate(() => NW_TEST.kit().test.lock());
  for(const pitch of [-0.05, -0.7]) for(let k = 0; k <= 40; k++) await stand(p, [MID[0] + Math.sin(k) * 0.05, MID[1], MID[2]], k / 40 * Math.PI * 2, pitch, 90);
  await p.evaluate(() => NW_TEST.kit().test.next());
  return p.evaluate(() => NW_TEST.kit().layout);
}

/* ================================================================ the Bunker */
if(!process.env.ONLY_SPACE){
console.log('the Bunker, walking the room');
const tv = await tvHost('zombie');
const code = await tv.evaluate(() => NW_TV.state().room.code);
const A = await phone(code, 'Ann', 'zombie', 0.6);
await until(A, () => !!NW_TEST.state().room, null, 15000);
ok(await A.evaluate(() => [...document.querySelectorAll('#mkOpts button')].every(b => b.style.display !== 'none')), 'the Bunker lobby offers Off, Face the same way and Walk the room');
ok(await until(A, () => NW_TEST.state().room && NW_TEST.state().room.mk.mode === 'off', null, 10000), 'markers are off to start with: the game as it always was');
await A.click('#mkOpts button[data-mk="walk"]');
ok(await until(A, () => NW_TEST.state().room.mk.mode === 'walk', null, 8000), 'Walk the room, picked on a phone, is the room\'s setting');
ok(await A.evaluate(() => /SET UP/.test(document.getElementById('mkSetup').textContent)), 'with nothing set up yet, it offers SET UP MARKERS');
await A.evaluate(() => NW_TEST.go());
await wait(1500);
ok(await A.evaluate(() => NW_TEST.state().phase === 'lobby'), 'no game starts until the bunker is drawn');

const L = await setUp(A, true);
const ids = Object.keys(L.markers).map(Number).sort((a, b) => a - b);
ok(JSON.stringify(ids) === '[0,1,2,12,13]', `the turn round finds every marker (${ids.map(i => i + 1)})`);
// the survey's frame is the room turned to FRONT: here, the pretend room less the middle
let worst = 0;
for(const id of ids){ const t = MARKS[id], m = L.markers[id].p; worst = Math.max(worst, Math.hypot(m[0] - (t[0] - MID[0]), m[2] - (t[2] - MID[2]))); }
ok(worst < 0.3, `and puts them where they are, FRONT ahead (worst ${(worst * 100).toFixed(0)} cm)`);
ok(await A.evaluate(() => NW_TEST.kit().test.setup().step === 'corners'), 'then asks for the corners of the bunker');

// the corners, aimed at on the floor from near the middle
const CORNERS = [[-1.8, -2.0], [1.7, -2.0], [1.7, 2.1], [-1.8, 2.1]];
for(const c of CORNERS){
  // a glance at a marker, then aim at the floor
  const from = [MID[0] + c[0] * 0.25, 1.4, MID[2] + c[1] * 0.25];
  const near = ids.map(id => MARKS[id]).filter(m => m[1] > 0.5).sort((a, b) => dist2([a[0], a[2]], c) - dist2([b[0], b[2]], c))[0];
  const [y1, p1] = look(from, near);
  await stand(A, from, y1, p1, 1500);
  const [y2, p2] = look(from, [c[0], 0, c[1]]);
  await stand(A, from, y2, p2, 500);
  await A.evaluate(() => NW_TEST.kit().test.corner());
}
const corners = await A.evaluate(() => NW_TEST.kit().test.setup().corners);
let cw = 0;
corners.forEach((p, i) => { cw = Math.max(cw, dist2(p, [CORNERS[i][0] - MID[0], CORNERS[i][1] - MID[2]])); });
console.log('       corners', corners.map((p, i) => (dist2(p, [CORNERS[i][0] - MID[0], CORNERS[i][1] - MID[2]]) * 100).toFixed(0) + ' cm').join(', '));
ok(corners.length === 4 && cw < 0.35, `four corners tapped on the floor, each where it was aimed (worst ${(cw * 100).toFixed(0)} cm)`);
await A.evaluate(() => NW_TEST.kit().test.map());
await wait(600);
await A.screenshot({path: 'shots/mk-map.png'});
await A.evaluate(() => NW_TEST.kit().test.done());
ok(await until(A, () => !!NW_TEST.fence(), null, 8000), 'DONE: the host takes the bunker and gives it back');
const F = await A.evaluate(() => NW_TEST.fence());
ok(F.portals.length >= 8 && F.portals.every(p => Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) < 2.4), `its fence is ${F.portals.length} sections of under 2.4 m`);
ok(F.portals.every(p => { const mx = (p.a[0] + p.b[0]) / 2, mz = (p.a[1] + p.b[1]) / 2; return !NW_INSIDE(F.boundary, mx + p.n[0] * 0.2, mz + p.n[1] * 0.2); }), 'every section faces out');
ok(await tv.evaluate(n => NW_TV.fence() === n || NW_TV.state().mode !== 'zombie', F.portals.length), 'the TV draws the same bunker');
ok(await until(A, n => NW_TEST.z().state && NW_TEST.kit().layout && document.getElementById('mkSetup').textContent.indexOf('AGAIN') >= 0, null, 5000), 'the lobby now offers to set it up again');

// walking about for real
async function where(p, pos, yaw, pitch){
  // a jump of over 1.5 m waits for three agreeing fixes, the step gate for
  // 40 cm held 0.4 s, and the catch-up glides at walking pace: a page drawn
  // in software at a few frames a second needs a while for all that
  await stand(p, pos, yaw, pitch, 9000);
  const s = await p.evaluate(() => NW_TEST.z().state());
  const e = Math.hypot(s.x - (pos[0] - MID[0]), s.z - (pos[2] - MID[2]));
  if(e > 0.3) console.log('       (where:', JSON.stringify(await p.evaluate(() => { const l = NW_TEST.kit().test.locator(); return {P: l.P, pending: l.pending, pendN: l.pendN, seen: NW_TEST.kit().seen(), cam: NW_TEST.kit().camOn}; })), 'truth', pos[0] - MID[0], pos[2] - MID[2], ')');
  return e;
}
const w1 = await where(A, [0.9, 1.4, 1.2], ...look([0.9, 1.4, 1.2], MARKS[13]));
ok(w1 < 0.3, `walking over to the back, the phone is there in the bunker too (${(w1 * 100).toFixed(0)} cm out)`);
const w2 = await where(A, [-0.8, 1.4, -1.0], ...look([-0.8, 1.4, -1.0], MARKS[1]));
ok(w2 < 0.3, `and over by the left wall (${(w2 * 100).toFixed(0)} cm out)`);

// a phone with no camera: the stick, inside the fence
const B = await phone(code, 'Bob', 'zombie', 0, false);
ok(await until(B, () => !!NW_TEST.fence(), null, 8000), 'a phone with no camera joins and is given the bunker too');
await B.evaluate(() => { NW_TEST.aim(0, 0, -1); if(document.activeElement) document.activeElement.blur(); });
const b0 = await B.evaluate(() => NW_TEST.z().state());
await B.bringToFront();
await B.keyboard.down('KeyW'); await wait(4000); await B.keyboard.up('KeyW');
await A.bringToFront();
const b1 = await B.evaluate(() => NW_TEST.z().state());
ok(Math.hypot(b1.x - b0.x, b1.z - b0.z) > 0.3, `it walks with the stick (the keys here): ${[b0.x, b0.z]} -> ${[b1.x, b1.z]}`);
ok(await B.evaluate(s => NW_TEST.kit().test.insidePoly(NW_TEST.fence().boundary, s.x, s.z), b1), 'and stops at the fence it was drawn with');
await B.screenshot({path: 'shots/mk-bunker-stick.png'});

// a game
console.log('the Bunker, a game');
await A.evaluate(() => NW_TEST.go());
ok(await until(A, () => NW_TEST.state().phase === 'wave', null, 20000), 'START: wave 1');
const host = () => tv.evaluate(() => { const S = NW_TV.host().S; return {n: S.sd.length, fence: !!(S.layout && S.layout.fence), focus: S.focus.slice(), secs: [...new Set(S.mons.map(m => m.sec))], phase: S.phase}; });
const h0 = await host();
ok(h0.fence && h0.n === F.portals.length, 'the host plays on the drawn fence');
ok(h0.focus.length === h0.n, 'and the monsters may come at any side of it');
const posts = {A: [0.1, 1.4, 0.3]};
let kills0 = 0, secsSeen = new Set();
const toWorld = c => [c[0] + MID[0], c[1], c[2] + MID[2]];
const t0 = Date.now();
while(Date.now() - t0 < 70000){
  const st = await A.evaluate(() => { const z = NW_TEST.z().state(); return {mons: z.mons, phase: z.phase}; });
  const live = st.mons.map(m => ({m, w: toWorld(m.c)})).sort((a, b) => Math.hypot(a.w[0] - posts.A[0], a.w[2] - posts.A[2]) - Math.hypot(b.w[0] - posts.A[0], b.w[2] - posts.A[2]));
  if(live.length && (st.phase === 'wave' || st.phase === 'break')){
    const [yaw, pitch] = look(posts.A, live[0].w);
    await A.evaluate(([at, yaw, pitch]) => { NW_TEST.kit().test.sim().set(at, yaw, pitch, 0); NW_TEST.z().fire(true); }, [posts.A, yaw, pitch]);
  } else await A.evaluate(() => NW_TEST.z().fire(false));
  for(const s of (await host()).secs) secsSeen.add(s);
  if(Date.now() - t0 > 35000 && !kills0){ kills0 = 1; await tv.screenshot({path: 'shots/mk-tv-bunker.png'}); await A.screenshot({path: 'shots/mk-bunker-walk.png'}); }
  await wait(250);
}
await A.evaluate(() => NW_TEST.z().fire(false));
const pl = await tv.evaluate(() => Object.values(NW_TV.host().S.players).map(q => ({n: q.name, k: q.kills, sh: q.shots, x: q.x, z: q.z})));
console.log('       host:', JSON.stringify(await tv.evaluate(() => { const S = NW_TV.host().S; return {phase: S.phase, wave: S.wave, why: S.why}; })), JSON.stringify(pl));
console.log('       ' + pl.map(q => `${q.n}: ${q.k} kills`).join('; ') + `; monsters went for ${secsSeen.size} different sections`);
ok(pl.find(q => q.n === 'Ann').k > 0, 'the walking phone shoots them down, aiming through the pretend camera');
ok(secsSeen.size >= 2, 'they come at more than one side');

// walk over to a wall and fix it
{
  const k = await tv.evaluate(() => { const S = NW_TV.host().S; S.secs[0].hp = 40; return S.sd[0]; });
  const standR = [k.mid[0] - k.n[0] * 0.6, 1.4, k.mid[1] - k.n[1] * 0.6];
  const standW = toWorld(standR);
  // look at the nearest marker on a wall, so the phone knows it is there
  const m = ids.map(id => MARKS[id]).filter(m => m[1] > 0.5).sort((a, b) => Math.hypot(a[0] - standW[0], a[2] - standW[2]) - Math.hypot(b[0] - standW[0], b[2] - standW[2]))[0];
  await stand(A, standW, ...look(standW, m), 2000);
  ok(await until(A, () => NW_TEST.z().state().nearSec === 0, null, 8000), 'walking to the damaged wall, the phone offers REPAIR');
  const before = await tv.evaluate(() => NW_TV.host().S.secs[0].hp);
  await A.evaluate(() => NW_TEST.z().repair(true));
  await wait(2500);
  const after = await tv.evaluate(() => NW_TV.host().S.secs[0].hp);
  await A.evaluate(() => NW_TEST.z().repair(false));
  ok(after > before + 10, `holding REPAIR there fixes it (${before.toFixed(0)} -> ${after.toFixed(0)})`);
}
await A.close(); await B.close(); await tv.close();
}

/* ================================================================ Space */
console.log('Space, facing the same way');
const tv2 = await tvHost('space');
const code2 = await tv2.evaluate(() => NW_TV.state().room.code);
const P = await phone(code2, 'Pat', 'space', 0.6);
await until(P, () => !!NW_TEST.state().room, null, 15000);
ok(await P.evaluate(() => document.querySelector('#mkOpts button[data-mk="walk"]').style.display === 'none'), 'Space offers Off and Face the same way (no walking)');
await P.click('#mkOpts button[data-mk="face"]');
ok(await until(P, () => NW_TEST.state().room.mk.mode === 'face', null, 8000), 'Face the same way is picked');
// the markers this room already has (set up in the Bunker above) are kept on this phone; set up again anyway
const L2 = await setUp(P, false);
ok(L2 && Object.keys(L2.markers).length === 5 && !NW_TEST_FALSE(), 'setting up: point at FRONT, turn round, DONE');
await wait(800);
const Q = await phone(code2, 'Quin', 'space', -1.2);
// Quin never locks FRONT: a look at a marker in the lobby squares the phone up
await stand(Q, [0.4, 1.3, -0.8], ...look([0.4, 1.3, -0.8], MARKS[0]), 3500);
ok(await until(Q, () => NW_TEST.kit().yaw() != null, null, 12000), 'a second phone, never locked, squares itself up from a marker in the lobby');
// both look the same way in the room: their views should agree
async function fwdOf(p, yaw){
  await stand(p, [0, 1.4, 0], yaw, 0, 1500);
  return p.evaluate(() => { const q = NW_TEST.viewQ(); const [x, y, z, w] = q; return [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))]; });
}
const fp = await fwdOf(P, 0.8), fq = await fwdOf(Q, 0.8);
console.log('       fwd', fp.map(v => v.toFixed(2)), fq.map(v => v.toFixed(2)), 'yaws', await P.evaluate(() => NW_TEST.kit().yaw()), await Q.evaluate(() => NW_TEST.kit().yaw()), await Q.evaluate(() => JSON.stringify(NW_TEST.kit().test.locator().yaws.slice(-6).map(e => [+e.y.toFixed(2), +e.w.toFixed(2)]))));
const ang = Math.acos(Math.min(1, fp[0] * fq[0] + fp[1] * fq[1] + fp[2] * fq[2])) * 180 / Math.PI;
ok(ang < 5, `turned the same way in the room, both phones show the same direction (${ang.toFixed(1)}° apart)`);
const fz = await fwdOf(P, 0);
ok(fz[2] < -0.98, `and facing the front wall is FRONT, -z, where the TV's view looks (${fz.map(v => v.toFixed(2))})`);
ok(await Q.evaluate(() => NW_TEST.kit().camOn), 'the camera is on in the lobby');
await P.evaluate(() => NW_TEST.go());
ok(await until(Q, () => NW_TEST.state().phase === 'wave', null, 20000), 'a wave starts');
ok(await until(Q, () => !NW_TEST.kit().camOn, null, 5000), 'during the wave the camera is off (the battery is for the fight)');
await tv2.evaluate(() => { const S = NW_TV.host().S; S.enemies = []; S.phase = 'break'; S.phaseT = 30; });
ok(await until(Q, () => NW_TEST.kit().camOn, null, 8000), 'between waves it is back on, to square up again');
await P.close(); await Q.close(); await tv2.close();

if(errors.length) console.log('errors:\n  ' + errors.slice(0, 20).join('\n  '));
ok(!errors.length, 'no errors in any page');
await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);

function NW_INSIDE(B, x, z){
  let inside = false;
  for(let i = 0, j = B.length - 1; i < B.length; j = i++){
    const [xi, zi] = B[i], [xj, zj] = B[j];
    if((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function NW_TEST_FALSE(){ return false; }
