import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../shared/maps.js';
import { buildTrack, validateTrack, nearest } from '../shared/track.js';

test('there are 6 maps with unique ids', () => {
  assert.equal(MAPS.length, 6);
  assert.equal(new Set(MAPS.map((m) => m.id)).size, 6);
});

for (const map of MAPS) {
  test(`map "${map.name}" passes validation`, () => {
    const track = buildTrack(map);
    assert.deepEqual(validateTrack(track), []);
    assert.equal(track.checkpoints.length, 16);
    assert.equal(track.gridSlots.length, 8);
    for (const slot of track.gridSlots) {
      const n = nearest(track, slot.x, slot.y);
      assert.ok(Math.abs(n.lat) + 9 < track.halfWidth, 'grid slot inside the track');
      // facing the race direction
      const fx = Math.sin(slot.angle), fy = -Math.cos(slot.angle);
      assert.ok(fx * track.tx[n.seg] + fy * track.ty[n.seg] > 0.95);
    }
  });
}
