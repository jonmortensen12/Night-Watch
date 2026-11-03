/* Night Watch - printed markers, on the phone.

   An option in Space and the Bunker (picked in the lobby; "Off" is the game
   as it always was, with LOCK FRONT). What it gives the game:

   - yaw(): how far round the motion sensors' world is from the room's, from
     whichever markers the camera sees. FRONT is -z, set once at setup by
     pointing at the TV. With it every phone faces the same way without
     LOCK FRONT, and a glance at any marker takes out the gyro's drift.
   - pos(): where the phone is in the room (the Bunker's "Walk the room"),
     or null when it is not known, when the stick takes over.

   The camera. In Space and the Bunker's "Face the same way" it is on only
   between waves (and in the lobby, and during setup): that is when you
   look round to square up, and it saves the battery for the fight. In
   "Walk the room" it is on all the time, at low resolution and 15 frames a
   second, looked at about eight times a second, and never shown.

   Setup, once per room, on any one phone: point at FRONT and tap; stand in
   the middle and turn slowly round until every marker is ticked (the
   survey also works out this camera's focal length); then, for walking,
   aim at the floor and tap to put down the corners of the bunker, and
   tidy them on a map. The result goes to the host, which keeps it and
   gives it to every phone that joins.

   A test camera (?sim=1, ./simcam.js) stands in for the real one in the
   checks. */
import {Detector} from './markers.js';
import {Survey, Locator, Focal, fenceLayout, boundaryProblem, insidePoly, mv, mul, tr, yawMat} from './room.js';

const DET_LONG = 640;           // the picture markers are looked for in, long side
const WALK_EVERY = 0.05;        // seconds between looks while walking (the camera gives 30 a second)
const FACE_EVERY = 0.05;        // ...and while squaring up between waves

