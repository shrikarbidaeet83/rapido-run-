// Headless full matches: 4 bots, every map, both modes, server code only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../../server/tanks/game.js';
import { planBotTurn } from '../../server/tanks/bot.js';
import { mulberry32 } from '../../shared/tanks/rng.js';
import { MAP_IDS } from '../../shared/tanks/maps.js';
import { DEFAULT_SETTINGS } from '../../shared/tanks/constants.js';
import { PLAYERS } from './helpers.js';

const LEVELS = ['easy', 'medium', 'hard', 'hard'];

function runMatch(map, mode, seed, settings = {}) {
  const m = new Match(PLAYERS(4), { ...DEFAULT_SETTINGS, map, mode, ...settings }, seed);
  while (m.phase === 'draft') m.autoPick();
  const rng = mulberry32(seed ^ 0x5bd1e995);
  let turns = 0;
  for (;;) {
    const b = m.beginTurn();
    if (b.done) break;
    assert.ok(++turns <= 4 * m.settings.weapons, 'no stuck or extra turns');
    let plan = planBotTurn(m, b.player, LEVELS[b.player], rng);
    if (plan.move) {
      m.move(b.player, plan.move);
      if (!m.isActive(b.player)) continue; // a mine ended the turn
      plan = planBotTurn(m, b.player, LEVELS[b.player], rng, { noMove: true });
    }
    const shot = m.fire(b.player, plan);
    assert.ok(!shot.error, shot.error);
  }
  return { m, turns };
}

for (const mode of ['classic', 'survival']) {
  for (const map of MAP_IDS) {
    test(`full 4-bot match: ${map} / ${mode}`, () => {
      const { m } = runMatch(map, mode, map.length * 1000 + (mode === 'survival' ? 7 : 3));
      const res = m.winner;
      assert.equal(m.phase, 'over');
      assert.ok(res.winners.length >= 1);
      if (!res.tie) assert.equal(res.winners.length, 1, 'exactly one winner');
      const s = m.state;
      if (mode === 'classic') {
        // every weapon was used (fired or lost to the timer)
        for (const inv of m.inv) assert.ok(inv.every((w) => w.used));
        const top = Math.max(...s.tanks.map((t) => t.score));
        assert.ok(res.winners.every((i) => s.tanks[i].score === top));
        if (!res.tie) assert.equal(s.tanks.filter((t) => t.score === top).length, 1);
      } else {
        const alive = s.tanks.filter((t) => t.alive);
        if (alive.length <= 1) {
          if (alive.length === 1) assert.ok(s.tanks[res.winners[0]].alive, 'last tank standing wins');
        } else {
          for (const inv of m.inv.filter((_, i) => s.tanks[i].alive)) assert.ok(inv.every((w) => w.used));
          const top = Math.max(...alive.map((t) => t.hp));
          assert.ok(res.winners.every((i) => s.tanks[i].alive && s.tanks[i].hp === top));
        }
        for (const t of s.tanks) assert.equal(t.alive, t.hp > 0);
      }
      // scores add up to the recorded damage
      m.stats.forEach((st, i) => {
        assert.equal(s.tanks[i].score, st.damage - st.self + st.healed, `player ${i} score = damage - self + leech`);
      });
      for (const t of s.tanks) for (const k of ['x', 'y', 'hp', 'score']) assert.ok(Number.isFinite(t[k]), `${k} is a number`);
      assert.ok(s.terrain.every(Number.isFinite));
      assert.equal(res.rows.length, 4);
    });
  }
}

test('2v2 teams: the winning team is reported', () => {
  const { m } = runMatch('hills', 'classic', 77, { teams: true });
  const res = m.winner;
  assert.ok(res.winTeams.length >= 1);
  for (const i of res.winners) assert.ok(res.winTeams.includes(m.state.tanks[i].team));
});

test('a classic tie is reported as a tie', () => {
  const m = new Match(PLAYERS(2), { ...DEFAULT_SETTINGS, weapons: 5 }, 1);
  while (m.phase === 'draft') m.autoPick();
  for (;;) { const b = m.beginTurn(); if (b.done) break; m.skip(b.player); }
  assert.equal(m.winner.tie, true);
  assert.equal(m.winner.winners.length, 2);
});
