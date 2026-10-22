import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../shared/maps.js';
import { buildTrack, pointAt } from '../shared/track.js';
import { createCar, stepCar, isOutside } from '../shared/physics.js';
import { PHYSICS, CAR_RADIUS } from '../shared/constants.js';
import { mulberry32 } from '../server/bot.js';

const TRIALS = 1000;

for (const map of MAPS) {
  test(`${map.name}: ${TRIALS} full-speed wall hits never leave the track`, () => {
    const track = buildTrack(map);
    const rng = mulberry32(map.id.length * 7919);
    const top = PHYSICS.maxPower * PHYSICS.drag / (1 - PHYSICS.drag);
    let wallHits = 0;
    for (let t = 0; t < TRIALS; t++) {
      const p = pointAt(track, rng() * track.length);
      const lat = (rng() * 2 - 1) * (track.halfWidth - CAR_RADIUS - 0.5);
      const angle = rng() * Math.PI * 2;
      // sometimes far faster than a car can drive (e.g. after a big shunt)
      const speed = top * (rng() < 0.2 ? 1 + rng() * 2 : 1);
      let s = createCar(p.x + p.nx * lat, p.y + p.ny * lat, angle, p.seg);
      s.power = PHYSICS.maxPower;
      s.xVelocity = Math.sin(angle) * speed;
      s.yVelocity = -Math.cos(angle) * speed;
      const steer = rng();
      for (let i = 0; i < 90; i++) {
        s = stepCar(s, { up: true, left: steer < 0.3, right: steer > 0.7 }, track);
        if (s.wallHit) wallHits++;
        if (isOutside(s, track, 0.5, s.seg)) assert.fail(`trial ${t} tick ${i}: car outside at (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`);
      }
    }
    assert.ok(wallHits > TRIALS / 2, `walls were actually hit (${wallHits})`);
  });
}
