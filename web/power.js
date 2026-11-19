/* Night Watch - not cooking the phone.

   A phone drawing 3D flat out gets hot and flat. Three things here keep it
   cooler, for all three games' renderers (world.js, yard.js, trail.js):

   - Resolution: a phone draws at 1.5x its CSS pixels at most (2x on a TV),
     never the 3x some phones report. Each renderer still drops lower by
     itself when frames run slow (adapt), judged against the frame rate it
     is meant to keep, so a deliberate 30 fps cap is not mistaken for a slow
     phone.
   - Frame rate: play.html draws at most 60 frames a second (some phones
     would do 120), 20 while a menu covers the screen, and 30 in saver mode.
   - Battery saver (the lobby's switch, remembered on the phone): 30 fps,
     1x resolution and no bloom glow.

   The TV page never saves: it is plugged in. */
const KEY = 'nwatch_saver';
function recall(){ try { return localStorage.getItem(KEY) === '1'; } catch(e){ return false; } }

export const POWER = {saver: recall(), renderers: new Set()};

/* Called by each renderer once it is built: r has renderer, composer, low, tv, dpr, resize(). */
export function powered(r){
  r._bloom = r.composer;
  r.budget = 1 / 60;
  POWER.renderers.add(r);
  apply(r);
}
function apply(r){
  const saver = POWER.saver && !r.tv;
  r.maxDpr = Math.min(window.devicePixelRatio || 1, r.low ? 1.25 : saver ? 1 : r.tv ? 2 : 1.5);
  if(r.dpr > r.maxDpr || saver) r.dpr = r.maxDpr;
  r.composer = saver ? null : r._bloom;
  r.resize();
}
export function setSaver(on){
  POWER.saver = !!on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch(e){}
  POWER.renderers.forEach(apply);
}
/* The frame rate the phone page aims for: menus need little, the saver less. */
export function fpsFor(menu){ return menu ? 20 : POWER.saver ? 30 : 60; }
export function setBudget(fps){ POWER.renderers.forEach(r => { r.budget = 1 / fps; }); }

/* A renderer's own quality step, every so many frames: slower than its
   budget allows - draw fewer pixels (and, last of all, drop the bloom);
   comfortably faster - more, up to its cap. */
export function adaptDpr(r, dt){
  r.frameTimes.push(dt);
  if(r.frameTimes.length < 60) return;
  const avg = r.frameTimes.reduce((a, b) => a + b, 0) / r.frameTimes.length;
  r.frameTimes.length = 0;
  const b = r.budget || 1 / 60;
  if(avg > b * 1.45 && r.dpr > 1){ r.dpr = Math.max(1, r.dpr - 0.25); r.resize(); }
  else if(avg > b * 1.8 && r.dpr <= 1 && r.composer) r.composer = null;
  else if(avg < b * 0.85 && r.dpr < r.maxDpr){ r.dpr = Math.min(r.maxDpr, r.dpr + 0.25); r.resize(); }
}
