/* Night Watch: Wagon - the simulation of the cowboy game.

   Same shape as sim.js and zsim.js (create, join, input, step, snap) so the
   host runs it without caring which game it is. Pure and deterministic;
   simcheck plays it with computer gunslingers.

   The idea. The players sit on the floor facing the TV, in rows - and
   that patch of floor is the bed of a freight wagon rolling through the
   West. Each phone says which seat it is in (a grid three across and
   four deep, 1 front left as you face the TV), so everybody's view starts
   from their own place on the wagon and the room shares one world: a rider coming up on the left really is
   nearer the left end of the line. The wagon is attacked from every side
   and from above, and if its health runs out the gang gets the gold.

   The trail is a run of stages - Dusty Flats, Red Rock Canyon, Vulture
   Gulch, the Old Mine, Hangman's Gorge, Outlaw's Pass - one a wave, each
   with its own scenery and its own kind of trouble. After the Pass the
   trail starts again at dusk, harder.

   Everybody has a revolver: six shots, then a reload (flick the phone, or
   it reloads itself once empty).

   The wagon stands still; the world moves past it. Metres, y up, -z is
   FRONT (the TV, and the way the wagon is going), as in the other games.
   No blood: bandits that are shot lose their hats and go "poof". */

export const PROTO = 1;
export const SPEED = 9;               // the trail goes by at this, m/s
export const BED = 1.0;               // the wagon bed's height
export const EYE = BED + 1.2;         // sitting on its bench
export const WAGON = {hw: 1.3, front: -2.4, back: 3.4};   // the gold and the cargo ride at the back, behind the seats
export const HP_MAX = 100;
export const COLORS = ['#4dd0ff', '#ffb000', '#ff5ca8', '#7cff6b', '#b388ff', '#ff7043', '#ffffff', '#00e5c0'];
/* The seats: a grid on the wagon bed, three across and four deep - seat 1
   is front left as the room faces the TV, 3 front right, 4 the second row's
   left, ... 12 back right. */
export const COLS = 3, ROWS = 4, MAX_SEATS = COLS * ROWS;
const COL_X = 0.8, ROW_Z = [-1.75, -0.65, 0.45, 1.55];

export const GUN = {rounds: 6, cool: 0.2, dmg: 1, range: 90, spread: 0.012, assist: 1.1, reload: 1.3, autoReload: 1.6};

export const STAGES = [
  {key: 'flats',  name: 'Dusty Flats',     blurb: 'Riders on the open plain',            walls: 0,   rim: 0,  menu: [['rider', 2], ['bandit', 1], ['tumble', 0.5]]},
  {key: 'canyon', name: 'Red Rock Canyon', blurb: 'Bandits behind every rock',          walls: 13,  rim: 15, menu: [['bandit', 1], ['rimbandit', 1.5], ['thrower', 2], ['rider', 2]]},
  {key: 'gulch',  name: 'Vulture Gulch',   blurb: 'Something circling overhead',        walls: 10,  rim: 12, menu: [['vultures', 3], ['rimbandit', 1.5], ['thrower', 2]]},
  {key: 'mine',   name: 'The Old Mine',    blurb: 'Dark tunnels, bats and mine carts',  walls: 4.6, rim: 0,  tunnel: 6.5, menu: [['bats', 3], ['cart', 2]]},
  {key: 'gorge',  name: "Hangman's Gorge", blurb: 'A long bridge, and bandits swinging in on ropes', walls: 0,  rim: 0,  bridge: true, menu: [['swinger', 2], ['vultures', 3], ['cliffthrower', 2]]},
  {key: 'pass',   name: "Outlaw's Pass",   blurb: 'The Balloon Baron himself',          walls: 16,  rim: 18, boss: true, menu: [['rider', 2], ['rimbandit', 1.5], ['thrower', 2]]},
];

export const ENEMIES = {
  //          hp, hit radius, height (centre above y), points, what it is called
  rider:    {hp: 3,  r: 0.75, h: 1.9, pts: 150, name: 'rider'},
  bandit:   {hp: 2,  r: 0.5,  h: 1.2, pts: 100, name: 'bandit'},
  thrower:  {hp: 2,  r: 0.5,  h: 1.2, pts: 150, name: 'dynamite bandit'},
  dynamite: {hp: 1,  r: 0.55, h: 0,   pts: 50,  name: 'dynamite'},
  vulture:  {hp: 1,  r: 0.7,  h: 0,   pts: 75,  name: 'vulture'},
  bat:      {hp: 1,  r: 0.45, h: 0,   pts: 50,  name: 'bat'},
  cart:     {hp: 4,  r: 0.8,  h: 1.3, pts: 150, name: 'mine cart'},
  swinger:  {hp: 2,  r: 0.6,  h: 1.0, pts: 150, name: 'rope bandit'},
  balloon:  {hp: 45, r: 3.2,  h: 0,   pts: 2500, name: 'Balloon Baron'},
  crate:    {hp: 1,  r: 0.6,  h: 0.4, pts: 0,   name: 'supply crate'},
  tumble:   {hp: 1,  r: 0.6,  h: 0.5, pts: 25,  name: 'tumbleweed'},
};
export const ENEMY_LIST = Object.keys(ENEMIES);
const ST = ['ride', 'station', 'aim', 'hide', 'up', 'board', 'aboard', 'fly', 'circle', 'dive', 'peck', 'swing', 'fall', 'float', 'roll', 'idle', 'wait'];

