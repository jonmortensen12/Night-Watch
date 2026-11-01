# Game Day — BYU vs Utah party games (reference)

A planning reference for a set of party games for the BYU–Utah game, to be
read from any chat working on them. Written 2026-11-01 from a brainstorm in
the night-watch session. Nothing here is built yet unless marked.

Personal use, at one party: themes can use BYU/Utah names, Cosmo, the
Cougarettes, fight songs and so on freely. Nothing here is meant to be
published.

## The party

- **Adults and kids.** Every station should have something a 6-year-old can
  do and something an adult will compete at.
- **The real game is on the main TV.** So: phone-only games, games on
  laptops/tablets around the room, and short rounds that fit a commercial
  break (~2-3 min) or halftime (~20 min).
- **Hardware plan:** a few laptops/tablets as stations (screens, and cameras
  for the camera games), guests' phones as controllers. The Meta Portal TV
  is a nice-to-have only (for a jumbotron or dance screen); a test page
  would tell whether its browser allows the camera, WebGL and enough speed
  for pose tracking. Fire Stick: can show a browser game but has no camera
  and little 3D power, and cannot see the Portal's camera.
- **Joining:** everything joins the way the existing games do: a QR code
  on the station's screen, phones scan it, no app install.

Effort: 🟢 about a day · 🟡 a few days · 🔴 a week or more.

## The ideas

### A. Reskins of Night Watch (existing code, new look)

1. **Hold the Line** 🟢 — the Bunker as an end zone. Red Utah players (and
   a mascot boss in place of the witch, dropping footballs) attack the
   fence; the pistol throws a tiny BYU quarterback, the shotgun a spread of
   linemen, the sniper a perfect spiral. Hits knock them down with a
   whistle and a yellow-flag puff instead of "poof". Planks become blue
   tackling dummies. Option: pick a side when joining, so Utah fans can
   play the attackers (versus mode).
2. **Holy War in Your Living Room** 🟢 — the same in the Haunted House:
   red players burst through your real walls and doorways (printed
   markers). One marker on the TV cabinet = players coming out of the
   broadcast.
3. **Cougar Squadron** 🟢 — Space with blue fighters; the dreadnought is a
   giant flying red helmet whose turrets are its facemask bars; supply
   drones drop cougar-claw power-ups.
4. **Fight-song music** 🟢 — stadium/brass-band tracks for any game, from
   the existing music pipeline (`tools/music.py`).
8. **Mascot Hunt** 🟢 — for little kids: cougar cubs peek out of the
   Haunted House portals (or round the sky in Space); hold the crosshair on
   one to high-five it. No shooting, no losing.
9. **Tailgate Defense** 🟡 — a tailgate in the middle (grill, cooler, TV);
   rival fans try to steal the food; foam footballs; repair the canopy; the
   boss sets the grill on fire and you put it out.

### B. New 3D phone games (pointing the phone, as in Night Watch)

5. **Field Goal Frenzy** 🟡 — goalposts all round you at different
   distances and heights; flick the phone to kick; wind bends the ball;
   everyone kicks at once, 60-second rounds, leaderboard.
6. **Hail Mary** 🟡 — one quarterback throws a ball through the shared 3D
   space; the receivers physically turn to find it on their own phones and
   catch it by holding their aim on it. The shared-sky idea that made Space
   fun, made cooperative.
7. **Blitz!** 🟡 — Haunted House doorways become gaps in the line;
   blitzers rush through; you are the QB and must throw before you are
   sacked. Survive a set time.
17. **3D Trivia** 🟡 — answer on your phone, then the right answer flies
   off somewhere round the room; first to turn and find it scores.
20. **Pick-Six Reflex** 🟢 — a pass flashes up; first phone to tap
   intercepts it. Instant rounds, anyone can play.
22. **Kickoff Return** 🟡 — tilt the phone to dodge tacklers down the field,
   an endless runner; good for kids.

### C. Throwing games (the phone is the ball)

10. **Touchdown Pass** 🟡 — hold the phone like a ball, thumb on the
   screen, throw; lift the thumb to release (never let go of the phone:
   wrist strap for kids). Gyro gives arm speed (distance), direction gives
   aim, wrist roll gives the spiral. Receivers run routes on the station's
   screen; lead them. Quick turns, pass the phone round.
11. **Two-Minute Drill** 🔴 — #10 grown up: call a play on the phone
   (slant, post, screen, Hail Mary, run), clock running, a defence that
   reacts, a spike gesture to stop the clock, score before time runs out.
   Versus: two QBs alternating drives.

   Note on "Dry Fly technology": Dry Fly's phone remote is a settings
   remote (sliders) for the VR headset, and its casting comes from VR
   controllers. The phone link (PeerJS, a room code) carries over, and so
   does its thinking about turning a hand stroke into a launch, but reading
   a throw from a phone's motion sensors is new work. A thrown ball is far
   simpler physics than a fly line.

### D. Camera games (a laptop/tablet camera, or the Portal if it allows)

12. **Cosmo & the Cougarettes Dance-Off** 🔴 — the routine plays on screen;
   the camera tracks 2-4 people (MediaPipe pose: ~33 body points each) and
   scores each beat PERFECT/GOOD/MISS by comparing limb angles (fair for
   tall, short and kids, wherever they stand), allowing a beat of lag.
   Reference poses come from running the dance video through the same
   model ahead of time. Needs: the dance videos (1-2 min, filmed straight
   on), tape Xs on the floor so dancers do not overlap. Risks: people
   hiding each other, keeping track of who is who, speed with 4 people.
