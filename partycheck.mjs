/* The party link (party.html, /gameday/?party=): no codes, no markers.
   node partycheck.mjs   (serves web/ itself; everything over ?local=1)
   - the first phone in runs the room, the Game Day look, markers off
   - a second phone joins it without typing anything
   - the phone running it leaves: the other takes the room over
   - a TV opening the link while a phone runs it watches; with nobody
     there, the TV runs it and phones join the TV */
import {createRequire} from 'module';
import {createServer} from 'http';
import {readFile} from 'fs/promises';
import {extname, join, dirname} from 'path';
import {fileURLToPath} from 'url';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'web');
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json'};
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if(path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, {'content-type': TYPES[extname(path)] || 'application/octet-stream'});
    res.end(body);
  } catch(e){ res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://localhost:' + server.address().port + '/';

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if(!c) fails++; };
const errors = [];
const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']});
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(page, fn, arg, ms = 20000){
  const t = Date.now();
  while(Date.now() - t < ms){ try { if(await page.evaluate(fn, arg)) return true; } catch(e){} await wait(200); }
  return false;
}
function watchErrors(page, who){
  page.on('pageerror', e => errors.push(who + ': ' + e.message));
  page.on('console', m => { if(m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(who + ': ' + m.text()); });
}
const isPhone = {viewport: {width: 390, height: 780}, hasTouch: true, isMobile: true};
// ?local=1 is a BroadcastChannel, which only reaches pages of the same
// browser context: a TV and phones share one, and phones beside a TV go
// straight to the page /gameday/ would send them to
async function phone(ctx, party, name, direct){
  const p = await ctx.newPage();
  watchErrors(p, name);
  if(direct){ await p.setViewportSize({width: 390, height: 780}); await p.goto(BASE + 'play.html?game=zombie&party=' + party + '&local=1&q=low'); }
  else { await p.goto(BASE + 'gameday/?party=' + party + '&local=1&q=low'); await p.waitForURL(/play\.html/); }
  await p.fill('#nameIn', name);
  await p.click('#joinBtn');
  return p;
}
const people = p => p.evaluate(() => { const r = NW_TEST.state().room; return r ? r.people.filter(q => q.role === 'player').map(q => q.n).sort().join(',') : ''; });

// the printout
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage(); watchErrors(p, 'print');
  await p.goto(BASE + 'party.html?party=utes9');
  const link = await p.evaluate(() => NW_PARTY.link());
  ok(/\/gameday\/\?party=UTES9$/.test(link), 'party.html links to ' + link.replace(BASE, '/'));
  ok(await p.locator('.sheet img.qr').count() === 1, 'party.html draws a QR code');
  await ctx.close();
}

// phones only
{
  const ctx = await browser.newContext(isPhone);
  ctx.setDefaultTimeout(90000);
  const a = await phone(ctx, 'TEST1', 'Ann');
  ok(await until(a, () => !!NW_TEST.host() && NW_TEST.state().room && NW_TEST.state().room.code), 'first phone runs the party room');
  ok(await a.evaluate(() => document.querySelector('#codeIn').offsetParent === null && document.querySelector('#hostBtn').offsetParent === null), 'no room code or host button on a party link');
  ok(await until(a, () => { const r = NW_TEST.state().room; return r.mode === 'zombie' && r.look === 'gameday' && r.mk && r.mk.mode === 'off'; }), 'Bunker, Game Day look, markers off');
  const b = await phone(ctx, 'TEST1', 'Bob');
  ok(await until(b, () => !NW_TEST.host() && NW_TEST.state().room && NW_TEST.state().room.people.length >= 2), 'second phone joins without a code');
  ok(await people(a) === 'Ann,Bob', 'the room holds both: ' + await people(a));
  await a.close();
  ok(await until(b, () => !!NW_TEST.host() && NW_TEST.state().room && NW_TEST.state().room.code, null, 60000), 'the phone running it leaves: the other takes the room over');
  const c = await phone(ctx, 'TEST1', 'Cal');
  ok(await until(c, () => !NW_TEST.host() && NW_TEST.state().room && NW_TEST.state().room.people.length >= 2), 'a third phone finds the new room');
  ok(await until(b, () => NW_TEST.state().room.look === 'gameday' && NW_TEST.state().room.mk.mode === 'off'), 'the new room is Game Day, no markers');
  await ctx.close();
}

// a TV
{
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(90000);
  const tv = await ctx.newPage(); watchErrors(tv, 'tv');
  await tv.setViewportSize({width: 1280, height: 720});
  await tv.goto(BASE + 'gameday/?party=TEST2&local=1&q=low');
  await tv.waitForURL(/tv\.html/);
  ok(await until(tv, () => !!NW_TV.host() && NW_TV.state().room && NW_TV.state().room.code), 'the TV first: the TV runs the room');
  ok(await tv.evaluate(() => document.getElementById('code').textContent) === 'TEST2', 'the TV shows the party name');
  const d = await phone(ctx, 'TEST2', 'Dee', true);
  ok(await until(d, () => !NW_TEST.host() && NW_TEST.state().room && NW_TEST.state().room.tv), 'a phone joins the TV');
  ok(await until(tv, () => NW_TV.state().room.look === 'gameday' && NW_TV.state().room.mode === 'zombie'), 'TV room: Game Day Bunker');
  await ctx.close();
}
{
  // a phone first, then the TV: the TV watches
  const pctx = await browser.newContext();
  pctx.setDefaultTimeout(90000);
  const e = await phone(pctx, 'TEST3', 'Eve', true);
  await until(e, () => !!NW_TEST.host() && NW_TEST.state().room && NW_TEST.state().room.code);
  const tv = await pctx.newPage(); watchErrors(tv, 'tv2');
  await tv.setViewportSize({width: 1280, height: 720});
  await tv.goto(BASE + 'gameday/?party=TEST3&tv=1&local=1&q=low');
  ok(await until(tv, () => !NW_TV.host() && NW_TV.state().room, null, 30000), 'a phone first: the TV watches its game');
  await pctx.close();
}

const real = errors.filter(e => !/AudioContext|autoplay|NotAllowedError|requestFullscreen|Permissions check/i.test(e));
ok(!real.length, 'no page errors' + (real.length ? ':\n    ' + real.slice(0, 6).join('\n    ') : ''));
await browser.close(); server.close();
console.log(fails ? fails + ' FAILED' : 'all good');
process.exit(fails ? 1 : 0);