export const BREAK_TIME = 10;
export const COUNT_TIME = 4;

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
const sideOf = S => rng(S) < 0.5 ? -1 : 1;

export function stageOf(wave){ return STAGES[((Math.max(1, wave) - 1) % STAGES.length)]; }
export function lapOf(wave){ return Math.floor((Math.max(1, wave) - 1) / STAGES.length); }
export function isBossWave(w){ return w > 0 && stageOf(w).boss; }

/* Where something is, in the words the room shares. */
export function sideWords(x, z){
  const a = Math.atan2(x, -z) * 180 / Math.PI, s = Math.abs(a);
  if(s < 30) return 'ahead';
  if(s > 150) return 'behind';
  if(s < 60) return 'ahead ' + (a > 0 ? 'right' : 'left');
  if(s > 120) return 'behind ' + (a > 0 ? 'right' : 'left');
  return a > 0 ? 'right' : 'left';
}

/* ---------- the seats ----------
   Where each seat is on the wagon bed: the room sits in the same grid on
   the floor, so somebody behind you on the floor is behind you on the
   wagon, and a rider on the left is nearer whoever sits on the left. */
export function seatPos(seat){
  const i = Math.max(1, Math.min(MAX_SEATS, seat | 0)) - 1, col = i % COLS, row = Math.floor(i / COLS);
  return {x: (col - (COLS - 1) / 2) * COL_X, z: ROW_Z[row], col, row};
}
const ROW_NAME = ['front', 'second', 'third', 'back'], COL_NAME = ['left', 'middle', 'right'];
export function seatName(seat){ const p = seatPos(seat); return ROW_NAME[p.row] + ' ' + COL_NAME[p.col]; }
export function placeBench(S){
  const list = activePlayers(S).sort((a, b) => (a.seat - b.seat) || (a.color - b.color));
  list.forEach((p, i) => { const q = seatPos(p.seat); p.x = q.x; p.z = q.z; p.rank = i; });
}

/* ---------- the game ---------- */
export function create(seed){
  return {
    mode: 'wagon', seed: (seed >>> 0) || 1, t: 0, phase: 'lobby', phaseT: 0, wave: 0,
    players: {}, foes: [], nextId: 1, ev: [], plan: null, boss: null,
    hp: HP_MAX, hitT: 0, dist: 0, stage: 0, why: null,
    stats: {kills: 0, waveReached: 0},
  };
}

export function join(S, id, name){
  let p = S.players[id];
  if(!p){
    const used = Object.values(S.players).map(q => q.color);
    let color = 0;
    while(used.indexOf(color) >= 0 && color < COLORS.length - 1) color++;
    const seats = Object.values(S.players).map(q => q.seat);
    let seat = 1;
    while(seats.indexOf(seat) >= 0) seat++;
    p = S.players[id] = {id, name: name || 'Gunslinger', color, seat, rank: 0, x: 0, z: 0.2,
      aim: [0, 0, -1], firing: false, tg: 0, cd: 0, ammo: GUN.rounds, rl: 0, dry: 0, away: false,
      score: 0, kills: 0, shots: 0, hits: 0, defused: 0, critters: 0, bosses: 0, crates: 0};
  }
  p.name = name || p.name;
  p.away = false;
  placeBench(S);
  return p;
}

export function leave(S, id){
  const p = S.players[id];
  if(!p) return;
  p.away = true; p.firing = false;
  if(S.phase === 'lobby') delete S.players[id];
  placeBench(S);
}

export function activePlayers(S){ return Object.values(S.players).filter(p => !p.away); }

/* Which seat a phone says it is in. Taking somebody's seat swaps with them. */
export function setSeat(S, id, seat){
  const p = S.players[id];
  seat = seat | 0;
  if(!p || seat < 1 || seat > MAX_SEATS || p.seat === seat) return;
  const other = Object.values(S.players).find(q => q !== p && q.seat === seat);
  if(other) other.seat = p.seat;
  p.seat = seat;
  placeBench(S);
}

/* What a phone says: where it points, what it has picked, the trigger, and
   a reload (a flick of the phone, or the button). */
export function input(S, id, d){
  const p = S.players[id];
  if(!p || !d) return;
  const a = d.a;
  if(a && a.length === 3 && a.every(Number.isFinite) && Math.hypot(a[0], a[1], a[2]) > 0.1){
    const l = Math.hypot(a[0], a[1], a[2]);
    p.aim = [a[0] / l, a[1] / l, a[2] / l];
  }
  p.tg = d.tg | 0;
  p.firing = !!d.f;
  // a phone counts its shots: each new one is one pull of the trigger
  if(Number.isFinite(d.sh)){
    if(p.seq != null && d.sh !== p.seq) p.pull = Math.min(3, (p.pull || 0) + ((d.sh - p.seq + 1000) % 1000));
    p.seq = d.sh;
  }
  if(d.rl && p.rl <= 0 && p.ammo < GUN.rounds) p.rl = GUN.reload;
  if(Number.isFinite(d.seat)) setSeat(S, id, d.seat);
}

