# Free 3D assets: what is in Google Drive "AI/Games/Free Assets"

A reference for future sessions: what each pack holds, where it is, and
how to actually get the files. Catalogued 2026-11-19.

All twelve entries are **shortcuts to Quaternius's own shared Drive folders**
(owner laulhet@gmail.com, Quaternius). Everything is by **Quaternius,
licence CC0** (public domain: use anywhere, no credit needed, though crediting
"Quaternius" is nice). Free Assets folder id: `15XUXiEkNHV5p2nfoH2jvUHLp-MTDMjEw`.

## Getting the files (read this first)

- **Direct Drive downloads do not work.** Every file answers "Google Drive -
  Quota exceeded" (`drive.usercontent.google.com/download?id=...`): these are
  some of the most downloaded free packs on the internet. The Drive connector's
  download tool returns the file inline as base64 - fine for a text file,
  hopeless for a 2-4 MB glTF.
- **Use the GitHub mirror instead:** `github.com/trebeljahr/quaternius-showcase`,
  folder `public/glb/<pack>/<Name>.glb` - the same Quaternius models as
  single binary GLB files (embedded textures, animations kept), about a fifth
  of the size of the glTF. Fetch with
  `https://raw.githubusercontent.com/trebeljahr/quaternius-showcase/main/public/glb/<pack>/<Name>.glb`
  (or a blobless `git clone --filter=blob:none --depth 1` to list it).
  Mirror packs that match Drive packs are noted below as **Mirror:**.
  The mirror also has many Quaternius packs that are *not* in the Drive folder
  (survival, nature, medieval village, dungeon, sci-fi, space, crops, city
  street, platformer, RPG items, ...): 33 packs, ~1,600 models.
- Drive's search over these shared folders is incomplete: a listing can miss
  files. The lists below are what Drive returned; treat them as "at least".

## The packs

Most packs have the same layout: `Blends/` (Blender sources), `FBX/`,
`OBJ/` (+ `.mtl`), often `glTF/`, plus `Preview.*` and `License.txt`.
glTF/FBX versions of character and animal packs are rigged and animated.

### Ultimate Animated Animals (July 2021) - shortcut target `1uJ3N5HfB7jKTseJUNQr3N4YaN0UuEtHk`
glTF (rigged, animated: walk, gallop, idle, eat, attack, death ...), `Preview.mp4`.
Alpaca, Bull, Cow, Deer, Donkey, Fox, **Horse**, **Horse_White**, Husky,
ShibaInu, Stag, Wolf.
**Mirror:** `animals_pack/` (all 12, ~0.6 MB each). *Used in the Wagon: the team and the riders' horses.*

### Farm Animals (2018) - `1is1ax2V0mIEDS7BbbzBV_x2Pabya1dVJ`
OBJ/FBX/Blends, `Preview.gif`. Low-poly, unanimated in OBJ.
Cow, Horse, Llama, Pig, Pug, Sheep, Zebra.

### Ultimate Animated Character Pack (Nov 2019) - `1sNi1AfenfPRrvRt5yfaj5QMMd6KKcUJ5`
glTF/FBX/OBJ/Blends, rigged and animated (idle, walk, run, punch, shoot, death ...). 50 characters:
BaseCharacter, BlueSoldier_Female/_Male, Casual_Bald/_Female/_Male,
Casual2_Female/_Male, Casual3_Female/_Male, Chef_Female/_Hat/_Male, Cow,
**Cowboy_Female, Cowboy_Hair, Cowboy_Male**, Doctor_Female_Old/_Young,
Doctor_Male_Old/_Young, Elf, Goblin_Female/_Male, Kimono_Female/_Male,
Knight_Golden_Female/_Male, Knight_Male, Ninja_Female, Ninja_Male,
Ninja_Male_Hair, Ninja_Sand, Ninja_Sand_Female, OldClassy_Female/_Male,
Pirate_Female/_Male, Pug, Soldier_Female/_Male, Suit_Female/_Male,
Viking_Female/_Male, VikingHelmet, Witch, Wizard, Worker_Female/_Male,
Zombie_Female/_Male.
**Not in the mirror** (and Drive is quota-blocked): the cowboys are the one
thing here worth fetching by hand - download `glTF/Cowboy_*.gltf` in a
browser (signed in, a copy into your own Drive first may get round the
quota) and put them in the repo.

