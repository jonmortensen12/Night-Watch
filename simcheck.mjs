/* Night Watch - the simulation, headless.

   node simcheck.mjs

   Computer gunners play whole games: each turns towards the most urgent
   thing it can see (torpedoes first, then whatever is closest) at a
   human-ish rate, takes a moment to react, and holds the trigger while it
   is on target. People will do better and worse than this; the bounds
   below are a starting point to retune after a family playtest. */
import * as NW from './web/sim.js';
import * as ZB from './web/zsim.js';
import * as WG from './web/wsim.js';

const DT = 1 / 60;
let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if(!c) fails++; };

function bot(S, p, mem, skill){
  // pick a target: torpedoes first, then whatever is nearest
  const live = S.enemies.filter(e => !(e.type === 'boss' && e.shielded) && !(e.type === 'phantom' && e.vis < 0.3));
  if(!mem.tg || !live.find(e => e.id === mem.tg) || mem.retarget <= 0){
    let best = null, bs = Infinity;
    for(const e of live){
      const score = NW.vec.len(e.p) * (e.type === 'torpedo' ? 0.3 : 1) * (0.7 + mem.rand() * 0.6);
      if(score < bs){ bs = score; best = e; }
    }
    mem.tg = best ? best.id : 0; mem.react = skill.react; mem.retarget = 3;
  }
  mem.retarget -= DT;
  const e = live.find(x => x.id === mem.tg);
  let firing = false, tg = 0;
  if(e){
    mem.react -= DT;
    // the bot only knows where it was a moment ago
    const want = NW.vec.norm(e.p);
    const a = p.aim, cos = Math.max(-1, Math.min(1, NW.vec.dot(a, want)));
    const ang = Math.acos(cos), maxTurn = skill.turn * DT;
    let next;
    if(ang <= maxTurn) next = want;
    else { const k = maxTurn / ang; next = NW.vec.norm(NW.vec.add(NW.vec.mul(a, 1 - k), NW.vec.mul(want, k))); }
    // hands shake: a degree or two of wobble, more while turning fast
    const j = skill.shake * (0.5 + Math.min(1, ang));
    if(mem.react <= 0) p.aim = NW.vec.norm(NW.vec.add(next, [(mem.rand() - 0.5) * j, (mem.rand() - 0.5) * j, (mem.rand() - 0.5) * j]));
    const off = Math.acos(Math.max(-1, Math.min(1, NW.vec.dot(p.aim, want))));
    // the trigger goes down when it looks close; the phone's own pick decides what is hit
    if(off < 0.07){ firing = p.heat < 85 || !skill.careful; const h = NW.resolveShot(S, p.aim, 0); tg = h ? h.id : 0; }
    if(off < 0.08 && p.missiles > 0 && (e.type === 'bomber' || e.type === 'turret' || e.type === 'boss' || e.type === 'torpedo' && NW.vec.len(e.p) < 30)) {
      mem.mcd = (mem.mcd || 0) - DT;
      if(mem.mcd <= 0){ NW.missile(S, p.id, e.id); mem.mcd = 1.5; }
    }
  }
  NW.input(S, p.id, p.aim, tg, firing);
}

function play(n, seed, skill, maxMin = 25){
  const S = NW.create(seed);
  const mems = [];
  for(let i = 0; i < n; i++){
    NW.join(S, 'p' + i, 'Bot ' + i);
    let s = seed * 31 + i;
    mems.push({rand: () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)});
  }
  NW.start(S);
  let t = 0, maxEnemies = 0, hullLowest = 100, waveTimes = [], lastWave = 0, lastT = 0;
  let evCount = {};
  while(S.phase !== 'over' && t < maxMin * 60){
    Object.values(S.players).forEach((p, i) => bot(S, p, mems[i], skill));
    NW.step(S, DT);
    t += DT;
    maxEnemies = Math.max(maxEnemies, S.enemies.length);
    hullLowest = Math.min(hullLowest, S.hull);
    if(S.wave !== lastWave){ if(lastWave) waveTimes.push(t - lastT); lastWave = S.wave; lastT = t; }
    for(const e of S.ev) evCount[e[0]] = (evCount[e[0]] || 0) + 1;
    S.ev = [];
  }
  return {S, t, maxEnemies, hullLowest, waveTimes, evCount};
}

const AVG = {react: 0.45, turn: 2.2, careful: true, shake: 0.06};      // radians a second
const GOOD = {react: 0.25, turn: 3.5, careful: true, shake: 0.035};

console.log('basics');
{
  const S = NW.create(7);
  NW.join(S, 'a', 'Ann');
  NW.join(S, 'b', 'Bob');
  ok(S.players.a.color !== S.players.b.color, 'two players get different colours');
  NW.start(S);
  ok(S.phase === 'count', 'start counts down');
  for(let i = 0; i < 60 * 5; i++) NW.step(S, DT);
  ok(S.phase === 'wave' && S.wave === 1, 'wave 1 begins after the countdown');
  for(let i = 0; i < 60 * 4; i++) NW.step(S, DT);
  ok(S.enemies.length > 0, 'enemies arrive');
  ok(S.enemies.every(e => e.p[2] < 0), 'wave 1 starts in front');
  const snap = NW.snap(S);
  ok(snap.en.length === S.enemies.length * 10, 'snapshot carries every enemy');
  ok(JSON.stringify(snap).length < 6000, 'snapshot is small (' + JSON.stringify(snap).length + ' bytes)');
  // shoot the first one with the phone's own pick
  const e = S.enemies[0], hp = e.hp;
  NW.input(S, 'a', NW.vec.norm(e.p), e.id, true);
  NW.step(S, DT);
  ok(e.hp < hp || e.dead, 'a shot on target does damage');
  // a pick that is nowhere near where the phone is pointing is not trusted
  const f = S.enemies.find(x => !x.dead);
  NW.input(S, 'b', NW.vec.mul(NW.vec.norm(f.p), -1), f.id, true);
  const hp2 = f.hp;
  NW.step(S, DT);
  ok(f.hp === hp2, 'a pick 180 degrees off the aim is ignored');
}

console.log('the guns');
{
  const S = NW.create(3);
  NW.join(S, 'a', 'Ann');
  NW.start(S);
  for(let i = 0; i < 60 * 5; i++) NW.step(S, DT);
  NW.input(S, 'a', [0, 1, 0], 0, true);      // straight up, at nothing
  let locked = false;
  for(let i = 0; i < 60 * 3; i++){ NW.step(S, DT); if(S.players.a.locked) locked = true; }
  ok(locked, 'holding the trigger overheats the laser');
  NW.input(S, 'a', [0, 1, 0], 0, false);
  for(let i = 0; i < 60 * 4; i++) NW.step(S, DT);
  ok(!S.players.a.locked, 'and it cools down again');
}