export function start(S){
  if(S.phase !== 'lobby' && S.phase !== 'over') return;
  const keep = S.players, seed = S.seed;
  Object.assign(S, create(seed));
  S.players = keep;
  Object.values(S.players).forEach(p => {
    if(p.away){ delete S.players[p.id]; return; }
    Object.assign(p, {cd: 0, firing: false, ammo: GUN.rounds, rl: 0, dry: 0,
      score: 0, kills: 0, shots: 0, hits: 0, defused: 0, critters: 0, bosses: 0, crates: 0});
  });
  placeBench(S);
  S.phase = 'count'; S.phaseT = COUNT_TIME;
  S.ev.push(['count']);
}

export function toLobby(S){
  S.phase = 'lobby'; S.foes = []; S.boss = null;
  Object.values(S.players).forEach(p => { if(p.away) delete S.players[p.id]; });
  placeBench(S);
}

function difficulty(S){
  const n = Math.max(1, activePlayers(S).length), lap = lapOf(S.wave || 1);
  return {
    crowd: 0.55 + 0.45 * Math.min(n, 6),
    lap,
    // how hard they hit, and how quickly they get their shot off
    dmg: (1 + 0.07 * (S.wave - 1)) * (1 + 0.15 * lap),
    quick: Math.max(0.55, 1 - 0.035 * (S.wave - 1) - 0.1 * lap),
    hp: 1 + 0.04 * (S.wave - 1) + 0.25 * lap,
  };
}

/* ---------- waves: one stage of the trail each ---------- */
function planWave(S){
  const d = difficulty(S), w = S.wave, st = stageOf(w);
  let budget = Math.round((7 + 2.2 * w) * d.crowd);
  if(st.boss) budget = Math.round(budget * 0.5);
  const menu = st.menu.slice();
  const groups = [];
  while(budget > 0){
    const size = 1 + Math.floor(rng(S) * Math.min(3, 1 + w / 3));
    const g = [];
    let spent = 0;
    for(let i = 0; i < size; i++){
      const opts = menu.filter(m => m[1] <= budget - spent);
      if(!opts.length) break;
      const pick = opts[Math.floor(rng(S) * opts.length)];
      g.push(pick[0]); spent += Math.max(1, pick[1]);
    }
    if(!g.length) break;
    budget -= spent;
    groups.push(g);
  }
  // somewhere along the trail: a supply crate, maybe two
  const crates = 1 + (rng(S) < 0.4 ? 1 : 0);
  for(let i = 0; i < crates; i++) groups.splice(1 + Math.floor(rng(S) * groups.length), 0, ['crate']);
  S.plan = {groups, gap: Math.max(2.2, 5.2 - w * 0.18), next: 2.5, sent: 0, maxAlive: Math.round((5 + w * 0.9) * d.crowd)};
}

function startWave(S){
  S.wave++;
  S.stage = (S.wave - 1) % STAGES.length;
  S.phase = 'wave'; S.phaseT = 0;
  S.stats.waveReached = S.wave;
  planWave(S);
  S.ev.push(['wave', S.wave, isBossWave(S.wave) ? 1 : 0, S.stage]);
  if(isBossWave(S.wave)) spawnBalloon(S);
}

export function newFoe(S, type, x, y, z, extra){
  const T = ENEMIES[type], d = difficulty(S);
  const hp = type === 'balloon' ? Math.round(T.hp * (1 + 0.3 * d.lap) * (0.7 + 0.3 * d.crowd)) : Math.max(1, Math.round(T.hp * (type === 'dynamite' || type === 'crate' || type === 'tumble' ? 1 : d.hp)));
  const f = Object.assign({id: S.nextId++, type, x, y, z, vx: 0, vy: 0, vz: 0, hp, hpMax: hp,
    st: 'ride', t: 0, timer: 0, side: x < 0 ? -1 : 1, face: Math.atan2(-x, -z), aux: 0,
    wob: rr(S, 0, 6.28)}, extra || {});
  S.foes.push(f);
  return f;
}

