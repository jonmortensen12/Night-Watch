/* Night Watch - sound.

   The music is recorded instruments rendered offline (tools/music.py, the
   same FluidR3 pipeline as Mission Control) and played from web/music/.
   The effects are synthesised here, the moment they happen.

   On a phone the effects are placed in 3D around the player and turn with
   the phone, so with headphones (or just the stereo speakers on a phone
   held sideways) an explosion behind you sounds behind you. That is half
   of finding things.

   A browser keeps a page silent until somebody touches that device, and an
   iPad mutes web audio on its silent switch unless the page says it plays
   media - both learned on Mission Control. */
let AC = null, master = null, sfxBus = null, comp = null;
const MUSIC = {man: null, bufs: {}, loading: {}, cur: null, gain: null, want: null, duckUntil: 0, on: true, vol: 0.85};
let noiseBuf = null;

export function soundOn(){ return !!AC && AC.state === 'running'; }

export function unlock(){
  try { if(navigator.audioSession) navigator.audioSession.type = 'playback'; } catch(e){}
  if(!AC){
    const C = window.AudioContext || window.webkitAudioContext;
    if(!C) return;
    AC = new C();
    comp = AC.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master = AC.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(AC.destination);
    sfxBus = AC.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
    const n = AC.sampleRate * 1.5;
    noiseBuf = AC.createBuffer(1, n, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for(let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    fetch('music/music.json').then(r => r.json()).then(m => { MUSIC.man = m; }).catch(() => {});
  }
  if(AC.state !== 'running') AC.resume();
  // iOS: a sound started inside the touch is what wakes it
  try { const b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource(); s.buffer = b; s.connect(AC.destination); s.start(0); } catch(e){}
}

export function setMuted(m){ if(master) master.gain.setTargetAtTime(m ? 0 : 0.9, AC.currentTime, 0.05); }

/* The listener turns with the phone. */
export function listen(fwd, up){
  if(!AC) return;
  const L = AC.listener, t = AC.currentTime;
  if(L.forwardX){
    L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t);
    L.upX.setValueAtTime(up.x, t); L.upY.setValueAtTime(up.y, t); L.upZ.setValueAtTime(up.z, t);
  } else if(L.setOrientation) L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
}

/* Where the listener stands (zombie mode walks about; space stays at the origin). */
export function listenAt(x, y, z){
  if(!AC) return;
  const L = AC.listener, t = AC.currentTime;
  if(L.positionX){ L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t); }
  else if(L.setPosition) L.setPosition(x, y, z);
}

/* Where an effect plays from: a panner when given a position, else straight to the bus. */
let refDist = 20;
/* Zombie mode is in metres and close up: sounds fall off sooner. */
export function setScale(metres){ refDist = metres ? 3 : 20; }
function out(pos, gain){
  const g = AC.createGain();
  g.gain.value = Number.isFinite(gain) ? gain : 0;
  if(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)){
    const p = AC.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = refDist; p.rolloffFactor = 0.6; p.maxDistance = 400;
    // positions are scaled into the panner's idea of nearness
    if(p.positionX){ p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    g.connect(p); p.connect(sfxBus);
  } else g.connect(sfxBus);
  return g;
}

