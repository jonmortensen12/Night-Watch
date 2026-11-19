/* Bundle every model in models-src/ into one file, web/models/models.glb.

   npm install                      (once: glTF-Transform)
   node tools/bundle-models.mjs

   One request instead of one per model when a phone opens the game. Each
   source file becomes a scene named after it (Horse, Cowboy_Hair, Cactus_3
   ...), and its animations are renamed "<Model>|<Clip>" (Horse|Gallop,
   Cowboy_Hair|Run) so models that share clip names do not collide.
   web/models.js reads it back by those names.

   Sources: Quaternius (CC0) - see ASSETS.md. Add a model: drop its .glb or
   .gltf into models-src/, run this, and use it by file name. */
import {NodeIO} from '@gltf-transform/core';
import {mergeDocuments, dedup, prune, unpartition} from '@gltf-transform/functions';
import {readdirSync, statSync} from 'fs';
import {join, dirname, basename, extname} from 'path';
import {fileURLToPath} from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'models-src'), OUT = join(ROOT, 'web', 'models', 'models.glb');
const io = new NodeIO();
const files = readdirSync(SRC).filter(f => /\.(glb|gltf)$/i.test(f)).sort();
const target = await io.read(join(SRC, files[0]));
const label = (doc, name) => {
  const scenes = doc.getRoot().listScenes();
  scenes.forEach((s, i) => s.setName(i ? name + '_' + i : name));
  for(const a of doc.getRoot().listAnimations()) a.setName(name + '|' + (a.getName() || 'clip').split('|').pop());
};
label(target, basename(files[0], extname(files[0])));
for(const f of files.slice(1)){
  const doc = await io.read(join(SRC, f));
  label(doc, basename(f, extname(f)));
  mergeDocuments(target, doc);
}
await target.transform(unpartition(), dedup(), prune({keepLeaves: true}));
await io.write(OUT, target);
const root = target.getRoot();
console.log(`${files.length} models -> web/models/models.glb, ${(statSync(OUT).size / 1048576).toFixed(2)} MB, ${root.listScenes().length} scenes, ${root.listAnimations().length} animations`);