function spawnGroup(S, g){
  const st = STAGES[S.stage], side = sideOf(S);
  g.forEach((type, i) => {
    const sd = i % 2 ? -side : side;
    if(type === 'rider'){
      // chasing from behind, or cutting in from the side
      const behind = rng(S) < 0.6;
      const x = behind ? sd * rr(S, 4, 10) : sd * rr(S, 28, 36);
      const z = behind ? rr(S, 45, 55) : rr(S, -10, 15);
      newFoe(S, 'rider', x, 0, z, {st: 'ride', station: [sd * rr(S, 3.6, 6.5), rr(S, -7, 7)], side: sd,
        fireT: rr(S, 2, 3.5), boardT: rr(S, 14, 20)});
    } else if(type === 'bandit' || type === 'thrower' || type === 'rimbandit' || type === 'cliffthrower'){
      // behind a rock up ahead, coming past as the wagon does
      const rim = type === 'rimbandit' || type === 'cliffthrower' || (type === 'thrower' && st.rim && rng(S) < 0.5);
      const throws = type === 'thrower' || type === 'cliffthrower';
      let x, y;
      if(type === 'cliffthrower'){ x = sd * rr(S, 9, 13); y = rr(S, 4, 7); }        // ledges above the bridge
      else if(rim && st.rim){ x = sd * (st.walls + 0.4); y = st.rim; }
      else { x = sd * rr(S, 4.5, st.walls ? Math.min(st.walls - 1.5, 10) : 11); y = 0; }
      newFoe(S, throws ? 'thrower' : 'bandit', x, y, rr(S, -95, -80) - i * rr(S, 6, 12), {st: 'hide', side: sd,
        timer: rr(S, 0.3, 1.2), rim: rim ? 1 : 0, aims: 0});
    } else if(type === 'vultures'){
      const a = rr(S, -Math.PI, Math.PI);
      for(let k = 0; k < 3; k++) newFoe(S, 'vulture', Math.sin(a) * 45 + rr(S, -4, 4), rr(S, 16, 22), -Math.cos(a) * 45 + rr(S, -4, 4),
        {st: 'fly', ang: a + k * 2.1, R: rr(S, 7, 11), timer: rr(S, 5, 9) + k * 1.5});
    } else if(type === 'bats'){
      const ahead = rng(S) < 0.6;
      for(let k = 0; k < 4; k++) newFoe(S, 'bat', rr(S, -3.5, 3.5), rr(S, 2.5, 5.5), (ahead ? -1 : 1) * rr(S, 40, 50),
        {st: 'fly', timer: 0});
    } else if(type === 'cart'){
      const behind = rng(S) < 0.5;
      newFoe(S, 'cart', sd * 3.4, 0, behind ? rr(S, 40, 48) : rr(S, -60, -52), {st: 'ride', station: [sd * 3.4, rr(S, -5, 5)], side: sd,
        fireT: rr(S, 2, 3.2), noBoard: 1});
    } else if(type === 'swinger'){
      newFoe(S, 'swinger', sd * rr(S, 5, 8), rr(S, 14, 17), rr(S, -75, -60) - i * 8, {st: 'wait', side: sd});
    } else if(type === 'crate'){
      newFoe(S, 'crate', sd * rr(S, 3.2, 6), 0, rr(S, -90, -80), {st: 'idle', side: sd});
    } else if(type === 'tumble'){
      newFoe(S, 'tumble', sd * rr(S, 14, 18), 0, rr(S, -60, -30), {st: 'roll', side: sd, vx: -sd * rr(S, 3, 5)});
    }
  });
}

function spawnBalloon(S){
  const b = newFoe(S, 'balloon', rr(S, -6, 6), 22, -110, {st: 'float', dropT: 6, crewT: 10, torn: 0});
  S.boss = b.id;
  S.ev.push(['baron']);
}

/* ---------- the wagon gets hurt ---------- */
function hurtWagon(S, dmg, f, why){
  if(S.phase === 'over' || S.phase === 'count') return;
  S.hp -= dmg;
  S.hitT = 0.35;
  S.ev.push(['ouch', r1(dmg), r1(f.x), r1(f.z), f.id]);
  if(S.hp <= 0){
    S.hp = 0;
    S.phase = 'over'; S.phaseT = 0;
    S.why = {type: why || f.type, stage: S.stage};
    S.ev.push(['over', S.wave, S.why.type, S.stage]);
  }
}

/* A point on the wagon somebody is aiming for. */
function onWagon(S){ return [rr(S, -0.9, 0.9), BED + 0.3, rr(S, -2, 3.1)]; }

function throwDynamite(S, from, fall){
  const to = onWagon(S);
  newFoe(S, 'dynamite', from[0], from[1], from[2], {st: 'fall', x0: from[0], y0: from[1], z0: from[2],
    tx: to[0], ty: to[1], tz: to[2], fall: fall || rr(S, 2.4, 2.9), t2: 0});
  S.ev.push(['toss', r1(from[0]), r1(from[1]), r1(from[2])]);
}

function bang(S, f, dmg){
  S.ev.push(['bang', f.id]);
  hurtWagon(S, dmg, f);
}