export function createMarkerKit(ctx){
  // ctx: {sensorQ (THREE.Quaternion, live), rowMajor(q) -> 3x3, frontYaw() (the
  //       sensors' yaw of the phone's forward, for "point at FRONT"),
  //       send(L) (to the host), toast(msg), sim, simYaw, game: () => 'space'|'zombie'}
  const params = new URLSearchParams(location.search);
  const SIM = !!ctx.sim;
  let mode = 'off', phase = 'lobby', layout = null, locator = new Locator(null, {glide: 0.35, smooth: true});
  let src = null, det = null, focal = null, gray = null, detScale = 1, camOn = false, starting = null, simcam = null;
  const grabC = document.createElement('canvas'), grabG = grabC.getContext('2d', {willReadFrequently: true});
  let since = 0, lastDets = [], loc = {P: null, yaw: null, fix: 1e9, seen: []}, lastFix = -1e9, clock = 0;
  let setup = null;           // {step: 'front'|'survey'|'corners'|'map', survey, front, corners: []}
  let camError = '';

  /* ---------- the camera ---------- */
  async function camStart(){
    if(camOn || starting) return starting;
    starting = (async () => {
      try {
        if(SIM){
          if(!simcam){ const {createSimCam} = await import('./simcam.js'); simcam = createSimCam({sensorYaw: ctx.simYaw || 0}); }
          src = {el: simcam.canvas, vw: simcam.w, vh: simcam.h};
        } else {
          if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('No camera here (it needs https).');
          const stream = await navigator.mediaDevices.getUserMedia({audio: false,
            video: {facingMode: {ideal: 'environment'}, width: {ideal: 640}, height: {ideal: 480}, frameRate: {ideal: 30, max: 30}}});
          const v = document.createElement('video');
          v.playsInline = true; v.muted = true; v.setAttribute('playsinline', '');
          v.srcObject = stream;
          await v.play();
          src = {el: v, vw: v.videoWidth, vh: v.videoHeight, stream};
        }
        sizeCam();
        camOn = true; camError = '';
      } catch(e){
        camError = (e && e.message) || 'The camera was not allowed';
        camOn = false;
      }
      starting = null;
    })();
    return starting;
  }
  function camStop(){
    if(!camOn) return;
    camOn = false;
    if(src && src.stream) src.stream.getTracks().forEach(t => t.stop());
    if(src && !SIM) src = null;
  }
  function sizeCam(){
    const vw = src.el.videoWidth || src.vw, vh = src.el.videoHeight || src.vh;
    if(!vw || !vh) return;
    src.vw = vw; src.vh = vh;
    detScale = Math.min(1, DET_LONG / Math.max(vw, vh));
    const w = Math.round(vw * detScale), h = Math.round(vh * detScale);
    if(grabC.width === w && grabC.height === h && det) return;
    grabC.width = w; grabC.height = h;
    gray = new Uint8Array(w * h);
    if(det) det.resize(w, h); else det = new Detector(w, h);
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem('nwatch_focal') || 'null'); } catch(e){}
    if(!focal || focal.w !== w || focal.h !== h) focal = new Focal(w, h, SIM ? null : kept);
  }
  function grab(){
    grabG.drawImage(src.el, 0, 0, grabC.width, grabC.height);
    const d = grabG.getImageData(0, 0, grabC.width, grabC.height).data;
    for(let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return gray;
  }
  function keepFocal(){ if(!SIM && focal) try { localStorage.setItem('nwatch_focal', JSON.stringify(focal.keep())); } catch(e){} }

  /* Is the camera wanted right now? */
  function wanted(){
    if(setup) return true;
    if(mode === 'off' || !layout) return false;
    if(mode === 'walk') return true;
    return phase === 'lobby' || phase === 'count' || phase === 'break';
  }

  /* ---------- every frame ---------- */
  function frame(dt){
    clock += dt;
    if(SIM && simcam) simcam.sensor(ctx.sensorQ);
    const want = wanted();
    if(want && !camOn) camStart();
    else if(!want && camOn) camStop();
    let dets = null;
    if(camOn && src && det){
      if(src.el.videoWidth && (src.el.videoWidth !== src.vw || src.el.videoHeight !== src.vh)) sizeCam();
      since += dt;
      const every = setup ? 0 : mode === 'walk' ? WALK_EVERY : FACE_EVERY;
      if(since >= every){
        since = 0;
        if(SIM && simcam) simcam.render();        // the pretend camera draws only the frames looked at
        dets = det.detect(grab());
        if(!setup || setup.step !== 'survey') focal.add(dets);
        lastDets = dets;
      }
    }
    const cam = det ? {f: focal.f, cx: det.w / 2, cy: det.h / 2} : null;
    const Rs = ctx.rowMajor(ctx.sensorQ);
    if(setup && setup.step === 'survey'){
      if(dets){ setup.survey.add(dets, mul(yawMat(setup.front), Rs), cam); drawFound(); }
    } else if(layout && cam && (dets || camOn)){
      loc = locator.update(dets, Rs, cam, dt);
      if(dets && dets.length && loc.seen.length) lastFix = clock;
      if(locator.fSuggest && !focal.sure){ focal.set(focal.f * 0.5 + locator.fSuggest * 0.5); locator.fSuggest = null; }
    }
    if(setup) drawSetup();
  }

  /* ---------- what the game asks ---------- */
  function yaw(){ return mode !== 'off' && layout && locator.yaw != null ? locator.yaw : null; }
  function pos(){
    if(mode !== 'walk' || !layout || !layout.boundary || !locator.P || !camOn) return null;
    // somebody who has not seen a marker for a long while is not where we think
    return clock - lastFix < 20 ? (locator.out || locator.P) : null;
  }

  function setLayout(L){
    if(!L || !L.markers) return;
    const same = layout && JSON.stringify(layout.markers) === JSON.stringify(L.markers);
    layout = L;
    if(!same) locator = new Locator(L, {glide: 0.35, smooth: true});      // a new setup is a new frame
    else locator.setLayout(L);
    try { localStorage.setItem('nwatch_markers_layout', JSON.stringify(L)); } catch(e){}
  }

  /* ================= setup ================= */
  const ui = document.createElement('div');
  ui.id = 'mkui';
  ui.innerHTML = `
    <style>
      #mkui { position: fixed; inset: 0; z-index: 30; display: none; background: #000; color: #eef; font: 15px/1.35 system-ui, sans-serif; touch-action: none; user-select: none; -webkit-user-select: none; }
      #mkui.on { display: block; }
      #mkui canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      #mkui .panel { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 14px calc(16px + env(safe-area-inset-bottom)); background: linear-gradient(180deg, #05070f00, #05070fee 30%); }
      #mkui h2 { margin: 0 0 4px; font-size: 20px; }
      #mkui p { margin: 0 0 10px; color: #b8c6e0; font-size: 14px; }
      #mkui .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; min-height: 28px; }
      #mkui .chips span { padding: 4px 10px; border-radius: 14px; border: 1px solid #3a4c70; font-weight: 700; font-size: 13px; background: #0d1626; }
      #mkui .chips span.ok { border-color: #5cff8a; color: #5cff8a; }
      #mkui .row { display: flex; gap: 8px; }
      #mkui .row button { flex: 1; font: 700 16px system-ui; color: #fff; padding: 14px 8px; border-radius: 14px; border: 1px solid #3a4c70; background: #13203a; }
      #mkui .row button.go { background: linear-gradient(180deg, #2fb8ff, #1272d6); border-color: #6fd4ff; }
      #mkui .row button:disabled { opacity: 0.4; }
      #mkui .msg { color: #ffb35c; min-height: 1.3em; font-weight: 700; }
    </style>
    <canvas id="mkView"></canvas>
    <div class="panel">
      <h2 id="mkTitle"></h2>
      <p id="mkHelp"></p>
      <div class="chips" id="mkChips"></div>
      <div class="msg" id="mkMsg"></div>
      <div class="row" id="mkRow"></div>
    </div>`;
  document.body.appendChild(ui);
  const $ = id => ui.querySelector('#' + id);
  const view = $('mkView'), vg = view.getContext('2d');
  function sizeView(){ const d = Math.min(2, devicePixelRatio || 1); view.width = innerWidth * d; view.height = innerHeight * d; vg.setTransform(d, 0, 0, d, 0, 0); }
  sizeView(); addEventListener('resize', sizeView);

  function buttons(list){
    const row = $('mkRow');
    row.innerHTML = '';
    for(const [label, fn, go, id] of list){
      const b = document.createElement('button');
      b.textContent = label; if(go) b.className = 'go'; if(id) b.id = id;
      b.addEventListener('click', e => { e.stopPropagation(); fn(); });
      row.appendChild(b);
    }
  }
  function say(t){ $('mkMsg').textContent = t || ''; }

  function startSetup(walk){
    setup = {step: 'front', walk: !!walk, corners: [], front: 0};
    ui.classList.add('on');
    camStart();
    stepFront();
  }
  function closeSetup(){ setup = null; ui.classList.remove('on'); }

  function stepFront(){
    setup.step = 'front';
    $('mkTitle').textContent = '1. Point at FRONT';
    $('mkHelp').textContent = 'Point the phone at the TV - or whatever you all call the front - and tap LOCK.';
    $('mkChips').innerHTML = '';
    say(camError);
    buttons([['CANCEL', closeSetup], ['LOCK FRONT', () => { setup.front = ctx.frontYaw(); stepSurvey(); }, true]]);
  }
  function stepSurvey(){
    setup.step = 'survey';
    setup.survey = new Survey();
    $('mkTitle').textContent = '2. Turn round';
    $('mkHelp').textContent = 'Stand in the middle of the room and turn slowly all the way round, pointing at every marker until it is ticked.';
    say('');
    foundKey = '';
    buttons([['CANCEL', closeSetup], [setup.walk ? 'NEXT' : 'DONE', finishSurvey, true, 'mkNext']]);
    drawFound();
  }
  let foundKey = '';
  function drawFound(){
    if(!setup || !setup.survey) return;
    const list = setup.survey.list();
    const key = list.map(m => m.id + (m.ok ? '+' : '-')).join(',');
    if(key === foundKey) return;
    foundKey = key;
    const c = $('mkChips');
    c.innerHTML = '';
    for(const m of list){ const s = document.createElement('span'); s.className = m.ok ? 'ok' : ''; s.textContent = (m.id + 1) + (m.ok ? ' ✓' : ''); c.appendChild(s); }
    if(!list.length) c.innerHTML = '<span>none yet</span>';
    const nb = $('mkNext');
    if(nb) nb.disabled = list.filter(m => m.ok).length < 2;
  }
  function finishSurvey(){
    const L = setup.survey.buildMarkers({f: focal.f, cx: det.w / 2, cy: det.h / 2});
    if(Object.keys(L.markers).length < 2){ say('Find at least two markers'); return; }
    if(L.f){ focal.set(L.f, true); delete L.f; keepFocal(); }
    // this phone's sensors, turned to FRONT, are the room's frame
    layout = L;
    locator = new Locator(L, {yaw: setup.front, glide: 0.35, smooth: true});
    if(!setup.walk){ ctx.send(L); try { localStorage.setItem('nwatch_markers_layout', JSON.stringify(L)); } catch(e){} ctx.toast(Object.keys(L.markers).length + ' markers - all set'); closeSetup(); return; }
    stepCorners();
  }

  /* --- the corners of the bunker, aimed at on the floor --- */
  function aimPoint(){
    if(!locator.P || locator.yaw == null) return null;
    const R = mul(yawMat(locator.yaw), ctx.rowMajor(ctx.sensorQ));
    const d = mv(R, [0, 0, -1]), P = locator.P;
    if(d[1] > -0.15) return null;               // not pointing down at the floor
    const t = -P[1] / d[1];
    if(t > 8) return null;
    return [P[0] + d[0] * t, P[2] + d[2] * t];
  }
  function stepCorners(){
    setup.step = 'corners';
    $('mkTitle').textContent = '3. The corners of your bunker';
    $('mkHelp').textContent = 'Aim the cross at the floor and tap CORNER, going round the space you want to play in. Keep inside the furniture. Glance at a marker now and then.';
    $('mkChips').innerHTML = '';
    buttons([['UNDO', () => { setup.corners.pop(); }], ['MAP', stepMap], ['CORNER', putCorner, true, 'mkCorner'], ['DONE', finishCorners, false, 'mkDone']]);
  }
  function putCorner(){
    const p = aimPoint();
    if(!p){ say(locator.P ? 'Aim at the floor' : 'Look at a marker first, so the phone knows where it is'); return; }
    if(clock - lastFix > 10){ say('Glance at a marker first - it has been a while'); return; }
    setup.corners.push(p);
    if(ctx.buzz) ctx.buzz(15);
    say('');
  }
  function finishCorners(){
    const why = boundaryProblem(setup.corners);
    if(why){ say(why); return; }
    const L = fenceLayout(layout, setup.corners);
    layout = L;
    locator.setLayout(L);
    ctx.send(L);
    try { localStorage.setItem('nwatch_markers_layout', JSON.stringify(L)); } catch(e){}
    ctx.toast('Bunker set: ' + L.portals.length + ' fence sections');
    closeSetup();
  }

  /* --- the map: drag a corner, tap the + on a side to add one --- */
  let drag = -1, mapT = null;
  function stepMap(){
    setup.step = 'map';
    $('mkTitle').textContent = 'The bunker, from above';
    $('mkHelp').textContent = 'Drag a corner to move it. Tap a + to add one, tap a corner twice to remove it. Numbers are the markers; the arrow is you.';
    say('');
    buttons([['BACK', stepCorners], ['DONE', finishCorners, true]]);
  }
  function mapXf(){
    const pts = setup.corners.slice();
    for(const id in layout.markers){ const p = layout.markers[id].p; pts.push([p[0], p[2]]); }
    if(locator.P) pts.push([locator.P[0], locator.P[2]]);
    if(!pts.length) pts.push([0, 0]);
    let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), z0 = Math.min(...pts.map(p => p[1])), z1 = Math.max(...pts.map(p => p[1]));
    const W = innerWidth, H = innerHeight * 0.66, pad = 40;
    const k = Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, z1 - z0));
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    return {to: p => [W / 2 + (p[0] - cx) * k, pad + H / 2 - pad + (p[1] - cz) * k], from: (sx, sy) => [cx + (sx - W / 2) / k, cz + (sy - (pad + H / 2 - pad)) / k]};
  }
  view.addEventListener('pointerdown', e => {
    if(!setup || setup.step !== 'map') return;
    const X = mapXf(), C = setup.corners;
    for(let i = 0; i < C.length; i++){
      const s = X.to(C[i]);
      if(Math.hypot(s[0] - e.clientX, s[1] - e.clientY) < 26){
        const now = performance.now();
        if(mapT && mapT.i === i && now - mapT.t < 400 && C.length > 3){ C.splice(i, 1); mapT = null; return; }
        mapT = {i, t: now}; drag = i; view.setPointerCapture(e.pointerId); return;
      }
    }
    for(let i = 0; i < C.length; i++){
      const a = X.to(C[i]), b = X.to(C[(i + 1) % C.length]);
      if(Math.hypot((a[0] + b[0]) / 2 - e.clientX, (a[1] + b[1]) / 2 - e.clientY) < 22){
        C.splice(i + 1, 0, X.from((a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
        drag = i + 1; view.setPointerCapture(e.pointerId); return;
      }
    }
  });
  view.addEventListener('pointermove', e => { if(drag >= 0 && setup) setup.corners[drag] = mapXf().from(e.clientX, e.clientY); });
  ['pointerup', 'pointercancel'].forEach(t => view.addEventListener(t, () => { drag = -1; }));

  /* --- drawing the setup screens --- */
  function toScreen(X){
    // a room point onto the camera picture, as the picture is shown
    if(!locator.P || locator.yaw == null || !src || !det) return null;
    const R = mul(yawMat(locator.yaw), ctx.rowMajor(ctx.sensorQ));
    const c = mv(tr(R), [X[0] - locator.P[0], X[1] - locator.P[1], X[2] - locator.P[2]]);
    if(c[2] > -0.05) return null;
    const u = det.w / 2 + focal.f * c[0] / -c[2], v = det.h / 2 - focal.f * c[1] / -c[2];
    const W = innerWidth, H = innerHeight, s = Math.max(W / src.vw, H / src.vh);
    return [u / detScale * s - (src.vw * s - W) / 2, v / detScale * s - (src.vh * s - H) / 2];
  }
  function drawSetup(){
    const W = innerWidth, H = innerHeight, g = vg;
    g.fillStyle = '#05070f'; g.fillRect(0, 0, W, H);
    if(setup.step === 'map') return drawMap();
    if(camOn && src){
      if(SIM && simcam && since > 0) simcam.render();
      const s = Math.max(W / src.vw, H / src.vh);
      try { g.drawImage(src.el, (W - src.vw * s) / 2, (H - src.vh * s) / 2, src.vw * s, src.vh * s); } catch(e){}
      const k = s / detScale, ox = (src.vw * s - W) / 2, oy = (src.vh * s - H) / 2;
      for(const d of lastDets){
        const ok = setup.step === 'survey' ? setup.survey.placed(d.id) : true;
        g.strokeStyle = ok ? '#5cff8a' : '#ffb35c'; g.lineWidth = 3;
        g.beginPath(); d.c.forEach((p, i) => { const x = p[0] * k - ox, y = p[1] * k - oy; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke();
        g.fillStyle = g.strokeStyle; g.font = '800 16px system-ui'; g.textAlign = 'center';
        g.fillText(String(d.id + 1) + (ok && setup.step === 'survey' ? ' ✓' : ''), d.ctr[0] * k - ox, d.ctr[1] * k - oy + 6);
      }
    } else {
      g.fillStyle = '#fff'; g.font = '700 16px system-ui'; g.textAlign = 'center';
      g.fillText(camError || 'Starting the camera...', W / 2, H / 3);
    }
    if(setup.step === 'front'){
      g.strokeStyle = '#7fe0ff'; g.lineWidth = 2; g.setLineDash([8, 8]);
      g.beginPath(); g.arc(W / 2, H / 2, 60, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }
    if(setup.step === 'corners'){
      // the bunker so far, on the real floor
      const C = setup.corners, aim = aimPoint();
      const pts = C.map(p => toScreen([p[0], 0, p[1]]));
      g.strokeStyle = '#4dd0ff'; g.lineWidth = 4; g.shadowColor = '#4dd0ff'; g.shadowBlur = 12;
      for(let i = 0; i + 1 < C.length; i++) line(pts[i], pts[i + 1]);
      if(aim && C.length){
        const a = toScreen([aim[0], 0, aim[1]]);
        g.setLineDash([10, 8]); line(pts[C.length - 1], a);
        if(C.length >= 2) line(a, pts[0]);
        g.setLineDash([]);
      }
      g.shadowBlur = 0;
      for(const p of pts) if(p){ g.fillStyle = '#4dd0ff'; g.beginPath(); g.arc(p[0], p[1], 8, 0, Math.PI * 2); g.fill(); }
      // where the cross is on the floor
      if(aim){
        g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath();
        for(let i = 0; i <= 24; i++){ const a = i / 24 * Math.PI * 2, q = toScreen([aim[0] + Math.cos(a) * 0.2, 0, aim[1] + Math.sin(a) * 0.2]); if(q) i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }
        g.stroke();
      }
      g.strokeStyle = aim ? '#fff' : '#ffffff66'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(W / 2 - 16, H / 2); g.lineTo(W / 2 + 16, H / 2); g.moveTo(W / 2, H / 2 - 16); g.lineTo(W / 2, H / 2 + 16); g.stroke();
      const old = clock - lastFix;
      $('mkChips').textContent = C.length + (C.length === 1 ? ' corner' : ' corners') + (loc.seen.length ? ' · seeing marker ' + loc.seen.map(i => i + 1).join(', ') : old < 1e8 ? ' · last saw a marker ' + Math.round(old) + ' s ago' : ' · look at a marker');
      const cb = $('mkCorner'), db = $('mkDone');
      if(cb) cb.disabled = !aim;
      if(db) db.disabled = C.length < 3;
    }
    function line(a, b){ if(!a || !b) return; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
  }
  function drawMap(){
    const g = vg, X = mapXf(), C = setup.corners;
    g.strokeStyle = '#1c2a44'; g.lineWidth = 1;
    // a metre grid
    const a = X.from(0, 0), b = X.from(innerWidth, innerHeight * 0.66);
    for(let x = Math.floor(a[0]); x <= b[0]; x++){ const p = X.to([x, 0]); g.beginPath(); g.moveTo(p[0], 0); g.lineTo(p[0], innerHeight * 0.66); g.stroke(); }
    for(let z = Math.floor(a[1]); z <= b[1]; z++){ const p = X.to([0, z]); g.beginPath(); g.moveTo(0, p[1]); g.lineTo(innerWidth, p[1]); g.stroke(); }
    const why = boundaryProblem(C);
    g.fillStyle = why ? '#ff4d6a22' : '#4dd0ff22'; g.strokeStyle = why ? '#ff4d6a' : '#4dd0ff'; g.lineWidth = 3;
    g.beginPath(); C.forEach((p, i) => { const s = X.to(p); i ? g.lineTo(s[0], s[1]) : g.moveTo(s[0], s[1]); }); if(C.length > 2) g.closePath(); g.fill(); g.stroke();
    for(let i = 0; i < C.length; i++){
      const s = X.to(C[i]), n = X.to(C[(i + 1) % C.length]);
      g.fillStyle = '#4dd0ff'; g.beginPath(); g.arc(s[0], s[1], 11, 0, Math.PI * 2); g.fill();
      if(C.length > 1){ g.fillStyle = '#ffffffaa'; g.font = '800 18px system-ui'; g.textAlign = 'center'; g.fillText('+', (s[0] + n[0]) / 2, (s[1] + n[1]) / 2 + 6); }
    }
    for(const id in layout.markers){
      const p = layout.markers[id].p, s = X.to([p[0], p[2]]);
      g.fillStyle = '#ffb35c'; g.fillRect(s[0] - 7, s[1] - 7, 14, 14);
      g.fillStyle = '#000'; g.font = '800 11px system-ui'; g.textAlign = 'center'; g.fillText(String(+id + 1), s[0], s[1] + 4);
    }
    if(locator.P){
      const s = X.to([locator.P[0], locator.P[2]]);
      const R = mul(yawMat(locator.yaw || 0), ctx.rowMajor(ctx.sensorQ)), f = mv(R, [0, 0, -1]), a2 = Math.atan2(f[2], f[0]);
      g.save(); g.translate(s[0], s[1]); g.rotate(a2); g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(14, 0); g.lineTo(-8, -8); g.lineTo(-8, 8); g.closePath(); g.fill(); g.restore();
    }
    g.fillStyle = '#7fe0ff'; g.font = '800 14px system-ui'; g.textAlign = 'center';
    g.fillText('▲ FRONT', innerWidth / 2, 24);
    say(why || '');
  }

  // the room set up before, on this phone, until the host says otherwise
  try { const L = JSON.parse(localStorage.getItem('nwatch_markers_layout') || 'null'); if(L && L.markers) setLayout(L); } catch(e){}

  return {
    frame, yaw, pos, setLayout, startSetup,
    setMode(m){ mode = m === 'walk' || m === 'face' ? m : 'off'; },
    setPhase(p){ phase = p; },
    get mode(){ return mode; }, get layout(){ return layout; }, get busy(){ return !!setup; },
    get camOn(){ return camOn; }, get error(){ return camError; },
    seen: () => loc.seen,
    // for the checks
    test: {
      sim: () => simcam, setup: () => setup, locator: () => locator, focal: () => focal && {f: focal.f / detScale, sure: focal.sure},
      lock: () => { setup.front = ctx.frontYaw(); stepSurvey(); }, next: () => finishSurvey(), corner: () => putCorner(),
      done: () => finishCorners(), map: () => stepMap(), aim: aimPoint, insidePoly,
    },
  };
}
