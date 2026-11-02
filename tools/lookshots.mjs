/* Screenshots of a Bunker look, for judging it by eye.

   node tools/lookshots.mjs [gameday|halloween]

   shots/look-<look>-ground.png, -air.png, -shots.png: the monsters lined up
   (tools/gallery.html); -phone.png, -tv.png, -swoop-*.png: a real game, a
   TV hosting and a phone playing over ?local=1, the phone shooting. */
import {createRequire} from 'module';
import {createServer} from 'http';
import {readFile, mkdir} from 'fs/promises';
import {extname, join, dirname} from 'path';
import {fileURLToPath} from 'url';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png'};
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if(path.endsWith('/')) path += 'index.html';
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, {'content-type': TYPES[extname(path)] || 'application/octet-stream'}); res.end(body); }
  catch(e){ res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://localhost:' + server.address().port + '/';
const look = process.argv[2] || 'gameday';
await mkdir(join(ROOT, 'shots'), {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const errors = [];
async function until(page, fn, arg, ms = 30000){ const t = Date.now(); while(Date.now() - t < ms){ if(await page.evaluate(fn, arg)) return true; await wait(200); } return false; }

for(const set of ['ground', 'air', 'shots', 'minis']){
  const p = await browser.newPage();
  p.on('pageerror', e => errors.push(set + ': ' + e.message));
  await p.setViewportSize({width: 900, height: 600});
  await p.goto(BASE + `tools/gallery.html?look=${look}&set=${set}`);
  await until(p, () => window.ready);
  await wait(set === 'shots' ? 1900 : 2500);
  await p.screenshot({path: join(ROOT, `shots/look-${look}-${set}.png`)});
  await p.close();
}

// a real game: the TV hosts, a phone plays
const ctx = await browser.newContext();
ctx.setDefaultTimeout(90000);
const tv = await ctx.newPage();
tv.on('pageerror', e => errors.push('tv: ' + e.message));
await tv.setViewportSize({width: 1280, height: 720});
await tv.goto(BASE + 'web/tv.html?local=1&game=zombie');
await until(tv, () => NW_TV.state().room && NW_TV.state().room.code);
await tv.evaluate(l => NW_TV.host().setLook(l), look);
const code = await tv.evaluate(() => NW_TV.state().room.code);
const ph = await ctx.newPage();
ph.on('pageerror', e => errors.push('phone: ' + e.message));
await ph.setViewportSize({width: 390, height: 780});
await ph.goto(BASE + `web/play.html?local=1&game=zombie#${code}`);
await ph.fill('#nameIn', 'Jon'); await ph.click('#joinBtn');
await until(ph, () => NW_TEST.state().me >= 0);
await wait(1500);
await ph.screenshot({path: join(ROOT, `shots/look-${look}-lobby.png`)});
await tv.screenshot({path: join(ROOT, `shots/look-${look}-tv-lobby.png`)});
await ph.evaluate(() => NW_TEST.go());
await until(ph, () => NW_TEST.state().phase === 'wave');
// shoot whatever is nearest, through the phone's own view
async function shoot(ms, shotAt){
  const t0 = Date.now(); let shot = false;
  while(Date.now() - t0 < ms){
    const best = await ph.evaluate(() => {
      const z = NW_TEST.z().state(); if(!z.mons.length){ NW_TEST.z().fire(false); return null; }
      const m = z.mons.slice().sort((a, b) => Math.hypot(a.p[0], a.p[2]) - Math.hypot(b.p[0], b.p[2]))[0];
      NW_TEST.aim(m.c[0] - z.x, m.c[1] - 1.55, m.c[2] - z.z); NW_TEST.z().fire(true); return m.type;
    });
    if(!shot && best && Date.now() - t0 > shotAt){ shot = true; await ph.screenshot({path: join(ROOT, `shots/look-${look}-phone.png`)}); await tv.screenshot({path: join(ROOT, `shots/look-${look}-tv.png`)}); }
    await wait(150);
  }
}
await shoot(40000, 26000);
// Swoop: straight to wave 5
await tv.evaluate(() => { const S = NW_TV.host().S; S.mons = []; S.wave = 4; S.phase = 'break'; S.phaseT = 0.5; });
await until(tv, () => NW_TV.host().S.mons.some(m => m.type === 'witch'));
await ph.evaluate(() => NW_TEST.z().fire(false));
await until(tv, () => { const w = NW_TV.host().S.mons.find(m => m.type === 'witch'); return w && w.st === 'circle'; }, null, 30000);
await wait(500);
const w = await tv.evaluate(() => { const m = NW_TV.host().S.mons.find(m => m.type === 'witch'); return [m.x, m.y, m.z]; });
await ph.evaluate(w => { const z = NW_TEST.z().state(); NW_TEST.aim(w[0] - z.x, w[1] - 1.55, w[2] - z.z); }, w);
await wait(1200);
await ph.evaluate(() => NW_TEST.z().weapon(2));
await ph.evaluate(() => NW_TEST.z().fire(true));
await wait(900);
await ph.screenshot({path: join(ROOT, `shots/look-${look}-swoop-phone.png`)});
await tv.screenshot({path: join(ROOT, `shots/look-${look}-swoop-tv.png`)});
await ph.evaluate(() => NW_TEST.z().fire(false));
if(errors.length) console.log('errors:\n  ' + errors.join('\n  '));
await browser.close(); server.close();
console.log('shots/look-' + look + '-*.png');
