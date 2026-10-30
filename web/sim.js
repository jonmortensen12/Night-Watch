/* Night Watch - the simulation.

   Pure and deterministic: no drawing, no network, no clock of its own. The
   host (a TV or a phone, see host.js) steps it at 60 Hz and sends a snapshot
   to every screen; simcheck.mjs runs it headless with computer gunners.

   The world. Everybody is at the origin, inside the station, the way a
   star map puts you at the centre of the sky: phones a metre apart on a
   floor are nothing next to enemies sixty units out, so all of them see
   the same ship in the same place. three.js axes: y is up (gravity, which
   every phone agrees on) and -z is "forward" - the TV, or whatever object
   the room agreed to point at when they locked on. Enemies come from the
   whole sphere, below the floor included.

   Units are arbitrary; the station's hull is a ball of radius HULL_R. */

export const PROTO = 1;
export const HULL_R = 3;
export const HULL_MAX = 100;
export const COLORS = ['#4dd0ff', '#ffb000', '#ff5ca8', '#7cff6b', '#b388ff', '#ff7043', '#ffffff', '#00e5c0'];

export const TYPES = {
  //        hp, radius (for hits), points, speed
  dart:    {hp: 2,  r: 2.2, pts: 100,  speed: 18},
  raider:  {hp: 4,  r: 2.6, pts: 150,  speed: 30},
  bomber:  {hp: 14, r: 4.2, pts: 300,  speed: 8},
  phantom: {hp: 3,  r: 2.4, pts: 250,  speed: 20},
  torpedo: {hp: 1,  r: 1.8, pts: 75,   speed: 9},
  crate:   {hp: 1,  r: 2.4, pts: 50,   speed: 5},
  turret:  {hp: 10, r: 3.2, pts: 200,  speed: 0},
  boss:    {hp: 40, r: 9,   pts: 2000, speed: 6},
};
export const TYPE_LIST = Object.keys(TYPES);

export const LASER = {cool: 0.14, rapidCool: 0.08, heat: 7, coolRate: 26, lockout: 100, unlockAt: 35, dmg: 1};
export const MISSILE = {max: 3, regen: 12, speed: 46, dmg: 7};
export const BREAK_TIME = 9;          // seconds between waves
export const COUNT_TIME = 4;          // the countdown before wave 1

/* ---------- small vector kit: arrays of three ---------- */
const len = a => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const vec = {len, sub, add, mul, dot, cross, norm};

/* mulberry32: the same seed plays the same game, which is what lets
   simcheck's numbers mean anything. */
