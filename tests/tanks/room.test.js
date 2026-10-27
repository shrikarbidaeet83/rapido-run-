// Room state machine with timers sped up: lobby, draft timeouts, turn timeouts, reconnects, bots, cleanup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, sanitizeName, sanitizeChat } from '../../server/tanks/room.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000) {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await wait(10); }
}

function makeRoom(opts = {}) {
  const log = [];
  const room = new Room('ABCDE', { send: (sid, ev, data) => log.push({ sid, ev, data }), fast: 200, ...opts });
  room.log = log;
  room.join = (n, sid = `s${n}`) => room.addMember({ id: `p${n}`, token: `tok-${n}-xxxxxxxx`, socketId: sid, name: `P${n}`, color: '#e74c3c' }).member;
  return room;
}
const events = (room, ev) => room.log.filter((l) => l.ev === ev);

test('names and chat are sanitized', () => {
  assert.equal(sanitizeName('<b>Bob</b>&"\''), 'bBob/b');
  assert.equal(sanitizeName('   '), 'Player');
  assert.equal(sanitizeName('abcdefghijklmnopq').length, 12);
  assert.equal(sanitizeChat('hi\nthere').length, 8);
  assert.equal(sanitizeChat('x'.repeat(500)).length, 120);
});

test('lobby: host controls, ready checks, colors are unique, kick and host hand-over', () => {
  const room = makeRoom();
  const a = room.join(1), b = room.join(2);
  assert.equal(room.hostId, a.id);
  assert.notEqual(a.color, b.color, 'second player gets a free color');
  room.setSettings(b.id, { mode: 'survival' });
  assert.equal(room.settings.mode, 'classic', 'only the host changes settings');
  room.setSettings(a.id, { mode: 'survival', weapons: 15, turnTime: 45, map: 'moon', walls: 'bounce', wind: false, bogus: 1 });
  assert.equal(room.settings.mode, 'survival');
  assert.equal(room.settings.weapons, 15);
  assert.equal(room.settings.map, 'moon');
  room.setSettings(a.id, { weapons: 7, map: 'nowhere', turnTime: 12 });
  assert.equal(room.settings.weapons, 15, 'invalid values are ignored');
  assert.equal(room.settings.map, 'moon');
  assert.ok(room.start(a.id).error, 'needs everyone ready');
  assert.ok(room.addBot(a.id, 'hard'));
  assert.ok(!room.addBot(b.id, 'hard'), 'only the host adds bots');
  assert.equal(room.seats.length, 3);
  room.kick(a.id, b.id);
  assert.ok(!room.members.has(b.id));
  assert.ok(room.log.some((l) => l.sid === 's2' && l.ev === 'kicked'));
  const c = room.join(3);
  room.removeMember(a.id);
  assert.equal(room.hostId, c.id, 'host passes to the next player');
  room.destroy();
});

test('chat is rate limited and only reaches room members', () => {
  const room = makeRoom();
  const a = room.join(1);
  for (let i = 0; i < 20; i++) room.chat(a.id, `msg ${i}`);
  assert.equal(events(room, 'chat').length, 6);
  room.emoji(a.id, '🔥');
  room.emoji(a.id, '<script>');
  assert.equal(events(room, 'emoji').length, 1);
  room.destroy();
});

test('full match with a bot and an idle human: draft auto-picks, turns time out, results arrive', async () => {
  const room = makeRoom();
  const a = room.join(1);
  room.addBot(a.id, 'easy');
  room.setSettings(a.id, { weapons: 5, turnTime: 20 });
  room.setReady(a.id, true);
  assert.ok(room.start(a.id).ok);
  assert.equal(room.phase, 'draft');
  await until(() => room.phase === 'match');
  for (const inv of room.match.inv) assert.equal(inv.length, 5);
  await until(() => room.phase === 'results', 60000);
  const res = events(room, 'results')[0].data;
  assert.ok(res.rows.length === 2);
  assert.ok(events(room, 'skipped').length >= 1, 'the idle human was skipped');
  assert.ok(events(room, 'shot').length >= 5, 'the bot fired');
  // rematch: same room, same players, new draft
  assert.ok(room.rematch(a.id).ok);
  assert.equal(room.phase, 'draft');
  room.destroy();
  assert.equal(room.timers.size, 0, 'no timers left after destroy');
});

test('disconnect: turns are skipped, reconnect resumes the tank, otherwise a bot takes over', async () => {
  const room = makeRoom();
  const a = room.join(1), b = room.join(2);
  room.setSettings(a.id, { weapons: 5, turnTime: 0 });
  room.setReady(a.id, true); room.setReady(b.id, true);
  room.start(a.id);
  await until(() => room.phase === 'match' && room.match.turn);
  room.disconnect('s2');
  assert.equal(b.connected, false);
  assert.equal(room.findReconnect(b.token), b);
  room.reattach(b, 's2b');
  assert.equal(b.connected, true);
  assert.equal(b.socketId, 's2b');
  // drop again and wait out the grace period (60 s / 200)
  room.disconnect('s2b');
  await until(() => b.isBot && b.takenOver, 5000);
  // the human host plays its own turns; the taken-over tank plays as a bot
  const fired = () => events(room, 'shot').filter((l) => l.data.input.shooter === room.seatIndex(b.id)).length;
  await until(() => {
    if (room.phase === 'match' && room.match.turn && !room.match.turn.fired && room.match.players[room.match.turn.player].id === a.id) {
      const slot = room.match.inv[room.match.turn.player].find((w) => !w.used).slot;
      room.fire('s1', { slot, angle: 45, power: 50 });
    }
    return fired() >= 1 || room.phase === 'results';
  }, 30000);
  room.destroy();
});

test('spectators: joining mid-match watches, then plays the next match', async () => {
  const room = makeRoom();
  const a = room.join(1);
  room.addBot(a.id);
  room.setReady(a.id, true);
  room.start(a.id);
  const c = room.join(3);
  assert.equal(c.spectator, true);
  assert.ok(room.log.some((l) => l.sid === 's3' && l.ev === 'match'), 'spectator gets the match state');
  room.match.phase = 'over';
  room.phase = 'results';
  room.toLobby(a.id);
  assert.equal(c.spectator, false);
  assert.ok(room.seats.includes(c.id));
  room.destroy();
});

test('empty rooms are cleaned up', async () => {
  let gone = false;
  const room = makeRoom({ onEmpty: () => { gone = true; } });
  const a = room.join(1);
  room.removeMember(a.id);
  assert.ok(gone, 'empty lobby is removed at once');
  assert.equal(room.timers.size, 0);
});

test('local (same device) rooms: one socket controls both seats', async () => {
  const room = makeRoom({ local: true });
  const a = room.join(1, 'dev');
  room.addMember({ id: 'p2', socketId: 'dev', name: 'Player 2', color: '', localOf: a.id });
  assert.equal(room.seats.length, 2);
  assert.equal(room.canStart(), null, 'local seats are ready');
  room.setSettings(a.id, { weapons: 5, turnTime: 0 });
  room.start(a.id);
  await until(() => room.phase === 'draft');
  const res = room.pick('dev', room.match.pool.find((p) => p.by < 0).slot);
  assert.ok(res.ok, 'the device picks for whichever seat is up');
  room.destroy();
});
