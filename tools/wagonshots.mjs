/* Screenshots of the wagon game, for judging it by eye.

   node tools/wagonshots.mjs [names...]

   shots/wagon-*.png: each stage from a seat on the bench and from the TV,
   and the outlaws lined up (tools/wagongallery.html). With names, only
   those shots. */
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
await mkdir(join(ROOT, 'shots'), {recursive: true});
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const errors = [];
async function until(page, fn, ms = 30000){ const t = Date.now(); while(Date.now() - t < ms){ if(await page.evaluate(fn)) return true; await wait(200); } return false; }

const SHOTS = {
  'flats-phone':   ['stage=0&t=12&yaw=-50&pitch=-4', 'phone'],
  'flats-tv':      ['stage=0&t=14&view=tv', 'tv'],
  'canyon-phone':  ['stage=1&t=10&yaw=35&pitch=6', 'phone'],
  'canyon-tv':     ['stage=1&t=12&view=tv', 'tv'],
  'gulch-phone':   ['stage=2&t=14&yaw=0&pitch=25', 'phone'],
  'mine-phone':    ['stage=3&t=10&yaw=180&pitch=0', 'phone'],
  'mine-tv':       ['stage=3&t=12&view=tv', 'tv'],
  'gorge-phone':   ['stage=4&t=10&yaw=-30&pitch=8', 'phone'],
  'gorge-tv':      ['stage=4&t=12&view=tv', 'tv'],
  'pass-phone':    ['stage=5&t=16&yaw=0&pitch=28', 'phone'],
  'pass-tv':       ['stage=5&t=18&view=tv', 'tv'],
  'outlaws':       ['stage=0&put=rider,bandit,thrower,cart&yaw=0&pitch=-2', 'wide'],
  'critters':      ['stage=2&put=vulture,bat,dynamite,swinger,crate,tumble&yaw=0&pitch=4', 'wide'],
  'baron':         ['stage=5&put=balloon&yaw=0&pitch=22', 'phone'],
  'dusk-tv':       ['stage=1&lap=1&t=12&view=tv', 'tv'],
};
const want = process.argv.slice(2);
for(const [name, [qs, kind]] of Object.entries(SHOTS)){
  if(want.length && !want.includes(name)) continue;
  const p = await browser.newPage();
  p.on('pageerror', e => errors.push(name + ': ' + e.message));
  p.on('console', m => { if(m.type() === 'error') errors.push(name + ': ' + m.text()); });
  await p.setViewportSize(kind === 'tv' || kind === 'wide' ? {width: 1280, height: 720} : {width: 390, height: 780});
  await p.goto(BASE + 'tools/wagongallery.html?' + qs);
  await until(p, () => window.ready);
  await wait(3500);
  await p.screenshot({path: join(ROOT, `shots/wagon-${name}.png`)});
  console.log('  shots/wagon-' + name + '.png');
  await p.close();
}
console.log(errors.length ? 'errors:\n  ' + errors.join('\n  ') : 'no errors');
await browser.close(); server.close();
