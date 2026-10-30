/* Night Watch - the simulation, headless.

   node simcheck.mjs

   Computer gunners play whole games: each turns towards the most urgent
   thing it can see (torpedoes first, then whatever is closest) at a
   human-ish rate, takes a moment to react, and holds the trigger while it
   is on target. People will do better and worse than this; the bounds
   below are a starting point to retune after a family playtest. */
import * as NW from './web/sim.js';
import * as ZB from './web/zsim.js';

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
  const eye = [p.x, ZB.EYE, p.z];
  const urgency = m => {
    const c = ZB.centre(m), d = Math.hypot(c[0] - p.x, c[2] - p.z);
    let u = 40 - d;
    if(m.st === 'climb') u += 100;
    if(m.type === 'ghost') u += 60 - Math.hypot(m.x, m.z) * 2;
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
  let goal = [0, 0], repair = false;
  let worst = -1, wv = 45;
  S.secs.forEach((s, i) => {
    const sec = ZB.SECTIONS[i];
    const busy = S.mons.some(m => m.sec === i && (m.st === 'attack' || m.st === 'climb') && m.type !== 'ghost');
    if(!busy && s.hp < wv){ wv = s.hp; worst = i; }
  });
  if(worst >= 0){
    const sec = ZB.SECTIONS[worst];
    const spot = [sec.mid[0] - sec.n[0] * 0.8, sec.mid[1] - sec.n[1] * 0.8];
    const nearest = Object.values(S.players).filter(q => !q.away).sort((a, b) => Math.hypot(a.x - spot[0], a.z - spot[1]) - Math.hypot(b.x - spot[0], b.z - spot[1]))[0];
    if(nearest === p && !S.mons.some(m => m.st === 'climb')){ goal = spot; repair = Math.hypot(p.x - spot[0], p.z - spot[1]) < 0.6; }
  }
  const gx = goal[0] - p.x, gz = goal[1] - p.z, gl = Math.hypot(gx, gz);
  let x = p.x, z = p.z;
  if(gl > 0.1){ const k = Math.min(gl, ZB.MOVE_SPEED * DT); x += gx / gl * k; z += gz / gl * k; }
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
  ZB.input(S, p.id, {a: p.aim, x, z, w, tg, f: firing, r: repair, zm: w === 2});
}

function zplay(n, seed, skill, maxMin = 25){
  const S = ZB.create(seed);
  const mems = [];
  for(let i = 0; i < n; i++){
    ZB.join(S, 'p' + i, 'Bot ' + i);
    let s = seed * 31 + i;
    mems.push({rand: () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)});
  }
  ZB.start(S);
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

console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
