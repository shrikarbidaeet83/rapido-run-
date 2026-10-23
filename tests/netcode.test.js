// Client-side prediction must match the server exactly (no rubber-banding):
// a simulated client with network latency + jitter talks to a real Room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { stepCar } from '../shared/physics.js';
import { mulberry32 } from '../server/bot.js';

function unpackOwn(m) {
  return { x: m[0], y: m[1], angle: m[2], xVelocity: m[3], yVelocity: m[4], power: m[5], reverse: m[6],
    angularVelocity: m[7], boost: m[8], boostTicks: m[9], seg: m[10], onKerb: false, drifting: false };
}

for (const [latency, jitter] of [[0, 0], [5, 0], [9, 4]]) {
  test(`prediction matches the server exactly (latency ${latency} ticks, jitter ±${jitter})`, () => {
    const rng = mulberry32(latency * 100 + jitter + 1);
    const toServer = [], toClient = [];
    // TCP: later packets never overtake earlier ones
    let lastUp = 0, lastDown = 0;
    const upAt = () => (lastUp = Math.max(lastUp, now + latency + Math.floor(rng() * (jitter + 1))));
    const downAt = () => (lastDown = Math.max(lastDown, now + latency + Math.floor(rng() * (jitter + 1))));
    const room = new Room('NETC', {
      seed: 1,
      send: (p, ev, data) => { if (ev === 's') toClient.push({ at: downAt(), data }); },
    });
    let now = 0;
    room.addPlayer({ id: 'a', name: 'A' });
    room.setFillBots('a', false);
    room.setReady('a', true);
    room.startRace('a', { realtime: false });
    const track = room.race.track, go = room.race.goTick;
    const slot = track.gridSlots[0];

    // client state (same algorithm as public/main.js)
    let pred = null, tickDelta = null, localTick = 0, history = [], maxErr = 0, checks = 0;
    const live = (t) => tickDelta != null && t + tickDelta > go;
    let held = { up: true, left: false, right: false, down: false, boost: false };

    for (now = 0; now < 1500; now++) {
      // client: one tick, numbered, sent with latency
      if (now % 40 === 0) held = { up: rng() < 0.85, down: rng() < 0.1, left: rng() < 0.4, right: rng() < 0.3, boost: rng() < 0.5 };
      const t = localTick++;
      const bits = (held.up ? 1 : 0) | (held.down ? 2 : 0) | (held.left ? 4 : 0) | (held.right ? 8 : 0) | (held.boost ? 16 : 0);
      toServer.push({ at: upAt(), t, bits });
      if (!pred) pred = { x: slot.x, y: slot.y, angle: slot.angle, xVelocity: 0, yVelocity: 0, power: 0, reverse: 0, angularVelocity: 0, boost: 0, boostTicks: 0, seg: slot.seg };
      if (live(t)) pred = stepCar(pred, held, track);
      history.push({ t, input: { ...held } });

      // network delivery
      while (toServer.length && toServer[0].at <= now) { const m = toServer.shift(); room.queueInputs('a', m.t, [m.bits]); }
      room.step();
      while (toClient.length && toClient[0].at <= now) {
        const snap = toClient.shift().data;
        if (snap.a < 0) continue;
        tickDelta = snap.t - snap.a;
        history = history.filter((h) => h.t > snap.a);
        let rec = unpackOwn(snap.m);
        for (const h of history) if (live(h.t)) rec = stepCar(rec, h.input, track);
        if (snap.t > go + 30) {
          maxErr = Math.max(maxErr, Math.hypot(rec.x - pred.x, rec.y - pred.y));
          checks++;
        }
        pred = rec;
      }
    }
    assert.ok(checks > 50, `reconciled ${checks} times`);
    assert.ok(maxErr < 1e-6, `prediction error ${maxErr}`);
    room.destroy();
  });
}
