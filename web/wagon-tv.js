/* Night Watch: Wagon - the TV, in the cowboy game.

   tv.html owns the room, the lobby, the scoreboard and the results; this is
   the wagon seen from behind and above, everybody on the bench in their
   seats, with the words and sounds that tell the room where the trouble is. */
import * as THREE from 'three';
import {Trail} from './trail.js';
import {STAGES, COLORS, sideWords, BED} from './wsim.js';

export function createWagonTV(ctx){
  // ctx: {SND, banner, call, players: () => snapshot players, onEvent}
  const SND = ctx.SND;
  const canvas = document.createElement('canvas');
  canvas.id = 'wview';
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  document.body.insertBefore(canvas, document.body.firstChild);
  const trail = new Trail(canvas, {mode: 'tv', low: /[?&]q=low/.test(location.search)});
  let active = true, S = null;
  const who = c => (ctx.players() || []).find(p => p.c === c);

  trail.onEvent = ev => {
    const k = ev[0];
    if(k === 'shot'){ if(Math.random() < 0.6) SND.sfx('revolver', null, 0.18); }
    else if(k === 'poof') SND.sfx(ev[2] === 'balloon' ? 'bigBlast' : ev[2] === 'dynamite' ? 'blast' : ev[2] === 'vulture' || ev[2] === 'bat' ? 'squawk' : ev[2] === 'crate' ? 'pickup' : 'yelp', null, 0.35);
    else if(k === 'bang') SND.sfx('enemyGun', null, 0.25);
    else if(k === 'toss'){ ctx.call('Dynamite - ' + sideWords(ev[1], ev[3]), '#ff5030'); SND.sfx('fuse', null, 0.4); }
    else if(k === 'blast') SND.sfx('blast', null, 0.7);
    else if(k === 'aboard') ctx.call('Bandit on the wagon - ' + (ev[2] < 0 ? 'left' : 'right') + ' side!', '#ff3a2a');
    else if(k === 'swing'){ const e = trail.foes.get(ev[1]); ctx.call('Rope bandit' + (e ? ' - ' + sideWords(e.d.x, e.d.z) : ''), '#ff8a50'); }
    else if(k === 'supplies'){ const p = who(ev[1]); ctx.call((p ? p.n + ' shot the supply crate' : 'Supplies') + ' - the wagon is patched up', p ? COLORS[p.c] : '#60ff80'); SND.sfx('pickup', null, 0.5); }
    else if(k === 'baron'){ SND.cue('baronwarn'); ctx.banner('THE BALLOON BARON', 'Shoot the balloon down before he blows up the gold'); }
    else if(k === 'crew') ctx.call('The Baron\'s gang are swinging down on ropes', '#ffb040');
    else if(k === 'barondown'){ const p = who(ev[1]); ctx.banner('THE BARON IS DOWN!', p ? 'Final shot: ' + p.n : ''); SND.cue('victory'); }
    if(ctx.onEvent) ctx.onEvent(ev);
  };

  let hoofT = 0;
  function frame(dt){
    if(!active) return;
    if(S && (S.ph === 'wave' || S.ph === 'break' || S.ph === 'count')){
      hoofT -= dt;
      if(hoofT <= 0){ hoofT = 0.26; SND.sfx('hoof', null, 0.12); }
    }
    trail.render();
  }

  /* the stage's name, and a ring round anything on the wagon or in the air at it */
  function drawHud(g, W, H){
    if(!S) return;
    for(const e of trail.foes.values()){
      const urgent = e.type === 'dynamite' || e.st === 'aboard' || e.st === 'board' || e.st === 'dive' || e.st === 'peck' || e.st === 'swing';
      if(!urgent && e.type !== 'balloon') continue;
      const p = trail.project(trail.centreOf(e));
      if(!p.on) continue;
      if(e.type === 'balloon'){
        g.fillStyle = '#0008'; g.fillRect(p.x - 70, p.y - 110, 140, 8);
        g.fillStyle = '#ffd040'; g.fillRect(p.x - 70, p.y - 110, 140 * e.hp, 8);
        continue;
      }
      g.strokeStyle = '#ff2a1a'; g.lineWidth = 3;
      g.beginPath(); g.arc(p.x, p.y, 18 + Math.sin(performance.now() / 90) * 4, 0, Math.PI * 2); g.stroke();
    }
    // the wagon's health, big, at the bottom
    const w = Math.min(520, W * 0.42), x = (W - w) / 2, y = H - 54;
    g.fillStyle = '#000a'; g.fillRect(x - 3, y - 3, w + 6, 22);
    g.fillStyle = S.hp < 35 ? '#ff3a20' : '#ffc040'; g.fillRect(x, y, w * Math.max(0, S.hp) / 100, 16);
    g.font = '800 15px system-ui'; g.textAlign = 'center'; g.fillStyle = '#ffe8c0'; g.shadowColor = '#000'; g.shadowBlur = 6;
    const st = STAGES[S.sg] || STAGES[0];
    g.fillText('THE WAGON' + (S.ph === 'wave' ? '  ·  ' + st.name.toUpperCase() : ''), W / 2, y - 10);
    g.shadowBlur = 0;
  }

  return {
    trail, frame, drawHud,
    onSnap(s){ S = s; trail.feed(s); },
    setActive(on){ active = on; canvas.style.display = on ? '' : 'none'; },
    get active(){ return active; },
  };
}
