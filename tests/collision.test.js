import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../shared/maps.js';
import { buildTrack, pointAt } from '../shared/track.js';
import { createCar, integrate, isOutside, speedOf } from '../shared/physics.js';
import { overlap, resolvePair, settle } from '../shared/collision.js';
import { mulberry32 } from '../server/bot.js';

test('SAT detects overlap and separation', () => {
  const a = createCar(0, 0, 0), b = createCar(6, 0, 0), c = createCar(20, 0, 0);
  assert.ok(overlap(a, b));
  assert.equal(overlap(a, c), null);
  const d = createCar(9, 0, Math.PI / 4); // rotated, corner-to-side
  assert.equal(!!overlap(a, d), true);
});

test('head-on impact bounces cars apart with restitution', () => {
  const a = createCar(0, 0, Math.PI / 2), b = createCar(17, 0, -Math.PI / 2);
  a.xVelocity = 1.5; b.xVelocity = -1.5;
  a.x += a.xVelocity; b.x += b.xVelocity; // one tick of closing speed → 2 units deep
  const hit = resolvePair(a, b);
  assert.ok(hit && hit.impact > 2.9);
  assert.ok(a.xVelocity < 0 && b.xVelocity > 0);
  assert.equal(overlap(a, b), null);
});

for (const map of MAPS) {
  test(`${map.name}: colliding cars never overlap after resolution and stay on track`, () => {
    const track = buildTrack(map);
    const rng = mulberry32(99 + map.width);
    for (let t = 0; t < 300; t++) {
      const p = pointAt(track, rng() * track.length);
      const lat = (rng() * 2 - 1) * (track.halfWidth - 10);
      const ax = p.x + p.nx * lat, ay = p.y + p.ny * lat;
      const a = createCar(ax, ay, rng() * 6.28, p.seg);
      const off = rng() * 6.28;
      const b = createCar(ax + Math.cos(off) * 6, ay + Math.sin(off) * 6, rng() * 6.28, p.seg);
      for (const [c, v] of [[a, 1.7 + rng() * 2], [b, 1.7 + rng() * 2]]) {
        const dir = rng() * 6.28;
        c.xVelocity = Math.cos(dir) * v; c.yVelocity = Math.sin(dir) * v;
      }
      a.id = 0; b.id = 1;
      for (let i = 0; i < 30; i++) {
        integrate(a, { up: true }, track);
        integrate(b, { up: true }, track);
        settle([a, b], track);
        const o = overlap(a, b);
        assert.ok(!o || o.depth < 0.05, `trial ${t} tick ${i}: overlap ${o && o.depth}`);
        assert.ok(!isOutside(a, track, 0.5, a.seg) && !isOutside(b, track, 0.5, b.seg), `trial ${t} tick ${i}: outside`);
        assert.ok(Number.isFinite(speedOf(a) + speedOf(b)));
      }
    }
  });
}
