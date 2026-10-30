# Night Watch — handoff

A co-op space shooter where every phone is a window into one shared sky.
Players sit or lie on the floor, turn their phones in every direction to
find enemy ships, and hold a finger on the screen to shoot. A TV, if there
is one, shows the whole battle from behind the players for everyone else
in the room. Waves get harder; every fifth is a dreadnought. Score is per
player; the wave reached is the family's record.

Built from the request on 2026-10-30: "like the constellation app, but a
space shooter in a shared 3D space between phones ... aim by moving your
phone ... an option for one phone [or the TV] to give a view of the whole
battlefield". Then: full sphere ("people playing on the floor more than
just on the couch; trying to find the bad guys is part of the fun"), lock
on the TV or an agreed object, graphics as good as possible (not
Fire-Stick-bound), a full working game. Working title.

## Files

| File | What it is |
|---|---|
| `web/index.html` | The TV. Hosts the room (or, with `?watch=CODE`, watches a phone's game), draws the battle, plays the music. |
| `web/play.html` | The phone. Joins a room, or hosts one itself ("START A GAME ON THIS PHONE"). |
| `web/sim.js` | The space simulation. Pure, deterministic, no drawing. Used by the host and by `simcheck`. |
| `web/zsim.js` | The bunker (zombie mode) simulation, the same shape as `sim.js`. |
| `web/yard.js` | The bunker's renderer: the graveyard, the fence, the monsters, the guns. |
| `web/zombie-phone.js`, `web/zombie-tv.js` | The bunker's controls and overlay on a phone, and its view on the TV. `play.html` and `index.html` hand over to them in zombie mode. |
| `web/host.js` | Runs a room: the people, the 60 Hz clock, snapshots to every screen, which game (space or bunker). The TV and a hosting phone both use it. |
| `web/world.js` | The three.js renderer for both kinds of screen: sky, ships, effects, interpolation, the phone's aim pick. |
| `web/sound.js` | Synthesised effects (3D on phones) and the music player. |
| `web/net.js` | PeerJS (WebRTC) normally, BroadcastChannel with `?local=1`. Ported from Mission Control. |
| `web/qr.js` | QR encoder, copied from Mission Control. |
| `web/lib/` | three.js r170 and its bloom passes, vendored so the game does not depend on a CDN for its 3D. |
| `web/music/` | Rendered by `tools/music.py`. |
| `worker.js`, `wrangler.jsonc` | Serves `web/` and `/relay` (Cloudflare TURN), exactly as Mission Control. |
| `simcheck.mjs`, `netcheck.mjs` | The checks. `tools/art.mjs` draws the icons and link preview. |

## Playing alone

A phone that opens the main URL is sent straight to `play.html` (a
coarse pointer and a screen under 600 px; `?tv=1` keeps a phone or tablet
as the TV). There, START A GAME ON THIS PHONE hosts on the phone itself
and READY (or START NOW) begins a solo game. The TV lobby says so, and
links a laptop to the same page.

## Playing it without phones

- `play.html?local=1`, START A GAME ON THIS PHONE: on a laptop there are no
  motion sensors, so it falls back to drag-to-look. **Space** fires, **M**
  fires a missile when locked, **F** resets front.
- `index.html?local=1` plus `play.html?local=1#CODE` in other tabs of the
  same browser: a TV and phones with no internet. This is what `netcheck`
  drives.
- `?q=low` on either page: no bloom, fewer particles, smaller sky.

## Two games, one room

The lobby picks **Space** or **Bunker** from any phone (`mode` message;
only between games — the results screen has a LOBBY button to get back).
The host swaps `sim.js` for `zsim.js`, everybody keeps their colour, and
each game keeps its own music choice and record (`nwatch_save`: `mode`,
`themes`, `bests`). Every snapshot says which game it is (`s.mode`), and
the pages switch renderer when it changes: in bunker mode the space canvas
is hidden and `zombie-phone.js` / `zombie-tv.js` draw on their own.

## The shared sky (the idea everything rests on)

Everybody is at the centre of the world, the way a star map puts you at the
centre of the sky. A phone reports only which way it points, not where it
is — and that is fine, because enemies are 40 to 150 units out and the
players are a metre apart: everybody sees the same ship in the same
direction. One person can shout "behind us, high!" and everyone turns and
finds it.

Axes are three.js's: **y is up** (gravity, which every phone agrees on
without help) and **−z is FRONT**.