console.log('the boss');
{
  const S = NW.create(11);
  NW.join(S, 'a', 'Ann');
  NW.start(S);
  S.wave = 4;
  for(let i = 0; i < 60 * 5; i++) NW.step(S, DT);
  ok(S.wave === 5 && S.boss, 'wave 5 brings a dreadnought');
  const b = S.enemies.find(e => e.type === 'boss');
  const turrets = S.enemies.filter(e => e.type === 'turret');
  ok(turrets.length === 4, 'with four turrets');
  NW.input(S, 'a', NW.vec.norm(b.p), b.id, true);
  const hp = b.hp;
  for(let i = 0; i < 30; i++) NW.step(S, DT);
  ok(b.hp === hp, 'its core is shielded while turrets stand');
  turrets.forEach(t => { t.hp = 0.5; NW.input(S, 'a', NW.vec.norm(t.p), t.id, true); S.players.a.cd = 0; S.players.a.heat = 0; NW.step(S, DT); });
  ok(!b.shielded, 'shooting every turret drops the shield');
}

console.log('whole games, computer gunners (tuning bounds)');
const rows = [];
for(const [label, n, skill] of [['1 average', 1, AVG], ['2 average', 2, AVG], ['4 average', 4, AVG], ['2 good', 2, GOOD], ['4 good', 4, GOOD]]){
  const res = [];
  for(let seed = 1; seed <= 6; seed++) res.push(play(n, seed, skill));
  const waves = res.map(r => r.S.wave);
  const mins = res.map(r => r.t / 60);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const wt = mean(res.flatMap(r => r.waveTimes));
  const acc = mean(res.map(r => { const ps = Object.values(r.S.players); return ps.reduce((a, p) => a + p.hits, 0) / Math.max(1, ps.reduce((a, p) => a + p.shots, 0)); }));
  rows.push({label, waves: mean(waves), min: mean(mins), wt, maxE: Math.max(...res.map(r => r.maxEnemies)), acc});
  console.log(`  ${label.padEnd(10)} waves ${waves.join(',').padEnd(18)} mean ${mean(waves).toFixed(1)}  ${mean(mins).toFixed(1)} min  ${wt.toFixed(0)} s/wave  peak ${Math.max(...res.map(r => r.maxEnemies))} on screen  accuracy ${(acc * 100).toFixed(0)}%`);
}
const R = Object.fromEntries(rows.map(r => [r.label, r]));
ok(R['1 average'].waves >= 3 && R['1 average'].waves <= 10, 'one average player gets a handful of waves');
ok(R['4 average'].waves >= 3 && R['4 average'].waves <= 12, 'four average players: not trivially easy');
ok(R['2 good'].waves > R['2 average'].waves, 'skill matters');
ok(R['1 average'].min >= 3, 'a solo game lasts a few minutes');
ok(rows.every(r => r.wt >= 25 && r.wt <= 120), 'waves take half a minute to two minutes');


/* ================================================================ zombies */
/* A computer defender: stands in the middle, picks the gun for the range,
   goes and repairs the worst section when nothing is at it, and turns at a
   person's speed with a person's wobble. */
function zbot(S, p, mem, skill){
  const live = S.mons.filter(m => m.type !== 'witch' || true);
  const eye = [p.x, S.haunt ? p.y || ZB.EYE : ZB.EYE, p.z];
  // in a house the defenders walk for real, at walking pace, from the middle
  const speed = S.haunt ? 1.3 : ZB.MOVE_SPEED, home = S.haunt ? [S.cx, S.cz] : [0, 0];
  const urgency = m => {
    const c = ZB.centre(m), d = Math.hypot(c[0] - p.x, c[2] - p.z);
    let u = 40 - d;
    if(m.st === 'climb') u += 100;
    if(m.type === 'ghost') u += 60 - Math.hypot(m.x - home[0], m.z - home[1]) * 2;
    if(m.type === 'bomb') u += 70;
    if(m.st === 'attack') u += 30 - S.secs[m.sec].hp * 0.2;
    return u + mem.rand() * 5;
  };
  if(!mem.tg || !live.find(m => m.id === mem.tg) || (mem.retarget -= DT) <= 0){
    let best = null, bu = -Infinity;
    for(const m of live){ const u = urgency(m); if(u > bu){ bu = u; best = m; } }
    mem.tg = best ? best.id : 0; mem.react = skill.react; mem.retarget = 1.5;
  }
  // repairing: the worst section with nothing at it, if this bot is nearest
  let goal = home.slice(), repair = false;
  let worst = -1, wv = 45;
  S.secs.forEach((s, i) => {
    const busy = S.mons.some(m => m.sec === i && (m.st === 'attack' || m.st === 'climb') && m.type !== 'ghost');
    if(!busy && s.hp < wv){ wv = s.hp; worst = i; }
  });
  if(worst >= 0){
    const sec = S.sd[worst];
    const spot = [sec.mid[0] - sec.n[0] * 0.8, sec.mid[1] - sec.n[1] * 0.8];
    const nearest = Object.values(S.players).filter(q => !q.away).sort((a, b) => Math.hypot(a.x - spot[0], a.z - spot[1]) - Math.hypot(b.x - spot[0], b.z - spot[1]))[0];
    if(nearest === p && !S.mons.some(m => m.st === 'climb')){ goal = spot; repair = Math.hypot(p.x - spot[0], p.z - spot[1]) < 0.6; }
  }
  const gx = goal[0] - p.x, gz = goal[1] - p.z, gl = Math.hypot(gx, gz);
  let x = p.x, z = p.z;
  if(gl > 0.1){ const k = Math.min(gl, speed * DT); x += gx / gl * k; z += gz / gl * k; }
  const m = live.find(q => q.id === mem.tg);
  let firing = false, tg = 0, w = p.w;
  if(m && !repair){
    const c = ZB.centre(m);
    const v = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]], dist = Math.hypot(...v);
    const want = v.map(q => q / dist);
    w = dist < 7 || m.type === 'bat' ? 1 : dist > 16 && m.hp >= 3 ? 2 : 0;
    mem.react -= DT;
    const a = p.aim, cos = Math.max(-1, Math.min(1, a[0] * want[0] + a[1] * want[1] + a[2] * want[2]));
    const ang = Math.acos(cos), maxTurn = skill.turn * DT;
    let next = want;
    if(ang > maxTurn){ const k = maxTurn / ang; next = a.map((q, i) => q * (1 - k) + want[i] * k); }
    const j = skill.shake * (0.5 + Math.min(1, ang));
    if(mem.react <= 0) p.aim = next.map(q => q + (mem.rand() - 0.5) * j);
    const off = Math.acos(Math.max(-1, Math.min(1, (p.aim[0] * want[0] + p.aim[1] * want[1] + p.aim[2] * want[2]) / Math.hypot(...p.aim))));
    if(off < Math.atan(0.6 / dist) + 0.02){ firing = true; tg = m.id; }
  }
  ZB.input(S, p.id, {a: p.aim, x, z, y: S.haunt ? 1.4 : undefined, w, tg, f: firing, r: repair, zm: w === 2});
}

