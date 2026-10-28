// Damage, scoring, statuses, moves, mines and the draft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, simulateShot, finalizeState } from '../../shared/tanks/simulate.js';
import { createTerrain, carveCircle, addCircle, diffTerrain, applyDiff, settle, terrainToInts, terrainFromInts } from '../../shared/tanks/terrain.js';
import { fallDamage, planMove } from '../../shared/tanks/physics.js';
import { generateTerrain, MAP_IDS } from '../../shared/tanks/maps.js';
import { Match, snakeOrder, drawPool } from '../../server/tanks/game.js';
import { mulberry32 } from '../../shared/tanks/rng.js';
import { DEFAULT_SETTINGS, MOVES_PER_MATCH, SPAWN_MIN_GAP, GROUND_MAX, GROUND_MIN } from '../../shared/tanks/constants.js';
import { flatState, PLAYERS } from './helpers.js';

const sim = (st, shooter = 0) => new Sim(st, 1, shooter, false);

test('damage falls off with distance to the nearest point of the hitbox', () => {
  const st = flatState([200, 800], { mode: 'survival' });
  const s = sim(st);
  // tank 1 hitbox top is y=582; a blast at y=540 is 42 px away
  s.explode(800, 540, 60, 50, { carve: false });
  assert.equal(st.tanks[1].hp, 100 - Math.round(50 * (1 - 42 / 60)));
  assert.equal(st.tanks[0].score, Math.round(50 * (1 - 42 / 60)));
  // out of range: nothing
  s.explode(800, 400, 60, 50, { carve: false });
  assert.equal(st.tanks[1].hp, 85);
});

test('direct hit bonus is +25%', () => {
  const st = flatState([200, 800], { mode: 'survival' });
  sim(st).explode(800, 590, 30, 40, { carve: false, direct: 1 });
  assert.equal(st.tanks[1].hp, 50);
  assert.equal(st.tanks[0].score, 50);
});

test('the attacker is immune to its own attack (blast, fall, mine)', () => {
  const st = flatState([200, 800], { mode: 'survival' });
  const s = sim(st);
  s.explode(200, 590, 60, 80, { direct: 0 });
  assert.equal(st.tanks[0].hp, 100, 'no damage from its own blast');
  assert.equal(st.tanks[0].score, 0, 'and no points lost');
  for (let x = 170; x <= 230; x++) st.terrain[x] = 700;
  s.markDirty([170, 230]);
  s.settleAll();
  assert.equal(st.tanks[0].y, 700, 'it still falls');
  assert.equal(st.tanks[0].hp, 100, 'but takes no fall damage from its own shot');
  // its own mine
  const m = flatState([200, 800], { mode: 'survival' });
  m.mines.push({ id: 1, x: 200, y: 600, owner: 0, armed: true });
  const r = simulateShot(m, { shooter: 0, mine: 1 }, 1);
  assert.equal(r.state.tanks[0].hp, 100);
});

test('friendly fire: teammates cost points when on, are immune when off', () => {
  const on = flatState([200, 600, 1000], { teams: [0, 0, 1] });
  sim(on).explode(600, 590, 30, 30, { carve: false });
  assert.equal(on.tanks[0].score, -30);
  const off = flatState([200, 600, 1000], { teams: [0, 0, 1], friendlyFire: false });
  sim(off).explode(600, 590, 30, 30, { carve: false });
  assert.equal(off.tanks[0].score, 0);
  sim(off).explode(1000, 590, 30, 30, { carve: false });
  assert.equal(off.tanks[0].score, 30, 'enemies still count');
});

test('survival: HP 0 destroys the tank, damage is capped at remaining HP', () => {
  const st = flatState([200, 800], { mode: 'survival' });
  st.tanks[1].hp = 10;
  const s = sim(st);
  s.explode(800, 590, 40, 60, { carve: false });
  assert.equal(st.tanks[1].hp, 0);
  assert.equal(st.tanks[1].alive, false);
  assert.equal(st.tanks[0].score, 10);
  assert.ok(s.events.some((e) => e.type === 'destroyed' && e.tank === 1));
  s.explode(800, 590, 40, 60, { carve: false });
  assert.equal(st.tanks[0].score, 10, 'dead tanks take no more damage');
});

test('fall damage: 0.2 × height, max 20', () => {
  assert.equal(fallDamage(2), 0);
  assert.equal(fallDamage(50), 10);
  assert.equal(fallDamage(400), 20);
  const st = flatState([200, 800], { mode: 'survival' });
  const s = sim(st);
  // dig a 60 px deep pit under tank 1 without hitting it
  for (let x = 770; x <= 830; x++) st.terrain[x] = 660;
  s.markDirty([770, 830]);
  s.settleAll();
  assert.equal(st.tanks[1].y, 660);
  assert.equal(st.tanks[1].hp, 100 - 12);
});