**Locking front.** A phone's sensor yaw means nothing (it is wherever the
phone was pointing when the sensor started). LOCK FRONT takes the phone's
current heading and turns the whole sky so that heading becomes −z
(`lockFront` in `play.html`: `yawQ` about y by `atan2(f.x, −f.z)`). With a
TV, everyone points at the TV; without one, the room agrees on a door or a
lamp. It refuses if the phone is pointing nearly straight up or down
(the heading is meaningless there).

**Drift.** Up and down never drift. Left and right come from the gyro and
drift a few degrees a minute on some phones. The cure is to lock again:
the ⌖ FRONT button is always on screen, the break between waves says so,
and the FRONT label on the phone's horizon makes drift visible (point at
the TV; if FRONT is not on it, re-lock).

**Orientation maths.** `deviceorientation` → quaternion exactly as three.js's
old DeviceOrientationControls did (Euler `beta, alpha, −gamma` in YXZ, a
−90° turn about x so the camera looks out of the back of the phone, then
the screen's own rotation). Smoothed with a slerp of 0.65 a frame.

**iOS** asks for motion permission once, and only from inside a tap: the
JOIN and START buttons call `DeviceOrientationEvent.requestPermission()`
before anything else. No events within 1.5 s (a laptop, a refusal) means
drag-to-look with a FIRE button.

**Rotation.** A phone pointed at the ceiling thinks it has been turned
sideways and flips the screen. On Android the page goes fullscreen and
locks portrait; iPhones cannot do that from a web page, so the lock screen
tells iPhone users to turn on Rotation Lock. **Untested on a real phone —
check this first.**

## The game

- **The station** is at the origin, a hull ball of radius 3, 100 hull.
  Bolts and torpedoes that reach it do damage; a wave cleared repairs 10.
- **Waves**: a budget spent on groups of 1–3 ships that arrive every few
  seconds, each from its own direction. Wave 1's first groups come from in
  front (easy to find); wave 2 stays above the floor; from wave 3 they come
  from anywhere on the sphere, including below. More players, bigger
  waves (`crowd = 0.7 + 0.3 × players`). A 9 s break between waves.
- **Enemies** (`TYPES` in `sim.js`):
  - **Dart** — wanders between waypoints 45–85 out, potshots.
  - **Raider** (wave 2+) — strafing runs past the station with a three-shot burst, then breaks away.
  - **Bomber** (wave 3+) — tough, stands off at ~80 and launches torpedoes.
  - **Torpedo** — heads straight in, speeding up. 12+ damage if it lands. The phone beeps from its direction and calls it out in words ("TORPEDO – behind left, low").
  - **Phantom** (wave 4+) — cloaked (a faint shimmer) except while charging a shot, just after, and when hit.
  - **Dreadnought** (every 5th wave) — parks ~115 out and orbits slowly; four turrets must die before its core's shield drops. Launches darts and torpedoes.
  - **Supply drone** — drifts past every 22–34 s; shoot it for hull repair, 10 s of rapid fire for everyone (no heat), or missiles refilled.
- **Laser**: hold a finger anywhere on the sky. 7 shots a second, heat 7 a
  shot, overheats at 100 and locks until it cools to 35.
- **Missiles**: hold the crosshair on one ship for 0.6 s to lock; the
  MISSILE button fires a homing missile (7 damage). Three, one back every
  12 s.
- **Score**: 10 a hit plus the kill's points. Results show score, kills,
  torpedoes stopped and accuracy, with awards (Top Gun, Sharpshooter,
  Torpedo Catcher, Giant Slayer).

## Who decides a hit

The host owns the gun: cadence, heat, damage. But a phone draws the world a
little in the past, so the phone says what its crosshair is on (`tg`, from
`world.pick`, which allows a cone that widens with distance), and the host
accepts it if that enemy is within 15° of the aim on the host's own copy —
else it casts its own ray (`resolveShot`). Co-op, so nobody is cheating;
the tolerance is about lag. The phone draws its own beam the instant the
trigger fires (predicting heat the same way the host does) and leaves the
host's verdict to the sparks and the score.

## Drawing it (`world.js`)

- **The sky is baked once**: an fbm shader (galaxy band with dust lanes,
  blue and violet clouds, the red nebula, the sun's glow) rendered into a
  cube map at start-up, so the phone pays nothing per frame for it. Stars
  are real points so they stay sharp. The **ringed planet** (front right,
  low), **sun** (behind left, high), **red nebula** (front left, high) and
  **moon** (behind right, low) are fixed landmarks for calling things out.
  A faint horizon with FRONT / RIGHT / BEHIND / LEFT, UP and DOWN.
- **Ships** are built from primitives (nose along +z), lit by the sun, a
  cool fill, the planet's bounce, and a brightened environment map. Every
  glowing part is a colour brighter than white, which is what the bloom
  catches.
- **Interpolation**: each thing is drawn at its last snapshot position plus
  velocity × age, eased towards that. No 100 ms buffer, so a phone's view
  is a frame or two behind the host, which keeps its picks honest.
- **Effects**: one pooled particle system (trails, sparks, explosions),
  camera-facing beams for lasers and bolts, flash sprites, shockwave rings,
  two pooled point lights. The station's shield ripples where it is hit
  (from inside, on a phone, only the ripple shows — kept small, or a hit
  straight ahead whites the view out).
- **The TV**: a camera drifting slowly behind and above the players, so left
  on the TV is left in the room. Range rings on the floor plane and a line
  from every ship down to it (height), the station with a turret per
  player, and each player's aim as a line in their colour. Ships are drawn
  3.4× bigger and bracketed.
- **The phone**: brackets round everything on screen (labelled for
  torpedoes and drones, health bars on the big ones), arrows at the edge for
  everything else (torpedoes bigger and pulsing), red arcs from the side a
  hit came from, the heat arc round the crosshair, the missile lock.
  Other players' aim shows as faint lines in their colour.
- **Adaptive**: a slow device lowers its pixel ratio in steps of 0.25, and
  drops the bloom as a last resort.

## Sound

Effects are synthesised (`sound.js`). On a phone they are HRTF-panned and
the listener turns with the phone, so an explosion behind you sounds
behind you — with headphones it is a real help finding things. Enemy shots
are sounded when a new bolt appears; torpedoes beep from where they are.

**Music** is Mission Control's pipeline: `tools/samples.py` fetches the
FluidR3 recordings, `tools/music.py` renders the notes written in it to
`web/music/*.mp3` with seamless loops. Pieces: **Night Watch** (D minor,
116 bpm, spiccato strings, horn tune, celesta stars, taiko — the main
theme), **Constellation** (E Lydian, 100 bpm, harp and celesta, flute,
pizzicato and timpani), **Red Shift** (C minor, 138 bpm, taiko, low brass
riff, trumpets), chosen from any phone in the lobby (it plays straight
away), plus **lobby** (A minor piano and celesta) and **boss** (F♯ minor,
140 bpm, limping low brass, choir). Cues: count, wave, clear, bosswarn,
victory, gameover, record, pickup.

Music plays on the TV. With no TV, on the hosting phone; other phones can
turn it on with ♪. A browser keeps a page silent until somebody touches
that device: the TV shows "tap this screen for sound" until it has had a
tap or a key (Mission Control's lesson).

## The phone ↔ host protocol (`PROTO` 1)

Phone → host: `hello {name, dev, proto, role: player|watch}`,
`in {a: [x,y,z], tg, f}` (aim, what the crosshair is on, trigger; every
50 ms and on change), `msl {tg}`, `ready {v}`, `go` (start now),
`again`, `theme {key}`, `ping` (a watching TV).

Host → phone: `host {proto, min, tv, code}`, `you {id, c}` (your colour),
and `s` twenty times a second: phase, wave, hull, enemies (ten numbers
each: id, type, position, velocity, health %, and cloak / shield / crate
kind), bolts, missiles, players (aim, heat, missiles, score, kills, shots,
hits...), events since the last one (`zap`, `hit`, `boom`, `hull`, `torp`,
`wave`, `clear`, `boss`, `shield`, `pick`, `crate`, `msl`, `mhit`, `hot`,
`over`, `count`), and every second or on change `ro` (the room: code,
people, ready, theme, record).

A phone below the host's `min` reloads. Bump `PROTO` (in `sim.js`) and
`PROTO_MIN` (in `host.js`) together when a message changes shape.

Carried over from Mission Control: a phone silent for 6 s is away, gone
after 30 s, and one that comes back with the same device id gets its seat,
colour and score back. `?local=1` keeps a phone's identity per tab.

## Tuning (first build)

`node simcheck.mjs` plays whole games with computer gunners (turn rate,
reaction time and hand shake set to roughly a person's). They know where
everything is, which people will not — finding things is the game — so
real games will end sooner than this:

- One average gunner: about wave 5–9, ~4 minutes. Two: wave 10. Four:
  wave 10–15. The dreadnought waves (5, 10, 15, 20) are the walls.
- Waves take 30–45 s plus the 9 s break.

These are a starting point to retune after the first family game.

## The bunker (zombie mode)

Asked for on 2026-10-30: "using your living room like a bunker with
zombies coming from all sides (no up or down) ... controls for walking
around (forward, back, strafing) ... the bunker can be fairly small ... no
blood and gore ... several Halloween themed monsters ... if they get in, we
lose ... health indicators on the different sections they attack ...
switch between weapons that all have their strengths and weaknesses. A
sniper rifle that can zoom in, a shotgun and a pistol." No ammunition
(asked). AR was discussed and deliberately left out for now: a phone can
only know where it is in a room through the camera (ARCore/ARKit), and
iPhone browsers — Chrome included, which is Safari underneath — have no
web AR.

**The place.** A 9 m square wooden bunker in a graveyard at night (moon,
fog, gravestones, dead trees, jack-o'-lanterns, mist, wisps). Its fence is
**eight sections**, two to a side, named for the room: front left, front
right, right front, right back, back right, back left, left back, left
front (`SECTIONS` in `zsim.js`). Each has 100 health, shown as a bar over
it, as planks falling off (one per 25), a red glow when it is down, its
colour on the phone's minimap and its name on the TV.

**Moving.** The phone still looks by turning (same LOCK FRONT, same shared
frame — the TV is front). A floating stick under the left thumb walks you,
relative to where the phone points: up is forward, sideways strafes
(3.2 m/s; a third of that zoomed in). The phone is trusted with its own
position (no lag on your own feet) and the host clamps it inside. Laptops:
WASD, drag to look, Space fires, 1/2/3 guns, Z zoom, R repair.

**Monsters** (`MONSTERS`), all walking across the field from every
direction to the section nearest where they came from:
- **Pumpkinhead** — a scarecrow with a carved, glowing pumpkin head. The basic one.
- **Skeleton** — fast and fragile, jaw chattering.
- **Bat** (wave 2+) — come five at a time, flitting, nibbling the fence. The shotgun's job.
- **Ghost** (wave 3+) — floats straight *through* the fence, slowly. Must be shot before it is inside.
- **Brute** (wave 4+) — a big green stitched-together monster; slow, 18 health, hits the fence hardest, cannot be knocked back.
- **The Witch** (every 5th wave) — circles on her broom, drops **pumpkin bombs** on the weakest section near her (shootable on the way down; 25 to that section and 8 to each neighbour) and raises skeletons.

At its section a monster batters it; once it is broken (0) monsters
**climb through** (2.2 s, longer for the brute) and **the first one inside
ends the game** ("A skeleton got in through the front left wall on wave
6"). Repairing a broken section under a climber pushes it back out.
Shooting one off the wall mid-climb is a "save".

**Guns** (`WEAPONS`) — no ammo; each is held back by rate, spread and reach:
- **Pistol**: 3.5 shots/s, 1 damage, accurate, 60 m. The all-rounder.
- **Shotgun**: 8 pellets in a 7° cone every 0.85 s, damage falls off to
  nothing by 20 m, knocks things back. Murderous close, useless far.
- **Sniper**: one shot every 1.25 s, 7 damage, goes through three in a
  line, 140 m, a little spread unless **zoomed** (14° field of view, a
  scope overlay, slow walking).
Shots are resolved like space (the phone's pick, trusted within ~10°, else
the host's own rays from the player's eye). The phone draws its tracers
and muzzle flash the moment it fires.

**Repair.** Within 1.7 m of a damaged section a big HOLD TO REPAIR button
appears: 24 health a second, no shooting while hammering. A cleared wave
gives every section 20. Results credit it ("Carpenter").

**On the phone**: three gun buttons at the top, ZOOM for the sniper, the
minimap (FRONT up, sections coloured by health, everybody, monsters) top
right, arrows at the screen edge for anything at the fence or a ghost
close in (red and pulsing when it is climbing in), hit markers, a
reload ring for the slow guns. A **torch** on every phone lights what you
point at — the fence and monsters are dark otherwise. Callouts for weak
and broken walls, climbers, bombs, the witch.

**On the TV**: the bunker from behind and above (left is left in the
room), section names over their bars, rings round anything climbing in,
each player as a figure in their colour, the scoreboard showing each
player's gun or the wall they are fixing.

**Sound**: three guns, groans, rattling bones, ghostly "wooo", bat
squeaks, the witch's cackle, thuds on the fence, cracking planks, a bomb's
whistle, hammering — placed around the listener, who walks with the
player. Music (same pipeline, new instruments fetched by `samples.py`:
church organ, xylophone, harpsichord, bassoon, oboe, tubular bells, music
box): **Danse of the Dead** (D minor waltz, 168 bpm — xylophone,
harpsichord, pizzicato, bassoon, organ), **Hollow Hill** (E minor, 92 bpm —
music box, taiko heartbeat, bells, oboe, choir), lobby **zlobby** (music
box), the witch's **witchboss** (G minor, 3/4 at 180), cues **zwave**
(a bell tolls), **zclear**, **witchwarn**, **zover**.

**Tuning** (`simcheck`, computer defenders who see all round at once —
people have to turn round, so real games will be shorter): one average
defender ~wave 6–10, two ~11–13, four ~13–14; waves 40–60 s; walls get
broken a few times a game; brutes and bats end most games. Four people
get proportionally more monsters (`crowd = 0.55 + 0.45 × players`).

**Protocol additions**: phone → host `in {a, tg, f, w, x, z, r, zm}` (aim,
pick, trigger, gun, position, repair, zoom), `mode {key}`, `lobby`. Host →
phone `s` in bunker mode carries `sec` (eight healths, −1 broken), `hit`
(which sections are being hit), `m` (11 numbers a monster: id, type, x, y,
z, facing, health %, state, section, vx, vz), `pl` (with x, z, gun, repair,
zoom), `why` (what got in, where) and events `shot`, `hit`, `poof`, `weak`,
`broken`, `fixed`, `climb`, `bomb`, `blast`, `witch`, `summon`,
`witchdown`, plus the shared `wave`, `clear`, `count`, `over`.

## Not built yet / to check

- **Never run on a real phone.** Everything is verified headless (software
  WebGL, no sensors). The first real test should check: the lock-front
  feel and how fast the gyro drifts, the screen flipping when pointing up,
  frame rate with bloom on mid-range phones, and whether 3D sound helps.
- **The relay** is built but off until the Worker has `TURN_KEY_ID` and
  `TURN_KEY_API_TOKEN` (the same TURN key the other games use will do).
  Until then a guest network, a router that keeps devices apart, or a
  phone on mobile data cannot join. Open `/relay` to see what a phone is
  given.
- **No licence gate.** Port Family Beatdown's when there is a product.
- **No haptics on iPhone** (Safari has no `navigator.vibrate`); hits flash
  red instead.
- **The bunker has never been played by people.** Check: whether the
  stick plus turning feels right, how dark it is on a real phone (the
  torch, `toneMappingExposure`), whether eight sections is the right
  number to watch, and the monster counts per wave.
- **Bunker AR** (zombies through your real windows) needs the camera and
  is Android-only on the web; deliberately not started.
- Ideas not built: a "spotter" role for a phone that just points and tags
  enemies for others, a radar sphere, versus mode.