function zplay(n, seed, skill, maxMin = 25, layout){
  const S = ZB.create(seed, layout);
  const mems = [];
  for(let i = 0; i < n; i++){
    ZB.join(S, 'p' + i, 'Bot ' + i);
    let s = seed * 31 + i;
    mems.push({rand: () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)});
  }
  ZB.start(S);
  if(layout) Object.values(S.players).forEach((p, i) => { p.x = S.cx + (i - n / 2) * 0.5; p.z = S.cz; });
  let t = 0, waveTimes = [], lastWave = 0, lastT = 0, peak = 0, broken = 0;
  while(S.phase !== 'over' && t < maxMin * 60){
    Object.values(S.players).forEach((p, i) => zbot(S, p, mems[i], skill));
    ZB.step(S, DT);
    t += DT;
    peak = Math.max(peak, S.mons.length);
    if(S.wave !== lastWave){ if(lastWave) waveTimes.push(t - lastT); lastWave = S.wave; lastT = t; }
    for(const e of S.ev) if(e[0] === 'broken') broken++;
    S.ev = [];
  }
  return {S, t, waveTimes, peak, broken};
}

console.log('zombies: basics');
{
  const S = ZB.create(5);
  ZB.join(S, 'a', 'Ann'); ZB.join(S, 'b', 'Bob');
  ok(S.players.a.color !== S.players.b.color, 'two defenders get different colours');
  ZB.start(S);
  for(let i = 0; i < 60 * 5; i++) ZB.step(S, DT);
  ok(S.phase === 'wave' && S.wave === 1, 'wave 1 after the countdown');
  for(let i = 0; i < 60 * 4; i++) ZB.step(S, DT);
  ok(S.mons.length > 0 && S.mons.every(m => m.z < 0), 'monsters arrive, from in front first');
  const snap = ZB.snap(S);
  ok(snap.m.length === S.mons.length * 11 && snap.sec.length === 8, 'the snapshot carries monsters and all eight sections');
  // walls fall, then something climbs in, then it is over
  const T = ZB.create(9);
  ZB.join(T, 'a', 'Ann'); ZB.start(T);
  for(let i = 0; i < 60 * 5; i++) ZB.step(T, DT);
  T.mons = []; T.plan.next = 999;
  const m = ZB.newMonster(T, 'pumpkin', 0.3, -20);
  m.sec = 0;
  let broke = false, steps = 0;
  while(T.phase !== 'over' && steps < 60 * 120){ ZB.step(T, DT); steps++; if(T.secs[0].broken) broke = true; }
  ok(broke, 'an unchecked monster batters its section down');
  ok(T.phase === 'over' && T.why && T.why.type === 'pumpkin' && T.why.sec === 0, 'then climbs in, and the game is lost');
  // repair
  const R = ZB.create(3);
  ZB.join(R, 'a', 'Ann'); ZB.start(R);
  for(let i = 0; i < 60 * 5; i++) ZB.step(R, DT);
  R.mons = []; R.plan.next = 999;
  R.secs[4].hp = 20;
  ZB.input(R, 'a', {a: [0, 0, 1], x: 2.25, z: 3.6, w: 0, r: true});
  for(let i = 0; i < 60 * 2; i++) ZB.step(R, DT);
  ok(R.secs[4].hp > 60, 'standing at a section holding REPAIR rebuilds it');
  ZB.input(R, 'a', {a: [0, 0, 1], x: -3, z: -3.6, w: 0, r: true});
  R.secs[4].hp = 20;
  for(let i = 0; i < 60; i++) ZB.step(R, DT);
  ok(R.secs[4].hp === 20, 'but only that section, from close to it');
  // ghosts come through walls
  const G = ZB.create(4);
  ZB.join(G, 'a', 'Ann'); ZB.start(G);
  for(let i = 0; i < 60 * 5; i++) ZB.step(G, DT);
  G.mons = []; G.plan.next = 999;
  ZB.newMonster(G, 'ghost', 12, 0);
  let n = 0;
  while(G.phase !== 'over' && n < 60 * 30) { ZB.step(G, DT); n++; }
  ok(G.phase === 'over' && G.why.type === 'ghost' && G.secs.every(s => s.hp === 100), 'a ghost passes through an unbroken wall');
}

console.log('zombies: the guns');
{
  const S = ZB.create(8);
  ZB.join(S, 'a', 'Ann'); ZB.start(S);
  for(let i = 0; i < 60 * 5; i++) ZB.step(S, DT);
  S.mons = []; S.plan.next = 999;
  const shoot = (w, dist, type) => {
    S.mons = [];
    const m = ZB.newMonster(S, type, 0, -dist);
    m.st = 'attack';                                // stands still
    const c = ZB.centre(m), d = [c[0], c[1] - (ZB.EYE - 0.1), c[2]], l = Math.hypot(...d);
    S.players.a.cd = 0;
    ZB.input(S, 'a', {a: d.map(q => q / l), x: 0, z: 0, w, f: true, tg: m.id, zm: true});
    S.players.a.cd = 0;
    const hp = m.hp;
    ZB.step(S, DT);
    ZB.input(S, 'a', {a: d.map(q => q / l), x: 0, z: 0, w, f: false});
    return hp - Math.max(0, m.hp);
  };
  const pc = shoot(1, 6, 'brute'), pf = shoot(1, 18, 'brute');
  ok(pc > pf * 2, `the shotgun is strong close and weak far (${pc.toFixed(1)} at 6 m, ${pf.toFixed(1)} at 18 m)`);
  ok(shoot(2, 25, 'brute') >= 7, 'the sniper hits hard at range');
  ok(shoot(0, 25, 'brute') === 1, 'the pistol does one');
  // the sniper goes through a line of them
  S.mons = [];
  const line = [8, 12, 16].map(d => { const m = ZB.newMonster(S, 'skeleton', 0, -d); m.st = 'attack'; return m; });
  const c = ZB.centre(line[0]);
  ZB.input(S, 'a', {a: [0, (c[1] - ZB.EYE + 0.1) / 8, -1], x: 0, z: 0, w: 2, f: true, zm: true});
  S.players.a.cd = 0;
  ZB.step(S, DT);
  ok(line.every(m => m.dead), 'a sniper shot goes through three in a line');
}