test('leech gives the damage back (points in Classic, HP in Survival)', () => {
  const c = flatState([200, 800]);
  sim(c).explode(800, 590, 30, 25, { carve: false, leech: true });
  assert.equal(c.tanks[0].score, 50);
  const s = flatState([200, 800], { mode: 'survival' });
  s.tanks[0].hp = 50;
  sim(s).explode(800, 590, 30, 25, { carve: false, leech: true });
  assert.equal(s.tanks[0].hp, 75);
});

test('shield absorbs the next 40 damage', () => {
  const st = flatState([200, 800], { mode: 'survival' });
  st.tanks[1].shield = 40; st.tanks[1].shieldTurns = 2;
  const s = sim(st);
  s.explode(800, 590, 30, 30, { carve: false });
  assert.equal(st.tanks[1].hp, 100);
  assert.equal(st.tanks[1].shield, 10);
  s.explode(800, 590, 30, 30, { carve: false });
  assert.equal(st.tanks[1].shield, 0);
  assert.equal(st.tanks[1].hp, 80);
  assert.equal(st.tanks[0].score, 20, 'absorbed damage scores nothing');
});

test('Energy Shield weapon sets the shield; it wears off after 2 enemy turns', () => {
  const m = playMatch(2);
  const p = m.turn.player;
  const slot = giveWeapon(m, p, 'shield');
  m.fire(p, { slot, angle: 90, power: 10 });
  assert.equal(m.state.tanks[p].shield, 40);
  const other = 1 - p;
  for (let k = 0; k < 2; k++) {
    m.beginTurn();
    if (m.turn.player === other) m.skip(other); else { m.skip(m.turn.player); k--; }
  }
  assert.equal(m.state.tanks[p].shield, 0);
});

test('terrain: craters, dirt, bounds, settle and diffs', () => {
  const t = createTerrain(600);
  carveCircle(t, 400, 600, 50);
  assert.equal(t[400], 650);
  carveCircle(t, 400, 2000, 3000); // absurd blast: clamped at bedrock
  assert.ok(t.every((v) => v >= GROUND_MIN && v <= GROUND_MAX));
  const u = createTerrain(600);
  addCircle(u, 800, 500, 40);
  assert.equal(Math.round(u[800]), 520);
  addCircle(u, 800, -5000, 6000);
  assert.ok(u.every((v) => v >= GROUND_MIN));
  const spike = createTerrain(600);
  spike[100] = 500;
  settle(spike, [100, 100]);
  assert.equal(spike[100], 600, '1-px spikes are smoothed');
  const a = createTerrain(600), b = createTerrain(600);
  carveCircle(b, 300, 600, 30); carveCircle(b, 1200, 600, 20);
  const d = diffTerrain(a, b);
  assert.equal(d.length, 2);
  applyDiff(a, d);
  assert.deepEqual(terrainToInts(a), terrainToInts(b));
  assert.deepEqual(terrainToInts(terrainFromInts(terrainToInts(b))), terrainToInts(b));
});

test('maps: spawns are spread at least 300 px apart and terrain is valid', () => {
  for (const id of MAP_IDS) {
    for (let seed = 1; seed < 30; seed++) {
      for (const n of [2, 3, 4]) {
        const { terrain, spawns } = generateTerrain(id, seed, n);
        assert.equal(spawns.length, n);
        for (let i = 1; i < n; i++) assert.ok(spawns[i] - spawns[i - 1] >= SPAWN_MIN_GAP, `${id} gap ${spawns[i] - spawns[i - 1]}`);
        assert.ok(terrain.every((v) => Number.isFinite(v) && v >= GROUND_MIN && v <= GROUND_MAX));
      }
    }
  }
});

// ---------- match-level rules ----------
function playMatch(n, settings = {}) {
  const m = new Match(PLAYERS(n), { ...DEFAULT_SETTINGS, map: 'hills', ...settings }, 1234);
  while (m.phase === 'draft') m.autoPick();
  m.beginTurn();
  return m;
}
function giveWeapon(m, p, weapon) {
  const item = m.inv[p].find((w) => !w.used);
  item.weapon = weapon;
  return item.slot;
}

test('moves: 4 per match, 60 px along the terrain, only on your turn', () => {
  const m = playMatch(2);
  const p = m.turn.player;
  const x0 = m.state.tanks[p].x;
  const dir = x0 < 800 ? 1 : -1;
  assert.equal(m.move(1 - p, dir).error, 'Not your turn');
  const r = m.move(p, dir);
  assert.ok(r.ok);
  assert.ok(Math.abs(m.state.tanks[p].x - x0) <= 60 && Math.abs(m.state.tanks[p].x - x0) > 0);
  for (let i = 1; i < MOVES_PER_MATCH; i++) m.move(p, i % 2 ? -dir : dir);
  assert.equal(m.state.tanks[p].moves, 0);
  assert.equal(m.move(p, dir).error, 'No moves left');
});

