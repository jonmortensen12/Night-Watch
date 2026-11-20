/* Night Watch: Wagon - the phone, in the cowboy game.

   play.html owns joining, the lobby (where the seat is picked), the results
   and where the phone is pointing (its sensors, LOCK FRONT, drag-to-look).
   This is everything else once the wagon is rolling: the revolver, the
   reload, the wagon's health, the arrows to trouble and the overlay.

   Nobody walks: everybody sits on the bench, in the seat they picked, and
   turns to look. A tap fires one shot; a held finger fans the hammer, a
   little slower. Six shots, then reload: flick the phone (a quick twist of
   the wrist), or tap the cylinder; an empty gun reloads itself after a
   moment anyway. The gun button swaps to the sawed-off shotgun: eight
   pellets a shot, close up, two shots a load. A shot to the head drops
   any outlaw. Between stages the wagon pulls up until somebody taps RIDE ON. */
import * as THREE from 'three';
import {Trail} from './trail.js';
import {ENEMIES, STAGES, GUNS, EYE, BED, COLORS, sideWords} from './wsim.js';

const FOE_COL = {rider: '#ffb060', bandit: '#ff8a50', thrower: '#ff5040', dynamite: '#ff3020', vulture: '#d0b0a0', bat: '#c070ff',
  cart: '#ffb060', swinger: '#ff8a50', balloon: '#ffd040', crate: '#60ff80', tumble: '#c8a870'};
const HOLD_EXTRA = [0.14, 0.18];   // a held finger fires a little slower than tapping