### Animated Men Characters (Feb 2019) - `17LibivOaUidsQhSkcxP3YYvDr0n7wIwu`
OBJ/FBX/Blends. Male_Casual, Male_LongSleeve, Male_Shirt, Male_Suit, and
"Smooth_" versions of each (more polygons). FBX rigged and animated.

### Animated Women Characters (Feb 2019) - `1c13R--fMqdR6r2MRlcKKsbPky0__T-yJ`
OBJ/FBX/Blend. Female_Alternative, Female_Casual, Female_Dress,
Female_TankTop, plus "Smooth_" versions. FBX rigged and animated.

### Ultimate Modular Men (Feb 2022) - `1USAAquX2JJWuA2m6zol0KUkFe3UkZ8zX`
`Individual Characters/glTF` and `All together/`. Rigged, ~24 animations
each (idle, walk, run, jump, punch, gun shoot, death, ...). Adventurer,
Beach, Casual_2, Casual_Hoodie, Farmer, King, Punk, Spacesuit, Suit, Swat,
Worker. **Mirror:** `modular_men/` (Adventurer, Beach, Casual, Casual2,
Farmer, King, Punk, Spacesuit, Suit, Swat, Worker).

### Ultimate Modular Women (April 2022) - `1720N9IGyQHXYvtvZJzazhxtTTlz-y2Vf`
`Individual Characters/` (FBX, glTF, Blends), `All together/`,
`Humanoid Rigs/`, `Separate Skeletal Meshes and Animations/`, `How To Use.txt`.
**Mirror:** `modular_women/`: Adventurer, Casual, Formal, Medieval, Punk,
SciFi, Soldier, Suit, Witch, Worker.

### Animated FPS Guns (Jun 2018) - `1ICYTdMXQqhkhrh8Fzjx9D0ozJuONwtC4`
OBJ/FBX/Blends, `Preview.mp4`. FBX versions animated (reload, shoot).
P90, Pistol, Revolver, Rifle, Shotgun, SniperRifle.

### Ultimate Gun Pack (July 2019) - `12V-mHNB6bnW2WzgpJfRBQd-TG4pOO3yx`
OBJ/FBX/Blends + `OBJ/Accessories/`. 40 guns: AssaultRifle_1-5,
AssaultRifle2_1-4, Bullpup_1-3, Pistol_1-6, **Revolver_1-5**, Shotgun_1-4,
Shotgun_SawedOff, Shotgun_ShortStock, SniperRifle_1-6, SubmachineGun_1-5.
**Mirror (similar):** `survival_pack/` has Revolver_1-3, Pistol_1-2,
Shotgun_1-2/SawedOff/ShortStock, FlareGun. *Used in the Wagon: the revolver.*

### Realistic Car Pack (Nov 2018) - `1fKlbDry77iY8KlEoxzUxIAZQL_XhzWlA`
OBJ/FBX/Blends. Cop, NormalCar1, NormalCar2, SportsCar, SportsCar2, SUV, Taxi.

### Ultimate Stylized Nature (May 2022) - `1IV3bXHzkNvuNWFHPi4KPx-G4ghuxIuT-`
glTF (+ `.bin`, textures), OBJ, FBX, Blends, `Preview.jpg`. Textured,
stylized. Seen: BirchTree_1-5, MapleTree_1-5, DeadTree_1-10, Bush (Small,
Large, Flowers), Flower_1-5 (+ Clumps), Grass_Small/Large/Large_Extruded,
plus textures for PineTree, PalmTree and Rocks (their models were not
returned by Drive's search but are in the pack).
**Mirror (older Ultimate Nature pack):** `nature_pack/`: Cactus_1-5,
CactusFlowers, Rock_1-7 (+Moss/Snow), Bush, CommonTree/Birch/Pine/Willow
(+Autumn/Dead/Snow), PalmTree, TreeStump, WoodLog, Grass, Plant, Wheat ...
*Used in the Wagon: cacti, rocks, dead trees.*

## Useful for which game

- **Wagon (cowboy):** horses (Animated Animals), cowboys (Character Pack -
  needs a manual download), revolvers (Gun Pack / survival mirror),
  cacti/rocks/dead trees (Nature), vulture: none (still drawn in code).
- **Bunker (Halloween):** Zombie_Male/Female, Witch, Goblin (Character Pack);
  DeadTree (Stylized Nature); Wolf (Animals).
- **Space:** Spacesuit (Modular Men), SciFi (Modular Women); the mirror has
  `ultimate_space_pack`, `spaceships_pack`, `modular_sci_fi`.
- **Game Day:** Casual / Soldier characters as players.