console.log('zombies: the witch');
{
  const S = ZB.create(13);
  ZB.join(S, 'a', 'Ann'); ZB.start(S);
  S.wave = 4;
  for(let i = 0; i < 60 * 5; i++) ZB.step(S, DT);
  ok(S.wave === 5 && S.mons.some(m => m.type === 'witch'), 'wave 5 brings the witch');
  let bombs = 0, sk = 0;
  for(let i = 0; i < 60 * 25; i++){ ZB.step(S, DT); for(const e of S.ev){ if(e[0] === 'bomb') bombs++; if(e[0] === 'summon') sk++; } S.ev = []; if(S.phase === 'over') break; }
  ok(bombs >= 2 && sk >= 1, `she drops pumpkin bombs (${bombs}) and raises skeletons (${sk})`);
}

console.log('zombies: whole games, computer defenders (tuning bounds)');
const zrows = [];
for(const [label, n, skill] of [['1 average', 1, AVG], ['2 average', 2, AVG], ['4 average', 4, AVG], ['2 good', 2, GOOD]]){
  const res = [];
  for(let seed = 1; seed <= 5; seed++) res.push(zplay(n, seed, skill));
  const waves = res.map(r => r.S.wave), mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const why = res.map(r => r.S.why ? r.S.why.type[0] : '-').join('');
  const row = {label, waves: mean(waves), min: mean(res.map(r => r.t / 60)), wt: mean(res.flatMap(r => r.waveTimes)),
    peak: Math.max(...res.map(r => r.peak)), broken: mean(res.map(r => r.broken))};
  zrows.push(row);
  console.log(`  ${label.padEnd(10)} waves ${waves.join(',').padEnd(16)} mean ${row.waves.toFixed(1)}  ${row.min.toFixed(1)} min  ${row.wt.toFixed(0)} s/wave  peak ${row.peak}  walls broken ${row.broken.toFixed(1)}  lost to ${why}`);
}
const Z = Object.fromEntries(zrows.map(r => [r.label, r]));
ok(Z['1 average'].waves >= 3 && Z['1 average'].waves <= 10, 'one average defender lasts a handful of waves');
ok(Z['4 average'].waves >= 3 && Z['4 average'].waves <= 14, 'four average defenders: not trivially easy');
ok(Z['2 good'].waves >= Z['2 average'].waves, 'skill matters');
ok(zrows.every(r => r.wt >= 25 && r.wt <= 120), 'waves take half a minute to two minutes');
ok(zrows.every(r => r.broken >= 0.5), 'walls do get broken (repairing matters)');

/* ================================================================ the Haunted House */
/* The same game in a living room: a window in the front wall and one in
   the left, a doorway by the right wall, a wide window across the back. */
