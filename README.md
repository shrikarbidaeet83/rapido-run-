# Game Arcade: Tiny Racers + Shell Shock Arena

Two online multiplayer browser games share one Node server and one repo. Opening the site (`/`) shows a page that asks **which game to play**:

| Path | Game |
|---|---|
| `/race/` | **Tiny Racers**: 8-player top-down car racing (real-time) |
| `/tanks/` | **Shell Shock Arena**: 2–4 player turn-based artillery with 40 weapons, bots and invite links |

Invite links keep working from the root: `/?room=ABCD` (4 letters) forwards to Tiny Racers, and `/?room=K7QX2` (5 characters) forwards to Shell Shock Arena.

```bash
npm install && npm start
# open http://localhost:3000   (port: process.env.PORT || 3000)
npm test                       # all tests for both games
```

Both games use the same stack: Node.js 20+, Express and Socket.IO 4 on an authoritative server; vanilla ES modules and Canvas 2D on the client, with no framework and no build step. Shared simulation code lives in `/shared`, so the server and the browser run exactly the same physics. The racer uses the default Socket.IO namespace and the tank game uses `/tanks`.

---

# Shell Shock Arena

A 2D side-view, turn-based artillery game in the style of Pocket Tanks, with original names, art and sounds. Tanks sit on hilly, destructible terrain. Players draft weapons, then take turns setting **angle + power** and firing shells that arc under gravity and wind.

## Playing

- **Home screen:** pick a name, tank body (6 styles) and colour (8). Then choose **Create Room**, **Join with Code**, **Quick Match** (joins any open public lobby), **Play vs Bot** or **Local 2-Player** (both players on one device, taking turns).
- **Lobby:** up to 4 players. Ready toggles; the host has a crown and can kick, add bots (Easy/Medium/Hard) and change the settings: mode, map, weapon count (5/10/15), turn timer (20/30/45 s/off), wind, friendly fire, walls (none/wrap/bounce), 2 teams, and private/public. There is chat plus emoji reactions (😂 🔥 💀 👏 GG), which also pop up as bubbles over tanks during a match.
- **Draft:** a pool of `weapons × players + 5` weapons, picked one at a time in **snake order** (A B C C B A …), 15 s per pick. If the timer runs out, a random weapon is picked for you. The pool can repeat weapons, but the Nuke appears at most once.
- **Turns:** on your turn, aim, pick a weapon, optionally **move** (4 moves per match, up to 60 px each, no slopes steeper than 60°), then **fire**. One shot per turn; each weapon is used up when fired. If the turn timer runs out, the turn is skipped and its weapon is lost.
- **Modes:** **Classic Score** (damage dealt = points; self/teammate damage costs points; highest score wins) and **Survival** (100 HP; last tank or team alive wins; if the shots run out, highest HP wins).
- **Wind** changes every turn (−10…+10) and is shown top-centre.
- **Falling:** when the ground under a tank is destroyed, the tank falls and takes `0.2 × height` damage (max 20).
- **Results:** winner celebration, a stats table (score/HP, damage, best shot, accuracy, self-damage), awards (Sharpshooter, Demolition Expert, Biggest Hit), the room's win leaderboard, and **Rematch**, **Back to Lobby** and **Share Result** (PNG image).

### Controls

| Action | Mouse / touch | Keyboard | Gamepad |
|---|---|---|---|
| Aim | drag anywhere: the direction from your tank sets the angle, the distance sets the power | ← / → angle, ↑ / ↓ power (hold **Shift** for 0.1 steps) | left stick (angle), right stick / triggers (power) |
| Fire | **FIRE** button | Space / Enter | A |
| Move | ◀ ▶ buttons | A / D | D-pad ← → |
| Switch weapon | ‹ › or tap the weapon card for the list | Q / E | LB / RB |
| Menu (volume, screen shake, leave) | ☰ | Esc | Start |
| Mute | menu | M | |

The dotted aim guide shows only the first 15% of the flight, so aiming still takes skill. A Tracer shot leaves its whole path visible until your next shot.

### Invite links

Creating a room gives a 5-character code and a link like `https://your-domain/tanks/?room=K7QX2`:

- **Copy Link** copies it.
- **Share** opens the phone's share sheet (WhatsApp, Instagram, …) through `navigator.share`, falling back to copying.
- **QR** draws a QR code to scan with a phone. It loads `qrcode-generator@1.4.4` from cdnjs only when you press it.

Opening the link goes straight to "enter your name → Join Lobby". The name is remembered, so next time it's one click. Rooms are private by default. Public rooms appear in **Quick Match**. Anyone who opens the link after the match has started watches as a spectator and joins the next match.

