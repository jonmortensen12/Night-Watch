/* Night Watch - the icons and the link preview, drawn by the game itself.

   node tools/art.mjs

   Opens the phone page headless, hosts a game, parks a few ships in front
   of the ringed planet and photographs it: web/icon-512.png,
   web/icon-192.png and web/og.png (the picture a shared link shows). Rerun
   it after changing how the ships or the sky look. */
import {createRequire} from 'module';
import {createServer} from 'http';
import {readFile} from 'fs/promises';
import {extname, join, dirname} from 'path';
import {fileURLToPath} from 'url';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png'};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try { const b = await readFile(join(WEB, path)); res.writeHead(200, {'content-type': MIME[extname(path)] || 'application/octet-stream'}); res.end(b); }
  catch(e){ res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://localhost:' + server.address().port + '/';
const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});

/* One scene: the planet low and to the right, ships coming in past it. */
async function shoot(w, h, file, opts){
  const page = await (await browser.newContext({viewport: {width: w, height: h}, deviceScaleFactor: 1})).newPage();
  page.on('pageerror', e => console.error(e.message));
  await page.goto(BASE + 'play.html?local=1');
  await page.fill('#nameIn', 'Art');
  await page.click('#hostBtn');
  await page.waitForTimeout(1200);
  await page.evaluate(async o => {
    document.querySelectorAll('.sheet,#top,.icon,#dot,#toast,#banner,#callout').forEach(e => e.style.display = 'none');
    if(o.noHud){ document.getElementById('hud').style.display = 'none'; NW_TEST.world().horizon.visible = false; }
    const NW = await import('./sim.js');
    const S = NW_TEST.host().S;
    NW.start(S);
    S.phase = 'wave'; S.wave = 1; S.plan = {groups: [], sent: 0, next: 999, maxAlive: 0, gap: 9}; S.crateT = 999;
    window.__ships = o.ships;
    for(const [type, p, v] of o.ships){ const e = NW.place(S, type, p); e.v = v; e.fireT = 99; e.wp = p; }
    NW_TEST.aim(...o.aim);
  }, opts);
  // hold the ships where they were put while the trails grow
  for(let i = 0; i < 25; i++){
    await page.evaluate(() => {
      const S = NW_TEST.host().S;
      S.enemies.forEach((e, i) => { const sh = window.__ships[i]; if(sh){ e.p = sh[1].slice(); e.v = sh[2]; e.st = 'out'; e.wp = sh[1].slice(); e.fireT = 99; e.burst = 0; } });
      S.bolts = [];
    });
    await page.waitForTimeout(60);
  }
  await page.screenshot({path: join(WEB, file)});
  await page.close();
  console.log('drew', file);
}

const icon = [
  ['raider', [4.2, -0.6, -17], [-14, 3, -4]],
  ['dart', [9.5, 3.2, -30], [-13, -3, -3]],
];
await shoot(512, 512, 'icon-512.png', {aim: [0.47, -0.2, -0.86], ships: icon, noHud: true});
await shoot(192, 192, 'icon-192.png', {aim: [0.47, -0.2, -0.86], ships: icon, noHud: true});
await shoot(1200, 630, 'og.png', {aim: [0.3, -0.1, -0.95], noHud: false, ships: [
  ['raider', [-3, -1, -20], [12, 2, -3]],
  ['dart', [9, 3.5, -34], [-13, -2, 8]],
  ['dart', [13, 1.5, -40], [-13, 1, 9]],
  ['bomber', [27, -7, -66], [-5, 1, 3]],
]});
await browser.close();
server.close();
