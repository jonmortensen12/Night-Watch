/* Night Watch - the simulation, headless.

   node simcheck.mjs

   Computer gunners play whole games: each turns towards the most urgent
   thing it can see (torpedoes first, then whatever is closest) at a
   human-ish rate, takes a moment to react, and holds the trigger while it
   is on target. People will do better and worse than this; the bounds
   below are a starting point to retune after a family playtest. */
import * as NW from './web/sim.js';

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

console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