/* ---------- each kind of trouble ---------- */
function foeStep(S, f, dt, d){
  f.t += dt;
  const scroll = SPEED * dt;
  switch(f.type){
    case 'rider': case 'cart': return riderStep(S, f, dt, d);
    case 'bandit': case 'thrower': {
      // the rock goes by with the ground; he pops up, aims, fires, ducks
      f.z += scroll;
      if(f.z > 40){ f.gone = true; return; }
      f.face = Math.atan2(-f.x, -f.z);
      f.timer -= dt;
      if(f.st === 'hide'){
        if(f.timer <= 0 && f.z > -70 && f.z < 25){ f.st = 'up'; f.timer = (f.type === 'thrower' ? 1.1 : 1.4) * d.quick * rr(S, 0.85, 1.2); }
      } else if(f.st === 'up'){
        f.aux = clamp(1 - f.timer / 1.4, 0, 1);
        if(f.timer <= 0){
          if(f.type === 'thrower') throwDynamite(S, [f.x, f.y + 2, f.z]);
          else bang(S, f, 3.2 * d.dmg);
          f.st = 'hide'; f.timer = rr(S, 1.4, 2.6); f.aux = 0;
        }
      }
      return;
    }
    case 'dynamite': {
      f.t2 += dt;
      const k = Math.min(1, f.t2 / f.fall);
      f.x = f.x0 + (f.tx - f.x0) * k; f.z = f.z0 + (f.tz - f.z0) * k;
      f.y = f.y0 + (f.ty - f.y0) * k + Math.sin(k * Math.PI) * (f.y0 > 10 ? 1 : 4);
      f.aux = k;
      if(k >= 1){
        f.dead = true; f.gone = true;
        S.ev.push(['blast', r1(f.x), r1(f.y), r1(f.z)]);
        hurtWagon(S, 11 * d.dmg, f);
      }
      return;
    }
    case 'vulture': {
      if(f.st === 'fly' || f.st === 'circle'){
        // in from afar, round and round overhead, then down for the cargo
        f.ang += dt * 0.9 / Math.max(4, f.R) * 4;
        const tx = Math.sin(f.ang) * f.R, tz = -Math.cos(f.ang) * f.R, ty = 11 + Math.sin(f.t + f.wob) * 1.2;
        const dx = tx - f.x, dy = ty - f.y, dz = tz - f.z, l = Math.hypot(dx, dy, dz) || 1;
        const sp = f.st === 'fly' ? 14 : 9;
        f.vx = dx / l * Math.min(sp, l * 3); f.vy = dy / l * Math.min(sp, l * 3); f.vz = dz / l * Math.min(sp, l * 3);
        if(l < 3) f.st = 'circle';
        if(f.st === 'circle'){ f.timer -= dt; if(f.timer <= 0){ f.st = 'dive'; f.tgt = [rr(S, -0.8, 0.8), BED + 0.9, rr(S, 2.5, 3.1)]; S.ev.push(['dive', f.id]); } }
      } else if(f.st === 'dive'){
        const dx = f.tgt[0] - f.x, dy = f.tgt[1] - f.y, dz = f.tgt[2] - f.z, l = Math.hypot(dx, dy, dz) || 1;
        const sp = 7.5;
        f.vx = dx / l * sp; f.vy = dy / l * sp; f.vz = dz / l * sp;
        if(l < 0.4){ f.st = 'peck'; f.vx = f.vy = f.vz = 0; }
      } else if(f.st === 'peck'){
        f.y = f.tgt[1] + Math.abs(Math.sin(f.t * 7)) * 0.2;
        hurtWagonSlow(S, f, 2.2 * d.dmg, dt);
      }
      f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      if(Math.hypot(f.vx, f.vz) > 0.3) f.face = Math.atan2(f.vx, f.vz);
      return;
    }
    case 'bat': {
      // a flutter down the tunnel at the wagon, and nibbling once there
      if(f.st === 'fly'){
        if(!f.tgt) f.tgt = [rr(S, -1, 1), BED + rr(S, 0.8, 1.6), rr(S, -1.8, 2)];
        let dx = f.tgt[0] - f.x, dy = f.tgt[1] - f.y, dz = f.tgt[2] - f.z;
        const dist = Math.hypot(dx, dy, dz);
        dx += Math.cos(f.t * 4 + f.wob) * dist * 0.3; dy += Math.sin(f.t * 5 + f.wob) * dist * 0.15;
        const l = Math.hypot(dx, dy, dz) || 1, sp = Math.min(7.5, dist * 2.5);
        f.vx = dx / l * sp; f.vy = dy / l * sp; f.vz = dz / l * sp;
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        if(dist < 0.35) f.st = 'peck';
      } else {
        f.x = f.tgt[0] + Math.sin(f.t * 9 + f.wob) * 0.25; f.y = f.tgt[1] + Math.cos(f.t * 11) * 0.2;
        hurtWagonSlow(S, f, 0.7 * d.dmg, dt);
      }
      f.face = Math.atan2(f.vx || 0.01, f.vz || 0.01);
      return;
    }
    case 'swinger': {
      if(f.st === 'wait'){
        // up on a rock pillar by the bridge (or in the Baron's basket) until the wagon is close enough to jump for
        f.z += f.fromBalloon ? 0 : scroll;
        if(f.z > -22 || f.fromBalloon){
          f.st = 'swing'; f.t2 = 0; f.x0 = f.x; f.y0 = f.y; f.z0 = f.z;
          const land = [f.side * WAGON.hw * 0.9, BED, rr(S, -1.6, 1.8)];
          f.tx = land[0]; f.ty = land[1]; f.tz = land[2];
          f.swing = (f.fromBalloon ? 3.2 : 2.6) / Math.max(0.7, 1 / d.quick * 0.8);
          S.ev.push(['swing', f.id]);
        }
      } else if(f.st === 'swing'){
        f.t2 += dt;
        const k = Math.min(1, f.t2 / f.swing), e = k * k * (3 - 2 * k);
        f.x = f.x0 + (f.tx - f.x0) * e; f.z = f.z0 + (f.tz - f.z0) * e;
        // a swing on a rope: down in an arc and up onto the boards
        f.y = Math.max(f.ty, f.y0 + (f.ty - f.y0) * Math.sin(e * Math.PI / 2) - Math.sin(k * Math.PI) * 2.5);
        f.aux = k;
        if(k >= 1){ f.st = 'aboard'; f.x = f.tx; f.y = BED; f.z = f.tz; S.ev.push(['aboard', f.id, f.side]); }
      } else if(f.st === 'aboard') hurtWagonSlow(S, f, 6 * d.dmg, dt);
      f.face = Math.atan2(-f.x, -f.z);
      return;
    }
    case 'balloon': return balloonStep(S, f, dt, d);
    case 'crate': f.z += scroll; f.face = 0; if(f.z > 40) f.gone = true; return;
    case 'tumble':
      f.z += scroll; f.x += f.vx * dt; f.face += dt * 3;
      if(f.z > 40 || Math.abs(f.x) > 30) f.gone = true;
      return;
  }
}

