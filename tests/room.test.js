import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Room, sanitizeName } from '../server/room.js';
import { COUNTDOWN_MS, TICK_MS, RECONNECT_GRACE_MS, RESPAWN_GHOST_MS, CHECKPOINTS } from '../shared/constants.js';

function makeRoom() {
  const sent = [];
  let emptied = false;
  const room = new Room('ABCD', { seed: 3, send: (p, ev, data) => sent.push({ to: p.id, ev, data }), onEmpty: () => { emptied = true; } });
  return { room, sent, isEmpty: () => emptied };
}

test('names are sanitized', () => {
  assert.equal(sanitizeName('<b>Bobby</b>'), 'bBobby/b');
  assert.equal(sanitizeName('averyveryverylongname').length, 12);
  assert.match(sanitizeName('   '), /^Driver\d{3}$/);
});

test('colours are unique per room and the host passes on when leaving', () => {
  const { room, isEmpty } = makeRoom();
  const a = room.addPlayer({ id: 'a', name: 'A', color: '#e53935' }).player;
  const b = room.addPlayer({ id: 'b', name: 'B', color: '#e53935' }).player;
  assert.notEqual(a.color, b.color);
  assert.equal(room.hostId, 'a');
  room.removePlayer('a');
  assert.equal(room.hostId, 'b');
  room.removePlayer('b');
  assert.equal(isEmpty(), true);
  assert.equal(room.destroyed, true);
});

test('room rejects a 9th player', () => {
  const { room } = makeRoom();
  for (let i = 0; i < 8; i++) assert.ok(room.addPlayer({ id: `p${i}`, name: `P${i}` }).player);
  assert.equal(room.addPlayer({ id: 'p9', name: 'P9' }).error, 'Room is full');
});

test('start needs the host and a ready player; bots fill to 8', () => {
  const { room } = makeRoom();
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  assert.equal(room.startRace('a', { realtime: false }), false, 'nobody ready');
  room.setReady('b', true);
  assert.equal(room.startRace('b', { realtime: false }), false, 'not host');
  assert.equal(room.startRace('a', { realtime: false }), true);
  assert.equal(room.race.cars.length, 8);
  assert.equal(room.race.cars.filter((c) => c.isBot).length, 6);
  assert.equal(new Set(room.race.cars.map((c) => c.color)).size, 8);
});

test('without bots only humans race; throttle before GO does nothing', () => {
  const { room } = makeRoom();
  room.addPlayer({ id: 'a', name: 'A' });
  room.setFillBots('a', false);
  room.setReady('a', true);
  room.startRace('a', { realtime: false });
  assert.equal(room.race.cars.length, 1);
  const car = room.race.cars[0];
  const x0 = car.state.x, y0 = car.state.y;
  room.setInput('a', 1, 1);
  const goTicks = Math.round(COUNTDOWN_MS / TICK_MS);
  for (let i = 0; i < goTicks; i++) room.step();
  assert.equal(car.state.x, x0);
  assert.equal(car.state.y, y0);
  assert.equal(car.state.power, 0);
  for (let i = 0; i < 60; i++) room.step();
  assert.ok(Math.hypot(car.state.x - x0, car.state.y - y0) > 10, 'moves after GO');
});

test('respawn: last checkpoint, ghost mode, 3 s cooldown', () => {
  const { room } = makeRoom();
  room.addPlayer({ id: 'a', name: 'A' });
  room.setFillBots('a', false);
  room.setReady('a', true);
  room.startRace('a', { realtime: false });
  const car = room.race.cars[0];
  room.setInput('a', 1, 1);
  while (car.cpPassed < 3) room.step();
  for (let i = 0; i < 30; i++) room.step();
  room.requestRespawn('a');
  room.step();
  const cp = room.race.track.checkpoints[(car.cpPassed - 1) % CHECKPOINTS];
  assert.ok(Math.hypot(car.state.x - cp.x, car.state.y - cp.y) < 5, 'at the last checkpoint');
  assert.ok(room.flags(car) & 1, 'ghost');
  const cooldownUntil = car.respawnAt;
  for (let i = 0; i < 60; i++) room.step();
  const before = { x: car.state.x, y: car.state.y };
  room.requestRespawn('a'); // too soon: ignored
  room.step();
  assert.equal(car.respawnAt, cooldownUntil, 'cooldown prevents a second respawn');
  assert.ok(Math.hypot(car.state.x - cp.x, car.state.y - cp.y) > Math.hypot(before.x - cp.x, before.y - cp.y), 'kept driving');
  for (let i = 0; i < Math.round(RESPAWN_GHOST_MS / TICK_MS); i++) room.step();
  assert.equal(room.flags(car) & 1, 0, 'ghost wears off');
});

test('disconnect during a race: rejoin within 15 s keeps the car, otherwise DNF', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { room } = makeRoom();
    room.addPlayer({ id: 'a', name: 'A' });
    room.addPlayer({ id: 'b', name: 'B' });
    room.setReady('a', true);
    room.startRace('a', { realtime: false });
    room.disconnect('b');
    assert.equal(room.players.get('b').connected, false);
    const back = room.findReconnect('other-token', 'B');
    assert.equal(back.id, 'b');
    room.reattach(back, 'sock2');
    mock.timers.tick(RECONNECT_GRACE_MS + 1);
    assert.ok(room.players.has('b'));
    assert.equal(room.race.cars.find((c) => c.id === 'b').removed, false);

    room.disconnect('b');
    mock.timers.tick(RECONNECT_GRACE_MS + 1);
    assert.equal(room.players.has('b'), false);
    const car = room.race.cars.find((c) => c.id === 'b');
    assert.equal(car.dnf, true);
    assert.equal(car.removed, true);
    room.destroy();
  } finally {
    mock.timers.reset();
  }
});

test('host leaving mid-race passes host and the race goes on', () => {
  const { room } = makeRoom();
  room.addPlayer({ id: 'a', name: 'A' });
  room.addPlayer({ id: 'b', name: 'B' });
  room.setReady('a', true);
  room.startRace('a', { realtime: false });
  room.removePlayer('a');
  assert.equal(room.hostId, 'b');
  assert.equal(room.phase, 'race');
  room.destroy();
});
