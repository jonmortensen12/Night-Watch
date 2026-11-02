# Night Watch

## Git workflow

Solo project, no collaborators — work directly on `main`. Commit and push
straight to `main`, no feature branches or PRs needed. Cloudflare Workers
deploys from `main` on every push, so anything on another branch is not
live, and a change has to work before it is committed.

## Start here

Read `HANDOFF.md` before making any non-trivial change — how the shared
sky works, the phone protocol, the tuning numbers and what is not built yet.

## The game lives in `web/`

`web/` is the only directory Cloudflare uploads. The check scripts, the
music tools and the notes beside it stay in the repo and off the internet.
Run the checks from the repo root.

## Before shipping

```
node simcheck.mjs    # the simulations, headless: space, the bunker and the Haunted House, tuning with computer players
node netcheck.mjs    # the TV and phones in Chromium over ?local=1: space, a phone-hosted game, then the bunker
node markcheck.mjs   # printed markers with a pretend camera: Bunker walking a drawn boundary, Space facing the same way
node hauntcheck.mjs  # the shelved Haunted House (and the print page) with a pretend camera
node tools/art.mjs   # redraw the icons and link preview after changing how ships or the sky look
python3 tools/samples.py && python3 tools/music.py   # re-render web/music/ after changing a piece
```

`node trackcheck.mjs` tests the shelved camera-only AR tracker
(`web/ar/track.js`). It is a progress report, not a gate - see HANDOFF.md.
Printed markers (`web/markers/`) are what the games use instead.

`web/sim.js` (space) and `web/zsim.js` (the bunker, and the Haunted House
given a room layout) decide everything that
happens and draw nothing. Change the
difficulty there and `simcheck` says whether the waves still last a
sensible time with one, two and four players.