/* steady damage (pecking, a brawl on the boards), told now and then */
function hurtWagonSlow(S, f, dps, dt){
  f.acc = (f.acc || 0) + dps * dt;
  if(f.acc >= 2){ hurtWagon(S, f.acc, f); f.acc = 0; }
}

function riderStep(S, f, dt, d){
  // gallop up to a spot beside the wagon and keep pace there, firing; a
  // rider who is left alone long enough jumps aboard
  const cart = f.type === 'cart';
  if(f.st === 'ride' || f.st === 'station' || f.st === 'aim'){
    const [sx, sz] = f.station;
    const dx = sx - f.x, dz = sz - f.z, l = Math.hypot(dx, dz);
    const sp = cart ? 9 : 12;
    const want = Math.min(sp, l * 1.5);
    f.vx += ((l > 0.01 ? dx / l : 0) * want - f.vx) * Math.min(1, dt * 2);
    f.vz += ((l > 0.01 ? dz / l : 0) * want - f.vz) * Math.min(1, dt * 2);
    if(cart) f.vx = 0;
    f.x += f.vx * dt; f.z += f.vz * dt;
    if(cart) f.x = f.station[0];
    // a horse faces the way the trail goes (it is galloping forward) unless it is cutting across
    f.face = Math.atan2(f.vx * 0.6, -SPEED + f.vz * 0.6) ;
    if(f.st === 'ride' && l < 2.5) f.st = 'station';
    if(f.st === 'station'){
      // drift about a bit so they are not sitting ducks
      f.station[1] += Math.sin(f.t * 0.7 + f.wob) * dt * 1.5;
      f.fireT -= dt;
      if(f.fireT <= 0){ f.st = 'aim'; f.timer = 1.0 * d.quick; }
      if(!f.noBoard){ f.boardT -= dt; if(f.boardT <= 0){ f.st = 'board'; f.timer = 0; } }
    } else if(f.st === 'aim'){
      f.timer -= dt; f.aux = clamp(1 - f.timer, 0, 1);
      if(f.timer <= 0){ bang(S, f, (cart ? 2.5 : 3) * d.dmg); f.st = 'station'; f.fireT = rr(S, 2.4, 3.6) * d.quick; f.aux = 0; }
    }
  } else if(f.st === 'board'){
    // in alongside, then the jump
    const tx = f.side * (WAGON.hw + 0.9), tz = clamp(f.z, -1.5, 1.8);
    f.x += (tx - f.x) * Math.min(1, dt * 1.5); f.z += (tz - f.z) * Math.min(1, dt * 1.5);
    f.face = Math.atan2(0, -1);
    f.timer += dt;
    if(f.timer > 2.2){ f.st = 'aboard'; f.x = f.side * WAGON.hw * 0.85; f.y = BED; f.z = tz; S.ev.push(['aboard', f.id, f.side]); }
  } else if(f.st === 'aboard'){
    f.face = Math.atan2(-f.x, 0);
    hurtWagonSlow(S, f, 6 * d.dmg, dt);
  }
}