export function createWagonPhone(ctx){
  // ctx: {tx(msg), SND, banner, toast, callout, buzz, look(dx, dy), isDrag(), me: () => colour, onEvent}
  const SND = ctx.SND;
  const canvas = document.createElement('canvas');
  canvas.id = 'wview';
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;z-index:1';
  document.body.insertBefore(canvas, document.body.firstChild.nextSibling);
  const trail = new Trail(canvas, {mode: 'phone', low: /[?&]q=low/.test(location.search)});

  /* ---------- the overlay ---------- */
  const ui = document.createElement('div');
  ui.id = 'wui';
  ui.innerHTML = `
    <style>
      #wui { position: fixed; inset: 0; z-index: 3; touch-action: none; }
      #whud { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 4; }
      #wui .wb { position: fixed; z-index: 6; font: 800 13px system-ui; color: #fff; background: #2a1a0ecc; border: 1px solid #a07040; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-direction: column; padding: 0; }
      #wui #wreload { right: 16px; bottom: calc(22px + env(safe-area-inset-bottom)); width: 96px; height: 96px; }
      #wui #wreload.empty { background: #c0401acc; border-color: #ffc080; box-shadow: 0 0 18px #ff8040; animation: wpulse 0.6s infinite alternate; }
      @keyframes wpulse { from { transform: scale(1); } to { transform: scale(1.07); } }
      #wui #wfire { left: 16px; bottom: calc(22px + env(safe-area-inset-bottom)); width: 92px; height: 92px; background: #8a2a10cc; display: none; }
      #wui #wcyl { position: static; width: 64px; height: 64px; }
      #wreload small { font-size: 10px; letter-spacing: 0.08em; margin-top: 1px; opacity: 0.9; }
      #wwagon { position: fixed; left: 50%; transform: translateX(-50%); top: calc(84px + env(safe-area-inset-top)); width: min(70vw, 300px); z-index: 5; pointer-events: none; text-align: center; font: 800 11px system-ui; letter-spacing: 0.12em; color: #ffe0b0; text-shadow: 0 1px 3px #000; }
      #wbar { height: 10px; border-radius: 6px; background: #0008; border: 1px solid #ffd09080; overflow: hidden; margin-top: 3px; }
      #wbarIn { height: 100%; width: 100%; background: linear-gradient(90deg, #ffb040, #ffe080); transition: width 0.2s; }
      #wbarIn.low { background: linear-gradient(90deg, #ff3020, #ff8040); }
      #wui #wgun { right: 22px; bottom: calc(132px + env(safe-area-inset-bottom)); width: 84px; height: 46px; border-radius: 23px; font-size: 11px; letter-spacing: 0.06em; line-height: 1.15; }
      #wui #wgun b { font-size: 13px; }
      #wui #wride { left: 50%; top: 58%; transform: translate(-50%, -50%); width: auto; height: auto; padding: 18px 34px; border-radius: 40px; font: 900 26px system-ui; letter-spacing: 0.06em;
        background: #c0601acc; border: 2px solid #ffd090; box-shadow: 0 0 26px #ff9040; display: none; animation: wpulse 0.8s infinite alternate; }
      #wui #wride small { font: 700 12px system-ui; letter-spacing: 0.04em; opacity: 0.9; margin-top: 4px; }
      #whead { position: fixed; left: 50%; top: 36%; transform: translate(-50%, -50%) scale(1); z-index: 5; pointer-events: none; font: 900 34px system-ui; letter-spacing: 0.08em; color: #ffd040; text-shadow: 0 0 12px #ff6020, 0 2px 4px #000; opacity: 0; transition: opacity 0.25s, transform 0.25s; }
      #whead.on { opacity: 1; transform: translate(-50%, -50%) scale(1.15); transition: none; }
      #wstage { margin-top: 4px; color: #fff8; font-weight: 700; letter-spacing: 0.08em; }
      #wblood { position: fixed; inset: 0; pointer-events: none; z-index: 4; opacity: 0; transition: opacity 0.12s; box-shadow: inset 0 0 90px 30px #c02010; }
    </style>
    <canvas id="whud"></canvas>
    <div id="wblood"></div>
    <div id="wwagon">THE WAGON<div id="wbar"><div id="wbarIn"></div></div><div id="wstage"></div></div>
    <button class="wb" id="wreload"><canvas id="wcyl" width="128" height="128"></canvas><small>RELOAD</small></button>
    <button class="wb" id="wfire">FIRE</button>
    <button class="wb" id="wgun"><span>SWAP TO</span><b>SHOTGUN</b></button>
    <button class="wb" id="wride">🐎 RIDE ON<small>when everybody is ready</small></button>
    <div id="whead">HEADSHOT!</div>`;
  document.body.appendChild(ui);
  const $ = s => ui.querySelector(s);
  const hud = $('#whud'), hg = hud.getContext('2d');
  function sizeHud(){ const d = Math.min(2, devicePixelRatio || 1); hud.width = innerWidth * d; hud.height = innerHeight * d; hg.setTransform(d, 0, 0, d, 0, 0); }
  sizeHud(); addEventListener('resize', sizeHud);
  const cg = $('#wcyl').getContext('2d');

  /* ---------- this gunslinger ---------- */
  let x = 0, z = 0.2, firing = false, held = 0, cd = 0, phase = 'lobby', S = null;
  let w = 0, swapT = 0, bag = GUNS.map(g => g.rounds);
  const G = () => GUNS[w];
  let ammo = G().rounds, reloading = 0, dry = 0, active = true, aimTarget = null, wantReload = false;
  const fwd = new THREE.Vector3(), up = new THREE.Vector3();
  const hits = [], ouches = [];

  function startReload(){
    if(reloading > 0 || (ammo >= G().rounds && hostAm >= G().rounds) || phase === 'lobby' || phase === 'over') return;
    reloading = G().reload;
    trail.reloading(true);
    wantReload = true;
    SND.sfx('spin');
    ctx.buzz(15);
    send();
  }
  $('#wreload').addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); SND.unlock(); startReload(); });

  /* the other gun: the host keeps each gun's rounds, so swapping back finds
     the revolver as it was left. Not mid-reload. */
  function swapGun(){
    if(reloading > 0) return;
    bag[w] = ammo; w = 1 - w; ammo = bag[w]; dry = 0;
    cd = Math.max(cd, 0.4); swapT = performance.now();
    trail.useGun(w);
    SND.sfx('cock'); ctx.buzz(12);
    showGun();
    send();
  }
  function showGun(){
    $('#wgun b').textContent = GUNS[1 - w].name.toUpperCase();
  }
  $('#wgun').addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); SND.unlock(); swapGun(); });

  /* pulled up between stages: anybody can call it */
  $('#wride').addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault(); SND.unlock();
    ctx.tx({t: 'next'}); ctx.buzz(20);
    $('#wride').style.display = 'none';
  });

  /* a flick of the wrist reloads: a quick spin the phone does not do just
     from somebody turning round to look */
  let flickT = 0;
  addEventListener('devicemotion', e => {
    const r = e.rotationRate;
    if(!r || !active) return;
    const w = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0);
    if(w > 560 && performance.now() > flickT){ flickT = performance.now() + 900; startReload(); }
  });

  /* Touches: a tap is a shot; holding keeps fanning the hammer. With no
     motion sensors, a finger drags the view and the FIRE button shoots. */
  const fingers = new Set();
  let looker = null;
  ui.addEventListener('pointerdown', e => {
    SND.unlock();
    if(e.target !== ui && e.target !== hud) return;
    ui.setPointerCapture(e.pointerId);
    if(ctx.isDrag()){ looker = {id: e.pointerId, x: e.clientX, y: e.clientY}; return; }
    fingers.add(e.pointerId);
    pull();
  });
  ui.addEventListener('pointermove', e => {
    if(looker && e.pointerId === looker.id){ ctx.look(e.clientX - looker.x, e.clientY - looker.y); looker.x = e.clientX; looker.y = e.clientY; }
  });
  const up_ = e => {
    if(looker && e.pointerId === looker.id) looker = null;
    if(fingers.delete(e.pointerId)) setFiring(fingers.size > 0);
  };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => ui.addEventListener(t, up_));
  const fb = $('#wfire');
  fb.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); fb.setPointerCapture(e.pointerId); fingers.add('fb'); pull(); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => fb.addEventListener(t, () => { fingers.delete('fb'); setFiring(fingers.size > 0); }));

  /* a fresh press: a shot now if the hammer is back */
  function pull(){
    held = 0;
    setFiring(true);
    // the shot goes on the press itself: a quick tap may be over before the next frame
    if(cd <= 0 && reloading <= 0 && ammo > 0 && (phase === 'wave' || phase === 'break')) shoot();
    if(ammo <= 0 && reloading <= 0 && (phase === 'wave' || phase === 'break')){ SND.sfx('dryfire'); ctx.callout('Empty! Flick the phone to reload'); }
  }
  function setFiring(f){ if(f === firing) return; firing = f; send(); }

  function keydown(e){
    if(e.target.tagName === 'INPUT') return false;
    if(e.code === 'Space'){ e.preventDefault(); if(!fingers.has('key')){ fingers.add('key'); pull(); } }
    if(e.code === 'KeyR') startReload();
    if(e.code === 'KeyQ' || e.code === 'KeyE') swapGun();
    if(e.code === 'Enter' && S && S.hold) ctx.tx({t: 'next'});
    return true;
  }
  function keyup(e){ if(e.code === 'Space'){ fingers.delete('key'); setFiring(fingers.size > 0); } }

  /* ---------- talking to the host ---------- */
  let sendT = 0;
  function send(){
    sendT = 0;
    // the host fires when this says the trigger is down; it is held down
    // just long enough for one shot on a tap
    ctx.tx({t: 'in', a: [+fwd.x.toFixed(3), +fwd.y.toFixed(3), +fwd.z.toFixed(3)], tg: aimTarget ? aimTarget.id : 0,
      f: false, sh: shots, rl: wantReload ? 1 : 0, w});
  }
  let shots = 0, lastShot = 0, hostAm = G().rounds;

  function onSnap(s){
    S = s;
    const was = phase;
    phase = s.ph;
    const mine = (s.pl || []).find(p => p.c === ctx.me());
    if(mine){
      x = mine.x; z = mine.z;
      // which gun: this phone's choice, unless the host has not had it for a while
      const hw = mine.w || 0;
      if(hw !== w && performance.now() - swapT > 800){ w = hw; trail.useGun(w); showGun(); }
      // the host's cylinder is the truth; this phone guesses between snapshots
      if(hw === w){
        hostAm = mine.am;
        if(reloading <= 0 && !mine.rl && mine.am !== ammo && performance.now() - lastShot > 450 && performance.now() - swapT > 450) ammo = mine.am;
        if(mine.rl && reloading <= 0){ reloading = G().reload * 0.5; trail.reloading(true); }
      }
      if(!mine.rl && wantReload && reloading <= 0) wantReload = false;
    }
    if(was !== phase && (phase === 'count' || phase === 'lobby')){ bag = GUNS.map(g => g.rounds); ammo = G().rounds; reloading = 0; dry = 0; trail.reloading(false); }
    // a stop between stages: every gun is loaded again
    if(was !== phase && phase === 'break'){ bag = GUNS.map(g => g.rounds); ammo = G().rounds; reloading = 0; dry = 0; trail.reloading(false); }
    $('#wride').style.display = s.hold ? 'flex' : 'none';
    trail.feed(s);
    const hp = Math.max(0, s.hp);
    $('#wbarIn').style.width = hp + '%';
    $('#wbarIn').classList.toggle('low', hp < 35);
    const st = STAGES[s.sg] || STAGES[0];
    $('#wstage').textContent = phase === 'wave' ? st.name.toUpperCase() + ' · ' + Math.round((s.dist || 0) / 1609 * 10) / 10 + ' MI' : '';
  }

  /* ---------- the events: sounds, words and buzzes ---------- */
  const at = (e) => e ? trail.centreOf(e) : null;
  const lastBoom = {};
  trail.onEvent = ev => {
    const k = ev[0];
    if(k === 'shot' && ev[1] !== ctx.me()){
      // a shotgun sends one of these per pellet: one bang for the lot
      const now = performance.now();
      if(!(ev[11] === 1 && now - (lastBoom[ev[1]] || 0) < 120)) SND.sfx(ev[11] === 1 ? 'shotgun' : 'revolver', new THREE.Vector3(ev[2], ev[3], ev[4]), 0.45);
      lastBoom[ev[1]] = now;
    }
    else if(k === 'headshot' && ev[2] === ctx.me()){
      const h = $('#whead');
      h.classList.add('on'); setTimeout(() => h.classList.remove('on'), 450);
      hits.push({t: performance.now(), kill: true, head: true});
      ctx.buzz([25, 30, 25]);
    }
    else if(k === 'rideon'){ $('#wride').style.display = 'none'; SND.sfx('yell', new THREE.Vector3(0, 1.5, -4), 0.6); }
    else if(k === 'hit' && ev[2] === ctx.me()) hits.push({t: performance.now()});
    else if(k === 'poof'){
      const p = new THREE.Vector3(ev[3], ev[4], ev[5]);
      SND.sfx(ev[2] === 'balloon' ? 'bigBlast' : ev[2] === 'dynamite' ? 'blast' : ev[2] === 'crate' ? 'pickup' : ev[2] === 'vulture' || ev[2] === 'bat' ? 'squawk' : 'yelp', p, ev[2] === 'dynamite' ? 0.5 : 0.8);
      if(ev[6] - 1 === ctx.me()){ ctx.buzz(20); hits.push({t: performance.now(), kill: true}); }
    } else if(k === 'bang'){
      const e = trail.foes.get(ev[1]);
      SND.sfx('enemyGun', at(e), 0.9);
      SND.sfx('ricochet', new THREE.Vector3((Math.random() - 0.5) * 2, BED + 0.5, (Math.random() - 0.5) * 3), 0.5);
    } else if(k === 'ouch'){
      ouches.push({t: performance.now(), x: ev[2], z: ev[3]});
      $('#wblood').style.opacity = Math.min(0.8, 0.25 + ev[1] / 12);
      setTimeout(() => { $('#wblood').style.opacity = 0; }, 140);
      ctx.buzz(ev[1] > 8 ? [60, 30, 60] : 35);
    } else if(k === 'toss'){
      SND.sfx('fuse', new THREE.Vector3(ev[1], ev[2], ev[3]));
      ctx.callout('DYNAMITE - ' + sideWords(ev[1], ev[3]).toUpperCase() + ' - shoot it!');
    } else if(k === 'blast'){ SND.sfx('blast', new THREE.Vector3(ev[1], ev[2], ev[3])); ctx.buzz([80, 40, 80]); }
    else if(k === 'aboard'){ ctx.callout('BANDIT ON THE WAGON - ' + (ev[2] < 0 ? 'LEFT' : 'RIGHT') + ' SIDE!'); SND.sfx('thump'); ctx.buzz([100, 50, 100]); }
    else if(k === 'swing'){ const e = trail.foes.get(ev[1]); if(e) ctx.callout('ROPE BANDIT - ' + sideWords(e.d.x, e.d.z).toUpperCase() + '!'); SND.sfx('yell', at(e)); }
    else if(k === 'dive'){ const e = trail.foes.get(ev[1]); if(e) SND.sfx('screech', at(e)); }
    else if(k === 'supplies'){ ctx.toast(ev[1] === ctx.me() ? 'Supplies! The wagon is patched up' : 'Supplies - the wagon is patched up'); SND.cue('pickup') || SND.sfx('pickup'); }
    else if(k === 'baron'){ SND.cue('baronwarn'); ctx.banner('THE BALLOON BARON', 'Shoot the balloon down before he blows up the gold'); }
    else if(k === 'crew'){ ctx.callout('His gang are swinging down on ropes!'); }
    else if(k === 'torn'){ ctx.toast(ev[1] === 1 ? 'The balloon is torn!' : 'It is going down - keep shooting!'); SND.sfx('rip'); }
    else if(k === 'barondown'){ ctx.banner('THE BARON IS DOWN!', ''); SND.cue('victory'); }
    else if(k === 'loaded' && ev[1] === ctx.me()){ ammo = G().rounds; reloading = 0; wantReload = false; trail.reloading(false); }
    if(ctx.onEvent) ctx.onEvent(ev);
  };

  /* the West makes itself heard */
  let noiseT = 1, hoofT = 0;
  function ambience(dt){
    if(phase === 'wave' || phase === 'break' || phase === 'count'){
      hoofT -= dt;
      if(hoofT <= 0){ hoofT = 0.26; SND.sfx('hoof', new THREE.Vector3(0, 0.5, -5.5), 0.22); }
    }
    noiseT -= dt;
    if(noiseT > 0 || !trail.foes.size) return;
    const list = [...trail.foes.values()];
    const e = list[Math.floor(Math.random() * list.length)];
    const s = {rider: 'hoof', cart: 'rattle', vulture: 'screech', bat: 'squeak', bandit: 'yell', thrower: 'yell', balloon: 'burner'}[e.type];
    if(s) SND.sfx(s, at(e), e.type === 'rider' ? 0.5 : 0.5);
    noiseT = 2 / Math.min(4, 0.5 + list.length * 0.3) * (0.6 + Math.random() * 0.8);
  }

  /* ---------- every frame ---------- */
  function frame(dt, now, viewQ){
    if(!active) return;
    fwd.set(0, 0, -1).applyQuaternion(viewQ);
    up.set(0, 1, 0).applyQuaternion(viewQ);
    trail.setView(viewQ, x, z, EYE);
    SND.listen(fwd, up);
    SND.listenAt(x, EYE, z);
    $('#wfire').style.display = ctx.isDrag() ? 'flex' : 'none';
    aimTarget = phase === 'lobby' ? null : trail.pick(fwd);
    cd = Math.max(0, cd - dt);
    if(reloading > 0){
      reloading -= dt;
      if(reloading <= 0){ reloading = 0; ammo = G().rounds; trail.reloading(false); SND.sfx('cock'); }
    } else if(ammo <= 0){
      dry += dt;
      if(dry > G().autoReload){ dry = 0; reloading = G().reload * 0.25; trail.reloading(true); SND.sfx('spin'); }
    }
    if(firing){
      held += dt;
      if(cd <= 0 && reloading <= 0 && ammo > 0 && (phase === 'wave' || phase === 'break')) shoot();
    }
    ambience(dt);
    sendT += dt;
    if(sendT >= 0.05) send();
    trail.render();
    drawHud(now);
    drawCylinder();
  }

  function shoot(){
    const W = G();
    cd = W.cool + (held > 0.25 ? HOLD_EXTRA[w] : 0.05);
    ammo--; dry = 0;
    shots = (shots + 1) % 1000;
    lastShot = performance.now();
    // what the host will work out, guessed here so the shot shows at once:
    // the revolver's one ball, the shotgun's spray
    const u = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize(), v = new THREE.Vector3().crossVectors(fwd, u).normalize();
    for(let i = 0; i < W.pellets; i++){
      const d = fwd.clone();
      const aimed = aimTarget && i === 0;
      if(!aimed){
        const r = W.spread * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
        d.addScaledVector(u, Math.cos(th) * r).addScaledVector(v, Math.sin(th) * r).normalize();
      }
      trail.localShot(d, aimed ? trail.centreOf(aimTarget) : null, i > 0);
    }
    SND.sfx(W.pellets > 1 ? 'shotgun' : 'revolver');
    ctx.buzz(W.pellets > 1 ? 25 : 10);
    send();
    if(ammo === 0) setTimeout(() => { if(ammo === 0 && reloading <= 0) ctx.callout('Empty! Flick the phone to reload'); }, 250);
  }

  /* the cylinder on the RELOAD button: six chambers, the loaded ones brass
     (the shotgun: its two shells, red) */
  function drawCylinder(){
    const g = cg, s = 128, c = s / 2;
    g.clearRect(0, 0, s, s);
    if(w === 1){
      const lift = reloading > 0 ? Math.sin(performance.now() / 90) * 6 : 0;
      for(let i = 0; i < 2; i++){
        const px = c + (i ? 22 : -22), full = reloading <= 0 && i < ammo;
        g.fillStyle = '#3a3c42'; g.beginPath(); g.arc(px, c + lift * (i ? 1 : -1), 24, 0, Math.PI * 2); g.fill();
        g.fillStyle = full ? '#c03020' : '#121214'; g.beginPath(); g.arc(px, c + lift * (i ? 1 : -1), 17, 0, Math.PI * 2); g.fill();
        if(full){ g.fillStyle = '#e0b040'; g.beginPath(); g.arc(px, c, 8, 0, Math.PI * 2); g.fill(); }
      }
      finishCylinder();
      return;
    }
    const spin = reloading > 0 ? performance.now() / 60 : 0;
    g.save(); g.translate(c, c); g.rotate(spin);
    g.fillStyle = '#5a5e66'; g.beginPath(); g.arc(0, 0, 54, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2a2c30'; g.lineWidth = 4; g.stroke();
    for(let i = 0; i < 6; i++){
      const a = i / 6 * Math.PI * 2 - Math.PI / 2, px = Math.cos(a) * 32, py = Math.sin(a) * 32;
      const full = reloading > 0 ? false : i < ammo;
      g.fillStyle = full ? '#e0b040' : '#1a1a1e';
      g.beginPath(); g.arc(px, py, 13, 0, Math.PI * 2); g.fill();
      if(full){ g.fillStyle = '#ffe8a0'; g.beginPath(); g.arc(px - 3, py - 3, 4, 0, Math.PI * 2); g.fill(); }
    }
    g.fillStyle = '#2a2c30'; g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill();
    g.restore();
    finishCylinder();
  }
  function finishCylinder(){
    $('#wreload').classList.toggle('empty', ammo <= 0 && reloading <= 0 && (phase === 'wave' || phase === 'break'));
    $('#wreload small').textContent = reloading > 0 ? 'LOADING' : ammo <= 0 ? 'EMPTY!' : 'RELOAD';
  }

  function drawHud(now){
    const W = innerWidth, H = innerHeight, g = hg, cx = W / 2, cy = H / 2;
    g.clearRect(0, 0, W, H);
    if(phase !== 'lobby'){
      for(const e of trail.foes.values()){
        if(e.type === 'tumble') continue;
        const c = trail.centreOf(e);
        const aiming = (e.st === 'aim' || e.st === 'up') && e.aux > 0.3 && e.type !== 'thrower';
        const urgent = e.type === 'dynamite' || e.st === 'aboard' || e.st === 'board' || e.st === 'dive' || e.st === 'peck' || e.st === 'swing' || aiming;
        const pr = trail.project(c);
        if(pr.on){
          if(urgent){
            g.strokeStyle = e.type === 'dynamite' ? '#ff3020' : '#ff6a3a'; g.lineWidth = 2.5;
            g.beginPath(); g.arc(pr.x, pr.y, 20 + Math.sin(now / 80) * 4, 0, Math.PI * 2); g.stroke();
          }
          if(e.type === 'balloon'){
            g.fillStyle = '#0008'; g.fillRect(pr.x - 40, pr.y - 90, 80, 6);
            g.fillStyle = '#ffd040'; g.fillRect(pr.x - 40, pr.y - 90, 80 * e.hp, 6);
          }
          if(e.type === 'crate'){ g.fillStyle = '#60ff80'; g.font = '800 11px system-ui'; g.textAlign = 'center'; g.fillText('SUPPLIES', pr.x, pr.y - 26); }
          continue;
        }
        // off screen: an arrow at the edge for anything coming for the wagon
        const near = Math.hypot(e.d.x, e.d.z) < 30 || e.type === 'balloon';
        if(!near && !urgent) continue;
        if(e.type === 'bandit' || e.type === 'thrower'){ if(e.st === 'hide' && !urgent) continue; }
        const sd = trail.screenDir(c);
        const a = Math.atan2(sd.y, sd.x);
        const ax = cx + Math.cos(a) * (W / 2 - 30), ay = cy + 30 + Math.sin(a) * (H / 2 - 80);
        const s = urgent ? 15 + 3 * Math.sin(now / 80) : 10;
        g.save(); g.translate(ax, ay); g.rotate(a);
        g.fillStyle = urgent ? '#ff2a1a' : FOE_COL[e.type] || '#fff'; g.shadowColor = g.fillStyle; g.shadowBlur = 8;
        g.beginPath(); g.moveTo(s, 0); g.lineTo(-s * 0.7, -s * 0.75); g.lineTo(-s * 0.35, 0); g.lineTo(-s * 0.7, s * 0.75); g.closePath(); g.fill();
        g.restore();
      }
    }
    // where the wagon was hit from
    for(let i = ouches.length - 1; i >= 0; i--){
      const o = ouches[i], k = (now - o.t) / 700;
      if(k >= 1){ ouches.splice(i, 1); continue; }
      const sd = trail.screenDir(_p.set(o.x, BED + 1, o.z));
      const a = Math.atan2(sd.y, sd.x);
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.strokeStyle = `rgba(255,50,30,${1 - k})`; g.lineWidth = 8;
      g.beginPath(); g.arc(0, 0, Math.min(W, H) * 0.32, -0.35, 0.35); g.stroke();
      g.restore();
    }
    // the sight: a revolver's notch and post
    const on = !!aimTarget;
    const col = on ? '#ff5a2a' : '#fff4e0';
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
    g.beginPath();
    for(const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){ g.moveTo(cx + dx * 7, cy + dy * 7); g.lineTo(cx + dx * 17, cy + dy * 17); }
    g.stroke();
    g.beginPath(); g.arc(cx, cy, 2.2, 0, Math.PI * 2); g.fill();
    if(on){ g.beginPath(); g.arc(cx, cy, 24, 0, Math.PI * 2); g.globalAlpha = 0.6; g.stroke(); g.globalAlpha = 1; }
    if(w === 1){
      // the shotgun's spread, roughly, on this screen
      const r = Math.max(30, trail.spreadPx ? trail.spreadPx(G().spread) : 60);
      g.globalAlpha = 0.45; g.setLineDash([5, 6]); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    }
    if(reloading > 0){
      g.strokeStyle = '#ffd890'; g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cy, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - reloading / G().reload)); g.stroke();
    }
    for(let i = hits.length - 1; i >= 0; i--){
      const k = (now - hits[i].t) / 250;
      if(k >= 1){ hits.splice(i, 1); continue; }
      g.strokeStyle = hits[i].kill ? `rgba(255,80,40,${1 - k})` : `rgba(255,255,255,${1 - k})`;
      g.lineWidth = hits[i].kill ? 3 : 2;
      g.beginPath();
      for(const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]){ g.moveTo(cx + dx * 9, cy + dy * 9); g.lineTo(cx + dx * 17, cy + dy * 17); }
      g.stroke();
    }
  }
  const _p = new THREE.Vector3();

  function setActive(on){
    active = on;
    canvas.style.display = ui.style.display = on ? '' : 'none';
    if(!on){ fingers.clear(); firing = false; }
  }
  function release(){ fingers.clear(); setFiring(false); }

  return {
    trail, frame, onSnap, send, keydown, keyup, setActive, release,
    setMe: c => trail.setMe(c),
    nameOf: type => ENEMIES[type] ? ENEMIES[type].name : type,
    get active(){ return active; },
    // for netcheck
    test: {
      state: () => ({x, z, ammo, reloading, phase, w, cd, hold: !!(S && S.hold), target: aimTarget ? aimTarget.id : 0,
        foes: [...trail.foes.values()].map(e => ({id: e.id, type: e.type, st: e.st, p: [e.d.x, e.d.y, e.d.z], c: trail.centreOf(e).toArray(), hit: trail.canHit(e)}))}),
      fire: on => { if(on){ fingers.add('test'); pull(); } else { fingers.delete('test'); setFiring(fingers.size > 0); } },
      reload: startReload,
      swap: swapGun,
      rideOn: () => $('#wride').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true})),
    },
  };
}