const HOUSE = {v: 1, markers: {}, ceil: 2.4, portals: [
  {name: 'window 1', kind: 'window', a: [0.3, -3], b: [1.5, -3], n: [0, -1], y0: 0.7, y1: 1.9, ids: [0]},
  {name: 'window 2', kind: 'window', a: [-2.8, -0.8], b: [-2.8, -2.0], n: [-1, 0], y0: 0.6, y1: 1.8, ids: [1]},
  {name: 'door 3', kind: 'door', a: [2.0, -0.1], b: [2.0, -1.1], n: [1, 0], y0: 0, y1: 2.05, ids: [2]},
  {name: 'wide window A', kind: 'window', a: [-1.1, 3], b: [0.6, 3], n: [0, 1], y0: 0.45, y1: 1.65, ids: [12, 13]},
]};
console.log('haunted house: the rules in a room');
{
  const S = ZB.create(21, HOUSE);
  ok(S.haunt && S.sd.length === 4 && S.secs.length === 4, 'the portals are the sections');
  ZB.join(S, 'a', 'Ann'); ZB.start(S);
  ok(S.players.a.x === S.players.a.x, 'players are not moved: they stand where they really are');
  for(let i = 0; i < 60 * 5; i++) ZB.step(S, DT);
  ok(S.phase === 'wave' && S.focus.length === 1, `wave 1 comes through one portal (${S.focus.map(i => S.sd[i].name)})`);
  for(let i = 0; i < 60 * 15; i++) ZB.step(S, DT);
  ok(S.mons.length > 0 && S.mons.every(m => S.focus.indexOf(m.sec) >= 0), 'every monster heads for it');
  const outside = S.mons.every(m => { const s = S.sd[m.sec]; return (m.x - s.mid[0]) * s.n[0] + (m.z - s.mid[1]) * s.n[1] > 0; });
  ok(outside, 'and comes from outside the room, beyond it');
  const sn = ZB.snap(S);
  ok(sn.mode === 'haunt' && sn.sec.length === 4 && Array.isArray(sn.foc), 'the snapshot carries the portals and where the wave is coming from');
  // later waves come at two or three
  S.wave = 5; S.phase = 'break'; S.phaseT = 0.01; S.mons = [];
  ZB.step(S, DT);
  ok(S.focus.length === 3, 'wave 6 comes through three');
}
{
  // an unchecked monster breaks a window and climbs in over the sill
  const S = ZB.create(22, HOUSE);
  ZB.join(S, 'a', 'Ann'); ZB.start(S);
  for(let i = 0; i < 60 * 5; i++) ZB.step(S, DT);
  S.plan.groups = []; S.mons = [];
  const s = S.sd[0];
  ZB.newMonster(S, 'pumpkin', s.mid[0], s.mid[1] - 8, {sec: 0});
  let n = 0, broke = false, maxY = 0;
  while(S.phase !== 'over' && n < 60 * 120){ ZB.step(S, DT); n++; if(S.secs[0].broken) broke = true; for(const m of S.mons) if(m.st === 'climb') maxY = Math.max(maxY, m.y); }
  ok(broke && S.phase === 'over' && S.why.sec === 0, 'an unchecked monster breaks the boards and gets in');
  ok(maxY > 0.6, `climbing over the window sill (${maxY.toFixed(2)} m up)`);
}
{
  // a ghost drifts through the boards
  const S = ZB.create(23, HOUSE);
  ZB.join(S, 'a', 'Ann'); ZB.start(S);
  for(let i = 0; i < 60 * 5; i++) ZB.step(S, DT);
  S.plan.groups = []; S.mons = [];
  const s = S.sd[2];
  ZB.newMonster(S, 'ghost', s.mid[0] + 10, s.mid[1], {sec: 2, y: 1});
  let n = 0;
  while(S.phase !== 'over' && n < 60 * 40){ ZB.step(S, DT); n++; }
  ok(S.phase === 'over' && S.why.type === 'ghost' && S.why.sec === 2 && !S.secs[2].broken, 'a ghost comes through the doorway, boards or no boards');
}
{
  // repairing: within reach of a portal, not across the room
  const S = ZB.create(24, HOUSE);
  ZB.join(S, 'a', 'Ann'); ZB.start(S);
  for(let i = 0; i < 60 * 5; i++) ZB.step(S, DT);
  S.plan.groups = []; S.mons = [];
  ZB.newMonster(S, 'pumpkin', 0, -40, {sec: 0});      // so the wave is not over (a break heals everything)
  S.secs[1].hp = 30;
  ZB.input(S, 'a', {a: [-1, 0, 0], x: -1.0, z: -1.4, y: 1.4, w: 0, r: true});
  for(let i = 0; i < 60; i++) ZB.step(S, DT);
  ok(S.secs[1].hp === 30, 'not from two metres away');
  ZB.input(S, 'a', {a: [-1, 0, 0], x: -2.0, z: -1.4, y: 1.4, w: 0, r: true});
  for(let i = 0; i < 60; i++) ZB.step(S, DT);
  ok(S.secs[1].hp > 45, 'but from beside it');
}
{
  // the witch circles low over the house, where the hole in the ceiling is
  const S = ZB.create(25, HOUSE);
  ZB.join(S, 'a', 'Ann'); ZB.start(S);
  S.wave = 4;
  for(let i = 0; i < 60 * 5; i++) ZB.step(S, DT);
  const w = S.mons.find(m => m.type === 'witch');
  ok(!!w, 'wave 5 brings the witch');
  let far = 0, bombs = 0;
  for(let i = 0; i < 60 * 20; i++){
    ZB.step(S, DT);
    if(w.st === 'circle') far = Math.max(far, Math.hypot(w.x - S.cx, w.z - S.cz));
    for(const e of S.ev) if(e[0] === 'bomb') bombs++;
    S.ev = [];
    if(S.phase === 'over') break;
  }
  ok(far > 0 && far < 7, `she circles close over the house (${far.toFixed(1)} m out)`);
  ok(bombs >= 1, 'and bombs its portals');
}
console.log('haunted house: whole games, computer defenders walking about');
const hrows = [];
for(const [label, n, skill] of [['1 average', 1, AVG], ['2 average', 2, AVG], ['4 average', 4, AVG]]){
  const res = [];
  for(let seed = 1; seed <= 5; seed++) res.push(zplay(n, seed, skill, 25, HOUSE));
  const waves = res.map(r => r.S.wave), mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const why = res.map(r => r.S.why ? r.S.why.type[0] : '-').join('');
  const row = {label, waves: mean(waves), min: mean(res.map(r => r.t / 60)), wt: mean(res.flatMap(r => r.waveTimes)),
    peak: Math.max(...res.map(r => r.peak)), broken: mean(res.map(r => r.broken))};
  hrows.push(row);
  console.log(`  ${label.padEnd(10)} waves ${waves.join(',').padEnd(16)} mean ${row.waves.toFixed(1)}  ${row.min.toFixed(1)} min  ${row.wt.toFixed(0)} s/wave  peak ${row.peak}  portals broken ${row.broken.toFixed(1)}  lost to ${why}`);
}
const H = Object.fromEntries(hrows.map(r => [r.label, r]));
ok(H['1 average'].waves >= 3 && H['1 average'].waves <= 12, 'one average defender lasts a handful of waves');
ok(H['4 average'].waves >= 4 && H['4 average'].waves <= 16, 'four: longer, but not for ever');
ok(hrows.every(r => r.wt >= 20 && r.wt <= 120), 'waves take half a minute to two minutes');
ok(hrows.every(r => r.broken >= 0.5), 'portals do get broken (repairing matters)');

/* ================================================================ a bunker drawn round a room */
console.log('the bunker drawn on a floor (printed markers, Walk the room)');
{
  const {fenceLayout} = await import('./web/markers/room.js');
  const L = fenceLayout({v: 2, markers: {}, ceil: 2.4}, [[-1.8, -2.2], [1.7, -2.2], [1.7, 1.9], [-1.8, 1.9]]);
  ok(L.fence && L.portals.length === 8 && L.portals.every(p => p.y0 === 0), `a 3.5 x 4.1 m floor makes ${L.portals.length} fence sections`);
  const S = ZB.create(31, L);
  ZB.join(S, 'a', 'Ann'); ZB.start(S);
  for(let i = 0; i < 60 * 5; i++) ZB.step(S, DT);
  ok(S.focus.length === 8, 'every wave may come at any side of it, as in the square bunker');
  ok(!S.ev.some(e => e[0] === 'focus'), 'and nobody is told "coming through..." (that is the Haunted House)');
  const rows = [];
  for(const [label, n] of [['1 average', 1], ['2 average', 2], ['4 average', 4]]){
    const res = [];
    for(let seed = 1; seed <= 4; seed++) res.push(zplay(n, seed, AVG, 25, L));
    const waves = res.map(r => r.S.wave), mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    rows.push({label, waves: mean(waves), wt: mean(res.flatMap(r => r.waveTimes))});
    console.log(`  ${label.padEnd(10)} waves ${waves.join(',').padEnd(14)} mean ${mean(waves).toFixed(1)}  ${mean(res.flatMap(r => r.waveTimes)).toFixed(0)} s/wave`);
  }
  ok(rows[0].waves >= 3 && rows[0].waves <= 14, 'one defender walking a living room lasts a handful of waves');
  ok(rows.every(r => r.wt >= 20 && r.wt <= 120), 'waves take half a minute to two minutes');
}

/* ================================================================ the wagon */
/* A computer gunslinger: sits in its seat, goes for whatever is most
   dangerous (dynamite in the air, anybody aboard, whoever is aiming),
   turns at a person's speed with a person's wobble, and flicks a reload
   when the cylinder is empty. */
