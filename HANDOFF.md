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
| `web/sim.js` | The simulation. Pure, deterministic, no drawing. Used by the host and by `simcheck`. |
| `web/host.js` | Runs a room: the people, the 60 Hz clock, snapshots to every screen. The TV and a hosting phone both use it. |
| `web/world.js` | The three.js renderer for both kinds of screen: sky, ships, effects, interpolation, the phone's aim pick. |
| `web/sound.js` | Synthesised effects (3D on phones) and the music player. |
| `web/net.js` | PeerJS (WebRTC) normally, BroadcastChannel with `?local=1`. Ported from Mission Control. |
| `web/qr.js` | QR encoder, copied from Mission Control. |
| `web/lib/` | three.js r170 and its bloom passes, vendored so the game does not depend on a CDN for its 3D. |
| `web/music/` | Rendered by `tools/music.py`. |
| `worker.js`, `wrangler.jsonc` | Serves `web/` and `/relay` (Cloudflare TURN), exactly as Mission Control. |
| `simcheck.mjs`, `netcheck.mjs` | The checks. `tools/art.mjs` draws the icons and link preview. |

## Playing it without phones

- `play.html?local=1`, START A GAME ON THIS PHONE: on a laptop there are no
  motion sensors, so it falls back to drag-to-look. **Space** fires, **M**
  fires a missile when locked, **F** resets front.
- `index.html?local=1` plus `play.html?local=1#CODE` in other tabs of the
  same browser: a TV and phones with no internet. This is what `netcheck`
  drives.
- `?q=low` on either page: no bloom, fewer particles, smaller sky.

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
- Ideas not built: a "spotter" role for a phone that just points and tags
  enemies for others, a radar sphere, versus mode.