function noise(t, dur, dest, filterType, f0, f1, q){
  const s = AC.createBufferSource();
  s.buffer = noiseBuf;
  const f = AC.createBiquadFilter();
  f.type = filterType; f.frequency.setValueAtTime(f0, t);
  if(f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  f.Q.value = q || 1;
  s.connect(f); f.connect(dest);
  s.start(t, Math.random()); s.stop(t + dur + 0.05);
  return s;
}

function tone(t, type, f0, f1, dur, dest, vol){
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if(f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
}

/* key, optional position {x,y,z} relative to the listener, optional volume */
export function sfx(key, pos, vol, pitch){
  if(!soundOn()) return;
  const t = AC.currentTime, v = vol == null ? 1 : vol, pk = pitch || 1;
  switch(key){
    case 'pistol': {
      const d = out(pos, 0.5 * v);
      noise(t, 0.12, d, 'bandpass', 2400, 600, 0.8);
      tone(t, 'square', 320, 70, 0.08, d, 0.6);
      break;
    }
    case 'shotgun': {
      const d = out(pos, 0.8 * v);
      noise(t, 0.45, d, 'lowpass', 3000, 200, 0.7);
      tone(t, 'sine', 110, 40, 0.3, d, 1);
      // the pump
      noise(t + 0.38, 0.05, d, 'highpass', 2500, 0, 2);
      noise(t + 0.5, 0.05, d, 'highpass', 1800, 0, 2);
      break;
    }
    case 'sniper': {
      const d = out(pos, 0.8 * v);
      noise(t, 0.08, d, 'highpass', 1500, 0, 0.7);
      tone(t, 'square', 900, 100, 0.06, d, 0.6);
      // the crack rolling away across the field
      noise(t + 0.05, 1.3, d, 'lowpass', 1200, 120, 0.6);
      noise(t + 0.25, 0.8, d, 'bandpass', 500, 200, 1.5);
      break;
    }
    case 'poof':
    case 'bigPoof': {
      const big = key === 'bigPoof';
      const d = out(pos, (big ? 0.9 : 0.5) * v);
      noise(t, big ? 1.2 : 0.45, d, 'bandpass', 900, 3500, 1.2);
      tone(t, 'sine', 300, 900, 0.18, d, 0.4);
      [1568, 2093, 2637].forEach((f, i) => tone(t + 0.05 + i * 0.05, 'triangle', f, f, 0.15, d, 0.25));
      if(big) tone(t, 'sine', 90, 40, 1, d, 1);
      break;
    }
    case 'groan': {
      const d = out(pos, 0.5 * v);
      const o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
      o.type = 'sawtooth';
      const f0 = (90 + Math.random() * 40) * pk;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.linearRampToValueAtTime(f0 * 1.15, t + 0.4);
      o.frequency.linearRampToValueAtTime(f0 * 0.8, t + 1.1);
      f.type = 'bandpass'; f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(800, t + 0.5); f.frequency.linearRampToValueAtTime(350, t + 1.1); f.Q.value = 3;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(f); f.connect(g); g.connect(d); o.start(t); o.stop(t + 1.3);
      break;
    }
    case 'rattle': {
      const d = out(pos, 0.45 * v);
      for(let i = 0; i < 9; i++) noise(t + i * 0.045 + Math.random() * 0.02, 0.03, d, 'bandpass', 2500 + Math.random() * 2000, 0, 6);
      break;
    }
    case 'boo': {
      const d = out(pos, 0.4 * v);
      const o = AC.createOscillator(), lfo = AC.createOscillator(), lg = AC.createGain(), g = AC.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(330, t); o.frequency.linearRampToValueAtTime(420, t + 0.6); o.frequency.linearRampToValueAtTime(260, t + 1.6);
      lfo.frequency.value = 6; lg.gain.value = 12; lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
      o.connect(g); g.connect(d); o.start(t); lfo.start(t); o.stop(t + 1.8); lfo.stop(t + 1.8);
      break;
    }
    case 'squeak': {
      const d = out(pos, 0.25 * v);
      for(let i = 0; i < 3; i++) tone(t + i * 0.09, 'sine', 4200 + Math.random() * 1500, 3000, 0.05, d, 0.5);
      break;
    }
    case 'cackle': {
      const d = out(pos, 0.5 * v);
      for(let i = 0; i < 6; i++){
        const f = 700 - i * 40 + Math.random() * 60;
        tone(t + i * 0.13, 'sawtooth', f * 1.3, f, 0.1, d, 0.35);
        noise(t + i * 0.13, 0.08, d, 'bandpass', 2000, 0, 3);
      }
      break;
    }
    case 'thud': {
      const d = out(pos, 0.5 * v);
      tone(t, 'sine', 120, 50, 0.18, d, 0.9);
      noise(t, 0.1, d, 'lowpass', 700, 200, 1);
      break;
    }
    case 'crack': {
      const d = out(pos, 0.8 * v);
      noise(t, 0.25, d, 'bandpass', 1800, 400, 1.5);
      noise(t + 0.06, 0.4, d, 'lowpass', 900, 150, 1);
      tone(t, 'square', 200, 60, 0.2, d, 0.3);
      break;
    }
    case 'hammer': {
      const d = out(pos, 0.35 * v);
      tone(t, 'triangle', 1800, 900, 0.05, d, 0.6);
      noise(t, 0.04, d, 'bandpass', 3000, 0, 3);
      break;
    }
    case 'alarm': {
      const d = out(pos, 0.45 * v);
      for(let i = 0; i < 3; i++) tone(t + i * 0.2, 'square', 880, 660, 0.16, d, 0.5);
      break;
    }
    case 'whistle': {
      const d = out(pos, 0.35 * v);
      tone(t, 'sine', 2200, 600, 2.2, d, 0.4);
      break;
    }
    case 'blast': {
      const d = out(pos, 0.9 * v);
      noise(t, 1.2, d, 'lowpass', 2500, 80, 0.7);
      tone(t, 'sine', 80, 30, 0.8, d, 1);
      break;
    }
    case 'laser': {
      const d = out(pos, 0.16 * v);
      tone(t, 'sawtooth', 1500 + Math.random() * 200, 220, 0.12, d, 0.8);
      tone(t, 'square', 900, 120, 0.09, d, 0.3);
      break;
    }
    case 'laserFar': {
      const d = out(pos, 0.07 * v);
      tone(t, 'sawtooth', 1200 + Math.random() * 300, 260, 0.1, d, 0.6);
      break;
    }
    case 'enemyShot': {
      const d = out(pos, 0.22 * v);
      tone(t, 'square', 420, 160, 0.22, d, 0.5);
      noise(t, 0.12, d, 'bandpass', 2000, 600, 2);
      break;
    }
    case 'hit': {
      const d = out(pos, 0.25 * v);
      tone(t, 'triangle', 2400, 1200, 0.05, d, 0.6);
      noise(t, 0.05, d, 'highpass', 3000, 0, 1);
      break;
    }
    case 'boom':
    case 'bigBoom': {
      const big = key === 'bigBoom';
      const d = out(pos, (big ? 0.9 : 0.55) * v);
      const n = noise(t, big ? 2.2 : 1.0, d, 'lowpass', big ? 2400 : 3200, 90, 0.7);
      const g = AC.createGain();
      tone(t, 'sine', big ? 90 : 130, 30, big ? 1.2 : 0.5, d, 0.9);
      void n; void g;
      break;
    }
    case 'hull': {
      const d = out(pos, 0.6 * v);
      tone(t, 'sine', 70, 35, 0.4, d, 1);
      noise(t, 0.35, d, 'lowpass', 900, 120, 1);
      noise(t, 0.2, d, 'bandpass', 3500, 1500, 4);
      break;
    }
    case 'torpedo': {
      // a warning that comes from where the torpedo is
      const d = out(pos, 0.3 * v);
      for(let i = 0; i < 3; i++) tone(t + i * 0.16, 'square', 1320, 1320, 0.1, d, 0.5);
      break;
    }
    case 'lock': {
      const d = out(null, 0.12 * v);
      tone(t, 'sine', 1760, 1760, 0.06, d, 0.6);
      tone(t + 0.07, 'sine', 2350, 2350, 0.09, d, 0.6);
      break;
    }
    case 'missile': {
      const d = out(pos, 0.35 * v);
      noise(t, 0.7, d, 'bandpass', 600, 3000, 2);
      tone(t, 'sawtooth', 200, 900, 0.5, d, 0.2);
      break;
    }
    case 'hot': {
      const d = out(null, 0.25 * v);
      noise(t, 0.5, d, 'highpass', 4000, 1500, 1);
      tone(t, 'square', 220, 110, 0.3, d, 0.3);
      break;
    }
    case 'pickup': {
      const d = out(null, 0.25 * v);
      [1047, 1319, 1568, 2093].forEach((f, i) => tone(t + i * 0.06, 'triangle', f, f, 0.25, d, 0.5));
      break;
    }
    case 'click': {
      const d = out(null, 0.12 * v);
      tone(t, 'triangle', 900, 600, 0.05, d, 0.6);
      break;
    }
    case 'shieldDown': {
      const d = out(pos, 0.6 * v);
      noise(t, 1.2, d, 'bandpass', 4000, 300, 3);
      tone(t, 'sawtooth', 600, 60, 1.0, d, 0.4);
      break;
    }
  }
}

/* ---------- music ---------- */
function musicBuf(key){
  const m = MUSIC.man;
  if(!m) return null;
  const e = (m.themes && m.themes[key]) || (m.loops && m.loops[key]) || (m.cues && m.cues[key]);
  if(!e) return null;
  if(MUSIC.bufs[key]) return MUSIC.bufs[key];
  if(!soundOn() || MUSIC.loading[key]) return null;
  MUSIC.loading[key] = true;
  fetch('music/' + e.file).then(r => r.arrayBuffer()).then(data =>
    AC.decodeAudioData(data, buf => { MUSIC.bufs[key] = buf; }, () => { MUSIC.loading[key] = false; })
  ).catch(() => { MUSIC.loading[key] = false; });
  return null;
}

export function musicThemes(mode){
  const m = MUSIC.man;
  return m && m.themes ? Object.entries(m.themes).filter(([k, t]) => (t.mode || 'space') === (mode || 'space'))
    .map(([k, t]) => ({key: k, title: t.title, blurb: t.blurb})) : [];
}
export function musicCredit(){ return MUSIC.man ? MUSIC.man.credit : ''; }
export function setMusic(on){ MUSIC.on = on; }
export function musicEnabled(){ return MUSIC.on; }

/* Called every frame with the piece that ought to be playing (or null). */
export function music(want){
  if(!soundOn() || !MUSIC.man) return;
  if(!MUSIC.gain){ MUSIC.gain = AC.createGain(); MUSIC.gain.gain.value = MUSIC.vol; MUSIC.gain.connect(master); }
  if(!MUSIC.on) want = null;
  if(want) musicBuf(want);
  // load the rest quietly, one at a time
  const busy = Object.keys(MUSIC.loading).some(k => MUSIC.loading[k] && !MUSIC.bufs[k]);
  if(!busy){
    const all = Object.keys(MUSIC.man.loops || {}).concat(Object.keys(MUSIC.man.cues || {}), Object.keys(MUSIC.man.themes || {}));
    const next = all.find(k => !MUSIC.bufs[k] && !MUSIC.loading[k]);
    if(next) musicBuf(next);
  }
  const now = AC.currentTime;
  if((MUSIC.cur && MUSIC.cur.key) !== want){
    const buf = want && MUSIC.bufs[want];
    if(!want || buf){
      if(MUSIC.cur){
        const old = MUSIC.cur;
        old.g.gain.setTargetAtTime(0, now, 0.4);
        setTimeout(() => { try { old.src.stop(); } catch(e){} }, 2500);
      }
      MUSIC.cur = null;
      if(buf){
        const m = MUSIC.man, e = m.themes[want] || m.loops[want];
        const src = AC.createBufferSource(), g = AC.createGain();
        src.buffer = buf; src.loop = true; src.loopStart = e.loopStart; src.loopEnd = e.loopEnd;
        g.gain.setValueAtTime(0, now); g.gain.setTargetAtTime(1, now, 0.5);
        src.connect(g); g.connect(MUSIC.gain); src.start(now, e.loopStart);
        MUSIC.cur = {key: want, src, g};
      }
    }
  }
  const duck = performance.now() < MUSIC.duckUntil ? 0.35 : 1;
  MUSIC.gain.gain.setTargetAtTime(MUSIC.vol * duck, now, 0.15);
}

/* A short recorded cue over the music; quietly nothing if it has not loaded. */
export function cue(key, vol){
  if(!soundOn() || !MUSIC.on) return false;
  const buf = MUSIC.bufs[key] || (musicBuf(key), null);
  if(!buf) return false;
  const s = AC.createBufferSource(), g = AC.createGain();
  s.buffer = buf; g.gain.value = vol == null ? 0.9 : vol;
  s.connect(g); g.connect(master); s.start();
  if(buf.duration > 2.5) MUSIC.duckUntil = Math.max(MUSIC.duckUntil, performance.now() + buf.duration * 700);
  return true;
}