function wbot(S, p, mem, skill){
  const eye = [p.x, WG.EYE, p.z];
  const live = S.foes.filter(f => WG.hittable(f) && f.type !== 'tumble');
  const urgency = f => {
    const c = WG.centre(f), d = Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]);
    let u = 60 - d;
    if(f.type === 'dynamite') u += 90 - f.aux * 10;
    if(f.st === 'aboard' || f.st === 'peck') u += 80;
    if(f.st === 'board' || f.st === 'dive' || f.st === 'swing') u += 50;
    if(f.st === 'aim' || f.st === 'up') u += 35;
    if(f.type === 'crate') u += S.hp < 60 ? 30 : -20;
    if(f.type === 'balloon') u -= 10;
    return u + mem.rand() * 6;
  };
  if(!mem.tg || !live.find(f => f.id === mem.tg) || (mem.retarget -= WDT) <= 0){
    let best = null, bu = -Infinity;
    for(const f of live){ const u = urgency(f); if(u > bu){ bu = u; best = f; } }
    mem.tg = best ? best.id : 0; mem.react = skill.react; mem.retarget = 1.2;
  }
  const f = live.find(q => q.id === mem.tg);
  let firing = false, tg = 0, rl = 0;
  if(p.ammo <= 0 && p.rl <= 0) rl = 1;
  if(f){
    const c = WG.centre(f);
    const v = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]], dist = Math.hypot(...v);
    const want = v.map(q => q / dist);
    mem.react -= WDT;
    const a = p.aim, cos = Math.max(-1, Math.min(1, a[0] * want[0] + a[1] * want[1] + a[2] * want[2]));
    const ang = Math.acos(cos), maxTurn = skill.turn * WDT;
    let next = want;
    if(ang > maxTurn){ const k = maxTurn / ang; next = a.map((q, i) => q * (1 - k) + want[i] * k); }
    const j = skill.shake * (0.5 + Math.min(1, ang));
    if(mem.react <= 0) p.aim = next.map(q => q + (mem.rand() - 0.5) * j);
    const off = Math.acos(Math.max(-1, Math.min(1, (p.aim[0] * want[0] + p.aim[1] * want[1] + p.aim[2] * want[2]) / Math.hypot(...p.aim))));
    if(off < Math.atan(0.6 / dist) + 0.02){ firing = true; tg = f.id; }
    // a person taps: about four shots a second, not a machine gun
    if(firing && (mem.tap = (mem.tap || 0) - WDT) > 0) firing = false;
    else if(firing) mem.tap = 0.25;
  }
  WG.input(S, p.id, {a: p.aim, tg, f: firing, rl});
}
const WDT = 1 / 60;
function wplay(n, seed, skill, maxMin = 25){
  const S = WG.create(seed);
  const mems = [];
  for(let i = 0; i < n; i++){
    WG.join(S, 'p' + i, 'Bot ' + i);
    let s = seed * 31 + i;
    mems.push({rand: () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)});
  }
  WG.start(S);
  let t = 0, waveTimes = [], lastWave = 0, lastT = 0, peak = 0, ouch = {}, kinds = {};
  while(S.phase !== 'over' && t < maxMin * 60){
    Object.values(S.players).forEach((p, i) => wbot(S, p, mems[i], skill));
    if(S.phase === 'break' && S.hold && S.phaseT > 3) WG.next(S, 'p0');     // a few seconds at the stop, then ride on
    WG.step(S, WDT);
    t += WDT;
    peak = Math.max(peak, S.foes.length);
    for(const f of S.foes) kinds[f.type] = 1;
    if(S.wave !== lastWave){ if(lastWave) waveTimes.push(t - lastT); lastWave = S.wave; lastT = t; }
    for(const e of S.ev) if(e[0] === "ouch"){ const ff = S.foes.find(q => q.id === e[4]); const k = (ff ? ff.type : "dynamite") + "@" + S.stage; ouch[k] = (ouch[k] || 0) + e[1]; }
    S.ev = [];
  }
  return {S, t, waveTimes, peak, kinds, ouch};
}

