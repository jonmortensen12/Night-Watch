/* Night Watch: Haunted House - end to end in Chromium, with a pretend camera.

   node hauntcheck.mjs          (serves web/ itself on a spare port)

   Every phone is a tab at haunt/?local=1&sim=1: the "network" is a
   BroadcastChannel between tabs, and the "camera" is a pretend living room
   with markers taped up (web/haunt/simcam.js), drawn from wherever this
   script stands the phone. Each phone's pretend motion sensors start from a
   different direction, as real ones do, so finding the room's yaw from the
   markers is tested too.

   What it checks: the print page's markers can be read back; the first
   phone in hosts; the survey finds every marker and makes the right
   portals at the right sizes; a phone knows where it is from the markers
   (and a second phone, with its own sensor yaw); a game plays - monsters
   come through the portals, get shot, boards get repaired; and when the
   host's tab closes, the next phone carries the game on.

   Screenshots go to shots/ (git-ignored). */
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
  page.on('console', m => { if(m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(who + ': ' + m.text()); });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(page, fn, arg, ms = 15000){
  const t = Date.now();
  while(Date.now() - t < ms){ if(await page.evaluate(fn, arg)) return true; await wait(150); }
  return false;
}
const SET = 'TESTHH';

/* ---------- the print page ---------- */
console.log('the print page');
{
  const p = await ctx.newPage();
  watchErrors(p, 'print');
  await p.setViewportSize({width: 900, height: 1200});
  await p.goto(BASE + 'haunt/print.html#' + SET);
  ok(await p.evaluate(() => NW_PRINT.code()) === SET, 'a set code in the link is the set printed');
  ok(/\/haunt\/#TESTHH$/.test(await p.evaluate(() => NW_PRINT.url())), 'its QR code goes to the game with the code');
  const sheets = await p.$$('.sheet');
  ok(sheets.length === 1 + 8 + 2, `cover, eight markers and a pair (${sheets.length} sheets)`);
  ok(await p.evaluate(() => document.getElementById('style').value) === 'hatch', 'ink saver is the default');
  // a printed marker, photographed (well, screenshotted) and read back, in
  // each style, sharp and small (as if from across the room)
  for(const style of ['hatch', 'light', 'solid']){
    await p.selectOption('#style', style);
    const note = await p.evaluate(() => document.getElementById('inkNote').textContent);
    const png = await (await p.$$('.sheet'))[4].screenshot();
    const got = await p.evaluate(async b64 => {
      const {Detector} = await import('./markers.js');
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const out = [];
      for(const k of [2, 6]){
        const w = Math.round(img.width / k), h = Math.round(img.height / k);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
        for(let i = 0; i < w * h; i++) gray[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
        out.push(new Detector(w, h).detect(gray).map(m => m.id));
      }
      return out;
    }, png.toString('base64'));
    ok(got.every(g => g.length === 1 && g[0] === 3), `${style}: a printed marker reads back, close and small (${JSON.stringify(got)}) - ${note}`);
  }
  await p.close();
}

/* ---------- phones ---------- */
async function phone(name, syaw){
  const p = await ctx.newPage();
  await p.setViewportSize({width: 390, height: 780});
  watchErrors(p, name);
  await p.goto(BASE + `haunt/?local=1&sim=1&q=low&syaw=${syaw}#${SET}`);
  await p.fill('#nameIn', name);
  await p.click('#enterBtn');
  return p;
}
/* Stand the pretend phone somewhere, looking some way, and let it see. */
async function stand(p, pos, yaw, pitch, frames = 12){
  await p.evaluate(([pos, yaw, pitch]) => NW_TEST.sim().set(pos, yaw, pitch, 0), [pos, yaw, pitch]);
  const n0 = await p.evaluate(() => performance.now());
  await until(p, t => performance.now() - t > 400, n0, 5000);
  await wait(frames * 20);
}
/* room frame <-> the pretend room: the survey phone's sensors were turned by
   its syaw, and the room's middle is where the survey stood */
const rot = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

console.log('joining');
const A = await phone('Ann', 0.6);
ok(await until(A, () => NW_TEST.state().joined && NW_TEST.iAmHost(), null, 30000), 'the first phone in finds no game and hosts it');
ok(await until(A, () => !!document.querySelector('#lobby.on'), null, 15000), 'its lobby is up');
ok(await A.evaluate(() => document.getElementById('startNow').disabled), 'no game can start before the room is set up');

console.log('setting up the room');
await A.evaluate(() => NW_TEST.startSurvey());
const MID = [0, 1.4, 0.2];
// turn slowly round in the middle, at eye level and then looking down
for(const pitch of [-0.05, -0.75]){
  for(let k = 0; k <= 40; k++) await stand(A, [MID[0] + Math.sin(k) * 0.05, MID[1], MID[2]], k / 40 * Math.PI * 2, pitch, 3);
}
await A.evaluate(() => NW_TEST.sim().set([0, 1.4, 0.2], Math.PI, -0.05, 0));
await wait(800);
await A.screenshot({path: 'shots/haunt-survey.png'});
const list = await A.evaluate(() => NW_TEST.survey().list());
console.log('       found: ' + list.map(m => `${m.label}(${m.kind}${m.ok ? '' : ', not yet'})`).join(' '));
ok([0, 1, 2, 12, 13].every(id => list.some(m => m.id === id && m.ok)), 'every marker is found');
ok(list.find(m => m.id === 2) && list.find(m => m.id === 2).kind === 'floor', 'the one on the floor is on the floor');
ok(list.filter(m => m.id !== 2).every(m => m.kind === 'wall'), 'the others are on walls');
await A.evaluate(() => NW_TEST.endSurvey(true));
ok(await until(A, () => getComputedStyle(document.getElementById('marks')).display === 'none', null, 8000),
  "the survey's marker outlines are gone once it is done");
const L = await A.evaluate(() => NW_TEST.layout());
ok(L && L.portals.length === 4, `four portals: ${L && L.portals.map(p => p.name).join(', ')}`);
// against the truth: distances between markers do not care which way the room was turned
const TRUE = {0: [0.9, 1.3, -2.985], 1: [-2.785, 1.2, -1.4], 2: [2.0, 0, -0.6], 12: [-1.1, 1.05, 2.99], 13: [0.6, 1.05, 2.99]};
let worst = 0;
for(const a of [0, 1, 2, 12, 13]) for(const b of [0, 1, 2, 12, 13]){
  if(a >= b) continue;
  const e = Math.abs(dist(L.markers[a].p, L.markers[b].p) - dist(TRUE[a], TRUE[b]));
  worst = Math.max(worst, e);
}
ok(worst < 0.25, `markers placed where they are, to within ${(worst * 100).toFixed(0)} cm`);
const hErr = Math.max(...[0, 1, 12, 13].map(id => Math.abs(L.markers[id].p[1] - TRUE[id][1])));
ok(hErr < 0.12, `at the right heights, from the floor marker (worst ${(hErr * 100).toFixed(0)} cm)`);
const wide = L.portals.find(p => p.ids.length === 2), door = L.portals.find(p => p.kind === 'door');
ok(wide && Math.abs(Math.hypot(wide.b[0] - wide.a[0], wide.b[1] - wide.a[1]) - 1.7) < 0.2, 'pair A makes one wide window between its markers');
ok(door && door.y0 === 0 && door.y1 > 1.9, 'the floor marker is a doorway, floor to head height');
// the doorway faces the way its arrow points (+x in the pretend room)
const dn = rot([door.n[0], 0, door.n[1]], -0.6);
ok(dn[0] > 0.9, `the doorway faces the way its arrow points (${dn.map(v => v.toFixed(2))})`);
const win = L.portals.find(p => p.ids[0] === 0), wn = rot([win.n[0], 0, win.n[1]], -0.6);
ok(wn[2] < -0.9, `the front window's way out is out through the front wall (${wn.map(v => v.toFixed(2))})`);
const f = await A.evaluate(() => NW_TEST.focal());
const F = 0.7 * 640;
ok(Math.abs(f.f - F) / F < 0.06, `the camera's focal length worked out from the markers (${f.f.toFixed(0)} px, truly ${F})`);

console.log('finding yourself');
async function whereAmI(p, pos, yaw, pitch, syaw){
  await stand(p, pos, yaw, pitch, 80);
  const l = await p.evaluate(() => NW_TEST.loc());
  if(!l.P) return {err: 99, yawErr: 99};
  // the survey stood at MID: that is the room's middle, its floor is y = 0
  const truth = rot([pos[0] - MID[0], pos[1], pos[2] - MID[2]], 0.6);
  return {err: dist(l.P, truth), yawErr: Math.abs(((l.yaw - (0.6 - syaw) + Math.PI * 3) % (Math.PI * 2)) - Math.PI), P: l.P, truth};
}
const w1 = await whereAmI(A, [0.4, 1.3, -0.4], -0.15, -0.05, 0.6);
console.log('       P', w1.P && w1.P.map(v => v.toFixed(2)), 'truth', w1.truth.map(v => v.toFixed(2)), 'yaw err', (w1.yawErr * 57.3).toFixed(1));
ok(w1.err < 0.25, `the surveying phone, walked away and looking at a window, knows where it is (${(w1.err * 100).toFixed(0)} cm out)`);
const B = await phone('Bob', -1.1);
ok(await until(B, () => NW_TEST.state().joined && !NW_TEST.iAmHost() && !!NW_TEST.layout(), null, 30000), 'a second phone joins the game and is given the room');
const w2 = await whereAmI(B, [-1.0, 1.5, 0.8], 0.7, -0.1, -1.1);
console.log('       P', w2.P && w2.P.map(v => v.toFixed(2)), 'truth', w2.truth && w2.truth.map(v => v.toFixed(2)), await B.evaluate(() => JSON.stringify(NW_TEST.focal())));
ok(w2.err < 0.35, `a second phone, its sensors pointing elsewhere and its lens not yet learnt (8% out), finds itself from a marker (${(w2.err * 100).toFixed(0)} cm out)`);
ok(w2.yawErr < 0.08, `and which way round the room it is (${(w2.yawErr * 180 / Math.PI).toFixed(1)}° out)`);
await A.screenshot({path: 'shots/haunt-lobby.png'});

console.log('a game');
// from the room's frame (the survey phone's) to the pretend room's, and a way to look
const toWorld = c => { const w = rot(c, -0.6); return [w[0] + MID[0], w[1], w[2] + MID[2]]; };
const look = (from, to) => { const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], l = Math.hypot(...d); return [Math.atan2(-d[0], -d[2]), Math.asin(d[1] / l)]; };
const posts = {A: [0.1, 1.4, 0.3], B: [-0.6, 1.5, 1.0]};
await A.evaluate(() => NW_TEST.go());
ok(await until(A, () => NW_TEST.state().phase === 'wave', null, 20000), 'START: the countdown, then wave 1');
ok(await until(B, () => NW_TEST.state().phase === 'wave', null, 10000), 'on both phones');
let sawOutside = 0, shots = 0;
async function bot(p, who){
  const st = await p.evaluate(() => { const z = NW_TEST.z().state(); return {mons: z.mons, phase: z.phase}; });
  const at = posts[who];
  const live = st.mons.filter(m => m.type !== 'witch' || true).map(m => ({m, w: toWorld(m.c)}));
  if(!live.length || (st.phase !== 'wave' && st.phase !== 'break')){ await p.evaluate(() => NW_TEST.z().fire(false)); return 0; }
  live.sort((a, b) => dist(a.w, at) - dist(b.w, at));
  const [yaw, pitch] = look(at, live[0].w);
  await p.evaluate(([at, yaw, pitch]) => { NW_TEST.sim().set(at, yaw, pitch, 0); NW_TEST.z().fire(true); }, [at, yaw, pitch]);
  return live.length;
}
const t0 = Date.now();
let peak = 0, waveSeen = 0;
while(Date.now() - t0 < 75000){
  peak = Math.max(peak, await bot(A, 'A'), await bot(B, 'B'));
  const v = await A.evaluate(() => [...NW_TEST.view().mons.values()].filter(e => e.out).length);
  sawOutside = Math.max(sawOutside, v);
  const s = await A.evaluate(() => NW_TEST.state());
  waveSeen = Math.max(waveSeen, s.wave || 0);
  if(s.phase === 'over') break;
  if(Date.now() - t0 > 40000 && !shots){ shots = 1; await A.screenshot({path: 'shots/haunt-ar.png'}); }
  await wait(250);
}
const sA = await A.evaluate(() => { const p = NW_TEST.host().S.players; return Object.values(p).map(q => ({n: q.name, k: q.kills, sh: q.shots, hi: q.hits})); });
console.log('       ' + sA.map(q => `${q.n}: ${q.k} kills, ${q.hi}/${q.sh} hits`).join('; ') + `; wave ${waveSeen}, peak ${peak} monsters`);
ok(peak > 0, 'monsters come');
ok(sawOutside > 0, `they are drawn out in the graveyard, through the holes (${sawOutside} at once)`);
ok(sA.every(q => q.k > 0), 'both phones shoot them down, aiming through the pretend camera');
const portalsOut = await A.evaluate(() => { const S = NW_TEST.host().S; return S.mons.every(m => m.type === 'witch' || S.sd[m.sec] != null); });
ok(portalsOut, 'every monster is headed for one of this room\'s portals');

console.log('repairing');
{
  // knock a portal about, then walk over to it and hold REPAIR
  const target = await A.evaluate(() => { const S = NW_TEST.host().S; S.secs[0].hp = 40; return S.sd[0]; });
  const markerWorld = toWorld(L.markers[L.portals[0].ids[0]].p);
  const standRoom = [target.mid[0] - target.n[0] * 0.7, 1.4, target.mid[1] - target.n[1] * 0.7];
  const standW = toWorld(standRoom);
  const [yaw, pitch] = look(standW, markerWorld);
  await A.evaluate(([at, yaw, pitch]) => { NW_TEST.z().fire(false); NW_TEST.sim().set(at, yaw, pitch, 0); }, [standW, yaw, pitch]);
  ok(await until(A, () => NW_TEST.z().state().nearSec === 0, null, 8000), 'standing at the hole, the phone offers REPAIR');
  const before = await A.evaluate(() => NW_TEST.host().S.secs[0].hp);
  await A.evaluate(() => NW_TEST.z().repair(true));
  await wait(2500);
  const after = await A.evaluate(() => NW_TEST.host().S.secs[0].hp);
  await A.evaluate(() => NW_TEST.z().repair(false));
  ok(after > before + 10, `holding REPAIR boards it back up (${before.toFixed(0)} -> ${after.toFixed(0)})`);
}

console.log('full immersion');
await B.evaluate(() => NW_TEST.setView('vr'));
await wait(1500);
await B.screenshot({path: 'shots/haunt-vr.png'});
ok(await B.evaluate(() => NW_TEST.view().roomBox.visible && !NW_TEST.view().bg.visible), 'the room is drawn instead of the camera');

console.log('the host drops out');
{
  const before = await B.evaluate(() => NW_TEST.state());
  const monsBefore = await A.evaluate(() => NW_TEST.host().S.mons.length);
  await wait(2200);                       // a fresh copy of the game reaches every phone
  await A.close();
  ok(await until(B, () => NW_TEST.iAmHost(), null, 20000), 'the next phone takes over the game');
  const after = await B.evaluate(() => ({s: NW_TEST.state(), mons: NW_TEST.host().S.mons.length, phase: NW_TEST.host().S.phase}));
  ok(after.s.wave >= before.wave && after.phase !== 'lobby', `carrying on: wave ${after.s.wave}, ${after.phase} (was wave ${before.wave})`);
  ok(monsBefore === 0 || after.mons > 0, `with the monsters where they were (${after.mons}, was ${monsBefore})`);
  ok(await until(B, () => NW_TEST.state().room && NW_TEST.state().room.people.some(p => p.n === 'Bob' && !p.w), null, 8000), 'and this phone still playing in it');
  const C = await phone('Cat', 2.0);
  ok(await until(C, () => NW_TEST.state().joined && !NW_TEST.iAmHost() && !!NW_TEST.layout(), null, 30000), 'somebody scanning the code now joins the new host, and gets the room');
}

if(errors.length) console.log('errors:\n  ' + errors.slice(0, 20).join('\n  '));
ok(!errors.length, 'no errors in any page');
await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
