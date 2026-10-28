// Every weapon, 50 seeds each: deterministic, terminates, and leaves a valid world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateShot, FRAME_STRIDE } from '../../shared/tanks/simulate.js';
import { WEAPONS } from '../../shared/tanks/weapons.js';
import { MAP_IDS } from '../../shared/tanks/maps.js';
import { mulberry32 } from '../../shared/tanks/rng.js';
import { surfaceY } from '../../shared/tanks/terrain.js';
import { WORLD_W, GROUND_MIN, GROUND_MAX, MAX_STEPS, MAX_EXPLOSIONS, MAX_PROJECTILES } from '../../shared/tanks/constants.js';
import { mapState } from './helpers.js';

test('there are exactly 60 weapons with unique ids', () => {
  assert.equal(WEAPONS.length, 60);
  assert.equal(new Set(WEAPONS.map((w) => w.id)).size, 60);
});

for (const w of WEAPONS) {
  test(`weapon ${w.id}: deterministic + valid over 50 seeds`, () => {
    const rng = mulberry32(w.id.length * 7919 + w.id.charCodeAt(0));
    for (let i = 0; i < 50; i++) {
      const map = MAP_IDS[i % MAP_IDS.length];
      const st = mapState(map, rng.seed(), 2 + (i % 3), { mode: i % 2 ? 'survival' : 'classic', walls: ['none', 'wrap', 'bounce'][i % 3] });
      const input = { shooter: i % st.tanks.length, weapon: w.id, angle: rng.range(0, 180), power: rng.range(10, 100) };
      const seed = rng.seed();
      const a = simulateShot(st, input, seed);
      const b = simulateShot(st, input, seed);
      assert.equal(a.hash, b.hash, `same hash (seed ${seed})`);
      assert.deepEqual(a.events, b.events);
      assert.ok(a.steps <= MAX_STEPS, 'terminates within the step limit');
      // long lobs on the Moon or bouncing between walls may hit the 20 s cap; everything else ends on its own
      if (map !== 'moon' && st.walls === 'none') assert.ok(!a.events.some((e) => e.type === 'timeout'), `${w.id} finished on its own (seed ${seed})`);
      assert.ok(a.events.filter((e) => e.type === 'explode').length <= MAX_EXPLOSIONS);
      const t = a.state.terrain;
      for (let x = 0; x < WORLD_W; x++) {
        assert.ok(Number.isFinite(t[x]) && t[x] >= GROUND_MIN && t[x] <= GROUND_MAX, `terrain ok at ${x}: ${t[x]}`);
      }
      for (const tk of a.state.tanks) {
        assert.ok(Number.isFinite(tk.x) && Number.isFinite(tk.y) && Number.isFinite(tk.hp) && Number.isFinite(tk.score));
        assert.ok(tk.x >= 0 && tk.x <= WORLD_W && tk.y <= GROUND_MAX, 'tank inside the map');
        assert.ok(tk.y <= surfaceY(t, tk.x) + 0.01, `tank not inside terrain (${tk.y} vs ${surfaceY(t, tk.x)})`);
        assert.ok(tk.hp >= 0 && tk.hp <= 100);
      }
      // the input state is never mutated
      assert.equal(st.tanks[0].score, 0);
    }
  });
}

test('safety caps hold with many projectiles (Machine Gun + walls, Airstrike, Acid)', () => {
  for (const weapon of ['mgun', 'airstrike', 'acid', 'cluster', 'firework', 'volcano', 'meteor', 'hydra', 'swarm', 'tornado']) {
    const res = simulateShot(mapState('neon', 3, 4), { shooter: 0, weapon, angle: 70, power: 80 }, 5, { record: true });
    for (const f of res.frames) assert.ok(f.p.length / FRAME_STRIDE <= MAX_PROJECTILES);
  }
});
