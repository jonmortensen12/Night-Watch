/* Night Watch: Bunker - the TV, in zombie mode.

   index.html owns the room, the lobby, the scoreboard and the results; this
   is the bunker seen from above and behind the players, with the words and
   sounds that tell the room which wall is in trouble. */
import * as THREE from 'three';
import {Yard} from './yard.js';
import {SECTIONS, MONSTERS, sideWords, COLORS} from './zsim.js';

export function createZombieTV(ctx){
  // ctx: {SND, banner, call, players: () => snapshot players}
  const SND = ctx.SND;
  const canvas = document.createElement('canvas');
  canvas.id = 'zview';
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  document.body.insertBefore(canvas, document.body.firstChild);
  const yard = new Yard(canvas, {mode: 'tv', low: /[?&]q=low/.test(location.search)});
  let active = true;
  const thudT = new Array(8).fill(0);
  let S = null;

  const who = c => (ctx.players() || []).find(p => p.c === c);
  yard.onEvent = ev => {
    const k = ev[0], sec = i => SECTIONS[i].name.toUpperCase();
    if(k === 'shot'){ if(Math.random() < 0.6) SND.sfx(['pistol', 'shotgun', 'sniper'][ev[2]], null, 0.18); }
    else if(k === 'poof'){
      SND.sfx(ev[2] === 'witch' ? 'bigPoof' : 'poof', null, 0.35);
    } else if(k === 'weak') ctx.call(sec(ev[1]) + ' wall is weak', '#ffd23a');
    else if(k === 'broken'){ ctx.banner(sec(ev[1]) + ' WALL BROKEN', 'Fix it or hold them off!'); SND.sfx('crack', null, 0.7); }
    else if(k === 'climb'){ ctx.call('CLIMBING IN - ' + sec(ev[2]) + '!', '#ff3a4a'); SND.sfx('alarm', null, 0.5); }
    else if(k === 'fixed'){ const p = who(ev[2]); ctx.call((p ? p.n + ' fixed the ' : 'Fixed the ') + SECTIONS[ev[1]].name + ' wall', p ? COLORS[p.c] : '#5cff8a'); }
    else if(k === 'bomb'){ ctx.call('Pumpkin bomb - ' + SECTIONS[ev[1]].name, '#ffb030'); SND.sfx('whistle', null, 0.4); }
    else if(k === 'blast') SND.sfx('blast', null, 0.7);
    else if(k === 'witch'){ SND.cue('witchwarn'); SND.sfx('cackle', null, 0.7); ctx.banner('THE WITCH', 'Shoot her down before she bombs the walls'); }
    else if(k === 'summon'){ ctx.call('The witch raises skeletons - ' + sideWords(ev[1], ev[2]), '#9cff40'); SND.sfx('cackle', null, 0.5); }
    else if(k === 'witchdown'){ const p = who(ev[1]); ctx.banner('THE WITCH IS DOWN', p ? 'Final shot: ' + p.n : ''); SND.cue('victory'); }
    if(ctx.onEvent) ctx.onEvent(ev);
  };

  let moanT = 1;
  function frame(dt){
    if(!active) return;
    moanT -= dt;
    if(moanT <= 0 && yard.mons.size){
      const list = [...yard.mons.values()], e = list[Math.floor(Math.random() * list.length)];
      const s = {pumpkin: 'groan', brute: 'groan', skeleton: 'rattle', ghost: 'boo', bat: 'squeak', witch: 'cackle'}[e.type];
      if(s) SND.sfx(s, null, 0.35, e.type === 'brute' ? 0.6 : 1);
      moanT = 2.5 / Math.min(4, 0.5 + list.length * 0.3);
    }
    if(S && S.hit) S.hit.forEach((h, i) => { if(h && performance.now() > thudT[i]){ thudT[i] = performance.now() + 600; SND.sfx('thud', null, 0.3); } });
    yard.render();
  }

  /* section names over the bars, so the room can shout them */
  function drawHud(g){
    if(!S || !S.sec) return;
    g.font = '800 15px system-ui'; g.textAlign = 'center';
    SECTIONS.forEach((s, i) => {
      const p = yard.project(new THREE.Vector3(s.mid[0] + s.n[0] * 1.2, 3.4, s.mid[1] + s.n[1] * 1.2));
      if(!p.on) return;
      const hp = S.sec[i];
      g.fillStyle = hp < 0 ? '#ff4a5a' : hp < 30 ? '#ffd23a' : '#ffffffaa';
      g.shadowColor = '#000'; g.shadowBlur = 6;
      g.fillText(s.name.toUpperCase(), p.x, p.y);
      g.shadowBlur = 0;
    });
    // trouble at the fence, ringed
    for(const e of yard.mons.values()){
      if(e.st !== 2 && e.type !== 'bomb') continue;
      const p = yard.project(yard.centreOf(e));
      if(!p.on) continue;
      g.strokeStyle = '#ff2a3a'; g.lineWidth = 3;
      g.beginPath(); g.arc(p.x, p.y, 18 + Math.sin(performance.now() / 90) * 4, 0, Math.PI * 2); g.stroke();
    }
  }

  return {
    yard, frame, drawHud,
    onSnap(s){ S = s; yard.feed(s); },
    setActive(on){ active = on; canvas.style.display = on ? '' : 'none'; },
    get active(){ return active; },
  };
}
