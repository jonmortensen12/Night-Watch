/* Night Watch: Bunker - the simulation of the zombie mode.

   Same shape as sim.js (create, join, input, step, snap) so the host runs
   either without caring which. Pure and deterministic; zsimcheck in
   simcheck.mjs plays it with computer defenders.

   The world. A small square bunker in a graveyard at night, its fence in
   eight sections, two to a side. Monsters come across the field from every
   direction, pick the section nearest to where they came from, and batter
   it down. Once a section is broken they climb through - and the first
   monster inside the bunker ends the game. Ghosts float straight through
   the fence, so they have to be shot before they get in. Players walk
   about inside (a stick on the phone), turn by turning their bodies, and
   can stand at a damaged section and hold REPAIR to rebuild it.

   Metres. y up, -z is FRONT (the TV), as in space mode. No blood: things
   that are shot go "poof". */

export const PROTO = 1;
export const HALF = 4.5;              // the fence is at x, z = +-HALF
export const ROOM = HALF - 0.45;      // how far a player can walk from the centre
export const EYE = 1.55;
export const SEC_MAX = 100;
export const COLORS = ['#4dd0ff', '#ffb000', '#ff5ca8', '#7cff6b', '#b388ff', '#ff7043', '#ffffff', '#00e5c0'];

/* Eight sections, going round clockwise seen from above, starting front left.
   a, b: ends; n: outward normal. */
export const SECTIONS = [
  {name: 'front left',  a: [-HALF, -HALF], b: [0, -HALF], n: [0, -1]},
  {name: 'front right', a: [0, -HALF], b: [HALF, -HALF], n: [0, -1]},
  {name: 'right front', a: [HALF, -HALF], b: [HALF, 0], n: [1, 0]},
  {name: 'right back',  a: [HALF, 0], b: [HALF, HALF], n: [1, 0]},
  {name: 'back right',  a: [HALF, HALF], b: [0, HALF], n: [0, 1]},
  {name: 'back left',   a: [0, HALF], b: [-HALF, HALF], n: [0, 1]},
  {name: 'left back',   a: [-HALF, HALF], b: [-HALF, 0], n: [-1, 0]},
  {name: 'left front',  a: [-HALF, 0], b: [-HALF, -HALF], n: [-1, 0]},
];
SECTIONS.forEach(s => { s.mid = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]; });

export const MONSTERS = {
  //          speed, hp, fence damage a second, radius, height, points, flying height
  pumpkin:  {speed: 1.1, hp: 4,  dps: 6,  r: 0.45, h: 1.9, pts: 100, fly: 0, name: 'pumpkinhead'},
  skeleton: {speed: 2.0, hp: 2,  dps: 4,  r: 0.4,  h: 1.8, pts: 100, fly: 0, name: 'skeleton'},
  ghost:    {speed: 0.75, hp: 3, dps: 0,  r: 0.5,  h: 1.7, pts: 200, fly: 0.5, name: 'ghost'},
  brute:    {speed: 0.65, hp: 18, dps: 18, r: 0.8, h: 2.6, pts: 400, fly: 0, name: 'brute'},
  bat:      {speed: 3.6, hp: 1,  dps: 2,  r: 0.35, h: 0.4, pts: 75,  fly: 2.6, name: 'bat'},
  witch:    {speed: 4.5, hp: 40, dps: 0,  r: 0.9,  h: 1.6, pts: 2000, fly: 7, name: 'witch'},
  bomb:     {speed: 0,   hp: 1,  dps: 0,  r: 0.5,  h: 0.6, pts: 50,  fly: 0, name: 'pumpkin bomb'},
};
export const MONSTER_LIST = Object.keys(MONSTERS);

/* No ammunition: each gun is held back by its rate of fire, its spread and
   its reach instead. */
