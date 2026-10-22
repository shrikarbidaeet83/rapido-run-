import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../shared/maps.js';
import { buildTrack, pointAt } from '../shared/track.js';
import { updateProgress, newRaceCar } from '../server/room.js';
import { LAPS } from '../shared/constants.js';

const track = buildTrack(MAPS[1]);

function car() {
  return newRaceCar(0, { id: 'p', name: 'P', color: '#000' }, track.gridSlots[0], 0);
}

// Moves the car along the centerline from distance d0 to d1 in small steps.
function drive(rc, d0, d1, tick = { t: 0 }) {
  const dir = Math.sign(d1 - d0);
  let prev = pointAt(track, d0);
  for (let d = d0 + dir * 3; dir > 0 ? d <= d1 : d >= d1; d += dir * 3) {
    const p = pointAt(track, d);
    tick.t++;
    updateProgress(rc, prev.x, prev.y, p.x, p.y, track, tick.t);
    prev = p;
  }
  return tick;
}

test('10 valid laps = finished', () => {
  const rc = car();
  drive(rc, -30, track.length * LAPS + 10);
  assert.equal(rc.lapTimes.length, LAPS);
  assert.equal(rc.finished, true);
  assert.ok(rc.bestLap > 0 && rc.finishAt > 0);
});

test('9 laps is not finished', () => {
  const rc = car();
  drive(rc, -30, track.length * (LAPS - 1) + 10);
  assert.equal(rc.lapTimes.length, LAPS - 1);
  assert.equal(rc.finished, false);
});

test('going backward across the finish line does not count', () => {
  const rc = car();
  const t = drive(rc, -30, 20);       // cross the line forwards: race started
  assert.equal(rc.cpPassed, 1);
  drive(rc, 20, -60, t);              // back over the line
  drive(rc, -60, 20, t);              // and forwards again
  drive(rc, 20, -60, t);
  drive(rc, -60, 20, t);
  assert.equal(rc.cpPassed, 1);
  assert.equal(rc.lapTimes.length, 0);
});

test('reversing a whole lap from the grid never counts', () => {
  const rc = car();
  drive(rc, -30, -track.length * 2);
  assert.equal(rc.cpPassed, 0);
  assert.equal(rc.lapTimes.length, 0);
});

test('skipping checkpoints does not count', () => {
  const rc = car();
  const t = drive(rc, -30, 20);
  // jump past checkpoints 1..5, then drive on over the finish line
  const skipTo = track.checkpoints[6].s + 5;
  drive(rc, skipTo, track.length + 20, t);
  assert.equal(rc.lapTimes.length, 0);
  assert.equal(rc.cpPassed, 1);
});

test('a finished car stops counting laps', () => {
  const rc = car();
  drive(rc, -30, track.length * (LAPS + 2));
  assert.equal(rc.lapTimes.length, LAPS);
});
