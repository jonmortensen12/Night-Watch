/* Night Watch: AR Bunker - the camera tracker, against the truth.

   node trackcheck.mjs

   A pretend living room (web/ar/fakeroom.js) is drawn with three.js in
   headless Chromium and walked through: look round, a step to the side,
   look at the floor, walk to the far wall, turn round fast, walk back. Each
   frame goes to the tracker (web/ar/track.js) as a phone's camera would,
   with the rotation the sensors would report - late, noisy and drifting -
   and a focal length that is only guessed. Where the tracker says the phone
   is gets compared with where it was. */
import {createRequire} from 'module';
import {createServer} from 'http';
import {readFile} from 'fs/promises';
import {extname, join, dirname} from 'path';
import {fileURLToPath} from 'url';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const ROOT = dirname(fileURLToPath(import.meta.url));
const MIME = {'.html': 'text/html', '.js': 'text/javascript'};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try { const b = await readFile(join(ROOT, path)); res.writeHead(200, {'content-type': MIME[extname(path)] || 'application/octet-stream'}); res.end(b); }
  catch(e){ res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://localhost:' + server.address().port + '/tools/trackcheck.html';

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if(!c) fails++; };
const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});

async function run(label, query){
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  page error:', e.message));
  await page.goto(BASE + (query || ''));
  await page.waitForFunction(() => window.ready);
  const r = await page.evaluate(() => window.run());
  if(process.env.SHOT){ const url = await page.evaluate(() => window.frame40); const fs = await import('fs'); fs.writeFileSync('shots/track-frame.png', Buffer.from(url.split(',')[1], 'base64')); const g = await page.evaluate(() => window.gray40); fs.writeFileSync('shots/track-gray.png', Buffer.from(g.split(',')[1], 'base64')); }
  await page.close();
  console.log(`${label}: tracking ${(100 * r.tracked / r.frames).toFixed(0)}% of frames, metres from ${r.metricAt == null ? 'never' : r.metricAt.toFixed(1) + ' s'}, ` +
    `error ${r.rmse == null ? '-' : (r.rmse * 100).toFixed(0) + ' cm typical, ' + (r.maxE * 100).toFixed(0) + ' cm worst'}, focal ${r.focal.toFixed(0)} (true ${r.focalTrue}), ${r.msPerFrame.toFixed(1)} ms a frame`);
  if(process.env.VERBOSE){ r.log.forEach(x => console.log('    ' + x)); r.rows.forEach(x => console.log('    ' + x)); }
  if(process.env.SHOT){ const d = await (async () => r)(); }
  return r;
}

if(process.env.IDEAL){ await run('ideal', '?lat=0&noise=0&drift=0&fguess=1' + (process.env.WALK ? '&walk=' + process.env.WALK : '') + (process.env.NOLEARN ? '&nolearn=1' : '') + (process.env.DBG ? '&dbg=1&t0=' + (process.env.T0 || 7) + '&t1=' + (process.env.T1 || 10.5) : '') + (process.env.AUDIT ? '&audit=1' : '')); process.exit(0); }
/* The game's walk is the one that has to work; the hard one (brisk, looking
   all over, into parts of the room never seen) is reported, to improve. */
const g = await run('game walk, ordinary sensors', '?walk=game');
const ph = g.phases;
console.log(`    worst error: scan ${(ph.scan * 100).toFixed(0)} cm, to the window ${(ph.toWindow * 100).toFixed(0)} cm, to the second window ${(ph.toSecond * 100).toFixed(0)} cm, back ${(ph.back * 100).toFixed(0)} cm`);
ok(ph.scan < 0.5, 'standing and scanning: the phone stays put (within 50 cm)');
ok(ph.toWindow < 0.6, 'walking to the window: within 60 cm');
ok(Math.abs(g.focal / g.focalTrue - 1) < 0.06, 'learns the camera\'s focal length from an 8% wrong guess');
ok(g.msPerFrame < 20, 'fast enough (' + g.msPerFrame.toFixed(1) + ' ms a frame here; a phone is two to four times slower)');
const h = await run('hard walk, ordinary sensors');
console.log('    (the hard walk is a target to improve, not a pass mark)');

await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