console.log('the wagon: basics');
{
  const S = WG.create(5);
  WG.join(S, 'a', 'Ann'); WG.join(S, 'b', 'Bob'); WG.join(S, 'c', 'Cal');
  ok(['a', 'b', 'c'].map(k => S.players[k].seat).join() === '1,2,3', 'everybody gets the next free seat');
  ok(S.players.a.x < S.players.b.x && S.players.b.x < S.players.c.x && Math.abs(S.players.b.x) < 1e-9, 'seats 1, 2, 3 are the front row, left to right as the room faces the TV');
  ok(['a', 'b', 'c'].every(k => S.players[k].z === S.players.a.z && S.players[k].z < -1), 'and they sit at the front of the wagon');
  WG.input(S, 'a', {seat: 3});
  ok(S.players.a.seat === 3 && S.players.c.seat === 1 && S.players.a.x > S.players.b.x && S.players.c.x < S.players.b.x, 'taking a seat swaps with whoever had it');
  WG.input(S, 'b', {seat: 11});
  ok(S.players.b.x === 0 && S.players.b.z > 1 && WG.seatName(11) === 'back middle', 'seat 11 is the back row, in the middle: right behind the front middle seat');
  WG.input(S, 'c', {seat: 4});
  ok(S.players.c.x < 0 && S.players.c.z > -1.2 && S.players.c.z < 0 && WG.seatName(4) === 'second left', 'seat 4 is the second row, on the left');
  WG.input(S, 'c', {seat: 13});
  ok(S.players.c.seat === 4, 'there are twelve seats, three across and four deep');
  ok(WG.seatPos(1).z < WG.seatPos(12).z && Math.abs(WG.seatPos(1).x - WG.seatPos(10).x) < 1e-9, 'front to back, the columns line up');
  ok([1, 3, 10, 12].every(i => Math.abs(WG.seatPos(i).x) < WG.WAGON.hw - 0.3 && WG.seatPos(i).z > WG.WAGON.front && WG.seatPos(i).z < WG.WAGON.back), 'every seat is on the wagon bed');
  WG.leave(S, 'c');
  ok(Object.keys(S.players).length === 2 && S.players.b.seat === 11, 'somebody leaves the lobby: everybody else stays where they are');
  WG.start(S);
  ok(S.phase === 'count', 'a game starts with the count');
  for(let i = 0; i < 60 * 5; i++) WG.step(S, DT);
  ok(S.phase === 'wave' && S.wave === 1 && S.stage === 0, 'wave 1 is the first stage: ' + WG.STAGES[0].name);
  const sn = WG.snap(S);
  ok(sn.mode === 'wagon' && sn.hp === 100 && sn.sg === 0 && sn.pl[0].am === 6 && sn.m.length % 11 === 0, 'the snapshot: wagon health, stage, ammunition, eleven numbers a foe');
  ok(WG.stageOf(7).key === 'flats' && WG.lapOf(7) === 1 && WG.isBossWave(6) && WG.isBossWave(12) && !WG.isBossWave(5), 'six stages, then round again; the Pass is the boss');
}
console.log('the wagon: revolvers');
{
  const S = WG.create(8);
  WG.join(S, 'a', 'Ann'); WG.start(S);
  for(let i = 0; i < 60 * 5; i++) WG.step(S, DT);
  S.foes = []; S.plan.sent = S.plan.groups.length + 99;
  const aimAt = f => { const c = WG.centre(f), p = S.players.a, d = [c[0] - p.x, c[1] - WG.EYE + 0.1, c[2] - p.z], l = Math.hypot(...d); return d.map(q => q / l); };
  // six shots, then dry
  const b = WG.newFoe(S, 'rider', 0, 0, -30, {st: 'station', station: [0, -30], fireT: 99, boardT: 99, side: 1});
  b.hp = b.hpMax = 99;
  let shots = 0;
  // at the horse, not his head (a headshot would end this at once)
  const body = f => { const c = WG.centre(f), p = S.players.a, d = [c[0] - p.x, c[1] - 0.8 - WG.EYE + 0.1, c[2] - p.z], l = Math.hypot(...d); return d.map(q => q / l); };
  for(let i = 0; i < 60 * 3; i++){ WG.input(S, 'a', {a: body(b), f: true}); WG.step(S, DT); shots += S.ev.filter(e => e[0] === 'shot').length; S.ev = []; if(S.players.a.ammo === 0) break; }
  ok(shots === 6 && S.players.a.ammo === 0, 'six shots and the cylinder is empty');
  WG.input(S, 'a', {a: aimAt(b), f: true, rl: 1});
  for(let i = 0; i < 60 * 1.2; i++) WG.step(S, DT);
  ok(S.players.a.ammo === 0, 'a reload takes a moment');
  for(let i = 0; i < 60 * 0.3; i++) WG.step(S, DT);
  ok(S.players.a.ammo > 0 || S.players.a.ammo === 6 || S.players.a.shots > 6, 'then it is full again');
  // left empty, it reloads itself
  const T = WG.create(9); WG.join(T, 'a', 'Ann'); WG.start(T); for(let i = 0; i < 60 * 5; i++) WG.step(T, DT);
  T.players.a.ammo = 0; T.players.a.dry = WG.GUN.autoReload;
  for(let i = 0; i < 60 * 2.2; i++) WG.step(T, DT);
  ok(T.players.a.ammo === 6, 'an empty gun reloads itself if nobody flicks');
  // a bandit behind his rock cannot be hit; up, he can
  S.foes = []; S.players.a.ammo = 6; S.players.a.rl = 0;
  const h = WG.newFoe(S, 'bandit', 5, 0, -20, {st: 'hide', timer: 99, side: 1});
  WG.input(S, 'a', {a: aimAt(h), f: true}); WG.step(S, DT); WG.input(S, 'a', {a: aimAt(h), f: false});
  for(let i = 0; i < 30; i++) WG.step(S, DT);
  ok(!h.dead && h.hp === h.hpMax, 'a bandit ducked behind his rock is safe');
  h.st = 'up'; h.timer = 99;
  for(let i = 0; i < 60 && !h.dead; i++){ WG.input(S, 'a', {a: aimAt(h), f: i % 15 === 0, tg: h.id}); WG.step(S, DT); }
  ok(h.dead, 'up from behind it, he goes down');
  ok(h.z > -20, 'and his rock was coming past the wagon all the while');
}
console.log('the wagon: headshots, the shotgun, the stop between stages');
{
  const fresh = () => { const S = WG.create(21); WG.join(S, 'a', 'Ann'); WG.start(S); for(let i = 0; i < 60 * 5; i++) WG.step(S, DT); S.foes = []; S.plan.sent = S.plan.groups.length + 99;
    WG.newFoe(S, 'rider', 40, 0, 60, {st: 'station', station: [40, 60], fireT: 99, boardT: 99, side: 1}); return S; };
  const aimAtPt = (S, c) => { const p = S.players.a, d = [c[0] - p.x, c[1] - WG.EYE + 0.1, c[2] - p.z], l = Math.hypot(...d); return d.map(q => q / l); };
  let S = fresh();
  const r = WG.newFoe(S, 'rider', -4, 0, -10, {st: 'station', station: [-4, -10], fireT: 99, boardT: 99, side: -1});
  r.hp = r.hpMax = 30;
  WG.input(S, 'a', {a: aimAtPt(S, WG.headOf(r)), f: true, tg: r.id}); WG.step(S, DT);
  ok(r.dead && S.ev.some(e => e[0] === 'headshot') && S.players.a.heads === 1, 'a revolver shot to the head takes even a tough one down in one');
  S = fresh();
  const r2 = WG.newFoe(S, 'rider', -4, 0, -10, {st: 'station', station: [-4, -10], fireT: 99, boardT: 99, side: -1});
  const hp0 = r2.hp, c = WG.centre(r2);
  WG.input(S, 'a', {a: aimAtPt(S, [c[0], c[1] - 0.7, c[2]]), f: true}); WG.step(S, DT); WG.input(S, 'a', {f: false});
  ok(!S.ev.some(e => e[0] === 'headshot') && hp0 - r2.hp === WG.GUN.dmg, 'a body shot does ' + WG.GUN.dmg + ' damage');
  S = fresh();
  WG.input(S, 'a', {w: 1, f: false});
  for(let i = 0; i < 30; i++) WG.step(S, DT);
  ok(S.players.a.w === 1 && S.players.a.ammo === 2, 'the shotgun: two shells');
  const big = WG.newFoe(S, 'cart', 0, 0, -6, {st: 'station', station: [0, -6], fireT: 99, noBoard: 1, side: 1});
  big.hp = big.hpMax = 8;
  let pellets = 0;
  WG.input(S, 'a', {a: aimAtPt(S, WG.centre(big)), f: true}); WG.step(S, DT); WG.input(S, 'a', {f: false});
  pellets = S.ev.filter(e => e[0] === 'shot').length;
  ok(pellets === 8 && big.dead, 'eight pellets, and close up it flattens even a mine cart');
  for(let i = 0; i < 30; i++){ WG.input(S, 'a', {a: [0, 0, -1], f: i % 20 === 0}); WG.step(S, DT); }
  ok(S.players.a.ammo === 0, 'two shots and it is empty');
  WG.input(S, 'a', {w: 0, f: false}); for(let i = 0; i < 30; i++) WG.step(S, DT);
  ok(S.players.a.w === 0 && S.players.a.ammo === 6, 'back to the revolver: still its six');
  // the stop between stages
  const H = WG.create(5); WG.join(H, 'a', 'Ann'); WG.start(H);
  for(let i = 0; i < 60 * 5; i++) WG.step(H, DT);
  H.foes = []; H.plan.sent = H.plan.groups.length;
  WG.step(H, DT);
  const d0 = H.dist;
  for(let i = 0; i < 60 * 30; i++) WG.step(H, DT);
  ok(H.phase === 'break' && H.hold && H.wave === 1 && Math.abs(H.dist - d0) < 1 && WG.snap(H).hold === 1, 'through a stage, the wagon stops and waits - as long as it takes');
  WG.next(H, 'a');
  ok(H.ev.some(e => e[0] === 'rideon'), 'RIDE ON from any phone');
  for(let i = 0; i < 60 * (WG.BREAK_TIME + 0.5); i++) WG.step(H, DT);
  ok(H.phase === 'wave' && H.wave === 2, 'and after a short count, on to the next stage');
}
console.log('the wagon: trouble');
{
  const fresh = () => { const S = WG.create(11); WG.join(S, 'a', 'Ann'); WG.start(S); for(let i = 0; i < 60 * 5; i++) WG.step(S, DT); S.foes = []; S.plan.sent = S.plan.groups.length + 99; return S; };
  let S = fresh();
  const hp0 = S.hp;
  const t = WG.newFoe(S, 'thrower', 6, 0, -15, {st: 'up', timer: 0.01, side: 1});
  let blasts = 0, dyn = null;
  for(let i = 0; i < 60 * 4; i++){ WG.step(S, DT); dyn = dyn || S.foes.find(f => f.type === 'dynamite'); blasts += S.ev.filter(e => e[0] === 'blast').length; S.ev = []; }
  ok(!!dyn && blasts === 1 && S.hp < hp0, `dynamite thrown at the wagon goes off on it (${(hp0 - S.hp).toFixed(0)} damage)`);
  S = fresh();
  WG.newFoe(S, 'thrower', 6, 0, -15, {st: 'up', timer: 0.01, side: 1});
  for(let i = 0; i < 20; i++) WG.step(S, DT);
  const d2 = S.foes.find(f => f.type === 'dynamite');
  const c = WG.centre(d2), p = S.players.a, v = [c[0] - p.x, c[1] - WG.EYE + 0.1, c[2] - p.z], l = Math.hypot(...v);
  WG.input(S, 'a', {a: v.map(q => q / l), f: true, tg: d2.id}); WG.step(S, DT); WG.input(S, 'a', {f: false});
  for(let i = 0; i < 60 * 4; i++) WG.step(S, DT);
  ok(d2.dead && S.hp === 100 && p.defused === 1, 'shot in the air, it does no harm');
  S = fresh();
  const r = WG.newFoe(S, 'rider', -8, 0, 40, {st: 'ride', station: [-4, 2], fireT: 99, boardT: 3, side: -1});
  let aboard = false;
  for(let i = 0; i < 60 * 15; i++){ WG.step(S, DT); if(r.st === 'aboard') aboard = true; }
  ok(aboard && S.hp < 100, 'a rider left alone jumps aboard and goes for the wagon');
  S = fresh();
  const v0 = WG.newFoe(S, 'vulture', 30, 18, -30, {st: 'fly', ang: 0, R: 8, timer: 2});
  let dove = false;
  for(let i = 0; i < 60 * 20; i++){ WG.step(S, DT); if(v0.st === 'peck') dove = true; }
  ok(dove && S.hp < 100, 'vultures circle, then dive for the cargo');
  S = fresh(); S.hp = 50;
  WG.newFoe(S, 'rider', 30, 0, 50, {st: 'station', station: [30, 50], fireT: 99, boardT: 99, side: 1});   // the stage is not over
  const cr = WG.newFoe(S, 'crate', 4, 0, -20, {st: 'idle', side: 1});
  const cc = WG.centre(cr), q = S.players.a, vv = [cc[0] - q.x, cc[1] - WG.EYE + 0.1, cc[2] - q.z], ll = Math.hypot(...vv);
  WG.input(S, 'a', {a: vv.map(x => x / ll), f: true, tg: cr.id}); WG.step(S, DT);
  ok(S.hp === 65, 'shooting a supply crate patches the wagon up');
  const B = WG.create(3); WG.join(B, 'a', 'Ann'); WG.start(B);
  while(B.wave < 6){ WG.step(B, DT); WG.next(B); if(B.phase === 'wave' && B.wave < 6){ B.foes = []; B.plan.sent = B.plan.groups.length; } B.hp = 100; }
  ok(B.foes.some(f => f.type === 'balloon'), 'wave 6, Outlaw\'s Pass: the Balloon Baron');
  let drops = 0, crew = 0;
  for(let i = 0; i < 60 * 40 && B.phase !== 'over'; i++){ WG.step(B, DT); B.hp = 100; drops += B.ev.filter(e => e[0] === 'toss').length; crew += B.ev.filter(e => e[0] === 'crew').length; B.ev = []; }
  ok(drops >= 3 && crew >= 1, `he drops dynamite (${drops}) and sends his crew swinging down on ropes (${crew})`);
}

