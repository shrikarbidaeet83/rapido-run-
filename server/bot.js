// AI driver: aims at a point ahead on the centerline and lifts/brakes before
// sharp corners. Uses exactly the same physics and lap rules as humans.

import { pointAt, turnAhead } from '../shared/track.js';
import { speedOf } from '../shared/physics.js';

export const BOT_NAMES = ['Ada', 'Turbo', 'Pixel', 'Nitro', 'Comet', 'Blip', 'Zippy', 'Rusty', 'Dash', 'Echo'];

// Small seeded RNG so simulations are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBotBrain(rng) {
  return {
    skill: 0.94 + rng() * 0.06,       // fraction of the ideal corner speed it dares
    lane: (rng() - 0.5) * 0.5,        // preferred lateral offset (fraction of half width)
    look: 50 + rng() * 20,            // base lookahead distance (≈60)
    stuckTicks: 0,
  };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Returns { up, down, left, right, respawn }.
export function botInput(brain, car, track) {
  const st = car.state;
  const speed = speedOf(st);
  const along = track.s[st.seg >= 0 ? st.seg : 0];

  const look = brain.look + speed * 18;
  const p = pointAt(track, along + look);
  const lane = brain.lane * (track.halfWidth - track.kerbWidth - 8);
  const tx = p.x + p.nx * lane, ty = p.y + p.ny * lane;
  const desired = Math.atan2(tx - st.x, -(ty - st.y));
  const err = wrap(desired - st.angle) - st.angularVelocity * 9;

  const input = { up: true, down: false, left: err < -0.025, right: err > 0.025, respawn: false };

  // corner speed: look further ahead the faster we go
  const turn = Math.max(turnAhead(track, along + 15, 70 + speed * 45), turnAhead(track, along + 40, 90 + speed * 50));
  const tight = Math.min(1, turn / (Math.PI * 0.5));
  const narrow = Math.min(1, track.width / 90);
  const target = (1.72 - tight * (0.95 - 0.25 * narrow)) * brain.skill;
  if (speed > target) {
    input.up = false;
    if (speed > target + 0.25) input.down = true;
  }
  // big heading error (after a spin): slow down and turn on the spot
  if (Math.abs(wrap(desired - st.angle)) > 1.2) {
    input.up = speed < 0.4;
  }

  // stuck or facing the wrong way for too long → respawn
  if (speed < 0.15 || car.wrongWay) brain.stuckTicks++;
  else brain.stuckTicks = Math.max(0, brain.stuckTicks - 2);
  if (brain.stuckTicks > 150) { input.respawn = true; brain.stuckTicks = 0; }
  return input;
}
