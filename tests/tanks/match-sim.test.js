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
        assert.equal(s.tanks[i].score, st.points - st.self + st.healed, `player ${i} score = points - teammate damage + leech`);
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

// ---------- Free Fire + unlimited arsenal ----------
function runFree(map, mode, seed, settings = {}) {
  const m = new Match(PLAYERS(4), { ...DEFAULT_SETTINGS, map, mode, pace: 'free', arsenal: 'unlimited', ...settings }, seed);
  assert.equal(m.phase, 'play', 'unlimited arsenal skips the draft');
  const rng = mulberry32(seed ^ 0x2545f491);
  let shots = 0;
  // shooters take turns at random, as players would in real time
  while (m.phase === 'play') {
    const ready = m.players.map((p) => p.index).filter((i) => m.canPlay(i));
    assert.ok(ready.length, 'someone can still shoot while the match is on');
    const p = ready[Math.floor(rng() * ready.length)];
    const plan = planBotTurn(m, p, LEVELS[p], rng, { noMove: true });
    const res = m.fireFree(p, plan);
    assert.ok(!res.error, res.error);
    assert.ok(++shots <= 4 * m.settings.weapons + 8, 'no runaway match');
  }
  return m;
}

for (const mode of ['classic', 'survival']) {
  test(`Free Fire, unlimited arsenal, 30 rounds: ${mode}`, () => {
    const m = runFree('dunes', mode, mode === 'classic' ? 11 : 12, { weapons: 30 });
    const s = m.state;
    assert.equal(m.phase, 'over');
    if (mode === 'classic') assert.ok(m.shotsLeft.every((n) => n === 0), 'everyone fired all 30 shots');
    else assert.ok(m.aliveTeams().size <= 1 || m.shotsLeft.every((n, i) => n === 0 || !s.tanks[i].alive));
    m.stats.forEach((st, i) => assert.equal(s.tanks[i].score, st.points - st.self + st.healed));
    for (const t of s.tanks) assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
    assert.ok(m.winner.winners.length >= 1);
  });
}

test('unlimited arsenal: every weapon reusable, legendaries once', () => {
  const m = new Match(PLAYERS(2), { ...DEFAULT_SETTINGS, arsenal: 'unlimited', weapons: 30 }, 5);
  assert.equal(m.inv[0].length, 60);
  m.beginTurn();
  const p = m.turn.player;
  const single = m.inv[p].find((w) => w.weapon === 'single');
  assert.ok(!m.fire(p, { slot: single.slot, angle: 45, power: 30 }).error);
  assert.equal(single.used, false, 'normal weapons are not used up');
  assert.equal(m.shotsLeft[p], 29);
  const nuke = m.inv[p].find((w) => w.weapon === 'nuke');
  m.beginTurn(); m.skip(m.turn.player);
  m.beginTurn();
  assert.ok(!m.fire(p, { slot: nuke.slot, angle: 90, power: 5 }).error);
  assert.equal(nuke.used, true, 'legendary is single-use');
});

test('Free Fire: no turns, frozen tanks thaw after their next shot, own mines blow first', () => {
  const m = new Match(PLAYERS(2), { ...DEFAULT_SETTINGS, map: 'hills', pace: 'free', arsenal: 'unlimited' }, 8);
  assert.equal(m.turn, null);
  assert.ok(m.canControl(0) && m.canControl(1), 'both players can act at once');
  const slot = m.inv[0].find((w) => w.weapon === 'single').slot;
  m.state.tanks[0].frozen = 1;
  const r = m.fireFree(0, { slot, angle: 45, power: 100 });
  assert.equal(r.shot.events.find((e) => e.type === 'fire').power, 80, 'frozen: power capped');
  assert.equal(m.state.tanks[0].frozen, 0, 'thawed after the shot');
  m.state.mines.push({ id: 77, x: 800, y: m.state.terrain[800], owner: 1, armed: false });
  const r2 = m.fireFree(1, { slot, angle: 45, power: 40 });
  assert.equal(r2.pre.length, 1, "the shooter's mine went off before the shot");
  assert.equal(m.fire(0, { slot, angle: 45, power: 40 }).error, 'Free Fire match: use fireFree');
});