console.log('the wagon: whole games, computer gunslingers (tuning bounds)');
const wrows = [];
for(const [label, n, skill] of [['1 average', 1, AVG], ['2 average', 2, AVG], ['4 average', 4, AVG], ['2 good', 2, GOOD]]){
  const res = [];
  for(let seed = 1; seed <= 5; seed++) res.push(wplay(n, seed, skill));
  const waves = res.map(r => r.S.wave), m = a => a.reduce((x, y) => x + y, 0) / a.length;
  const row = {label, waves: m(waves), wt: m(res.flatMap(r => r.waveTimes)), kinds: Object.assign({}, ...res.map(r => r.kinds))};
  wrows.push(row);
  console.log(`  ${label.padEnd(10)} waves ${waves.join(',').padEnd(16)} mean ${row.waves.toFixed(1)}  ${m(res.map(r => r.t / 60)).toFixed(1)} min  ${row.wt.toFixed(0)} s/wave  lost to ${res.map(r => r.S.why ? r.S.why.type + ' (' + WG.STAGES[r.S.why.stage].key + ')' : '-').join(', ')}`);
}
const WR = Object.fromEntries(wrows.map(r => [r.label, r]));
ok(WR['1 average'].waves >= 3 && WR['1 average'].waves <= 8, 'one average gunslinger gets a few stages down the trail');
ok(WR['4 average'].waves >= 4 && WR['4 average'].waves <= 12, 'four: further, not for ever');
ok(WR['2 good'].waves >= WR['2 average'].waves, 'skill matters');
ok(WR['2 good'].waves >= 6.5, 'good players get past the Balloon Baron');
ok(wrows.every(r => r.wt >= 30 && r.wt <= 110), 'stages take half a minute to two minutes');
ok(['rider', 'bandit', 'thrower', 'dynamite', 'vulture', 'bat', 'cart', 'swinger', 'balloon', 'crate'].every(k => WR['2 good'].kinds[k]), 'every kind of trouble turns up');

console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