**Disconnects:** a player has 60 s to come back (same browser; a session token is kept in `localStorage`) and gets their tank back. Meanwhile their turns are skipped. After 60 s, a bot takes over the tank and is shown with a BOT tag. If the host leaves, the next player becomes host. Rooms with no one connected are deleted after 5 minutes.

## Weapons (40)

| # | Weapon | What it does |
|---|---|---|
| 1 | Single Shell | One shell, radius 30, 30 dmg |
| 2 | Heavy Shell | Radius 50, 45 dmg |
| 3 | Mega Bomb | Radius 90, 60 dmg, big crater |
| 4 | Triple Shot | 3 shells in a 6° spread |
| 5 | Five Spread | 5 shells in a 12° spread |
| 6 | Sniper Round | Very fast and flat; 70 dmg on a direct hit only |
| 7 | Machine Gun | 12 small rounds in sequence, 6 dmg each |
| 8 | Napalm | Burning liquid flows downhill for 3 s, 3 dmg per tick |
| 9 | Dirt Ball | Drops a ball of dirt (radius 60) |
| 10 | Dirt Slinger | Raises the ground up to 40 px over a wide area |
| 11 | Digger | Tunnels 120 px down from the impact |
| 12 | Roller | Rolls downhill, explodes when it stops or touches a tank |
| 13 | Skipper | Skips across the ground 4 times with small blasts |
| 14 | Chain Reaction | 6 explosions in a line moving forward |
| 15 | Splitter | Splits into 3 shells at its apex |
| 16 | Tracer | No damage; leaves a glowing trail for aiming |
| 17 | Leech | 25 dmg; you gain the same back as points (or HP) |
| 18 | Hail Storm | 8 ice pellets fall over 200 px |
| 19 | Crazy Shot | A random classic weapon effect |
| 20 | Earth Spike | A rock spike throws nearby tanks into the air (fall damage) |
| 21 | Meteor Shower | A sky portal rains 6 meteors, 15 dmg each |
| 22 | Black Hole | Pulls tanks in for 2 s, then collapses (up to 50 dmg) |
| 23 | Lightning Strike | Bolt to the nearest enemy within 250 px for 35 |
| 24 | Cluster Bomb | 7 bomblets at the apex |
| 25 | Bouncing Betty | Bounces 3 times, exploding each time for 18 |
| 26 | Homing Missile | Steers toward the nearest enemy after its apex (2°/step) |
| 27 | Laser Beam | Instant beam, power × 12 px long, cuts terrain, 45 dmg |
| 28 | Earthquake | 2 s quake breaks and lowers the ground within 300 px, +10 dmg |
| 29 | Volcano | Raises a cone that erupts 8 lava blobs; the lava flows |
| 30 | Ice Bomb | Radius 50, 25 dmg; frozen tanks can't move next turn and power is capped at 80% |
| 31 | Acid Rain | A cloud drifts with the wind for 3 s, eroding terrain, 2 dmg per drop |
| 32 | Drill Torpedo | Burrows up to 200 px through terrain, then explodes (radius 55) |
| 33 | Teleport Shot | Your tank teleports to where it lands (doesn't use a move) |
| 34 | Energy Shield | Not fired: absorbs the next 40 damage (lasts 2 enemy turns) |
| 35 | Airstrike | A jet drops 5 bombs in a line over the impact |
| 36 | Firework | Bursts at its apex into 12 sparks, 5 dmg each |
| 37 | Sticky Mine | Arms after 1 turn; explodes (45 px, 40 dmg) when a tank moves within 60 px, or at the start of your next turn |
| 38 | Mega Wall | Builds a 30 × 180 px dirt wall |
| 39 | Magnet Pulse | Pulls enemies within 250 px up to 80 px in, 15 dmg |
| 40 | Nuke | Slow shell, radius 150, 80 dmg, huge crater (legendary, max 1 per pool) |

**Damage:** `maxDamage × (1 − distance / radius)`, where the distance is measured from the blast to the nearest point of the tank's hitbox. A **direct hit** adds 25%. Shields absorb damage first, and absorbed damage scores nothing.

### Adding a weapon

Weapons are data plus a behaviour, both in [shared/tanks/weapons.js](shared/tanks/weapons.js):

```js
// 1. data: add to WEAPONS
{ id: 'bigbounce', name: 'Big Bounce', icon: '🏀', rarity: 'rare', color: '#ff9f43',
  behavior: 'betty', params: { bounces: 5, restitution: 0.7, r: 40, dmg: 20 }, desc: 'Bounces 5 times.' },

// 2. behaviour (only if no existing one fits): add to BEHAVIORS
myBehavior(sim, P, c) {             // P = params (+ style, color), c = { angle, power, weapon }
  sim.fire(c.angle, c.power, {      // a ballistic shell from the turret
    r: P.r, dmg: P.dmg, style: P.style,
    onApex(s, p) { /* optional: at the top of the arc */ },
    onStep(s, p) { /* optional: every physics step */ },
    onHit(s, p, hit) { s.explode(p.x, p.y, P.r, P.dmg, { direct: hit.tank }); },
  });
},
```

The `Sim` API (in [shared/tanks/simulate.js](shared/tanks/simulate.js)) includes `fire`, `shell`, `explode`, `hurt`, `carve`, `terrainOp`, `after(steps, fn)`, `add(entity)`, `event`, `nearestEnemy`, `shove` and `rng` (seeded). Never use `Math.random` or `Date.now` inside a behaviour. The determinism tests cover every entry in `WEAPONS` automatically, and `rarity` sets how often the weapon appears in draft pools (common 4, rare 3, epic 2, legendary 1).

## Maps

| Theme | Special rule |
|---|---|
| Green Hills | normal |
| Desert Dunes | stronger wind (1.6×) |
| Snow Peaks | slippery: moves go 1.5× farther |
| Volcanic | normal (ember hazard off), glowing lava edges |
| Moon Base | low gravity (0.4×), weaker wind |
| Neon City | normal, glow-heavy visuals |

Each map has its own seeded terrain generator, palette and parallax background. There are no image files; everything is drawn with canvas gradients and shapes. Spawn pads are flattened and at least 300 px apart.

## How a shot stays in sync

1. The client sends `fire { slot, angle, power }`. The server checks that it's that player's turn, the weapon is theirs and unused, and the values are in range.
2. The server picks a seed and runs `simulateShot(state, input, seed)`, which returns the new state, an event timeline and a state hash. All randomness comes from the seed (mulberry32), and the physics runs at a fixed 120 steps/s, with sub-steps of at most 4 px so shells never tunnel through thin hills.
3. The server broadcasts `shot { input, seed, events, hash, terrain diff (changed column ranges), tanks, mines }`.
4. Each client replays the shot locally with the same shared code to animate the flight. Damage numbers come from the server's timeline, never from the client's own simulation. When the animation ends, the client applies the server's final state and checks the hash. On a mismatch it asks the server for a full resync, so a desync can't last.

Safety limits per shot: 400 projectiles, 60 explosions, 20 s of simulation, a 12 s lifetime per shell, and at most 4 wall wraps/bounces per shell. Sticky mines, shields and frozen status live in the authoritative state and are sent with every turn. Napalm, lava and acid play out fully inside the shot that created them.

## Tunable constants ([shared/tanks/constants.js](shared/tanks/constants.js))

| Constant | Value | Meaning |
|---|---|---|
| `WORLD_W` × `WORLD_H` | 1600 × 900 | logical world, letterboxed to any screen |
| `STEP_RATE`, `SUBSTEP_PX` | 120, 4 | physics steps per second; max shell move per collision check |
| `GRAVITY`, `POWER_K` | 300, 7 | px/s²; launch speed per power point |
| `WIND_MAX`, `WIND_FACTOR` | 10, 6 | wind range; px/s² per wind point |
| `MAX_PROJECTILES`, `MAX_EXPLOSIONS`, `MAX_SIM_SECONDS` | 400, 60, 20 | per-shot safety limits |
| `SHELL_MAX_SECONDS`, `MAX_WALL_HITS` | 12, 4 | a single shell's lifetime and wall uses |
| `TANK_W`, `TANK_H`, `TANK_HP` | 36, 18, 100 | hitbox and Survival HP |
| `FALL_DMG_PER_PX`, `FALL_DMG_MAX` | 0.2, 20 | fall damage |
| `DIRECT_HIT_BONUS` | 0.25 | +25% |
| `MOVES_PER_MATCH`, `MOVE_DISTANCE`, `MOVE_MAX_SLOPE` | 4, 60, tan 60° | moving |
| `SHIELD_HP`, `SHIELD_TURNS`, `FROZEN_POWER_CAP` | 40, 2, 80 | statuses |
| `MINE_RADIUS`, `MINE_DAMAGE`, `MINE_TRIGGER` | 45, 40, 60 | sticky mines |
| `DRAFT_PICK_SECONDS`, `POOL_EXTRA` | 15, 5 | draft |
| `TURN_TIMES`, `WEAPON_COUNTS` | 20/30/45/off, 5/10/15 | host choices |
| `RECONNECT_SECONDS`, `EMPTY_ROOM_MINUTES` | 60, 5 | |
| `MAX_ROOMS`, `CHAT_MAX`, `CHAT_PER_10S`, `RATE_LIMIT_PER_SEC` | 500, 120, 6, 30 | server limits |
| `BOT_THINK_MS` | 1000–2000 | bot "thinking" time before firing |

## Bots

Bots aim by simulating candidate shots. A fast ballistic probe over the angle/power grid (wind and gravity included) finds shots that land near the target. The best few are then scored with the real `simulateShot`: damage dealt minus 1.5 × self-damage.

- **Easy** picks random weapons and adds a large aim error.
- **Medium** prefers high-damage weapons and adds a small error.
- **Hard** compares its top 3 weapons, aims almost perfectly, moves when it has no good shot, and raises a shield when low on HP in Survival.

Bots wait 1–2 s before firing and visibly turn their turret first.

## Layout

```
public/index.html          game chooser (forwards ?room= links)
public/race/               Tiny Racers client
public/tanks/              Shell Shock Arena client
  index.html, style.css
  main.js                  screens, networking, lobby, draft, shot playback, HUD, results
  render.js                parallax layers, camera, terrain (re-rendered by column range), tanks, projectiles
  fx.js                    pooled particles (max 1500), explosions, shockwaves, smoke, debris, bolts, beams
  input.js                 mouse/touch drag aiming, keyboard, gamepad
  audio.js                 WebAudio synthesized sounds (no audio files)
shared/tanks/              constants, rng, terrain, physics, weapons, simulate, maps (server + client)
server/tanks/index.js      /tanks Socket.IO namespace, room manager, invite codes, rate limits
server/tanks/room.js       Room: lobby → draft → match → results, timers, reconnects, chat
server/tanks/game.js       Match logic (pure, no timers): draft, turns, moves, mines, results
server/tanks/bot.js        AI players
tests/tanks/               determinism, rules, full-match, room and browser smoke tests
```

## Tests (Shell Shock Arena)

- **determinism:** each of the 40 weapons is run with 50 random seeds across all maps, modes and wall types. The same input and seed must give the same hash and events. Every shot must end within the limits, terrain must stay within bounds with no NaN, and no tank may end up outside the map or inside the terrain.
- **rules:** damage falloff, direct-hit bonus, self-damage, friendly fire on/off, Survival death, fall damage, Leech, shields, moves (4 per match, slopes, edges), frozen tanks, mines (arming, proximity, owner's turn), draft (snake order, pool size, max 1 Nuke, N unique slots each, only the current picker can pick), terrain craters/diffs, and spawn spacing.
- **match-sim:** a full 4-bot match on all 6 maps in both modes, using server code only. It checks for one winner (or a correct tie), that all weapons are used, that each score equals damage − self-damage + Leech, no NaN, no stuck turns, and team results.
- **room:** lobby rules, chat sanitising and rate limits, draft auto-pick and turn timeouts (timers sped up), reconnect and bot takeover, spectators, cleanup of empty rooms and timers, and local 2-player rooms.
- **smoke (Playwright):** A opens the chooser, creates a room and copies the invite link. B opens that link and joins. Both ready up and draft, then A fires. Both browsers must show the same scores and state hash as the server, with no console errors.

## Deploying on Render (Web Service)

1. Push the repo to GitHub. In Render, go to **New → Web Service** and pick the repo.
2. Settings:
   - Runtime **Node**
   - Region **Singapore**
   - Build command **`npm install`**
   - Start command **`npm start`**
   - Health check path `/health`
3. Deploy. Both games are served from the one URL: `https://<service>.onrender.com/` (the chooser), `/race/` and `/tanks/`. Invite links use whatever domain you opened the game on.

[render.yaml](render.yaml) describes the same service as a Blueprint. To host the static pages on Vercel and only the game server on Render, see **Deploying** below. Both games use the same `GAME_SERVER_URL` / `CORS_ORIGIN` settings.

## Known limitations

- Rooms live in memory in one process. A server restart ends the current games, and the server can't be scaled to several instances without sticky sessions and a shared store.
- Clients replay shots with the shared simulation. Different browser engines could in theory round `Math.sin` differently. If they do, the flight animation may differ slightly, but the final state always snaps to the server's, so scores never desync.
- The QR code needs the cdnjs script, so it is unavailable offline (Copy Link and Share still work).
- Persistent napalm, lava and acid play out within the shot that created them, rather than lingering into later turns.

---

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
# open http://localhost:3000/race/   (port: process.env.PORT || 3000)
```

To test alone: create a room, keep **Fill empty slots with bots** ticked, click **Ready**, then **Start Race**.
To play with friends: share the room code or the **Copy link** URL (`/race/?room=ABCD`).

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
public/race/         index.html, main.js (screens/net/prediction/HUD), render.js, input.js, audio.js, style.css
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