export const WEAPONS = [
  {key: 'pistol',  name: 'Pistol',  cool: 0.28, dmg: 1,   pellets: 1, spread: 0.008, range: 60,  assist: 1.0, knock: 0,    pierce: 1},
  {key: 'shotgun', name: 'Shotgun', cool: 0.85, dmg: 1.0, pellets: 8, spread: 0.12,  range: 20,  assist: 1.3, knock: 0.35, pierce: 1},
  {key: 'sniper',  name: 'Sniper',  cool: 1.25, dmg: 7,   pellets: 1, spread: 0.035, range: 140, assist: 0.6, knock: 0.6,  pierce: 3},
];
export const REPAIR_RATE = 24;       // section health a second
export const REPAIR_REACH = 1.7;
export const MOVE_SPEED = 3.2;
export const BREAK_TIME = 10;
export const COUNT_TIME = 4;
export const CLIMB_TIME = 2.2;
const SPAWN_R = [30, 36];

/* ---------- small kit ---------- */
function rng(S){
  let t = (S.seed = (S.seed + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (S, a, b) => a + (b - a) * rng(S);
const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* Distance from point (x, z) to a section's line, and the nearest point on it. */
export function toSection(sec, x, z){
  const [ax, az] = sec.a, [bx, bz] = sec.b;
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
  const px = ax + dx * t, pz = az + dz * t;
  return {d: Math.hypot(x - px, z - pz), x: px, z: pz};
}
export function inside(x, z, margin){ const m = HALF - (margin || 0); return Math.abs(x) < m && Math.abs(z) < m; }

/* Where something is, in the words the room shares. */
export function sideWords(x, z){
  const a = Math.atan2(x, -z) * 180 / Math.PI, s = Math.abs(a);
  if(s < 30) return 'in front';
  if(s > 150) return 'behind';
  if(s < 60) return 'front ' + (a > 0 ? 'right' : 'left');
  if(s > 120) return 'back ' + (a > 0 ? 'right' : 'left');
  return a > 0 ? 'right' : 'left';
}

/* ---------- the game ---------- */
export function create(seed){
  return {
    mode: 'zombie', seed: (seed >>> 0) || 1, t: 0, phase: 'lobby', phaseT: 0, wave: 0,
    players: {}, mons: [], nextId: 1, ev: [], plan: null, boss: null,
    secs: SECTIONS.map(() => ({hp: SEC_MAX, broken: false, warned: false, hitT: 0})),
    stats: {kills: 0, waveReached: 0}, why: null,
  };
}

export function join(S, id, name){
  let p = S.players[id];
  if(!p){
    const used = Object.values(S.players).map(q => q.color);
    let color = 0;
    while(used.indexOf(color) >= 0 && color < COLORS.length - 1) color++;
    // spread out round the middle so nobody starts inside anybody else
    const a = color * Math.PI / 4;
    p = S.players[id] = {id, name: name || 'Defender', color, x: Math.sin(a) * 1.2, z: Math.cos(a) * 1.2,
      aim: [0, 0, -1], w: 0, firing: false, repairing: false, zoom: false, tg: 0, cd: 0, away: false,
      score: 0, kills: 0, shots: 0, hits: 0, repaired: 0, saves: 0, bosses: 0};
  }
  p.name = name || p.name;
  p.away = false;
  return p;
}

export function leave(S, id){
  const p = S.players[id];
  if(!p) return;
  p.away = true; p.firing = false; p.repairing = false;
  if(S.phase === 'lobby') delete S.players[id];
}

export function activePlayers(S){ return Object.values(S.players).filter(p => !p.away); }

/* What a phone says: where it points, where it is standing (the phone is
   trusted with its own position, so walking has no lag), which gun, and
   whether the trigger, REPAIR or the sniper's zoom are held. */
export function input(S, id, d){
  const p = S.players[id];
  if(!p || !d) return;
  const a = d.a;
  if(a && a.length === 3 && a.every(Number.isFinite) && Math.hypot(a[0], a[1], a[2]) > 0.1){
    const l = Math.hypot(a[0], a[1], a[2]);
    p.aim = [a[0] / l, a[1] / l, a[2] / l];
  }
  if(Number.isFinite(d.x) && Number.isFinite(d.z)){ p.x = clamp(d.x, -ROOM, ROOM); p.z = clamp(d.z, -ROOM, ROOM); }
  const w = d.w | 0;
  if(w >= 0 && w < WEAPONS.length && w !== p.w){ p.w = w; p.cd = Math.max(p.cd, 0.35); }
  p.tg = d.tg | 0;
  p.firing = !!d.f;
  p.repairing = !!d.r;
  p.zoom = !!d.zm && WEAPONS[p.w].key === 'sniper';
}

export function start(S){
  if(S.phase !== 'lobby' && S.phase !== 'over') return;
  const keep = S.players, seed = S.seed;
  Object.assign(S, create(seed));
  S.players = keep;
  Object.values(S.players).forEach(p => {
    if(p.away){ delete S.players[p.id]; return; }
    const a = p.color * Math.PI / 4;
    Object.assign(p, {x: Math.sin(a) * 1.2, z: Math.cos(a) * 1.2, cd: 0, firing: false, repairing: false,
      score: 0, kills: 0, shots: 0, hits: 0, repaired: 0, saves: 0, bosses: 0});
  });
  S.phase = 'count'; S.phaseT = COUNT_TIME;
  S.ev.push(['count']);
}

export function toLobby(S){
  S.phase = 'lobby'; S.mons = [];
  Object.values(S.players).forEach(p => { if(p.away) delete S.players[p.id]; });
}

function difficulty(S){
  const n = Math.max(1, activePlayers(S).length);
  return {
    // more defenders, a lot more monsters: four people cover all four sides at once
    crowd: 0.55 + 0.45 * Math.min(n, 6),
    speed: Math.min(1.45, 1 + 0.035 * (S.wave - 1)),
    dps: 1 + 0.06 * (S.wave - 1),
    hp: 1 + 0.05 * (S.wave - 1),
  };
}

/* ---------- waves ---------- */
export function isBossWave(w){ return w > 0 && w % 5 === 0; }

function planWave(S){
  const d = difficulty(S), w = S.wave;
  let budget = Math.round((5 + 2.6 * w) * d.crowd);
  if(isBossWave(w)) budget = Math.round(budget * 0.55);
  const menu = [['pumpkin', 1], ['skeleton', 1]];
  if(w >= 2) menu.push(['bats', 3]);
  if(w >= 3) menu.push(['ghost', 2]);
  if(w >= 4) menu.push(['brute', 4]);
  const groups = [];
  while(budget > 0){
    const size = 1 + Math.floor(rng(S) * Math.min(4, 1 + w / 2));
    const g = [];
    let spent = 0;
    for(let i = 0; i < size; i++){
      const opts = menu.filter(m => m[1] <= budget - spent);
      if(!opts.length) break;
      const pick = opts[Math.min(opts.length - 1, Math.floor(Math.pow(rng(S), 1.4 - Math.min(0.9, w * 0.08)) * opts.length))];
      g.push(pick[0]); spent += pick[1];
    }
    if(!g.length) break;
    budget -= spent;
    groups.push(g);
  }
  S.plan = {groups, gap: Math.max(2.5, 6 - w * 0.25), next: 2, sent: 0, maxAlive: Math.round((6 + w * 1.3) * d.crowd)};
}

function startWave(S){
  S.wave++;
  S.phase = 'wave'; S.phaseT = 0;
  S.stats.waveReached = S.wave;
  planWave(S);
  S.ev.push(['wave', S.wave, isBossWave(S.wave) ? 1 : 0]);
  if(isBossWave(S.wave)) spawnWitch(S);
}

function spawnAngle(S){
  // wave 1's first groups come from in front, to be found easily
  if(S.wave === 1 && S.plan.sent < 2) return rr(S, -0.5, 0.5);
  return rr(S, -Math.PI, Math.PI);
}

function nearestSection(x, z){
  let best = 0, bd = Infinity;
  SECTIONS.forEach((s, i) => { const d = Math.hypot(x - s.mid[0], z - s.mid[1]); if(d < bd){ bd = d; best = i; } });
  return best;
}

export function newMonster(S, type, x, z, extra){
  const T = MONSTERS[type], d = difficulty(S);
  const hp = Math.max(1, Math.round(T.hp * (type === 'witch' ? 1 + 0.25 * Math.floor(S.wave / 5 - 1) : d.hp)));
  const m = Object.assign({id: S.nextId++, type, x, z, y: T.fly, vx: 0, vz: 0, hp, hpMax: hp,
    st: 'walk', sec: nearestSection(x, z), t: 0, climbT: 0, face: Math.atan2(-x, -z), knock: 0,
    off: rr(S, -1, 1), wob: rr(S, 0, 6.28)}, extra || {});
  S.mons.push(m);
  return m;
}

function spawnGroup(S, g){
  const a = spawnAngle(S);
  g.forEach((type, i) => {
    const aa = a + (i ? rr(S, -0.25, 0.25) : 0), r = rr(S, SPAWN_R[0], SPAWN_R[1]);
    const x = Math.sin(aa) * r, z = -Math.cos(aa) * r;
    if(type === 'bats'){
      for(let k = 0; k < 5; k++) newMonster(S, 'bat', x + rr(S, -2, 2), z + rr(S, -2, 2), {y: rr(S, 2, 3.4)});
    } else newMonster(S, type, x, z);
  });
}

function spawnWitch(S){
  const a = rr(S, -Math.PI, Math.PI);
  const w = newMonster(S, 'witch', Math.sin(a) * 40, -Math.cos(a) * 40, {ang: a, dir: rng(S) < 0.5 ? 1 : -1, bombT: 6, summonT: 10, st: 'in'});
  S.boss = w.id;
  S.ev.push(['witch']);
}

/* ---------- monsters ---------- */
function damageSection(S, i, dmg){
  const s = S.secs[i];
  if(s.broken) return;
  s.hp -= dmg;
  s.hitT = 0.3;
  if(s.hp < 30 && !s.warned){ s.warned = true; S.ev.push(['weak', i]); }
  if(s.hp <= 0){ s.hp = 0; s.broken = true; S.ev.push(['broken', i]); }
}

function monsterStep(S, m, dt, d){
  const T = MONSTERS[m.type];
  m.t += dt;
  const sp = T.speed * d.speed;
  if(m.knock > 0){
    // knocked back by a shot: pushed outwards, briefly
    const l = Math.hypot(m.x, m.z) || 1;
    const k = Math.min(m.knock, dt * 6);
    m.x += m.x / l * k; m.z += m.z / l * k; m.knock -= k;
    if(m.st === 'attack') m.st = 'walk';
    return;
  }
  if(m.type === 'witch') return witchStep(S, m, dt);
  if(m.type === 'bomb'){
    m.t2 = (m.t2 || 0) + dt;
    const k = Math.min(1, m.t2 / m.fall);
    m.x = m.x0 + (m.tx - m.x0) * k; m.z = m.z0 + (m.tz - m.z0) * k;
    m.y = m.y0 * (1 - k) + Math.sin(k * Math.PI) * 2;
    if(k >= 1){
      m.dead = true; m.gone = true;
      damageSection(S, m.sec, 25);
      damageSection(S, (m.sec + 1) % 8, 8);
      damageSection(S, (m.sec + 7) % 8, 8);
      S.ev.push(['blast', r1(m.tx), r1(m.tz), m.sec]);
    }
    return;
  }
  if(m.type === 'ghost'){
    // straight in, through the fence
    const l = Math.hypot(m.x, m.z) || 1;
    m.vx = -m.x / l * sp; m.vz = -m.z / l * sp;
    m.x += m.vx * dt; m.z += m.vz * dt;
    m.face = Math.atan2(m.vx, m.vz);
    m.y = T.fly + Math.sin(m.t * 2 + m.wob) * 0.25;
    if(inside(m.x, m.z, 0.3)) getsIn(S, m);
    return;
  }
  const sec = SECTIONS[m.sec], ss = S.secs[m.sec];
  // where it is heading: a spot just outside its section (spread along it)
  const along = 0.5 + m.off * 0.32;
  const tx = sec.a[0] + (sec.b[0] - sec.a[0]) * along + sec.n[0] * (T.r + 0.35);
  const tz = sec.a[1] + (sec.b[1] - sec.a[1]) * along + sec.n[1] * (T.r + 0.35);
  if(m.st === 'walk'){
    let dx = tx - m.x, dz = tz - m.z;
    const dist = Math.hypot(dx, dz);
    if(m.type === 'bat'){
      // flits: a weave on the way in
      dx += Math.cos(m.t * 3 + m.wob) * dist * 0.25;
      dz += Math.sin(m.t * 3 + m.wob) * dist * 0.25;
      m.y = T.fly + Math.sin(m.t * 4 + m.wob) * 0.6;
    }
    const l = Math.hypot(dx, dz) || 1;
    const want = Math.min(sp, dist * 2);
    m.vx += (dx / l * want - m.vx) * Math.min(1, dt * 4);
    m.vz += (dz / l * want - m.vz) * Math.min(1, dt * 4);
    m.x += m.vx * dt; m.z += m.vz * dt;
    if(Math.hypot(m.vx, m.vz) > 0.1) m.face = Math.atan2(m.vx, m.vz);
    if(dist < 0.25){ m.st = ss.broken ? 'climb' : 'attack'; m.climbT = 0; }
  } else if(m.st === 'attack'){
    m.face = Math.atan2(-sec.n[0], -sec.n[1]);
    m.vx = m.vz = 0;
    if(m.type === 'bat') m.y = 1.2 + Math.sin(m.t * 8 + m.wob) * 0.3;
    if(ss.broken){ m.st = 'climb'; m.climbT = 0; S.ev.push(['climb', m.id, m.sec]); }
    else damageSection(S, m.sec, T.dps * d.dps * dt);
  } else if(m.st === 'climb'){
    if(!ss.broken){ m.st = 'attack'; return; }       // somebody fixed it under them
    m.climbT += dt;
    const need = m.type === 'brute' ? CLIMB_TIME * 1.4 : m.type === 'bat' ? 0.8 : CLIMB_TIME;
    // edge towards and over the gap
    const k = m.climbT / need;
    m.x = tx - sec.n[0] * (T.r + 0.35) * 2 * k;
    m.z = tz - sec.n[1] * (T.r + 0.35) * 2 * k;
    if(k >= 1) getsIn(S, m);
  }
}

function getsIn(S, m){
  if(S.phase === 'over') return;
  S.phase = 'over'; S.phaseT = 0;
  S.why = {type: m.type, sec: m.type === 'ghost' ? nearestSection(m.x, m.z) : m.sec};
  S.ev.push(['over', S.wave, m.type, S.why.sec, m.id]);
}

function witchStep(S, m, dt){
  // sweeps in, then circles the bunker, dropping pumpkin bombs and raising skeletons
  const R = 15 + Math.sin(m.t * 0.4) * 3;
  if(m.st === 'in'){
    const l = Math.hypot(m.x, m.z);
    m.x -= m.x / l * 8 * dt; m.z -= m.z / l * 8 * dt;
    if(l < R + 1){ m.st = 'circle'; m.ang = Math.atan2(m.x, -m.z); }
  } else {
    m.ang += m.dir * MONSTERS.witch.speed / R * dt;
    const nx = Math.sin(m.ang) * R, nz = -Math.cos(m.ang) * R;
    m.vx = (nx - m.x) / dt; m.vz = (nz - m.z) / dt;
    m.x = nx; m.z = nz;
  }
  m.y = MONSTERS.witch.fly + Math.sin(m.t * 1.3) * 1.2;
  m.face = Math.atan2(m.vx || -m.x, m.vz || -m.z);
  if(m.st !== 'circle') return;
  m.bombT -= dt; m.summonT -= dt;
  if(m.bombT <= 0){
    // the weakest section near her gets it
    let best = 0, bv = Infinity;
    SECTIONS.forEach((s, i) => {
      const v = Math.hypot(m.x - s.mid[0], m.z - s.mid[1]) + (S.secs[i].broken ? 99 : S.secs[i].hp * 0.05);
      if(v < bv){ bv = v; best = i; }
    });
    const s = SECTIONS[best];
    newMonster(S, 'bomb', m.x, m.z, {y: m.y, y0: m.y, x0: m.x, z0: m.z, tx: s.mid[0] + s.n[0] * 0.4, tz: s.mid[1] + s.n[1] * 0.4,
      fall: 2.4, sec: best, st: 'fall'});
    S.ev.push(['bomb', best]);
    m.bombT = rr(S, 3.5, 5.5);
  }
  if(m.summonT <= 0){
    for(let i = 0; i < 3; i++){
      const a = m.ang + rr(S, -0.4, 0.4);
      newMonster(S, 'skeleton', Math.sin(a) * 24, -Math.cos(a) * 24);
    }
    S.ev.push(['summon', r1(m.x), r1(m.z)]);
    m.summonT = rr(S, 11, 15);
  }
}

/* Monsters keep a little apart, so a crowd at one section spreads along it. */
function separate(S){
  const L = S.mons;
  for(let i = 0; i < L.length; i++){
    const a = L[i];
    if(a.type === 'witch' || a.type === 'bomb' || a.type === 'ghost' || a.st === 'climb') continue;
    for(let j = i + 1; j < L.length; j++){
      const b = L[j];
      if(b.type === 'witch' || b.type === 'bomb' || b.type === 'ghost' || b.st === 'climb') continue;
      if((a.type === 'bat') !== (b.type === 'bat')) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      const min = MONSTERS[a.type].r + MONSTERS[b.type].r;
      if(d > 0.001 && d < min){
        const k = (min - d) / d * 0.5;
        a.x -= dx * k; a.z -= dz * k; b.x += dx * k; b.z += dz * k;
      }
    }
  }
}

/* ---------- the guns ---------- */
/* Where a monster is centred for being hit: its body, not its feet. */
export function centre(m){ const T = MONSTERS[m.type]; return [m.x, m.y + (T.fly ? 0 : T.h * 0.55), m.z]; }

function rayHits(S, ox, oy, oz, dx, dy, dz, W, range){
  const out = [];
  for(const m of S.mons){
    if(m.dead) continue;
    const c = centre(m), T = MONSTERS[m.type];
    const vx = c[0] - ox, vy = c[1] - oy, vz = c[2] - oz;
    const t = vx * dx + vy * dy + vz * dz;
    if(t <= 0 || t > range) continue;
    const miss = Math.hypot(vx - dx * t, vy - dy * t, vz - dz * t);
    // a body is taller than it is wide: be generous up and down
    const r = (T.r + (T.fly ? 0.15 : 0.25)) * W.assist + t * 0.006;
    if(miss < r) out.push({m, t});
  }
  return out.sort((a, b) => a.t - b.t);
}

function spreadDir(S, a, spread){
  if(!spread) return a;
  // a random direction within the cone
  const r = spread * Math.sqrt(rng(S)), th = rng(S) * Math.PI * 2;
  let ux = -a[2], uz = a[0];
  const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  const vx = a[1] * uz, vy = a[2] * ux - a[0] * uz, vz = -a[1] * ux;
  const c = Math.cos(th) * r, s = Math.sin(th) * r;
  const d = [a[0] + ux * c + vx * s, a[1] + vy * s, a[2] + uz * c + vz * s];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

/* The phone's own pick, if it is plausible: the phone sees the world a
   moment in the past. */
function trusted(S, p, ox, oy, oz){
  if(!p.tg) return null;
  const m = S.mons.find(x => x.id === p.tg && !x.dead);
  if(!m) return null;
  const c = centre(m);
  const vx = c[0] - ox, vy = c[1] - oy, vz = c[2] - oz, l = Math.hypot(vx, vy, vz) || 1;
  const cos = (vx * p.aim[0] + vy * p.aim[1] + vz * p.aim[2]) / l;
  return cos > Math.cos(0.18) ? {m, t: l} : null;
}

function fire(S, p){
  const W = WEAPONS[p.w];
  p.cd = W.cool;
  p.shots++;
  const ox = p.x, oy = EYE - 0.1, oz = p.z;
  const hits = [];
  let landed = false;
  for(let k = 0; k < W.pellets; k++){
    const spread = W.key === 'sniper' && p.zoom ? 0 : W.spread;
    const dir = k === 0 && W.pellets === 1 && p.tg ? p.aim : spreadDir(S, p.aim, spread);
    let list = rayHits(S, ox, oy, oz, dir[0], dir[1], dir[2], W, W.range);
    if(k === 0){
      const t = trusted(S, p, ox, oy, oz);
      if(t && !list.find(h => h.m === t.m)) list.unshift(t);
    }
    list = list.slice(0, W.pierce);
    for(const h of list){
      let dmg = W.dmg;
      if(W.key === 'shotgun') dmg *= Math.max(0.15, 1 - h.t / W.range);
      hurt(S, h.m, dmg, p, W);
      hits.push(h.m.id);
      landed = true;
    }
    if(k === 0 || W.pellets > 1) S.ev.push(['shot', p.color, p.w, r2(ox), r2(oy), r2(oz), r2(dir[0]), r2(dir[1]), r2(dir[2]),
      list.length ? Math.round(list[list.length - 1].t * 10) / 10 : W.range, list.length ? list[0].m.id : 0]);
  }
  if(landed) p.hits++;
}

function hurt(S, m, dmg, p, W){
  if(m.dead) return;
  m.hp -= dmg;
  if(W.knock && m.type !== 'brute' && m.type !== 'witch' && m.type !== 'bomb') m.knock = Math.max(m.knock, W.knock);
  if(p) p.score += 5;
  S.ev.push(['hit', m.id, p ? p.color : -1]);
  if(m.hp <= 0) kill(S, m, p);
}

function kill(S, m, p){
  m.dead = true;
  const T = MONSTERS[m.type];
  if(p){
    p.score += T.pts; p.kills++;
    if(m.st === 'climb' || (m.type === 'ghost' && inside(m.x, m.z, -2))) { p.saves++; p.score += 100; }
    if(m.type === 'witch') p.bosses++;
  }
  S.stats.kills++;
  const c = centre(m);
  S.ev.push(['poof', m.id, m.type, r1(c[0]), r1(c[1]), r1(c[2]), p ? p.color + 1 : 0]);
  if(m.type === 'witch'){ S.boss = null; S.ev.push(['witchdown', p ? p.color : -1]); }
}

function playerStep(S, p, dt){
  p.cd = Math.max(0, p.cd - dt);
  if(p.away) return;
  if(p.repairing){
    // the section this player is standing at, if it needs it
    let best = -1, bd = REPAIR_REACH;
    SECTIONS.forEach((s, i) => { const d = toSection(s, p.x, p.z).d; if(d < bd && S.secs[i].hp < SEC_MAX){ bd = d; best = i; } });
    if(best >= 0 && S.phase !== 'over'){
      const s = S.secs[best], add = Math.min(REPAIR_RATE * dt, SEC_MAX - s.hp);
      s.hp += add; p.repaired += add; p.score += add * 0.5;
      if(s.broken && s.hp > 8){ s.broken = false; S.ev.push(['fixed', best, p.color]); }
      if(s.hp > 45) s.warned = false;
      p.fixing = best;
    } else p.fixing = -1;
    return;                               // hands full: no shooting while hammering
  }
  p.fixing = -1;
  if(!p.firing || p.cd > 0) return;
  if(S.phase !== 'wave' && S.phase !== 'break') return;
  fire(S, p);
}

/* ---------- one tick ---------- */
export function step(S, dt){
  S.t += dt;
  if(S.phase === 'lobby') return;
  if(S.phase === 'over'){ S.phaseT += dt; return; }
  const d = difficulty(S);
  if(S.phase === 'count' || S.phase === 'break'){
    S.phaseT -= dt;
    if(S.phaseT <= 0) startWave(S);
  } else if(S.phase === 'wave'){
    S.phaseT += dt;
    const P = S.plan;
    const alive = S.mons.filter(m => !m.dead && m.type !== 'bomb').length;
    P.next -= dt;
    if(P.sent < P.groups.length && P.next <= 0 && alive < P.maxAlive){
      spawnGroup(S, P.groups[P.sent++]);
      P.next = P.gap * rr(S, 0.75, 1.25);
    }
    if(P.sent >= P.groups.length && alive === 0 && !S.mons.some(m => !m.dead)){
      S.phase = 'break'; S.phaseT = BREAK_TIME;
      S.secs.forEach(s => { s.hp = Math.min(SEC_MAX, s.hp + 20); if(s.broken && s.hp > 8) s.broken = false; if(s.hp > 45) s.warned = false; });
      S.ev.push(['clear', S.wave]);
    }
  }
  for(const m of S.mons) if(!m.dead) monsterStep(S, m, dt, d);
  separate(S);
  for(const p of Object.values(S.players)) playerStep(S, p, dt);
  for(const s of S.secs) s.hitT = Math.max(0, s.hitT - dt);
  S.mons = S.mons.filter(m => !m.dead);
}

/* ---------- the wire ---------- */
const ST = ['walk', 'attack', 'climb', 'in', 'circle', 'fall'];
export function snap(S){
  const m = [];
  for(const x of S.mons){
    m.push(x.id, MONSTER_LIST.indexOf(x.type), r2(x.x), r2(x.y), r2(x.z), Math.round(x.face * 100),
      Math.max(0, Math.round(100 * x.hp / x.hpMax)), Math.max(0, ST.indexOf(x.st)), x.sec | 0,
      r1(x.vx), r1(x.vz));
  }
  const pl = Object.values(S.players).map(p => ({
    id: p.id, n: p.name, c: p.color, x: r2(p.x), z: r2(p.z), a: [r2(p.aim[0]), r2(p.aim[1]), r2(p.aim[2])],
    w: p.w, f: p.firing ? 1 : 0, r: p.repairing ? 1 : 0, fx: p.fixing >= 0 ? p.fixing : -1, zm: p.zoom ? 1 : 0, aw: p.away ? 1 : 0,
    s: Math.round(p.score), k: p.kills, sh: p.shots, hi: p.hits, rp: Math.round(p.repaired), sv: p.saves, bs: p.bosses,
  }));
  const out = {t: 's', mode: 'zombie', ph: S.phase, pt: r1(S.phaseT), w: S.wave,
    sec: S.secs.map(s => s.broken ? -1 : Math.round(s.hp)), hit: S.secs.map(s => s.hitT > 0 ? 1 : 0),
    m, pl, ev: S.ev, boss: S.boss || 0, why: S.why};
  S.ev = [];
  return out;
}

export function awards(players){
  const live = players.filter(p => p.sh > 0 || p.k > 0 || p.rp > 0);
  const out = {};
  const best = (f, min) => {
    let b = null;
    for(const p of live){ const v = f(p); if(v >= (min || 1) && (!b || v > f(b))) b = p; }
    return b;
  };
  const pick = (p, name) => { if(p && !out[p.id]) out[p.id] = name; };
  pick(best(p => p.k), 'Monster Hunter');
  pick(best(p => p.rp, 40), 'Carpenter');
  pick(best(p => p.sv), 'Last-Second Save');
  pick(best(p => p.bs), 'Witch Hunter');
  pick(best(p => (p.sh >= 20 ? p.hi / p.sh : 0), 0.01), 'Sharpshooter');
  return out;
}
