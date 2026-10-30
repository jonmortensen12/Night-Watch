/* Night Watch: Bunker - the phone, in zombie mode.

   play.html owns joining, the lobby, the results and where the phone is
   pointing (its sensors, LOCK FRONT, drag-to-look). This is everything else
   once a bunker game is running: the stick that walks you about, the guns,
   the scope, REPAIR, the minimap and the overlay.

   Walking is relative to where the phone points: push the stick up and you
   walk the way you are looking. The phone is trusted with its own position
   (no lag on your own feet); the host is told twenty times a second. */
import * as THREE from 'three';
import {Yard} from './yard.js';
import {WEAPONS, MONSTERS, SECTIONS, ROOM, EYE, MOVE_SPEED, REPAIR_REACH, COLORS, toSection, sideWords} from './zsim.js';

const ICON = ['🔫', '💥', '🎯'];
const MON_COL = {pumpkin: '#ff9a2a', skeleton: '#f0ead8', ghost: '#8ad0ff', brute: '#7cff6b', bat: '#c070ff', witch: '#9cff40', bomb: '#ffb030'};

export function createZombiePhone(ctx){
  // ctx: {tx(msg), SND, banner, toast, callout, buzz, look(dx, dy), isDrag(), me: () => colour}
  const SND = ctx.SND;
  const canvas = document.createElement('canvas');
  canvas.id = 'zview';
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;z-index:1';
  document.body.insertBefore(canvas, document.body.firstChild.nextSibling);
  const low = /[?&]q=low/.test(location.search);
  const yard = new Yard(canvas, {mode: 'phone', low});

  /* ---------- the overlay ---------- */
  const ui = document.createElement('div');
  ui.id = 'zui';
  ui.innerHTML = `
    <style>
      #zui { position: fixed; inset: 0; z-index: 3; touch-action: none; }
      #zui .zb { position: fixed; z-index: 6; font: 700 13px system-ui; color: #fff; background: #0b1424cc; border: 1px solid #3a4c70; border-radius: 14px; padding: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; }
      #zguns { position: fixed; left: 12px; top: calc(100px + env(safe-area-inset-top)); display: flex; flex-direction: column; gap: 6px; z-index: 6; }
      #zui #zguns button { position: static; width: 70px; height: 46px; font-size: 10px; letter-spacing: 0.04em; }
      #zguns button b { font-size: 18px; line-height: 1; }
      #zui #zguns button.sel { background: #ff8a20dd; border-color: #ffd090; box-shadow: 0 0 14px #ff8a20; }
      #zui #zzoom { right: 14px; top: 46%; width: 66px; height: 66px; border-radius: 50%; font-size: 11px; display: none; }
      #zui #zzoom.on { background: #3aa0ffdd; border-color: #a0d8ff; }
      #zui #zrep { left: 50%; transform: translateX(-50%); bottom: calc(26px + env(safe-area-inset-bottom)); width: 190px; height: 64px; display: none; background: #2a8a3add; border-color: #8affa0; font-size: 14px; }
      #zui #zrep.held { background: #4cff7add; color: #062; }
      #zrep small { font-size: 11px; font-weight: 600; opacity: 0.9; }
      #zui #zfire { right: 16px; bottom: calc(24px + env(safe-area-inset-bottom)); width: 92px; height: 92px; border-radius: 50%; background: #ff6a3dcc; font-size: 15px; display: none; }
      #zmap { position: fixed; left: auto; bottom: auto; right: 10px; top: calc(100px + env(safe-area-inset-top)); width: 116px; height: 116px; z-index: 5; pointer-events: none; border-radius: 12px; background: #050a14aa; border: 1px solid #2c4470; }
      #zhud { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 4; }
      #zstickHint { position: fixed; left: 18px; bottom: calc(30px + env(safe-area-inset-bottom)); z-index: 4; color: #ffffff55; font: 700 11px system-ui; letter-spacing: 0.1em; pointer-events: none; }
    </style>
    <canvas id="zhud"></canvas>
    <div id="zstickHint">◀ MOVE ▶</div>
    <div id="zguns">${WEAPONS.map((w, i) => `<button class="zb" data-w="${i}"><b>${ICON[i]}</b>${w.name.toUpperCase()}</button>`).join('')}</div>
    <button class="zb" id="zzoom">🔭<br>ZOOM</button>
    <button class="zb" id="zrep">🔨 HOLD TO REPAIR<small></small></button>
    <button class="zb" id="zfire">FIRE</button>
    <canvas id="zmap" width="232" height="232"></canvas>`;
  document.body.appendChild(ui);
  const $ = s => ui.querySelector(s);
  const hud = $('#zhud'), hg = hud.getContext('2d');
  function sizeHud(){ const d = Math.min(2, devicePixelRatio || 1); hud.width = innerWidth * d; hud.height = innerHeight * d; hg.setTransform(d, 0, 0, d, 0, 0); }
  sizeHud(); addEventListener('resize', sizeHud);
  const mg = $('#zmap').getContext('2d');

  /* ---------- this player ---------- */
  let x = 0, z = 0, w = 0, zoom = false, repairing = false, firing = false, cd = 0, phase = 'lobby', S = null;
  let stick = null, stickV = {x: 0, y: 0}, keys = {};
  const fwd = new THREE.Vector3(), up = new THREE.Vector3();
  let aimTarget = null, nearSec = -1, placed = false, active = true, hammerT = 0;
  const hits = [];     // hit markers

  function setWeapon(i){
    if(i === w || i < 0 || i >= WEAPONS.length) return;
    w = i; cd = Math.max(cd, 0.35);
    if(WEAPONS[w].key !== 'sniper') setZoom(false);
    yard.setWeapon(w);
    SND.sfx('click');
    paintGuns();
    send();
  }
  function paintGuns(){
    ui.querySelectorAll('#zguns button').forEach(b => b.classList.toggle('sel', +b.dataset.w === w));
    $('#zzoom').style.display = WEAPONS[w].key === 'sniper' ? 'flex' : 'none';
  }
  function setZoom(on){
    zoom = on && WEAPONS[w].key === 'sniper';
    yard.setZoom(zoom);
    $('#zzoom').classList.toggle('on', zoom);
  }
  paintGuns();
  ui.querySelectorAll('#zguns button').forEach(b => b.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); SND.unlock(); setWeapon(+b.dataset.w); }));
  $('#zzoom').addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); setZoom(!zoom); SND.sfx('click'); send(); });
  const rep = $('#zrep');
  rep.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); rep.setPointerCapture(e.pointerId); setRepair(true); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => rep.addEventListener(t, () => setRepair(false)));
  function setRepair(on){ if(on === repairing) return; repairing = on; rep.classList.toggle('held', on); if(on) setZoom(false); send(); }
  const fb = $('#zfire');
  fb.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); fb.setPointerCapture(e.pointerId); fingers.add('fb'); setFiring(true); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => fb.addEventListener(t, () => { fingers.delete('fb'); setFiring(fingers.size > 0); }));

  /* Touches on the screen: lower left is the stick; anywhere else fires
     (or, with no motion sensors, drags the view). */
  const fingers = new Set();
  let looker = null;
  function inStickZone(cx, cy){ return cx < innerWidth * 0.45 && cy > innerHeight * 0.45; }
  ui.addEventListener('pointerdown', e => {
    SND.unlock();
    if(e.target !== ui && e.target !== hud) return;
    ui.setPointerCapture(e.pointerId);
    if(!stick && inStickZone(e.clientX, e.clientY)){
      stick = {id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY};
      return;
    }
    if(ctx.isDrag()){ looker = {id: e.pointerId, x: e.clientX, y: e.clientY}; return; }
    fingers.add(e.pointerId);
    setFiring(true);
  });
  ui.addEventListener('pointermove', e => {
    if(stick && e.pointerId === stick.id){
      stick.x = e.clientX; stick.y = e.clientY;
      const dx = stick.x - stick.x0, dy = stick.y - stick.y0, l = Math.hypot(dx, dy), R = 55;
      const k = l > R ? R / l : 1;
      stickV = {x: dx * k / R, y: dy * k / R};
    } else if(looker && e.pointerId === looker.id){
      ctx.look(e.clientX - looker.x, e.clientY - looker.y);
      looker.x = e.clientX; looker.y = e.clientY;
    }
  });
  const up_ = e => {
    if(stick && e.pointerId === stick.id){ stick = null; stickV = {x: 0, y: 0}; }
    if(looker && e.pointerId === looker.id) looker = null;
    if(fingers.delete(e.pointerId)) setFiring(fingers.size > 0);
  };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => ui.addEventListener(t, up_));

  function setFiring(f){ if(f === firing) return; firing = f; send(); }

  function keydown(e){
    if(e.target.tagName === 'INPUT') return false;
    keys[e.code] = true;
    if(e.code === 'Space'){ e.preventDefault(); fingers.add('key'); setFiring(true); }
    if(e.code === 'Digit1') setWeapon(0);
    if(e.code === 'Digit2') setWeapon(1);
    if(e.code === 'Digit3') setWeapon(2);
    if(e.code === 'KeyZ' || e.code === 'KeyE') { setZoom(!zoom); send(); }
    if(e.code === 'KeyR') setRepair(true);
    return true;
  }
  function keyup(e){
    keys[e.code] = false;
    if(e.code === 'Space'){ fingers.delete('key'); setFiring(fingers.size > 0); }
    if(e.code === 'KeyR') setRepair(false);
  }

  /* ---------- talking to the host ---------- */
  let sendT = 0;
  function send(){
    sendT = 0;
    ctx.tx({t: 'in', a: [+fwd.x.toFixed(3), +fwd.y.toFixed(3), +fwd.z.toFixed(3)], tg: aimTarget ? aimTarget.id : 0,
      f: firing && !repairing, w, x: +x.toFixed(2), z: +z.toFixed(2), r: repairing && nearSec >= 0, zm: zoom});
  }

  let lastSecs = null;
  function onSnap(s){
    S = s;
    const was = phase;
    phase = s.ph;
    const mine = (s.pl || []).find(p => p.c === ctx.me());
    // the host places us at the start of a game; after that we walk ourselves
    if(mine && (!placed || (was !== 'count' && phase === 'count') || phase === 'lobby')){ x = mine.x; z = mine.z; placed = true; }
    yard.feed(s);
    lastSecs = s.sec;
  }

  /* ---------- the events: sounds, words and buzzes ---------- */
  const thudT = new Array(8).fill(0);
  yard.onEvent = ev => {
    const k = ev[0];
    const secPos = i => new THREE.Vector3(SECTIONS[i].mid[0], 1, SECTIONS[i].mid[1]);
    if(k === 'shot' && ev[1] !== ctx.me()) SND.sfx(['pistol', 'shotgun', 'sniper'][ev[2]], new THREE.Vector3(ev[3], ev[4], ev[5]), 0.5);
    else if(k === 'hit' && ev[2] === ctx.me()){ hits.push({t: performance.now()}); }
    else if(k === 'poof'){
      SND.sfx(ev[2] === 'witch' ? 'bigPoof' : 'poof', new THREE.Vector3(ev[3], ev[4], ev[5]));
      if(ev[6] - 1 === ctx.me()){ ctx.buzz(20); hits.push({t: performance.now(), kill: true}); }
    } else if(k === 'weak'){ ctx.callout(SECTIONS[ev[1]].name.toUpperCase() + ' wall is weak - repair it!'); SND.sfx('crack', secPos(ev[1]), 0.6); }
    else if(k === 'broken'){
      ctx.banner(SECTIONS[ev[1]].name.toUpperCase() + ' BROKEN', 'Fix it or hold them off!');
      SND.sfx('crack', secPos(ev[1])); ctx.buzz([60, 40, 60]);
    } else if(k === 'climb'){
      ctx.callout('CLIMBING IN - ' + SECTIONS[ev[2]].name.toUpperCase() + '!');
      SND.sfx('alarm', secPos(ev[2]));
      ctx.buzz([100, 50, 100]);
    } else if(k === 'fixed'){ ctx.toast(SECTIONS[ev[1]].name + ' wall fixed'); }
    else if(k === 'bomb'){ ctx.callout('PUMPKIN BOMB - ' + SECTIONS[ev[1]].name + ' - shoot it!'); SND.sfx('whistle', secPos(ev[1])); }
    else if(k === 'blast'){ SND.sfx('blast', new THREE.Vector3(ev[1], 0.5, ev[2])); ctx.buzz(60); }
    else if(k === 'witch'){ SND.cue('witchwarn'); SND.sfx('cackle'); ctx.banner('THE WITCH', 'Shoot her down before she bombs the walls'); }
    else if(k === 'summon'){ ctx.callout('She is raising skeletons - ' + sideWords(ev[1], ev[2])); SND.sfx('cackle', new THREE.Vector3(ev[1], 6, ev[2])); }
    else if(k === 'witchdown'){ ctx.banner('THE WITCH IS DOWN', ''); SND.cue('victory'); }
    if(ctx.onEvent) ctx.onEvent(ev);
  };

  /* monsters make themselves heard, from where they are */
  let moanT = 1;
  function ambience(dt){
    moanT -= dt;
    if(moanT > 0 || !yard.mons.size) return;
    const list = [...yard.mons.values()];
    const e = list[Math.floor(Math.random() * list.length)];
    const s = {pumpkin: 'groan', brute: 'groan', skeleton: 'rattle', ghost: 'boo', bat: 'squeak', witch: 'cackle'}[e.type];
    if(s) SND.sfx(s, e.d, e.type === 'brute' ? 1.2 : 0.8, e.type === 'brute' ? 0.6 : 1);
    moanT = 2.2 / Math.min(4, 0.5 + list.length * 0.3) * (0.6 + Math.random() * 0.8);
    // the fence taking blows
    if(S && S.hit) S.hit.forEach((h, i) => {
      if(h && performance.now() > thudT[i]){ thudT[i] = performance.now() + 450; SND.sfx('thud', new THREE.Vector3(SECTIONS[i].mid[0], 0.8, SECTIONS[i].mid[1]), 0.8); }
    });
  }

  /* ---------- every frame ---------- */
  function frame(dt, now, viewQ){
    if(!active) return;
    fwd.set(0, 0, -1).applyQuaternion(viewQ);
    up.set(0, 1, 0).applyQuaternion(viewQ);
    // walking: the stick (or WASD), relative to where the phone points
    let mx = stickV.x, my = stickV.y;
    if(keys.KeyW || keys.ArrowUp) my = -1;
    if(keys.KeyS || keys.ArrowDown) my = 1;
    if(keys.KeyA || keys.ArrowLeft) mx = -1;
    if(keys.KeyD || keys.ArrowRight) mx = 1;
    const fl = Math.hypot(fwd.x, fwd.z) || 1, fx = fwd.x / fl, fz = fwd.z / fl;
    const canMove = phase !== 'over' && !repairing;
    const speed = MOVE_SPEED * (zoom ? 0.35 : 1);
    if(canMove && (mx || my)){
      const ml = Math.min(1, Math.hypot(mx, my));
      const vx = fx * -my + -fz * mx, vz = fz * -my + fx * mx, vl = Math.hypot(vx, vz) || 1;
      x = Math.max(-ROOM, Math.min(ROOM, x + vx / vl * speed * ml * dt));
      z = Math.max(-ROOM, Math.min(ROOM, z + vz / vl * speed * ml * dt));
    }
    yard.setView(viewQ, x, z);
    SND.listen(fwd, up);
    SND.listenAt(x, EYE, z);
    // the section within reach that needs work
    nearSec = -1;
    let bd = REPAIR_REACH;
    if(lastSecs) SECTIONS.forEach((s, i) => { const d = toSection(s, x, z).d; if(d < bd && lastSecs[i] < 100){ bd = d; nearSec = i; } });
    const showRep = nearSec >= 0 && (phase === 'wave' || phase === 'break');
    rep.style.display = showRep ? 'flex' : 'none';
    if(showRep){
      const hp = lastSecs[nearSec];
      rep.querySelector('small').textContent = SECTIONS[nearSec].name + ' · ' + (hp < 0 ? 'broken' : Math.round(hp) + '%');
    } else if(repairing) setRepair(false);
    $('#zfire').style.display = ctx.isDrag() ? 'flex' : 'none';
    // the guns
    aimTarget = phase === 'lobby' ? null : yard.pick(fwd, w);
    cd = Math.max(0, cd - dt);
    if(firing && !repairing && cd <= 0 && (phase === 'wave' || phase === 'break')) shoot();
    ambience(dt);
    if(repairing && nearSec >= 0){
      hammerT -= dt;
      if(hammerT <= 0){ hammerT = 0.32; SND.sfx('hammer', new THREE.Vector3(SECTIONS[nearSec].mid[0], 0.8, SECTIONS[nearSec].mid[1])); ctx.buzz(10); }
    }
    sendT += dt;
    if(sendT >= 0.05) send();
    yard.render();
    drawHud(now);
    drawMap();
  }

  function shoot(){
    const W = WEAPONS[w];
    cd = W.cool;
    const dirs = [], pts = [];
    for(let k = 0; k < W.pellets; k++){
      let d = fwd.clone();
      const sp = W.key === 'sniper' && zoom ? 0 : W.spread;
      if(sp && !(W.pellets === 1 && aimTarget)){
        const r = sp * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
        const u = new THREE.Vector3(-d.z, 0, d.x).normalize(), v = new THREE.Vector3().crossVectors(d, u).normalize();
        d.addScaledVector(u, Math.cos(th) * r).addScaledVector(v, Math.sin(th) * r).normalize();
      }
      dirs.push(d);
      const e = W.pellets === 1 && aimTarget ? aimTarget : yard.pick(d, w);
      pts.push(e ? yard.centreOf(e) : null);
    }
    yard.localShot(w, dirs, pts);
    SND.sfx(W.key);
    ctx.buzz(W.key === 'pistol' ? 8 : 18);
  }

  /* ---------- the overlay ---------- */
  function drawHud(now){
    const W = innerWidth, H = innerHeight, g = hg, cx = W / 2, cy = H / 2;
    g.clearRect(0, 0, W, H);
    // the stick
    if(stick){
      g.globalAlpha = 0.5; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(stick.x0, stick.y0, 55, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ffffffaa'; g.beginPath(); g.arc(stick.x0 + stickV.x * 55, stick.y0 + stickV.y * 55, 22, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
    if(phase !== 'lobby'){
      // arrows to trouble that is off screen: anything at the fence, ghosts, bombs, the witch
      for(const e of yard.mons.values()){
        const c = yard.centreOf(e);
        const urgent = e.st === 2 || e.type === 'bomb' || (e.type === 'ghost' && Math.hypot(e.d.x, e.d.z) < 12);
        const atFence = e.st === 1 || urgent || e.type === 'witch';
        const pr = yard.project(c);
        if(pr.on){
          if(e.st === 2 || e.type === 'bomb'){
            g.strokeStyle = '#ff2a3a'; g.lineWidth = 2.5;
            g.beginPath(); g.arc(pr.x, pr.y, 22 + Math.sin(now / 90) * 4, 0, Math.PI * 2); g.stroke();
          }
          if(e.type === 'witch' || e.type === 'brute'){
            g.fillStyle = '#0008'; g.fillRect(pr.x - 24, pr.y - 50, 48, 5);
            g.fillStyle = MON_COL[e.type]; g.fillRect(pr.x - 24, pr.y - 50, 48 * e.hp, 5);
          }
          continue;
        }
        if(!atFence) continue;
        const sd = yard.screenDir(c);
        const a = Math.atan2(sd.y, sd.x);
        const ax = cx + Math.cos(a) * (W / 2 - 30), ay = cy + 30 + Math.sin(a) * (H / 2 - 70);
        const s = urgent ? 15 + 3 * Math.sin(now / 80) : 10;
        g.save(); g.translate(ax, ay); g.rotate(a);
        g.fillStyle = urgent ? '#ff2a3a' : MON_COL[e.type]; g.shadowColor = g.fillStyle; g.shadowBlur = 8;
        g.beginPath(); g.moveTo(s, 0); g.lineTo(-s * 0.7, -s * 0.75); g.lineTo(-s * 0.35, 0); g.lineTo(-s * 0.7, s * 0.75); g.closePath(); g.fill();
        g.restore();
      }
    }
    // the sight
    const on = !!aimTarget;
    const col = on ? '#ff6a3d' : '#f4f8ff';
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
    if(zoom){
      // a scope: dark round the edge, fine cross in the middle
      const r = Math.min(W, H) * 0.46;
      g.fillStyle = 'rgba(0,0,0,0.92)';
      g.beginPath(); g.rect(0, 0, W, H); g.arc(cx, cy, r, 0, Math.PI * 2, true); g.fill();
      g.strokeStyle = '#000'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = on ? '#ff3a2a' : '#101010'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx - 6, cy); g.moveTo(cx + 6, cy); g.lineTo(cx + r, cy);
      g.moveTo(cx, cy - r); g.lineTo(cx, cy - 6); g.moveTo(cx, cy + 6); g.lineTo(cx, cy + r); g.stroke();
      g.fillStyle = '#ff3a2a'; g.beginPath(); g.arc(cx, cy, 2, 0, Math.PI * 2); g.fill();
    } else if(w === 1){
      const r = Math.tan(WEAPONS[1].spread) / Math.tan(yard.cam.fov * Math.PI / 360) * H / 2;
      g.globalAlpha = 0.85;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(cx, cy, 2.5, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    } else {
      const gap = w === 2 ? 10 : 7;
      g.beginPath();
      for(const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){ g.moveTo(cx + dx * gap, cy + dy * gap); g.lineTo(cx + dx * (gap + 12), cy + dy * (gap + 12)); }
      g.stroke();
      g.beginPath(); g.arc(cx, cy, 2, 0, Math.PI * 2); g.fill();
    }
    // reloading: how long until this gun is ready
    if(cd > 0 && WEAPONS[w].cool > 0.5){
      g.strokeStyle = '#ffffffaa'; g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cy, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - cd / WEAPONS[w].cool)); g.stroke();
    }
    // hit markers
    for(let i = hits.length - 1; i >= 0; i--){
      const k = (now - hits[i].t) / 250;
      if(k >= 1){ hits.splice(i, 1); continue; }
      g.strokeStyle = hits[i].kill ? `rgba(255,80,60,${1 - k})` : `rgba(255,255,255,${1 - k})`;
      g.lineWidth = hits[i].kill ? 3 : 2;
      g.beginPath();
      for(const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]){ g.moveTo(cx + dx * 9, cy + dy * 9); g.lineTo(cx + dx * 17, cy + dy * 17); }
      g.stroke();
    }
  }

  /* The bunker from above, FRONT at the top (as the TV shows it). */
  function drawMap(){
    const g = mg, N = 232, c = N / 2, R = 13, k = (N / 2 - 8) / R;
    g.clearRect(0, 0, N, N);
    const P = (px, pz) => [c + px * k, c + pz * k];
    // monsters
    for(const e of yard.mons.values()){
      let px = e.d.x, pz = e.d.z;
      const l = Math.hypot(px, pz);
      const edge = l > R;
      if(edge){ px *= R / l; pz *= R / l; }
      const [sx, sy] = P(px, pz);
      g.fillStyle = MON_COL[e.type] || '#f44';
      g.globalAlpha = edge ? 0.5 : 1;
      g.beginPath(); g.arc(sx, sy, e.type === 'witch' ? 8 : e.type === 'brute' ? 6 : e.type === 'bat' ? 3 : 4.5, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // the sections
    if(lastSecs) SECTIONS.forEach((s, i) => {
      const hp = lastSecs[i];
      const [ax, ay] = P(s.a[0], s.a[1]), [bx, by] = P(s.b[0], s.b[1]);
      g.strokeStyle = hp < 0 ? (Math.floor(performance.now() / 250) % 2 ? '#ff2030' : '#400') : hp > 60 ? '#4cff7a' : hp > 30 ? '#ffd23a' : '#ff4a3a';
      g.lineWidth = 7;
      g.beginPath(); g.moveTo(ax + (bx - ax) * 0.06, ay + (by - ay) * 0.06); g.lineTo(bx - (bx - ax) * 0.06, by - (by - ay) * 0.06); g.stroke();
    });
    // everybody
    for(const p of (S && S.pl) || []){
      if(p.aw) continue;
      const mine = p.c === ctx.me();
      const [sx, sy] = P(mine ? x : p.x, mine ? z : p.z);
      if(mine){
        const a = Math.atan2(fwd.x, fwd.z);
        g.fillStyle = '#ffffff30';
        g.beginPath(); g.moveTo(sx, sy); g.arc(sx, sy, 40, Math.PI / 2 - a - 0.5, Math.PI / 2 - a + 0.5); g.closePath(); g.fill();
      }
      g.fillStyle = COLORS[p.c]; g.strokeStyle = '#000'; g.lineWidth = 2;
      g.beginPath(); g.arc(sx, sy, mine ? 7 : 6, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.fillStyle = '#7fe0ff'; g.font = '800 18px system-ui'; g.textAlign = 'center';
    g.fillText('FRONT', c, 18);
  }

  function setActive(on){
    active = on;
    canvas.style.display = ui.style.display = on ? '' : 'none';
    if(!on){ fingers.clear(); firing = false; stick = null; stickV = {x: 0, y: 0}; setRepair(false); setZoom(false); }
  }
  function release(){ fingers.clear(); setFiring(false); setRepair(false); stick = null; stickV = {x: 0, y: 0}; }

  return {
    yard, frame, onSnap, send, keydown, keyup, setActive, release,
    get active(){ return active; },
    // for netcheck
    test: {
      state: () => ({x, z, w, zoom, repairing, nearSec, target: aimTarget ? aimTarget.id : 0, phase,
        mons: [...yard.mons.values()].map(e => ({id: e.id, type: e.type, st: e.st, p: [e.d.x, e.d.y, e.d.z], c: yard.centreOf(e).toArray()})), secs: lastSecs}),
      moveTo(nx, nz){ x = nx; z = nz; },
      weapon: setWeapon, zoom: on => { setZoom(on); send(); }, repair: setRepair,
      fire: on => { if(on) fingers.add('test'); else fingers.delete('test'); setFiring(fingers.size > 0); },
    },
  };
}