function balloonStep(S, f, dt, d){
  if(f.st === 'float'){
    // drifts in over the trail ahead, then hangs over the wagon, swaying
    const tz = -16 + Math.sin(f.t * 0.23) * 10, tx = Math.sin(f.t * 0.31 + 1) * 9;
    f.vx = (tx - f.x) * 0.5; f.vz = clamp((tz - f.z) * 0.6, -8, 8);
    f.x += f.vx * dt; f.z += f.vz * dt;
    f.y = 19 + Math.sin(f.t * 0.6) * 1.5;
    f.face = Math.sin(f.t * 0.2) * 0.4;
    if(f.z > -45){
      f.dropT -= dt; f.crewT -= dt;
      if(f.dropT <= 0){ throwDynamite(S, [f.x, f.y - 2.5, f.z], rr(S, 2.6, 3.1)); f.dropT = rr(S, 3.2, 4.6) * d.quick; }
      if(f.crewT <= 0){
        for(let k = 0; k < 2; k++) newFoe(S, 'swinger', f.x + (k ? 1 : -1) * 0.5, f.y - 2.1, f.z, {st: 'wait', side: k ? 1 : -1, fromBalloon: 1});
        S.ev.push(['crew', r1(f.x), r1(f.z)]);
        f.crewT = rr(S, 10, 13);
      }
    }
  }
}

/* ---------- the revolvers ---------- */
/* Where a thing is centred for being hit. */
export function centre(f){ const T = ENEMIES[f.type]; return [f.x, f.y + T.h, f.z]; }
/* Only a bandit who is up from behind his rock can be hit. */
export function hittable(f){ return !f.dead && !((f.type === 'bandit' || f.type === 'thrower') && f.st === 'hide'); }

function rayHits(S, ox, oy, oz, dx, dy, dz){
  const out = [];
  for(const f of S.foes){
    if(!hittable(f)) continue;
    const c = centre(f), T = ENEMIES[f.type];
    const vx = c[0] - ox, vy = c[1] - oy, vz = c[2] - oz;
    const t = vx * dx + vy * dy + vz * dz;
    if(t <= 0 || t > GUN.range) continue;
    const miss = Math.hypot(vx - dx * t, vy - dy * t, vz - dz * t);
    const r = T.r * GUN.assist + 0.15 + t * 0.007;
    if(miss < r) out.push({f, t});
  }
  return out.sort((a, b) => a.t - b.t);
}

