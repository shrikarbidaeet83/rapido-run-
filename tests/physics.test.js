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

test('edge (kerb) zone reduces speed compared to asphalt', () => {
  const track = buildTrack(MAPS[0]); // Speed Ring: long straight at the start
  const start = pointAt(track, 5);
  const angle = Math.atan2(start.tx, -start.ty);
  const run = (lat) => {
    let s = createCar(start.x + start.nx * lat, start.y + start.ny * lat, angle, start.seg);
    let kerbTicks = 0;
    for (let i = 0; i < 120; i++) { s = stepCar(s, { up: true }, track); if (s.onKerb) kerbTicks++; }
    return { speed: speedOf(s), kerbTicks };
  };
  const asphalt = run(0);
  const kerb = run(track.halfWidth - 9.5); // corner rides on the kerb stripe
  assert.equal(asphalt.kerbTicks, 0);
  assert.ok(kerb.kerbTicks > 100, `kerb ticks ${kerb.kerbTicks}`);
  assert.ok(kerb.speed < asphalt.speed * 0.9, `kerb ${kerb.speed} vs asphalt ${asphalt.speed}`);
});

test('boost meter fills slowly when driving and much faster when drifting', () => {
  const straight = () => {
    let s = createCar(0, 0, 0);
    for (let i = 0; i < 300; i++) s = stepCar(s, { up: true }, null);
    return s.boost;
  };
  const drifting = () => {
    let s = createCar(0, 0, 0);
    for (let i = 0; i < 120; i++) s = stepCar(s, { up: true }, null);
    const start = s.boost;
    let driftTicks = 0;
    for (let i = 0; i < 180; i++) { s = stepCar(s, { up: true, left: true }, null); if (s.drifting) driftTicks++; }
    return { gained: s.boost - start, driftTicks };
  };
  const a = straight();
  const d = drifting();
  assert.ok(a > 0.2 && a < 0.5, `straight-line fill after 5 s: ${a}`);
  assert.ok(d.driftTicks > 60, `actually drifted (${d.driftTicks} ticks)`);
  assert.ok(d.gained > 0.6, `drifting fills much faster (gained ${d.gained} in 3 s)`);
});

test('boost only fires at 100%, then gives a faster burst for 1.5 s', () => {
  let s = createCar(0, 0, 0);
  for (let i = 0; i < 300; i++) s = stepCar(s, { up: true }, null);
  const cruise = speedOf(s);
  s = stepCar({ ...s, boost: 0.99 }, { up: true, boost: true }, null);
  assert.equal(s.boostTicks, 0, 'not full: nothing happens');
  s = stepCar({ ...s, boost: 1 }, { up: true, boost: true }, null);
  assert.ok(s.boostTicks > 0 && s.boost === 0, 'fired and meter emptied');
  let peak = 0, ticks = 1;
  while (s.boostTicks > 0) { s = stepCar(s, { up: true }, null); peak = Math.max(peak, speedOf(s)); ticks++; }
  assert.equal(ticks, 90);
  assert.ok(peak > cruise * 1.3, `boost speed ${peak} vs ${cruise}`);
  for (let i = 0; i < 200; i++) s = stepCar(s, { up: true }, null);
  assert.ok(Math.abs(speedOf(s) - cruise) < 0.05, 'back to normal top speed afterwards');
});
