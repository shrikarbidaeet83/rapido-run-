# Tiny Racers

8-player online, top-down 2D car racing in the browser. Cars look and handle like [car.js.org](https://car.js.org/): tiny 8×16 flat rectangles with an arcade, slightly floaty, momentum-based feel. The game adds a lobby, 6 compact tracks, walls, 10-lap races, drift-charged boost, car-to-car collisions, AI bots and a scoreboard.

- **Server:** Node.js 20+, Express, Socket.IO 4. The server is authoritative for physics, collisions, laps and results.
- **Client:** vanilla ES modules and HTML5 Canvas 2D, with no framework and no build step.
- **Shared:** `/shared` holds the physics, track geometry and constants. Both server and client import it.

## Office look

The game is styled to stay quiet on a work screen:

- **Colours:** a white graph-paper background, a light grey road and muted car colours.
- **Text:** small and plain, with no flashing banners, red start lights, trophies or emojis.
- **Effects and sound:** no screen shake or bright effects, and sound is off by default.
- **Browser tab:** titled "Workspace", with a plain document icon.
- **Boss key:** **B** (or **`**) instantly covers the screen with a plain "Meeting notes" page and changes the tab title to match. Your controls are released while it's up. Online races keep running, so your car coasts. Press B again to come back.

## Run

```bash
npm install && npm start
# open http://localhost:3000   (port: process.env.PORT || 3000)
```

To test alone: create a room, keep **Fill empty slots with bots** ticked, click **Ready**, then **Start Race**.
To play with friends: share the room code or the **Copy link** URL (`?room=ABCD`).

## Controls

| Action | Keyboard | Touch | Gamepad |
|---|---|---|---|
| Throttle | ↑ / W | GAS (right) | RT / A |
| Brake / reverse | ↓ / S | BRAKE (right) | LT / B |
| Steer | ← → / A D | ◀ ▶ (left) | Left stick / D-pad |
| Boost (when the meter is 100%) | Space / Shift | BOOST (right) | X / RB |
| Respawn at last checkpoint | R | Respawn button | Y |
| Menu (the race keeps running) | Esc | ☰ | |
| Sound on/off (off by default, saved) | M | Menu → Sound | |
| **Hide screen (boss key)** | B or ` | Menu → Hide screen (double-tap to return) | |
| FPS / ping | F3 | | |
| Zoom 1×–4× | Mouse wheel | Pinch | |

All inputs are released when the window loses focus.

## Race rules

- **Boost:** the meter fills slowly while you drive (about 14 s) and much faster while you drift, i.e. slide sideways through corners (about 2.5 s of drifting). At 100%, press boost for 1.5 s of extra power (1.6× top power).
- 10 laps. There are 16 checkpoints per lap, and checkpoint 0 is the finish line. Progress only counts when you cross the **next** checkpoint going forwards, so shortcuts and reversing over the line don't count.
- Start: cars are frozen on a staggered 2×4 grid while 5 red lights count down 3-2-1. When they go out, it's GO.
- After the winner finishes, everyone else has 30 s. Cars still racing after that are **DNF**, ordered by progress.
- Wrong-way warning: shown when you've been heading more than 120° against the track for over 1 s.
- Respawn: puts you at the last checkpoint, standing still and facing forwards, with a 1.5 s ghost (no collisions). You can respawn at most once every 3 s.
- Points per race: 25-18-15-12-10-8-6-4, given to finishers in P1–P8. The room leaderboard keeps wins and points across races.
- Reconnect: if you drop out mid-race, rejoin within 15 s (same tab, or the same name) and you get your car back. Otherwise it becomes DNF.
- Joining while a race is running makes you a spectator until the next race.

## Project layout

```
server/index.js      Express + Socket.IO, room manager, rate limiting
server/room.js       Room: lobby, race state machine, fixed-step loop, results
server/bot.js        AI driver
shared/constants.js  every tunable number
shared/physics.js    car step (pure, deterministic) + edge zone + boost + wall constraint
shared/collision.js  OBB vs OBB (SAT) + impulse response
shared/track.js      spline, nearest point, checkpoints, grid, validation
shared/maps.js       the 6 tracks
public/              index.html, main.js (screens/net/prediction/HUD), render.js, input.js, audio.js, style.css
scripts/             validate-maps.js, simulate.js (headless race)
tests/               node --test suites (+ Playwright browser smoke test)
```

## Networking model

- The server runs physics at a fixed **60 Hz**, paced by an accumulator rather than trusting timer intervals. It broadcasts compact array snapshots at **20 Hz**.
- Clients send only `[firstTick, [inputBits…]]`. Positions from clients are never accepted.
- **Your own car** uses client-side prediction with the same shared physics. The client numbers every physics tick and sends the input for each one (batched once per frame). The server buffers them (a small jitter buffer) and applies exactly one per server tick. It then reports the last tick it applied, along with your car's full-precision state. The client replays exactly the ticks after that one, so prediction and server agree to within 1e-6 units: no rubber-banding. Only collisions with other cars cause visible corrections, and those are blended out in about 100 ms.
- **Other cars** are interpolated between snapshots about 120 ms in the past, using a jitter-resistant clock estimate. If a packet is late, they are briefly extrapolated instead of freezing.
- Each socket is limited to 60 messages per second. Player names are sanitised on the server and only ever drawn with `fillText` / `textContent`.

## Tunable constants (`shared/constants.js`)

| Constant | Value | Meaning |
|---|---|---|
| `PHYSICS.maxPower` | 0.09 | top throttle (car.js: 0.075, raised slightly to suit the bigger tracks) |
| `PHYSICS.maxReverse` | 0.0375 | top reverse |
| `PHYSICS.powerFactor` | 0.0012 | throttle build-up per tick |
| `PHYSICS.reverseFactor` | 0.0005 | reverse build-up per tick |
| `PHYSICS.drag` | 0.95 | velocity kept per tick (lower = grippier) |
| `PHYSICS.angularDrag` | 0.95 | spin kept per tick |
| `PHYSICS.turnSpeed` | 0.002 | steering per tick |
| `KERB_WIDTH` / `KERB_DRAG` / `KERB_POWER_CAP` | 10 / 0.985 / 0.8 | slow edge zone outside the white edge line: width, extra drag, power cap |
| `BOOST.fillNormal` / `BOOST.fillDrift` | 1/840, 1/150 per tick | meter fill: driving / drifting |
| `BOOST.driftSlip` | 0.35 | sideways speed that counts as drifting |
| `BOOST.durationTicks` / `BOOST.powerMult` | 90 / 1.6 | boost length and power |
| `INPUT_JITTER_TICKS` / `INPUT_QUEUE_MAX` | 3 / 20 | server input buffer |
| `WALL_RESTITUTION` / `WALL_FRICTION` / `WALL_SPIN` | 0.3 / 0.8 / 0.004 | wall bounce, scrape loss, spin |
| `CAR_RESTITUTION` / `CAR_FRICTION` / `CAR_SPIN` | 0.4 / 0.1 / 0.012 | car-to-car bounce, friction, spin kick |
| `LAPS`, `CHECKPOINTS` | 10, 16 | race length, checkpoints per lap |
| `COUNTDOWN_MS`, `FINISH_GRACE_MS` | 3000, 30000 | start lights, time left after the winner |
| `RESPAWN_GHOST_MS`, `RESPAWN_COOLDOWN_MS` | 1500, 3000 | |
| `WRONG_WAY_ANGLE`, `WRONG_WAY_MS` | 120°, 1000 | |
| `TICK_RATE`, `SNAPSHOT_RATE` | 60, 20 | |
| `INTERP_DELAY_MS`, `SNAP_DISTANCE` | 120, 30 | |
| `RECONNECT_GRACE_MS`, `RATE_LIMIT_PER_SEC` | 15000, 120 | |
| `ZOOM_DEFAULT` / `ZOOM_MIN` / `ZOOM_MAX` | 2.5 / 0.8 / 4 | camera (phones start zoomed out further) |
| `MAX_PARTICLES`, `MAX_SKIDS` | 300, 400 | effect pools |

## Adding a map

Add an entry to `MAPS` in `shared/maps.js`:

```js
{
  id: 'my-track', name: 'My Track', difficulty: 'Medium', width: 80, theme: THEMES.grass,
  points: [
    [500, 110, 0],      // [x, y, cornerRadius]: first point = start/finish line, put it mid-straight (radius 0)
    [1000, 110, 150],   // corner: rounded with a 150-unit radius
    [1000, 600, 150],
    [120, 600, 150],
    [120, 110, 150],
  ],
}
```

- The car is 8 × 16 units. Current tracks are about 1000 × 700 with widths of 95–120 and laps of 2,000–3,500 units (about 20–40 s). The world size is computed from the track automatically.
- Keep the first point at least `width / 2 + 20` from the top and left edges.
- The track runs through the points in order and closes back to the first one. Every corner becomes a circular arc of the given radius, and the result is smoothed with a centripetal Catmull-Rom spline sampled every 4 units.
- A hairpin is two 90° corners close together, for example `[700, 300, 62], [700, 500, 62]`.
- Run `npm run validate`. The server also refuses to start with an invalid map. The checks are:
  - no self-intersection;
  - parts more than `3 × width` apart along the track must be at least `width + 40` apart in space, so walls never overlap or open shortcuts;
  - every corner radius is at least `halfWidth + 12`;
  - the whole track stays inside the world.
- Run `npm run simulate my-track` to watch 8 bots race it headlessly.

## Tests

```bash
npm test
```

- **physics:** same inputs give the same state after 600 ticks; the edge zone is slower than asphalt.
- **maps:** all 6 maps pass validation; grid slots are on track and face forwards.
- **walls:** 1000 random full-speed (and over-speed) wall hits per map, and no corner ever leaves the track.
- **collision:** SAT and impulses; 300 random high-speed crashes per map leave no overlap and no car off the track.
- **laps:** reversing over the line, skipping checkpoints, and exactly 10 laps to finish.
- **room:** ready/host/bots rules, frozen start, respawn ghost and cooldown, 15 s reconnect, host handover, input queue rules.
- **netcode:** a simulated client with latency and jitter predicts its own car; prediction must match the server exactly (< 1e-6).
- **boost:** fills faster when drifting, only fires at 100%, faster for 1.5 s, then back to normal.
- **race-sim:** a full 10-lap race with 8 bots on every map, with no sockets and run at full speed. It checks for exactly one winner, a correctly sorted table, correct DNF handling, no NaN, and no car outside the track at any tick.
- **split hosting:** the static build served from one origin connects to a game server on another (CORS allowed), and a non-allowed origin is refused.
- **smoke:** Playwright runs 2 browser contexts: create a room, join it by code, race, hold the throttle for 5 s. Both views must see 2 cars moving and there must be no console errors. If no Chromium is available, this test is skipped. Install one with `npx playwright install chromium`.

## Deploying

The game server needs a long-running Node process that keeps WebSockets open.
**Vercel can't run it.** Its serverless functions are short-lived and can't hold Socket.IO connections.
So the setup is:

- **Front end** (the page, client JS, shared code): **Vercel**, as static files.
- **Game server** (`server/`): **Render** (or Railway, Fly.io, any VPS).

```
Browser ──https──▶ your-project.vercel.app      (static page: dist/)
   └─────wss────▶ tiny-racers-server.onrender.com (Socket.IO game server)
```

### 1. Game server on Render

1. In Render, go to **New → Blueprint** and pick this repo. It reads [render.yaml](render.yaml).
   Or create a **Web Service** by hand with build `npm install --omit=dev`, start `npm start` and health check `/health`.
2. Set the `CORS_ORIGIN` env var to your Vercel URL(s), comma-separated. `*` wildcards are allowed for preview deploys. For example:
   `https://tiny-racers.vercel.app,https://tiny-racers-*.vercel.app`
3. Copy the service URL, e.g. `https://tiny-racers-server.onrender.com`. Opening `/health` should return `{"ok":true,...}`.

Free Render services sleep after about 15 minutes idle. The first visitor then waits about 30 s while it wakes up, and the page shows a "Connecting…" message meanwhile. A paid instance stays awake.

### 2. Front end on Vercel

1. Import the repo in Vercel. [vercel.json](vercel.json) already sets everything: no framework, build `node scripts/build-static.js`, output `dist`.
2. In **Project → Settings → Environment Variables**, add `GAME_SERVER_URL` = your Render URL (no trailing slash).
3. Deploy. The build copies `public/` and `shared/` into `dist/` and writes `dist/config.js` pointing at the game server.

If you change `GAME_SERVER_URL`, redeploy on Vercel. If your Vercel domain changes, update `CORS_ORIGIN` on Render.

### All-in-one (no Vercel)

`npm start` on Render or Railway serves both the page and the game from one URL. No `CORS_ORIGIN` or `GAME_SERVER_URL` is needed.

### Environment variables

| Where | Variable | Purpose |
|---|---|---|
| Game server | `PORT` | port to listen on (hosts set this) |
| Game server | `CORS_ORIGIN` | front-end origins allowed to connect (comma list, `*` wildcards). Unset = same origin only |
| Vercel build | `GAME_SERVER_URL` | game server URL written into `config.js` |

All rooms live in memory in one process. Run a single server instance; scaling out would need sticky sessions plus a shared room store.