function spreadDir(S, a, spread){
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
   moment in the past, and here the world is moving past at a gallop. */
function trusted(S, p, ox, oy, oz){
  if(!p.tg) return null;
  const f = S.foes.find(x => x.id === p.tg && hittable(x));
  if(!f) return null;
  const c = centre(f);
  const vx = c[0] - ox, vy = c[1] - oy, vz = c[2] - oz, l = Math.hypot(vx, vy, vz) || 1;
  const cos = (vx * p.aim[0] + vy * p.aim[1] + vz * p.aim[2]) / l;
  return cos > Math.cos(0.2) ? {f, t: l} : null;
}

function fire(S, p){
  p.cd = GUN.cool;
  p.ammo--;
  p.shots++;
  const ox = p.x, oy = EYE - 0.1, oz = p.z;
  const dir = p.tg ? p.aim : spreadDir(S, p.aim, GUN.spread);
  let list = rayHits(S, ox, oy, oz, dir[0], dir[1], dir[2]);
  const t = trusted(S, p, ox, oy, oz);
  if(t) list = [t].concat(list.filter(h => h.f !== t.f));
  const h = list[0];
  if(h){ hurt(S, h.f, GUN.dmg, p); p.hits++; }
  S.ev.push(['shot', p.color, r2(ox), r2(oy), r2(oz), r2(dir[0]), r2(dir[1]), r2(dir[2]), h ? r1(h.t) : GUN.range, h ? h.f.id : 0]);
  if(p.ammo <= 0) p.dry = GUN.autoReload;
}

function hurt(S, f, dmg, p){
  if(f.dead) return;
  f.hp -= dmg;
  if(p) p.score += 5;
  S.ev.push(['hit', f.id, p ? p.color : -1]);
  if(f.type === 'balloon'){
    const k = f.hp / f.hpMax;
    if(f.torn < 1 && k < 0.66){ f.torn = 1; S.ev.push(['torn', 1]); }
    if(f.torn < 2 && k < 0.33){ f.torn = 2; S.ev.push(['torn', 2]); }
  }
  if(f.hp <= 0) kill(S, f, p);
}

function kill(S, f, p){
  f.dead = true;
  const T = ENEMIES[f.type];
  if(p){
    p.score += T.pts; p.kills++;
    if(f.type === 'dynamite') p.defused++;
    if(f.type === 'vulture' || f.type === 'bat') p.critters++;
    if(f.type === 'balloon') p.bosses++;
    if(f.type === 'crate') p.crates++;
    if(f.st === 'aboard' || f.st === 'board' || f.st === 'peck') p.score += 100;   // got him off the wagon
  }
  if(f.type !== 'crate' && f.type !== 'tumble') S.stats.kills++;
  const c = centre(f);
  S.ev.push(['poof', f.id, f.type, r1(c[0]), r1(c[1]), r1(c[2]), p ? p.color + 1 : 0]);
  if(f.type === 'crate'){ S.hp = Math.min(HP_MAX, S.hp + 15); S.ev.push(['supplies', p ? p.color : -1]); }
  if(f.type === 'balloon'){
    S.boss = null;
    S.ev.push(['barondown', p ? p.color : -1]);
    // his crew lets go of the ladder
    S.foes.forEach(o => { if(o.type === 'swinger' && o.fromBalloon && o.st === 'wait') o.dead = true; });
  }
}

function playerStep(S, p, dt){
  p.cd = Math.max(0, p.cd - dt);
  if(p.away) return;
  if(p.rl > 0){
    p.rl -= dt;
    if(p.rl <= 0){ p.rl = 0; p.ammo = GUN.rounds; p.dry = 0; S.ev.push(['loaded', p.color]); }
    p.pull = 0;
    return;
  }
  if(p.ammo <= 0){
    // empty: it reloads itself, a little slower than a flick
    p.pull = 0;
    p.dry -= dt;
    if(p.dry <= 0){ p.rl = GUN.reload * 0.25; }
    return;
  }
  if(!(p.firing || p.pull > 0) || p.cd > 0) return;
  if(S.phase !== 'wave' && S.phase !== 'break'){ p.pull = 0; return; }
  fire(S, p);
  if(p.pull > 0) p.pull--;
}

/* ---------- one tick ---------- */
export function step(S, dt){
  S.t += dt;
  if(S.phase === 'lobby') return;
  if(S.phase === 'over'){ S.phaseT += dt; return; }
  S.dist += SPEED * dt;
  const d = difficulty(S);
  if(S.phase === 'count' || S.phase === 'break'){
    S.phaseT -= dt;
    if(S.phaseT <= 0) startWave(S);
  } else if(S.phase === 'wave'){
    S.phaseT += dt;
    const P = S.plan;
    const alive = S.foes.filter(f => !f.dead && f.type !== 'dynamite' && f.type !== 'crate' && f.type !== 'tumble').length;
    P.next -= dt;
    if(P.sent < P.groups.length && P.next <= 0 && alive < P.maxAlive){
      spawnGroup(S, P.groups[P.sent++]);
      P.next = P.gap * rr(S, 0.75, 1.25);
    }
    const left = S.foes.some(f => !f.dead && f.type !== 'crate' && f.type !== 'tumble');
    if(P.sent >= P.groups.length && !left){
      S.phase = 'break'; S.phaseT = BREAK_TIME;
      S.hp = Math.min(HP_MAX, S.hp + 20);
      S.foes.forEach(f => { f.gone = true; });
      S.ev.push(['clear', S.wave, S.stage]);
    }
  }
  for(const f of S.foes) if(!f.dead && !f.gone) foeStep(S, f, dt, d);
  for(const p of Object.values(S.players)) playerStep(S, p, dt);
  S.hitT = Math.max(0, S.hitT - dt);
  S.foes = S.foes.filter(f => !f.dead && !f.gone);
}

/* ---------- the wire ---------- */
export function snap(S){
  const m = [];
  for(const f of S.foes){
    m.push(f.id, ENEMY_LIST.indexOf(f.type), r2(f.x), r2(f.y), r2(f.z), Math.round(f.face * 100),
      Math.max(0, Math.round(100 * f.hp / f.hpMax)), Math.max(0, ST.indexOf(f.st)), Math.round((f.aux || 0) * 100) + (f.side < 0 ? 1000 : 0),
      r1(f.vx), r1(f.vz));
  }
  const pl = Object.values(S.players).map(p => ({
    id: p.id, n: p.name, c: p.color, x: r2(p.x), z: r2(p.z), seat: p.seat, rk: p.rank,
    a: [r2(p.aim[0]), r2(p.aim[1]), r2(p.aim[2])], f: p.firing ? 1 : 0, am: p.ammo, rl: p.rl > 0 ? 1 : 0, aw: p.away ? 1 : 0,
    s: Math.round(p.score), k: p.kills, sh: p.shots, hi: p.hits, df: p.defused, cr: p.critters, bs: p.bosses,
  }));
  const out = {t: 's', mode: 'wagon', ph: S.phase, pt: r1(S.phaseT), w: S.wave, sg: S.stage, hp: Math.round(S.hp), hit: S.hitT > 0 ? 1 : 0,
    dist: Math.round(S.dist), m, pl, ev: S.ev, boss: S.boss || 0, why: S.why};
  S.ev = [];
  return out;
}
export const STATES = ST;

export function awards(players){
  const live = players.filter(p => p.sh > 0 || p.k > 0);
  const out = {};
  const best = (f, min) => {
    let b = null;
    for(const p of live){ const v = f(p); if(v >= (min || 1) && (!b || v > f(b))) b = p; }
    return b;
  };
  const pick = (p, name) => { if(p && !out[p.id]) out[p.id] = name; };
  pick(best(p => p.bs), 'Balloon Popper');
  pick(best(p => p.k), 'Quickest Draw');
  pick(best(p => p.df), 'Dynamite Defuser');
  pick(best(p => p.cr, 2), 'Varmint Hunter');
  pick(best(p => (p.sh >= 18 ? p.hi / p.sh : 0), 0.01), 'Deadeye');
  return out;
}