test('moves stop at steep slopes and map edges', () => {
  const st = flatState([40, 800]);
  const path = planMove(st, 0, -1, 60);
  assert.equal(path[path.length - 1], 20, 'stops at the edge margin');
  for (let x = 820; x < 900; x++) st.terrain[x] = 300; // a cliff
  const up = planMove(st, 1, 1, 60);
  assert.ok(up[up.length - 1] < 820, 'cannot climb a cliff');
});

test('frozen tank cannot move and power is capped at 80%', () => {
  const m = playMatch(2);
  const p = m.turn.player;
  m.state.tanks[p].frozen = 1;
  m.turn.frozen = true;
  assert.equal(m.move(p, 1).error, 'Frozen');
  const slot = giveWeapon(m, p, 'single');
  const shot = m.fire(p, { slot, angle: 45, power: 100 });
  assert.equal(shot.events.find((e) => e.type === 'fire').power, 80);
  assert.equal(m.state.tanks[p].frozen, 0, 'frozen wears off after the turn');
});

test('Ice Bomb freezes tanks in its radius', () => {
  // a weak flat shot lands just in front of the barrel, next to tank 1
  const s2 = flatState([200, 230]);
  const r2 = simulateShot(s2, { shooter: 0, weapon: 'ice', angle: 0, power: 5 }, 1);
  assert.equal(r2.state.tanks[1].frozen, 1);
});

test('sticky mine: arms after a turn, blows when a tank moves within 60 px', () => {
  const m = playMatch(2);
  const p = m.turn.player, other = 1 - p;
  const ot = m.state.tanks[other];
  m.state.mines.push({ id: 99, x: ot.x + (ot.x < 800 ? 70 : -70), y: ot.y, owner: p, armed: false });
  m.skip(p);
  const b = m.beginTurn();
  assert.equal(b.player, other);
  assert.equal(m.state.mines[0].armed, true);
  const r = m.move(other, ot.x < 800 ? 1 : -1);
  assert.ok(r.ok);
  assert.equal(r.mineShots.length, 1, 'mine detonated');
  assert.equal(m.state.mines.length, 0);
  assert.ok(m.state.tanks[p].score > 0, 'owner scores the mine damage');
});

test('sticky mine: blows at the start of the owner\'s next turn', () => {
  const m = playMatch(2);
  const p = m.turn.player;
  m.state.mines.push({ id: 7, x: 800, y: m.state.terrain[800], owner: p, armed: false });
  m.skip(p);
  m.beginTurn();
  m.skip(m.turn.player);
  const b = m.beginTurn();
  assert.equal(b.player, p);
  assert.equal(b.mineShots.length, 1);
  assert.equal(m.state.mines.length, 0);
});

test('mine weapon places a mine in the state', () => {
  const st = flatState([200, 800]);
  const r = simulateShot(st, { shooter: 0, weapon: 'mine', angle: 45, power: 50 }, 3);
  assert.equal(r.state.mines.length, 1);
  assert.equal(r.state.mines[0].owner, 0);
  assert.equal(r.state.mines[0].armed, false);
});

// ---------- draft ----------
test('draft: snake order', () => {
  assert.deepEqual(snakeOrder(3, 3), [0, 1, 2, 2, 1, 0, 0, 1, 2]);
  assert.deepEqual(snakeOrder(2, 4), [0, 1, 1, 0, 0, 1, 1, 0]);
});

test('draft: pool size, max 1 Nuke, everyone gets exactly N unique slots', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const pool = drawPool(mulberry32(seed), 45);
    assert.equal(pool.length, 45);
    assert.ok(pool.filter((p) => p.weapon === 'nuke').length <= 1);
  }
  for (const [n, w] of [[2, 5], [3, 10], [4, 10], [4, 15]]) {
    const m = new Match(PLAYERS(n), { ...DEFAULT_SETTINGS, weapons: w }, n * 100 + w);
    assert.equal(m.pool.length, w * n + 5);
    while (m.phase === 'draft') m.autoPick();
    const slots = new Set();
    for (const inv of m.inv) {
      assert.equal(inv.length, w);
      for (const it of inv) { assert.ok(!slots.has(it.slot)); slots.add(it.slot); }
    }
  }
});

test('draft: only the current picker can pick, and taken slots are refused', () => {
  const m = new Match(PLAYERS(2), DEFAULT_SETTINGS, 9);
  assert.equal(m.draftPick(1, 0).error, 'Not your pick');
  assert.ok(m.draftPick(0, 0).ok);
  assert.equal(m.draftPick(1, 0).error, 'Already taken');
  assert.ok(m.draftPick(1, 1).ok);
});

test('finalizeState keeps tanks on the surface', () => {
  const st = flatState([200.123456, 800]);
  finalizeState(st);
  assert.equal(st.tanks[0].x, 200.12);
  assert.equal(st.tanks[0].y, 600);
});
