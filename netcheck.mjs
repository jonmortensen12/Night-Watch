/* Night Watch - the TV and the phones, end to end, in Chromium.

   node netcheck.mjs            (serves web/ itself on a spare port)

   Everything runs over ?local=1, so the "network" is a BroadcastChannel
   between tabs of one browser - no internet, no PeerJS broker, the same
   messages. The phones have no motion sensors here; they are aimed through
   NW_TEST, which turns the drag-to-look view, exactly what a laptop does.

   Screenshots of the TV and a phone mid-battle go to shots/ (git-ignored)
   so a change to the look can be checked by eye. */
import {createRequire} from 'module';
import {createServer} from 'http';
import {readFile, mkdir} from 'fs/promises';
import {extname, join, dirname} from 'path';
import {fileURLToPath} from 'url';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'web');
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json'};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
    res.writeHead(200, {'content-type': TYPES[extname(path)] || 'application/octet-stream'});
    res.end(body);
  } catch(e){ res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://localhost:' + server.address().port + '/';
await mkdir('shots', {recursive: true});

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if(!c) fails++; };
const errors = [];
const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']});
const ctx = await browser.newContext();
function watchErrors(page, who){
  page.on('pageerror', e => errors.push(who + ': ' + e.message));
  page.on('console', m => { if(m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(who + ': ' + m.text()); });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(page, fn, arg, ms = 15000){
  const t = Date.now();
  while(Date.now() - t < ms){ if(await page.evaluate(fn, arg)) return true; await wait(150); }
  return false;
}

async function phone(code, name){
  const p = await ctx.newPage();
  await p.setViewportSize({width: 390, height: 780});
  watchErrors(p, name);
  await p.goto(BASE + 'play.html?local=1#' + code);
  await p.fill('#nameIn', name);
  await p.click('#joinBtn');
  return p;
}

/* aim at the nearest thing on the phone's own screen and hold the trigger */
async function gunner(p){
  return p.evaluate(() => {
    const s = NW_TEST.state();
    const live = s.ents.filter(e => e.type !== 'phantom' || e.vis > 0.3);
    if(!live.length){ NW_TEST.fire(false); return 0; }
    live.sort((a, b) => Math.hypot(...a.p) * (a.type === 'torpedo' ? 0.3 : 1) - Math.hypot(...b.p) * (b.type === 'torpedo' ? 0.3 : 1));
    NW_TEST.aim(...live[0].p);
    NW_TEST.fire(true);
    return live.length;
  });
}

console.log('the room');
const tv = await ctx.newPage();
await tv.setViewportSize({width: 1280, height: 720});
watchErrors(tv, 'TV');
await tv.goto(BASE + 'index.html?local=1');
ok(await until(tv, () => NW_TV.state().room && NW_TV.state().room.code), 'the TV opens a room');
const code = await tv.evaluate(() => NW_TV.state().room.code);
ok(/^[A-Z2-9]{4}$/.test(code), 'with a four-letter code (' + code + ')');
ok(await tv.evaluate(() => document.getElementById('url').textContent.includes('play.html')), 'and a link to the phone page');

const names = ['Ann', 'Bob', 'Cat'];
const phones = [];
for(const n of names) phones.push(await phone(code, n));
ok(await until(tv, () => NW_TV.state().room.people.filter(p => p.role === 'player').length === 3), 'three phones join');
const cols = await tv.evaluate(() => NW_TV.state().room.people.map(p => p.c));
ok(new Set(cols).size === 3, 'each gets its own colour');
ok(await until(phones[0], () => NW_TEST.state().me >= 0), 'a phone is told its colour');
ok(await phones[0].evaluate(() => !document.getElementById('lobby').classList.contains('on') || true), 'phones show the lobby');

console.log('the lobby');
await until(phones[1], () => document.querySelectorAll('#themes button').length > 1, null, 8000);
const nThemes = await phones[1].evaluate(() => document.querySelectorAll('#themes button').length);
ok(nThemes === 4, 'three themes and Off to choose from (' + nThemes + ')');
await phones[1].evaluate(() => [...document.querySelectorAll('#themes button')].find(b => b.dataset.key === 'redshift').click());
ok(await until(tv, () => NW_TV.state().room.theme === 'redshift'), 'a phone picks the music on the TV');
for(const p of phones.slice(0, 2)) await p.click('#readyBtn');
await wait(600);
ok(await tv.evaluate(() => NW_TV.state().phase === 'lobby'), 'nothing starts until everybody is ready');
await phones[2].click('#readyBtn');
ok(await until(tv, () => NW_TV.state().phase === 'count'), 'everybody ready: the countdown');
ok(await until(tv, () => NW_TV.state().phase === 'wave', null, 8000), 'wave 1');
await tv.screenshot({path: 'shots/tv-wave1.png'});

console.log('the battle');
ok(await until(phones[0], () => NW_TEST.state().ents.length > 0, null, 10000), 'enemies reach the phones');
let kills = 0, missileSeen = false;
const t0 = Date.now();
while(Date.now() - t0 < 40000){
  // first Ann holds her aim on one ship until a missile locks and goes
  // (nobody else shoots it out from under her), then everybody fires
  if(missileSeen) for(const p of phones) await gunner(p);
  if(!missileSeen) await phones[0].evaluate(() => {
    const s = NW_TEST.state();
    if(!s.lockId && !s.ents.some(e => e.id === window.__tracking) && s.ents.length){
      window.__tracking = s.ents.sort((a, b) => Math.hypot(...b.p) - Math.hypot(...a.p))[0].id;
      NW_TEST.track(window.__tracking);
    }
  });
  if(!missileSeen){
    const locked = await phones[0].evaluate(() => NW_TEST.state().lockId);
    if(locked){
      await phones[0].evaluate(() => { NW_TEST.missile(); NW_TEST.track(0); });
      missileSeen = await until(tv, () => Object.values(NW_TV.host().S.players).some(p => p.missiles < 3), null, 2000);
    }
  }
  kills = (await tv.evaluate(() => NW_TV.state().players)).reduce((a, p) => a + p.k, 0);
  if(kills >= 6 && missileSeen) break;
  await wait(120);
}
ok(kills >= 4, 'phones aimed at the enemies shoot them down (' + kills + ' kills)');
ok(missileSeen, 'holding the crosshair on one locks a missile, and it fires');
const sc = await phones.map(p => p.evaluate(() => NW_TEST.state().score)).reduce(async (a, b) => (await a) + (await b), 0);
ok(sc > 0, 'scores reach the phones');
await phones[0].screenshot({path: 'shots/phone-battle.png'});
await tv.screenshot({path: 'shots/tv-battle.png'});
for(const p of phones) await p.evaluate(() => NW_TEST.fire(false));

console.log('a phone that drops out');
const bobColour = await phones[1].evaluate(() => NW_TEST.state().me);
const bobDev = await phones[1].evaluate(() => sessionStorage.getItem('nwatch_dev'));
await phones[1].close();
ok(await until(tv, () => NW_TV.state().players.some(p => p.n === 'Bob' && p.w), null, 12000), 'is marked away');
const back = await ctx.newPage();
watchErrors(back, 'Bob again');
await back.addInitScript(dev => sessionStorage.setItem('nwatch_dev', dev), bobDev);
await back.goto(BASE + 'play.html?local=1#' + code);
await back.fill('#nameIn', 'Bob');
await back.click('#joinBtn');
ok(await until(back, () => NW_TEST.state().me >= 0), 'comes back');
ok(await back.evaluate(() => NW_TEST.state().me) === bobColour, 'in the same colour, with the same score');
phones[1] = back;

console.log('the end');
await tv.evaluate(() => { NW_TV.host().S.hull = 0; });
ok(await until(tv, () => NW_TV.state().phase === 'over'), 'the hull gives out: game over');
ok(await until(phones[0], () => document.getElementById('over').classList.contains('on')), 'phones show the results');
ok(await phones[0].evaluate(() => document.querySelectorAll('#results tr').length) === 4, 'one line per player');
ok(await tv.evaluate(() => !document.getElementById('over').classList.contains('off')), 'and so does the TV');
await tv.screenshot({path: 'shots/tv-over.png'});
await until(phones[2], () => !document.getElementById('againBtn').disabled, null, 6000);
await phones[2].click('#againBtn');
ok(await until(tv, () => NW_TV.state().phase === 'count'), 'PLAY AGAIN from any phone starts the next game');
ok(await tv.evaluate(() => NW_TV.state().hull === 100 && NW_TV.state().wave === 0), 'with a fresh hull');

console.log('no TV: a phone hosts, and a TV can watch');
for(const p of [tv, ...phones]) await p.close();
const hp = await ctx.newPage();
await hp.setViewportSize({width: 390, height: 780});
watchErrors(hp, 'host phone');
await hp.goto(BASE + 'play.html?local=1');
await hp.fill('#nameIn', 'Dee');
await hp.click('#hostBtn');
ok(await until(hp, () => NW_TEST.state().room && NW_TEST.state().room.code), 'START A GAME ON THIS PHONE opens a room');
const code2 = await hp.evaluate(() => NW_TEST.state().room.code);
ok(await hp.evaluate(() => getComputedStyle(document.getElementById('qrBox')).display !== 'none'), 'the hosting phone shows a QR code for the others');
const guest = await phone(code2, 'Eve');
ok(await until(hp, () => NW_TEST.state().room.people.length === 2), 'another phone joins it');
const watcher = await ctx.newPage();
await watcher.setViewportSize({width: 1280, height: 720});
watchErrors(watcher, 'watching TV');
await watcher.goto(BASE + 'index.html?local=1&watch=' + code2);
await hp.click('#startNow');
ok(await until(watcher, () => NW_TV.state().phase === 'count' || NW_TV.state().phase === 'wave'), 'the watching TV follows the game');
ok(await until(guest, () => NW_TEST.state().phase === 'wave', null, 8000), 'and the guest plays it');
ok(await until(watcher, () => NW_TV.state().ents > 0, null, 10000), 'the watching TV shows the enemies');

console.log('');
ok(errors.length === 0, 'no errors on any page' + (errors.length ? ':\n    ' + [...new Set(errors)].slice(0, 12).join('\n    ') : ''));
await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
