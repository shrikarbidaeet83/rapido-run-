import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCar, stepCar, speedOf } from '../shared/physics.js';
import { buildTrack, pointAt } from '../shared/track.js';
import { MAPS } from '../shared/maps.js';
import { PHYSICS } from '../shared/constants.js';
import { mulberry32 } from '../server/bot.js';

function inputsFor(seed, n) {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => ({ up: rng() < 0.8, down: rng() < 0.1, left: rng() < 0.3, right: rng() < 0.3 }));
}

test('physics is deterministic (same inputs → same state after 600 ticks)', () => {
  const track = buildTrack(MAPS[0]);
  const slot = track.gridSlots[0];
  const inputs = inputsFor(42, 600);
  const run = () => {
    let s = createCar(slot.x, slot.y, slot.angle, slot.seg);
    for (const i of inputs) s = stepCar(s, i, track);
    return s;
  };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
});

test('stepCar does not mutate its input', () => {
  const s = createCar(100, 100, 0);
  const copy = { ...s };
  stepCar(s, { up: true, left: true }, null);
  assert.deepEqual(s, copy);
});

test('car keeps sliding after letting go of the throttle', () => {
  let s = createCar(0, 0, 0);
  for (let i = 0; i < 200; i++) s = stepCar(s, { up: true }, null);
  const top = speedOf(s);
  assert.ok(Math.abs(top - PHYSICS.maxPower * PHYSICS.drag / (1 - PHYSICS.drag)) < 0.05, `top speed ${top}`);
  s = stepCar(s, {}, null);
  assert.ok(speedOf(s) > top * 0.9);
});

test('kerb zone reduces speed compared to asphalt', () => {
  const track = buildTrack(MAPS[0]); // Speed Ring: long straight at the start
  const start = pointAt(track, 40);
  const angle = Math.atan2(start.tx, -start.ty);
  const run = (lat) => {
    let s = createCar(start.x + start.nx * lat, start.y + start.ny * lat, angle, start.seg);
    let kerbTicks = 0;
    for (let i = 0; i < 240; i++) { s = stepCar(s, { up: true }, track); if (s.onKerb) kerbTicks++; }
    return { speed: speedOf(s), kerbTicks };
  };
  const asphalt = run(0);
  const kerb = run(track.halfWidth - 9.5); // corner rides on the kerb stripe
  assert.equal(asphalt.kerbTicks, 0);
  assert.ok(kerb.kerbTicks > 200, `kerb ticks ${kerb.kerbTicks}`);
  assert.ok(kerb.speed < asphalt.speed * 0.9, `kerb ${kerb.speed} vs asphalt ${asphalt.speed}`);
});
