/* Night Watch - the host.

   Whoever opens the room runs the game: the TV normally, or one of the
   phones when there is no TV ("Start a game on this phone"). It holds the
   simulation, steps it at 60 Hz from real elapsed time (setInterval, not
   requestAnimationFrame, which is a paint rate and stops in a background
   tab), and sends every screen a snapshot twenty times a second.

   A phone that hosts also plays: its own gunner is wired in through a
   loopback connection that looks exactly like a network one, so the game
   never needs to know which phone is holding the room.

   Lessons carried over from Mission Control: a phone that says nothing for
   six seconds is away (WebRTC can take far longer to notice), one away for
   thirty has gone, and a phone that comes back with the same device id gets
   its own seat, colour and score back.

   Two games share the room: space (sim.js) and the bunker (zsim.js). The
   lobby picks one; both have the same create / join / step / snap shape. */
import * as NW from './sim.js';
import * as ZB from './zsim.js';
const GAMES = {space: NW, zombie: ZB};
const THEME0 = {space: 'nightwatch', zombie: 'danse'};

export const PROTO = NW.PROTO;
export const PROTO_MIN = 1;
const TICK = 1 / 60;
const SNAP_EVERY = 0.05;
const AWAY_MS = 6000, GONE_MS = 30000;

function cleanName(n){ return String(n || '').replace(/[^\p{L}\p{N} '\-]/gu, '').trim().slice(0, 14); }

function loadSave(){
  let s = {};
  try { s = JSON.parse(localStorage.getItem('nwatch_save') || '{}') || {}; } catch(e){}
  // the first build kept one record and one theme, for space
  const out = {games: s.games || 0, mode: s.mode === 'zombie' ? 'zombie' : 'space',
    themes: Object.assign({}, THEME0, s.themes || {}),
    bests: Object.assign({space: {best: s.best || 0, bestScore: s.bestScore || 0}, zombie: {best: 0, bestScore: 0}}, s.bests || {})};
  if(s.theme && !s.themes) out.themes.space = s.theme;
  return out;
}

/* opts: {tv: bool (this host is a TV - every phone is a gunner),
          onSnap(snap) (this device's own screen), onRoom(info), onError(msg)} */
export function createHost(opts){
  const save = loadSave();
  let mode = save.mode, G = GAMES[mode];
  let S = G.create((Math.random() * 2 ** 32) >>> 0);
  const people = {};        // dev id -> {id, name, role, conn, seen, gone, ready}
  const room = {code: null, status: 'Opening the room...', tv: !!opts.tv};
  let themePicked = false;
  let handle = null, acc = 0, snapAcc = 0, last = performance.now(), roomDirty = true, roomEvery = 0;

  function persist(){ try { localStorage.setItem('nwatch_save', JSON.stringify(save)); } catch(e){} }

  function open(){
    room.status = 'Opening the room...';
    handle = window.NWNet.host({
      open: code => { room.code = code; room.status = ''; roomDirty = true; info(); },
      conn: c => wire(c),
      error: msg => {
        room.status = msg + ' Retrying...';
        room.code = null; info();
        setTimeout(() => { if(!room.code) open(); }, 4000);
      }
    });
  }

  function send(p, m){ if(p && p.conn){ try { p.conn.send(m); } catch(e){} } }

  function wire(c){
    let id = null;
    c.on('data', d => {
      if(!d || typeof d !== 'object') return;
      if(d.t === 'hello'){
        id = String(d.dev || c.peer).slice(0, 40);
        const old = people[id];
        if(old && old.conn && old.conn !== c){ try { old.conn.close(); } catch(e){} }
        const p = old || {id, ready: false};
        p.name = cleanName(d.name) || p.name || 'Gunner';
        p.role = d.role === 'watch' ? 'watch' : 'player';
        p.conn = c; p.lastConn = c; p.gone = 0; p.seen = performance.now();
        people[id] = p;
        send(p, {t: 'host', proto: PROTO, min: PROTO_MIN, tv: room.tv, code: room.code});
        if(p.role === 'player'){
          const pl = G.join(S, id, p.name);
          send(p, {t: 'you', id, c: pl.color});
        }
        roomDirty = true;
        return;
      }
      const p = id && people[id];
      if(!p) return;
      if(!p.conn && p.lastConn === c){ p.conn = c; p.gone = 0; if(p.role === 'player') G.join(S, id, p.name); roomDirty = true; }
      if(p.conn !== c) return;
      p.seen = performance.now();
      fromPhone(p, d);
    });
    c.on('close', () => {
      const p = id && people[id];
      if(p && p.conn === c) drop(p);
    });
  }

  function drop(p){
    p.conn = null; p.gone = performance.now(); p.ready = false;
    if(p.role === 'player') G.leave(S, p.id);
    roomDirty = true;
  }

  function fromPhone(p, d){
    if(d.t === 'in'){
      if(p.role !== 'player') return;
      if(mode === 'space') NW.input(S, p.id, d.a, d.tg, d.f);
      else ZB.input(S, p.id, d);
    } else if(d.t === 'msl'){
      if(p.role === 'player' && mode === 'space') NW.missile(S, p.id, d.tg | 0);
    } else if(d.t === 'mode'){
      if(GAMES[d.key]) setMode(d.key);
    } else if(d.t === 'ready'){
      if(S.phase === 'lobby'){ p.ready = !!d.v; roomDirty = true; maybeStart(); }
    } else if(d.t === 'go'){
      go();
    } else if(d.t === 'again'){
      if(S.phase === 'over' && S.phaseT > 2.5) go();
    } else if(d.t === 'net'){
      // how this phone reaches us, as it measured it
      if(['wifi', 'internet', 'relay', 'local'].indexOf(d.k) >= 0 && p.net !== d.k){ p.net = d.k; roomDirty = true; }
    } else if(d.t === 'lobby'){
      // back to the lobby: to change the game, or the music, or wait for somebody
      if(S.phase === 'over' && S.phaseT > 2.5){ G.toLobby(S); Object.values(people).forEach(q => { q.ready = false; }); roomDirty = true; }
    } else if(d.t === 'theme'){
      if(typeof d.key === 'string' && d.key.length < 24){ save.themes[mode] = d.key; themePicked = true; persist(); roomDirty = true; }
    }
  }

  /* Between games only. Everybody keeps their colour. */
  function setMode(m){
    if(m === mode || (S.phase !== 'lobby' && S.phase !== 'over')) return;
    const keep = Object.values(S.players).filter(q => !q.away).sort((a, b) => a.color - b.color);
    mode = m; G = GAMES[m];
    save.mode = m; persist();
    S = G.create((Math.random() * 2 ** 32) >>> 0);
    keep.forEach(q => G.join(S, q.id, q.name));
    Object.values(people).forEach(p => {
      if(p.role !== 'player' || !p.conn) return;
      const pl = S.players[p.id] || G.join(S, p.id, p.name);
      p.ready = false;
      send(p, {t: 'you', id: p.id, c: pl.color});
    });
    themePicked = false;
    roomDirty = true;
  }

  function players(){ return Object.values(people).filter(p => p.conn && p.role === 'player'); }

  function maybeStart(){
    const ps = players();
    if(ps.length && ps.every(p => p.ready)) go();
  }

  function go(){
    if(S.phase !== 'lobby' && S.phase !== 'over') return;
    if(!players().length) return;
    G.start(S);
    themePicked = false;
    Object.values(people).forEach(p => { p.ready = false; });
    roomDirty = true;
  }

  function sweep(now){
    Object.values(people).forEach(p => {
      if(p.conn && now - p.seen > AWAY_MS) drop(p);
      if(!p.conn && now - p.gone > GONE_MS){
        delete people[p.id];
        if(S.players[p.id] && S.phase === 'lobby') delete S.players[p.id];
        roomDirty = true;
      }
    });
  }

  function roomInfo(){
    const b = save.bests[mode];
    return {code: room.code, status: room.status, tv: room.tv, mode, theme: save.themes[mode], themePicked,
      best: b.best, bestScore: b.bestScore,
      people: Object.values(people).map(p => {
        const pl = S.players[p.id];
        return {id: p.id, n: p.name, role: p.role, c: pl ? pl.color : -1, r: p.ready ? 1 : 0, w: p.conn ? 0 : 1,
          net: p.conn && p.conn.peer === 'local' ? 'host' : p.net || ''};
      })};
  }
  function info(){ if(opts.onRoom) opts.onRoom(roomInfo()); }

  function tick(){
    const now = performance.now();
    let dt = (now - last) / 1000;
    last = now;
    if(dt > 0.25) dt = 0.25;           // a stalled tab does not fast-forward through a wave
    acc += dt;
    while(acc >= TICK){
      const was = S.phase;
      G.step(S, TICK);
      acc -= TICK;
      if(was !== 'over' && S.phase === 'over') finish();
    }
    snapAcc += dt;
    if(snapAcc >= SNAP_EVERY){
      snapAcc = 0;
      sweep(now);
      const s = G.snap(S);
      s.mode = mode;
      if(S.phase === 'over') s.nr = S.newRecord ? 1 : 0;
      if(roomDirty || ++roomEvery >= 20){ s.ro = roomInfo(); roomDirty = false; roomEvery = 0; info(); }
      Object.values(people).forEach(p => send(p, s));
      if(opts.onSnap) opts.onSnap(s);
    }
  }

  function finish(){
    save.games++;
    const score = Object.values(S.players).reduce((a, p) => a + p.score, 0);
    const b = save.bests[mode];
    S.newRecord = S.wave > b.best && S.wave >= 2;
    if(S.wave > b.best) b.best = S.wave;
    if(score > b.bestScore) b.bestScore = Math.round(score);
    persist();
    roomDirty = true;
  }

  /* A gunner on this very device: the same messages, no network. */
  function local(name, dev, onMessage){
    const em = {};
    const fire = (ev, x) => (em[ev] || []).forEach(f => f(x));
    const conn = {
      peer: 'local',
      on: (ev, fn) => { (em[ev] = em[ev] || []).push(fn); },
      send: m => { try { onMessage(m); } catch(e){ console.error(e); } },
      close: () => fire('close'),
    };
    wire(conn);
    const toHost = m => fire('data', m);
    toHost({t: 'hello', name, dev, proto: PROTO, role: 'player'});
    return {send: toHost};
  }

  open();
  const timer = setInterval(tick, 1000 / 60);
  return {
    get S(){ return S; }, get mode(){ return mode; }, setMode, room, local, go, roomInfo,
    // the TV's own keyboard
    key: k => { if(k === 'go') go(); },
    destroy: () => { clearInterval(timer); if(handle) handle.destroy(); },
  };
}