13. **Photo Booth** 🟡 — be Cosmo (mascot head over yours), a football
   player (helmet + facemask, eye black, shoulder pads) or a cheerleader
   (bow, pom-poms that follow your hands, uniform), on a stadium background.
   Several faces at once, each picks a costume. 3-2-1, flash, then a QR
   code to download the photo to your phone. MediaPipe face (468 points)
   + body + person cut-out. The work is the art; a Cosmo head works well as
   flat art mapped to the face (needs pictures of Cosmo).
19. **Mascot Mirror** 🟡 — Cosmo on screen copies *your* moves live. Kids
   will love it; a stepping stone to the Dance-Off (same pose tracking).
21. **Squad Celebration** 🟡 — a group invents a touchdown celebration, the
   camera records it, the room votes on their phones.

### E. Party-wide (everyone, all day)

14. **Prediction Pool** 🟢 — before each quarter, guess the next score, who
   scores, yards on the next drive; points as the real game goes; live
   leaderboard. Someone (the host) enters what actually happened. The one
   game grandparents will play.
15. **Halftime Showdown** 🟡 — teams by side; a 15-minute tournament of
   quick rounds (Field Goal Frenzy, Hail Mary, Mascot Hunt, Pick-Six);
   rivalry-trophy finish.
16. **Wave the Flag** 🟢 — everyone holds up a phone; waving and jumping
   (motion sensors) fill a crowd meter; in sync, the whole room cheers.
18. **Jumbotron** 🟢 — a screen showing photo-booth pictures, leaderboards
   from every game, "dance cam"/"kiss cam" moments. Ties the party together.
   (Leaderboards from several games need one place to post scores to -
   see the hub below.)
23. **Noise Meter** 🟢 — phone microphones measure the cheering on big
   plays; loudest moment of the night wins.

**Most party for the effort:** Hold the Line (1), Prediction Pool (14),
Photo Booth (13), Jumbotron (18).

## Repositories: how to split it so several chats can work at once

The rule that makes parallel work easy: **one repository per chat at a
time.** These are solo repos where work goes straight to `main` and every
push deploys, so two chats editing the same repo will trip over each other.
Group the games so that games sharing code share a repo, and different
groups can be built side by side.

| Repo | Games | Shared core |
|---|---|---|
| **night-watch** (exists) | 1, 2, 3, 4, 8, 9, 17 | A game-day theme over the existing sims and renderers (`?theme=gameday` or a lobby switch), so the Halloween versions stay intact |
| **gridiron** (new) | 5, 6, 7, 10, 11, 20, 22 | A football field renderer, ball flight, and the phone-motion "throw/kick/flick" reader. Field Goal Frenzy and Touchdown Pass share almost everything |
| **cougar-cam** (new) | 12, 13, 19, 21 | Camera handling and MediaPipe (pose, face, person cut-out) bundled locally, the Cosmo/costume art, the Portal test page. Photo Booth first, it proves the pipeline |
| **party-hub** (new) | 14, 15, 16, 18, 23 | Lightweight phone + screen pages, no 3D. Owns the **scoreboard**: one small Cloudflare Worker endpoint other games post scores to, which the Jumbotron and Halftime Showdown read |

If Blitz! (7) is easier in night-watch (it needs the Haunted House's
markers and portals), build it there; gridiron would then share only the
throw reader with it.

**Shared code.** Each repo deploys on its own, so copy rather than import
across repos. night-watch is the source to copy from:
- `web/net.js` — PeerJS rooms, `?local=1` BroadcastChannel testing, fixed
  codes and join-or-host (Haunted House), connection-type reporting.
- `web/host.js` — the host loop (60 Hz sim, 20 Hz snapshots, away/gone,
  rejoin with the same device id, a phone hosting via loopback, state
  backup so the next phone takes over).
- `web/qr.js` — the QR encoder (no CDN).
- `web/sound.js` + `tools/samples.py`, `tools/music.py` — sound effects and
  the music pipeline.
- `web/lib/` — three.js r170, vendored.
- `worker.js` + `wrangler.jsonc` — serve `web/` and `/relay` (Cloudflare
  TURN; the TURN secrets are already set on night-watch's Worker and can be
  set the same way on new ones).
- The phone page habits from `play.html`: never zoom (the Brave pinch fix),
  motion permission inside a tap (iOS), wake lock, fullscreen + portrait.
- The test habit: a headless check that drives the real pages in Chromium
  over `?local=1` (see `netcheck.mjs`, `hauntcheck.mjs`).

Each new repo should start with the same `CLAUDE.md` shape as night-watch
(work on `main`, the game in `web/`, the checks to run before shipping) and
a `HANDOFF.md`.

**Scores across games (optional).** If the Jumbotron should show every
game's leaderboard, party-hub's Worker can keep a tiny store (KV or a
Durable Object) with `POST /score {game, name, score}` and
`GET /scores`. The other games post to it when a round ends; nothing else
couples them.

## Suggested order

1. **night-watch: game-day theme** (Hold the Line) — quickest big win, and
   it tests the theme switch.
2. **party-hub: Prediction Pool**, then the Jumbotron and scoreboard.
3. **cougar-cam: Photo Booth** (then Mascot Mirror, then the Dance-Off if
   time allows).
4. **gridiron: Field Goal Frenzy / Touchdown Pass** (the throw reader),
   Two-Minute Drill if time allows.

Items 1-4 can run in four chats at once, one per repo.

## Starting a chat on one of these

Paste something like: "Read GAMEDAY.md in jonmortensen12/night-watch (game
ideas #N, #M). Create/use the `<repo>` repo per its 'Repositories' section,
copying the shared code it lists from night-watch."
