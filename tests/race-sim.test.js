// Full 10-lap race with 8 bots on every map, server code only, no sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../shared/maps.js';
import { LAPS, TICK_MS } from '../shared/constants.js';
import { simulateRace } from '../scripts/simulate.js';

for (const map of MAPS) {
  test(`${map.name}: full ${LAPS}-lap race with 8 bots`, () => {
    const { room, results, stats } = simulateRace(map.id, { seed: 7 });
    assert.equal(stats.nan, 0, 'no NaN anywhere');
    assert.equal(stats.outside, 0, 'no car outside the track at any tick');
    assert.equal(room.phase, 'results');
    assert.ok(results, 'results produced');

    const rows = results.rows;
    assert.equal(rows.length, 8);
    assert.deepEqual(rows.map((r) => r.pos), [1, 2, 3, 4, 5, 6, 7, 8]);

    // exactly one winner, and it is P1 with 10 laps
    assert.equal(rows.filter((r) => r.winner).length, 1);
    assert.equal(rows[0].winner, true);
    assert.equal(rows[0].status, 'Finished');
    assert.equal(rows[0].laps, LAPS);
    assert.equal(rows[0].gapMs, 0);

    // every car is either Finished with 10 laps or DNF with fewer
    for (const r of rows) {
      assert.ok(['Finished', 'DNF'].includes(r.status));
      if (r.status === 'Finished') {
        assert.equal(r.laps, LAPS);
        assert.ok(Number.isFinite(r.totalMs) && r.totalMs > 0);
      } else {
        assert.ok(r.laps < LAPS);
        assert.equal(r.totalMs, null);
      }
      if (r.bestLapMs != null) assert.ok(Number.isFinite(r.bestLapMs) && r.bestLapMs > 0);
    }

    // sorted: finishers first by time, then DNFs by laps completed
    const fin = rows.filter((r) => r.status === 'Finished');
    const dnf = rows.filter((r) => r.status === 'DNF');
    assert.deepEqual(rows, [...fin, ...dnf]);
    for (let i = 1; i < fin.length; i++) assert.ok(fin[i].totalMs >= fin[i - 1].totalMs);
    for (let i = 1; i < dnf.length; i++) assert.ok(dnf[i].laps <= dnf[i - 1].laps);
    for (let i = 1; i < fin.length; i++) assert.ok(fin[i].gapMs >= 0);

    // DNF only after the 30 s grace period expired
    if (dnf.length) {
      const lastTick = room.race.tick;
      const winnerTick = room.race.winnerAt;
      assert.ok((lastTick - winnerTick) * TICK_MS >= 29900, 'grace period respected');
    }

    // session leaderboard got F1 points
    const p1 = results.session.find((s) => s.name === rows[0].name);
    assert.equal(p1.points, 25);
    assert.equal(p1.wins, 1);
  });
}