function rng(S){
  let t = (S.seed = (S.seed + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (S, a, b) => a + (b - a) * rng(S);

/* A direction anywhere on the sphere, uniformly. */
function anyDir(S){
  const z = rr(S, -1, 1), a = rr(S, 0, Math.PI * 2), s = Math.sqrt(1 - z * z);
  return [s * Math.cos(a), z, s * Math.sin(a)];
}
/* A direction within `ang` radians of `d`. */
function near(S, d, ang){
  for(let i = 0; i < 40; i++){
    const c = anyDir(S);
    if(Math.acos(Math.max(-1, Math.min(1, dot(c, d)))) <= ang) return c;
  }
  return d.slice();
}
/* Turn direction d by angle `ang` about a random axis perpendicular to it. */
function swing(S, d, ang){
  let ax = norm(cross(d, anyDir(S)));
  const c = Math.cos(ang), s = Math.sin(ang);
  // Rodrigues, axis perpendicular to d
  return norm(add(mul(d, c), mul(cross(ax, d), s)));
}

/* ---------- the game ---------- */
export function create(seed){
  return {
    seed: (seed >>> 0) || 1, t: 0, phase: 'lobby', phaseT: 0,
    wave: 0, hull: HULL_MAX, players: {}, enemies: [], bolts: [], missiles: [],
    nextId: 1, ev: [], plan: null, rapid: 0, crateT: 20, boss: null,
    stats: {kills: 0, waveReached: 0, score: 0, bossKills: 0},
  };
}

export function join(S, id, name){
  let p = S.players[id];
  if(!p){
    const used = Object.values(S.players).map(q => q.color);
    let color = 0;
    while(used.indexOf(color) >= 0 && color < COLORS.length - 1) color++;
    p = S.players[id] = {id, name: name || 'Gunner', color, aim: [0, 0, -1], tg: 0, firing: false,
      heat: 0, locked: false, cd: 0, missiles: MISSILE.max, mregen: 0, away: false,
      score: 0, kills: 0, shots: 0, hits: 0, torps: 0, boss: 0, seat: Object.keys(S.players).length};
  }
  p.name = name || p.name;
  p.away = false;
  return p;
}

export function leave(S, id){
  const p = S.players[id];
  if(!p) return;
  p.away = true; p.firing = false;
  // gone before the game started: no reason to keep a seat
  if(S.phase === 'lobby') delete S.players[id];
}

export function activePlayers(S){ return Object.values(S.players).filter(p => !p.away); }

/* What a phone says many times a second: where it points, what is under
   its crosshair on its own screen (tg, an enemy id or 0), and whether the
   trigger is held. */
export function input(S, id, aim, tg, firing){
  const p = S.players[id];
  if(!p) return;
  if(aim && aim.length === 3 && aim.every(Number.isFinite) && len(aim) > 0.1) p.aim = norm(aim);
  p.tg = tg | 0;
  p.firing = !!firing;
}

export function start(S){
  if(S.phase !== 'lobby' && S.phase !== 'over') return;
  const keep = S.players;
  const seed = S.seed;
  Object.assign(S, create(seed));
  S.players = keep;
  Object.values(S.players).forEach(p => {
    if(p.away){ delete S.players[p.id]; return; }
    Object.assign(p, {heat: 0, locked: false, cd: 0, missiles: MISSILE.max, mregen: 0,
      score: 0, kills: 0, shots: 0, hits: 0, torps: 0, boss: 0, firing: false});
  });
  S.phase = 'count'; S.phaseT = COUNT_TIME;
  S.ev.push(['count']);
}

export function toLobby(S){
  S.phase = 'lobby'; S.phaseT = 0;
  S.enemies = []; S.bolts = []; S.missiles = [];
  Object.values(S.players).forEach(p => { if(p.away) delete S.players[p.id]; });
}

function difficulty(S){
  const n = Math.max(1, activePlayers(S).length);
  return {
    wave: S.wave,
    crowd: 0.7 + 0.3 * Math.min(n, 6),                 // 1 player 1.0, 4 players 1.9
    fire: 1 + 0.07 * (S.wave - 1),                     // enemies shoot more often
    dmg: 2 + 0.15 * (S.wave - 1),                      // and harder
    speed: Math.min(1.5, 1 + 0.035 * (S.wave - 1)),
  };
}

/* ---------- the waves ----------
   A wave is a budget spent on groups that arrive every few seconds, each
   from a direction of its own - the point is that nobody knows where the
   next one is. Wave 1 starts in front so the first one is easy to find.
   Every fifth wave is a dreadnought. */
export function isBossWave(w){ return w > 0 && w % 5 === 0; }

function planWave(S){
  const d = difficulty(S), w = S.wave;
  let budget = Math.round((5 + 3 * w) * d.crowd);
  const menu = [['dart', 1]];
  if(w >= 2) menu.push(['raider', 2]);
  if(w >= 3) menu.push(['bomber', 4]);
  if(w >= 4) menu.push(['phantom', 3]);
  const groups = [];
  if(isBossWave(w)) budget = Math.round(budget * 0.5);
  while(budget > 0){
    const size = Math.min(budget, 1 + Math.floor(rng(S) * Math.min(3, 1 + w / 2)));
    const g = [];
    let spent = 0;
    for(let i = 0; i < size && spent < budget; i++){
      const opts = menu.filter(m => m[1] <= budget - spent);
      if(!opts.length) break;
      // later waves lean on the heavier things
      const pick = opts[Math.min(opts.length - 1, Math.floor(Math.pow(rng(S), 1.4 - Math.min(0.9, w * 0.08)) * opts.length))];
      g.push(pick[0]); spent += pick[1];
    }
    if(!g.length) break;
    budget -= spent;
    groups.push(g);
  }
  S.plan = {groups, gap: Math.max(2.2, 5.5 - w * 0.25), next: 1.5, sent: 0, boss: isBossWave(w)};
  S.plan.maxAlive = Math.round((5 + w) * d.crowd);
}

function startWave(S){
  S.wave++;
  S.phase = 'wave'; S.phaseT = 0;
  S.stats.waveReached = S.wave;
  planWave(S);
  S.ev.push(['wave', S.wave, S.plan.boss ? 1 : 0]);
  if(S.plan.boss) spawnBoss(S);
}

function spawnDir(S){
  // wave 1, first two groups: in front, near the horizon
  if(S.wave === 1 && S.plan.sent < 2) return norm([rr(S, -0.5, 0.5), rr(S, -0.15, 0.3), -1]);
  // wave 2: anywhere around, but not yet below the floor
  if(S.wave === 2) { const d = anyDir(S); d[1] = Math.abs(d[1]) * 0.8; return norm(d); }
  return anyDir(S);
}

function newEnemy(S, type, p, extra){
  const T = TYPES[type];
  const sc = type === 'turret' || type === 'boss' ? 1 + 0.2 * Math.floor(S.wave / 5 - 1) : 1;
  const hp = Math.round(T.hp * sc);
  const e = Object.assign({id: S.nextId++, type, p: p.slice(), v: [0, 0, 0], hp, hpMax: hp,
    st: 'in', t: 0, wp: null, fireT: rr(S, 1.5, 3.5), vis: 1, seenT: 0, burst: 0, life: 0}, extra || {});
  S.enemies.push(e);
  return e;
}

/* For the checks and the art tool: put something exactly here. */
export function place(S, type, p, extra){
  const e = newEnemy(S, type, p, extra);
  if(type === 'boss'){
    e.shielded = true; e.orbit = 1; e.launchT = 99; e.torpT = 99; e.st = 'orbit';
    const offs = [[-14, 3, 2], [14, 3, 2], [-8, -5, 4], [8, -5, 4]];
    e.turrets = offs.map(o => newEnemy(S, 'turret', e.p, {parent: e.id, off: o, fireT: 99}).id);
    S.boss = e.id;
  }
  return e;
}

function spawnGroup(S, g){
  const dir = spawnDir(S);
  g.forEach((type, i) => {
    const d = i ? near(S, dir, 0.18) : dir;
    const e = newEnemy(S, type, mul(d, rr(S, 140, 160)));
    e.home = dir;
    e.v = mul(d, -TYPES[type].speed * 0.8);
    if(type === 'phantom') e.vis = 0.06;
  });
}

function spawnBoss(S){
  const dir = S.wave === 5 ? norm([0.3, 0.25, -1]) : anyDir(S);
  const b = newEnemy(S, 'boss', mul(dir, 200), {shielded: true, orbit: rr(S, 0, 1) < 0.5 ? 1 : -1, launchT: 8, torpT: 6});
  b.home = dir;
  const offs = [[-14, 3, 2], [14, 3, 2], [-8, -5, 4], [8, -5, 4]];
  b.turrets = offs.map(o => newEnemy(S, 'turret', b.p, {parent: b.id, off: o, fireT: rr(S, 2, 4)}).id);
  S.boss = b.id;
  S.ev.push(['boss']);
}

/* The boss's own axes: forward at the station, up as close to world up as it can be. */
function bossBasis(p){
  const f = norm(mul(p, -1));
  let up = [0, 1, 0];
  if(Math.abs(dot(f, up)) > 0.95) up = [1, 0, 0];
  const r = norm(cross(f, up));
  up = cross(r, f);
  return {f, r, up};
}

/* ---------- moving things ---------- */
function steer(e, target, speed, turn, dt){
  const want = mul(norm(sub(target, e.p)), speed);
  const k = Math.min(1, turn * dt);
  e.v = add(e.v, mul(sub(want, e.v), k));
}

function newWaypoint(S, e, rMin, rMax, swingMin, swingMax){
  const from = norm(e.p);
  const d = swing(S, from, rr(S, swingMin, swingMax));
  e.wp = mul(d, rr(S, rMin, rMax));
}

function fireBolt(S, from, dmgScale){
  const d = difficulty(S);
  // aimed at the station, with a little scatter: most land
  const aim = add([0, 0, 0], [rr(S, -2.5, 2.5), rr(S, -2.5, 2.5), rr(S, -2.5, 2.5)]);
  const dir = norm(sub(aim, from));
  S.bolts.push({id: S.nextId++, p: from.slice(), v: mul(dir, 30), dmg: d.dmg * (dmgScale || 1), life: 8});
}

function launchTorpedo(S, from){
  const e = newEnemy(S, 'torpedo', from, {st: 'run'});
  e.v = mul(norm(mul(from, -1)), 6);
  S.ev.push(['torp', e.id]);
}

function enemyStep(S, e, dt, d){
  const T = TYPES[e.type];
  const sp = T.speed * d.speed;
  e.t += dt; e.life += dt;
  const dist = len(e.p);
  switch(e.type){
    case 'dart':
    case 'phantom': {
      if(!e.wp || len(sub(e.wp, e.p)) < 8) newWaypoint(S, e, 45, 85, 0.4, 1.1);
      steer(e, e.wp, sp, 1.8, dt);
      e.fireT -= dt * d.fire;
      if(e.type === 'phantom'){
        // cloaked, except while charging a shot, just after one, and when hit
        const want = (e.fireT < 1.3 || e.seenT > 0) ? 1 : 0.06;
        e.vis += (want - e.vis) * Math.min(1, dt * 4);
        e.seenT = Math.max(0, e.seenT - dt);
      }
      if(e.fireT <= 0){
        if(dist < 110) fireBolt(S, e.p);
        e.fireT = rr(S, 2.6, 4.2);
        if(e.type === 'phantom'){ e.seenT = 1.0; e.fireT = rr(S, 3.5, 5.5); }
      }
      break;
    }
    case 'raider': {
      // approach, strafing run past the station, break away, again
      if(e.st === 'in'){
        if(!e.wp) e.wp = mul(norm(e.p), 60);
        steer(e, e.wp, sp, 1.6, dt);
        if(len(sub(e.wp, e.p)) < 10){
          e.st = 'run';
          const side = norm(cross(norm(e.p), anyDir(S)));
          e.wp = mul(side, 14);
          e.burst = 3; e.fireT = 0.4;
        }
      } else if(e.st === 'run'){
        steer(e, e.wp, sp * 1.15, 2.4, dt);
        e.fireT -= dt;
        if(e.burst > 0 && e.fireT <= 0 && dist < 65){ fireBolt(S, e.p, 0.8); e.burst--; e.fireT = 0.18; }
        if(len(sub(e.wp, e.p)) < 6 || dist < 15){
          e.st = 'out';
          e.wp = mul(swing(S, norm(e.p), rr(S, 0.3, 0.8)), 95);
        }
      } else {
        steer(e, e.wp, sp, 1.4, dt);
        if(len(sub(e.wp, e.p)) < 12){ e.st = 'in'; e.wp = mul(swing(S, norm(e.p), rr(S, 0.9, 1.9)), 60); }
      }
      break;
    }
    case 'bomber': {
      // stand off, circle slowly, launch torpedoes
      if(!e.wp || len(sub(e.wp, e.p)) < 6) newWaypoint(S, e, 75, 90, 0.25, 0.5);
      steer(e, e.wp, sp, 0.9, dt);
      e.fireT -= dt * d.fire;
      if(e.fireT <= 0 && dist < 110){
        launchTorpedo(S, add(e.p, mul(norm(e.p), -4)));
        e.fireT = rr(S, 6.5, 9);
      }
      break;
    }
    case 'torpedo': {
      // straight in, speeding up: somebody has to find it and shoot it
      const sp2 = Math.min(15, 6 + e.life * 1.2) * d.speed;
      steer(e, [0, 0, 0], sp2, 3, dt);
      break;
    }
    case 'crate': {
      // drifts across the sky, then leaves
      if(!e.wp) e.wp = mul(swing(S, norm(e.p), rr(S, 0.8, 1.2)), len(e.p));
      steer(e, e.wp, sp, 0.6, dt);
      if(e.life > 16){ e.dead = true; e.gone = true; }
      break;
    }
    case 'boss': {
      if(e.st === 'in'){
        steer(e, mul(norm(e.p), 115), 22, 1, dt);
        if(dist < 120){ e.st = 'orbit'; }
      } else {
        // slow orbit about the station, holding its distance
        const r = norm(e.p);
        let ax = [0, 1, 0];
        if(Math.abs(r[1]) > 0.9) ax = [1, 0, 0];
        const tan = norm(cross(ax, r));
        e.v = add(mul(tan, sp * e.orbit), mul(r, (115 - dist) * 0.5));
      }
      e.launchT -= dt; e.torpT -= dt;
      if(e.st === 'orbit' && e.launchT <= 0){
        for(let i = 0; i < 2; i++){
          const m = newEnemy(S, 'dart', add(e.p, mul(anyDir(S), 6)));
          m.v = mul(norm(e.p), -10);
        }
        e.launchT = rr(S, 11, 14);
      }
      if(e.st === 'orbit' && e.torpT <= 0){
        launchTorpedo(S, add(e.p, mul(norm(e.p), -10)));
        e.torpT = rr(S, 6, 8) / d.fire;
      }
      break;
    }
    case 'turret': {
      const b = S.enemies.find(x => x.id === e.parent);
      if(!b || b.dead){ e.dead = true; e.gone = true; break; }
      const B = bossBasis(b.p);
      const o = e.off;
      const np = add(b.p, add(add(mul(B.r, o[0]), mul(B.up, o[1])), mul(B.f, o[2])));
      e.v = mul(sub(np, e.p), 1 / Math.max(dt, 1e-6));
      e.p = np;
      e.fireT -= dt * d.fire;
      if(b.st === 'orbit' && e.fireT <= 0){ fireBolt(S, e.p, 1.2); e.fireT = rr(S, 2.2, 3.4); }
      return;                                           // already placed
    }
  }
  // keep the slower things from parking inside the station
  if(e.type !== 'torpedo' && e.type !== 'raider' && dist < 14) e.v = add(e.v, mul(norm(e.p), 20 * dt));
  e.p = add(e.p, mul(e.v, dt));
  // a torpedo that arrives
  if(e.type === 'torpedo' && len(e.p) < HULL_R + 0.5){
    e.dead = true; e.gone = true;
    hurtHull(S, 12 + d.wave * 0.6, norm(e.p));
    S.ev.push(['boom', e.id, 'torpedo', r1(e.p[0]), r1(e.p[1]), r1(e.p[2]), 0]);
  }
}

function hurtHull(S, dmg, from){
  S.hull = Math.max(0, S.hull - dmg);
  S.ev.push(['hull', Math.round(dmg * 10) / 10, r2(from[0]), r2(from[1]), r2(from[2])]);
}

/* ---------- the guns ---------- */
function angleTo(dir, p){
  return Math.acos(Math.max(-1, Math.min(1, dot(dir, norm(p)))));
}

/* What a shot along `dir` hits: the phone's own pick if it is plausible
   (the phone sees the world a little in the past, so allow for it), else
   the nearest thing on the ray. */
export function resolveShot(S, dir, tg){
  if(tg){
    const e = S.enemies.find(x => x.id === tg && !x.dead);
    if(e && !(e.type === 'boss' && e.shielded) && angleTo(dir, e.p) < 0.26) return e;
  }
  let best = null, bestT = Infinity;
  for(const e of S.enemies){
    if(e.dead) continue;
    const t = dot(e.p, dir);
    if(t <= 0) continue;
    const miss = len(sub(e.p, mul(dir, t)));
    // a little help at range, as the phones give
    const r = TYPES[e.type].r + t * 0.035;
    if(miss < r && t < bestT){ best = e; bestT = t; }
  }
  if(best && best.type === 'boss' && best.shielded) return null;
  return best;
}

function damage(S, e, dmg, p){
  if(e.dead) return;
  if(e.type === 'boss' && e.shielded) return;
  e.hp -= dmg;
  e.seenT = 1.5;
  if(p){ p.score += 10; }
  S.ev.push(['hit', e.id, p ? p.color : -1]);
  if(e.hp <= 0) kill(S, e, p);
}

function kill(S, e, p){
  e.dead = true;
  const T = TYPES[e.type];
  if(p){
    p.score += T.pts; p.kills++;
    if(e.type === 'torpedo') p.torps++;
    if(e.type === 'boss') p.boss++;
  }
  S.stats.kills++;
  S.ev.push(['boom', e.id, e.type, r1(e.p[0]), r1(e.p[1]), r1(e.p[2]), p ? p.color + 1 : 0]);
  if(e.type === 'crate') pickup(S, e, p);
  if(e.type === 'turret'){
    const b = S.enemies.find(x => x.id === e.parent);
    if(b && !b.dead && S.enemies.filter(x => x.type === 'turret' && x.parent === b.id && !x.dead).length === 0){
      b.shielded = false;
      S.ev.push(['shield', b.id]);
    }
  }
  if(e.type === 'boss'){
    S.stats.bossKills++;
    S.boss = null;
    S.enemies.forEach(x => { if(x.parent === e.id) x.dead = true; });
  }
}

function pickup(S, e, p){
  if(e.kind === 'repair') S.hull = Math.min(HULL_MAX, S.hull + 25);
  else if(e.kind === 'rapid') S.rapid = 10;
  else if(e.kind === 'missiles') Object.values(S.players).forEach(q => { q.missiles = MISSILE.max; q.mregen = 0; });
  S.ev.push(['pick', e.kind, p ? p.color : -1]);
}

function gunStep(S, p, dt){
  p.cd = Math.max(0, p.cd - dt);
  const rapid = S.rapid > 0;
  if(p.locked){
    p.heat = Math.max(0, p.heat - LASER.coolRate * dt);
    if(p.heat <= LASER.unlockAt) p.locked = false;
  } else if(!p.firing || rapid){
    p.heat = Math.max(0, p.heat - LASER.coolRate * dt);
  }
  if(p.mregen > 0 || p.missiles < MISSILE.max){
    p.mregen += dt;
    if(p.mregen >= MISSILE.regen){ p.mregen = 0; p.missiles = Math.min(MISSILE.max, p.missiles + 1); }
    if(p.missiles >= MISSILE.max) p.mregen = 0;
  }
  if(!p.firing || p.locked || p.away || p.cd > 0) return;
  if(S.phase !== 'wave' && S.phase !== 'break') return;
  p.cd = rapid ? LASER.rapidCool : LASER.cool;
  if(!rapid){
    p.heat += LASER.heat;
    if(p.heat >= LASER.lockout){ p.heat = LASER.lockout; p.locked = true; S.ev.push(['hot', p.color]); }
  }
  p.shots++;
  const e = resolveShot(S, p.aim, p.tg);
  const range = e ? len(e.p) : 160;
  S.ev.push(['zap', p.color, r2(p.aim[0]), r2(p.aim[1]), r2(p.aim[2]), e ? e.id : 0, Math.round(range)]);
  if(e){ p.hits++; damage(S, e, LASER.dmg, p); }
}

export function missile(S, id, tg){
  const p = S.players[id];
  if(!p || p.away || p.missiles < 1) return false;
  if(S.phase !== 'wave' && S.phase !== 'break') return false;
  const e = S.enemies.find(x => x.id === tg && !x.dead);
  if(!e || (e.type === 'boss' && e.shielded)) return false;
  p.missiles--;
  const dir = norm(add(p.aim, mul(norm(e.p), 0.3)));
  const m = {id: S.nextId++, p: mul(dir, 2), v: mul(dir, 22), tg: e.id, owner: id, color: p.color, life: 6};
  S.missiles.push(m);
  S.ev.push(['msl', m.id, p.color]);
  return true;
}

function missileStep(S, m, dt){
  m.life -= dt;
  const e = S.enemies.find(x => x.id === m.tg && !x.dead);
  if(e){
    const want = mul(norm(sub(e.p, m.p)), MISSILE.speed);
    m.v = add(m.v, mul(sub(want, m.v), Math.min(1, 5 * dt)));
  }
  m.p = add(m.p, mul(m.v, dt));
  if(e && len(sub(e.p, m.p)) < TYPES[e.type].r + 1.5){
    m.dead = true;
    damage(S, e, MISSILE.dmg, S.players[m.owner]);
    S.ev.push(['mhit', m.id, r1(m.p[0]), r1(m.p[1]), r1(m.p[2])]);
  } else if(m.life <= 0 || len(m.p) > 250){
    m.dead = true;
  }
}

/* ---------- one tick ---------- */
export function step(S, dt){
  S.t += dt;
  if(S.phase === 'lobby') return;
  if(S.phase === 'over'){ S.phaseT += dt; return; }
  const d = difficulty(S);
  if(S.phase === 'count'){
    S.phaseT -= dt;
    if(S.phaseT <= 0) startWave(S);
  } else if(S.phase === 'break'){
    S.phaseT -= dt;
    if(S.phaseT <= 0) startWave(S);
  } else if(S.phase === 'wave'){
    S.phaseT += dt;
    const P = S.plan;
    const alive = S.enemies.filter(e => !e.dead && e.type !== 'crate').length;
    P.next -= dt;
    if(P.sent < P.groups.length && P.next <= 0 && alive < P.maxAlive){
      spawnGroup(S, P.groups[P.sent++]);
      P.next = P.gap * rr(S, 0.75, 1.25);
    }
    if(P.sent >= P.groups.length && alive === 0){
      S.phase = 'break'; S.phaseT = BREAK_TIME;
      S.hull = Math.min(HULL_MAX, S.hull + 10);
      S.bolts = [];
      S.ev.push(['clear', S.wave]);
    }
  }
  // supply drones drift by now and then
  if(S.phase === 'wave'){
    S.crateT -= dt;
    if(S.crateT <= 0){
      const kinds = S.hull < 60 ? ['repair', 'repair', 'rapid', 'missiles'] : ['repair', 'rapid', 'missiles'];
      const c = newEnemy(S, 'crate', mul(spawnDir(S), rr(S, 40, 60)), {kind: kinds[Math.floor(rng(S) * kinds.length)]});
      c.v = [0, 0, 0];
      S.ev.push(['crate', c.id]);
      S.crateT = rr(S, 22, 34);
    }
  }
  S.rapid = Math.max(0, S.rapid - dt);

  for(const e of S.enemies) if(!e.dead) enemyStep(S, e, dt, d);
  for(const b of S.bolts){
    b.p = add(b.p, mul(b.v, dt));
    b.life -= dt;
    if(len(b.p) < HULL_R){ b.dead = true; hurtHull(S, b.dmg, norm(sub(b.p, b.v))); }
    else if(b.life <= 0) b.dead = true;
  }
  for(const m of S.missiles) if(!m.dead) missileStep(S, m, dt);
  for(const p of Object.values(S.players)) gunStep(S, p, dt);

  S.enemies = S.enemies.filter(e => !e.dead);
  S.bolts = S.bolts.filter(b => !b.dead);
  S.missiles = S.missiles.filter(m => !m.dead);

  if(S.hull <= 0 && S.phase !== 'over'){
    S.phase = 'over'; S.phaseT = 0;
    S.stats.score = Object.values(S.players).reduce((a, p) => a + p.score, 0);
    S.ev.push(['over', S.wave]);
  }
}

/* ---------- what goes down the wire ----------
   Ten numbers or so per thing, rounded. Twenty times a second to every
   screen; events (shots, explosions, hull hits) ride along and are drained. */
const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;

export function snap(S){
  const en = [];
  for(const e of S.enemies){
    en.push(e.id, TYPE_LIST.indexOf(e.type), r1(e.p[0]), r1(e.p[1]), r1(e.p[2]),
      r1(e.v[0]), r1(e.v[1]), r1(e.v[2]),
      Math.max(0, Math.round(100 * e.hp / e.hpMax)),
      e.type === 'phantom' ? Math.round(e.vis * 100) : e.type === 'boss' ? (e.shielded ? 1 : 0) :
        e.type === 'crate' ? ['repair', 'rapid', 'missiles'].indexOf(e.kind) : 0);
  }
  const bo = [];
  for(const b of S.bolts) bo.push(b.id, r1(b.p[0]), r1(b.p[1]), r1(b.p[2]), r1(b.v[0]), r1(b.v[1]), r1(b.v[2]));
  const ms = [];
  for(const m of S.missiles) ms.push(m.id, r1(m.p[0]), r1(m.p[1]), r1(m.p[2]), m.color);
  const pl = Object.values(S.players).map(p => ({
    id: p.id, n: p.name, c: p.color, a: [r2(p.aim[0]), r2(p.aim[1]), r2(p.aim[2])],
    h: Math.round(p.heat), l: p.locked ? 1 : 0, m: p.missiles, s: p.score, k: p.kills,
    f: p.firing && !p.locked ? 1 : 0, w: p.away ? 1 : 0,
    sh: p.shots, hi: p.hits, tp: p.torps, bs: p.boss,
  }));
  const out = {t: 's', ph: S.phase, pt: r1(S.phaseT), w: S.wave, hull: Math.round(S.hull), rapid: r1(S.rapid),
    en, bo, ms, pl, ev: S.ev, boss: S.boss || 0};
  S.ev = [];
  return out;
}

/* ---------- the results ----------
   One line each, the way Mission Control's crew report does it. */
export function awards(players){
  const live = players.filter(p => p.sh > 0 || p.k > 0);
  const out = {};
  const best = (f, min) => {
    let b = null;
    for(const p of live){ const v = f(p); if(v >= (min || 1) && (!b || v > f(b))) b = p; }
    return b;
  };
  const top = best(p => p.k);
  if(top) out[top.id] = 'Top Gun';
  const sharp = best(p => (p.sh >= 25 ? p.hi / p.sh : 0), 0.01);
  if(sharp && !out[sharp.id]) out[sharp.id] = 'Sharpshooter';
  const torp = best(p => p.tp);
  if(torp && !out[torp.id]) out[torp.id] = 'Torpedo Catcher';
  const boss = best(p => p.bs);
  if(boss && !out[boss.id]) out[boss.id] = 'Giant Slayer';
  return out;
}
