// Match logic for Shell Shock Arena: draft -> play -> over.
// No timers and no sockets: room.js drives it, and the headless tests drive it directly.

import {
  MOVE_DISTANCE, POOL_EXTRA, MINE_TRIGGER, FROZEN_POWER_CAP,
} from '../../shared/tanks/constants.js';
import { mulberry32 } from '../../shared/tanks/rng.js';
import { MAPS, getMap, generateTerrain } from '../../shared/tanks/maps.js';
import { WEAPONS, getWeapon, RARITY_WEIGHT } from '../../shared/tanks/weapons.js';

// Unlimited arsenal: every weapon, reusable, except legendaries (one use each).
export function fullArsenal() {
  return WEAPONS.map((w, i) => ({ slot: i, weapon: w.id, used: false, ...(w.rarity === 'legendary' ? {} : { infinite: true }) }));
}
import { planMove, settleTank } from '../../shared/tanks/physics.js';
import { simulateShot, makeTank, hashState, finalizeState, sameTeam } from '../../shared/tanks/simulate.js';
import { terrainToInts, diffTerrain } from '../../shared/tanks/terrain.js';

// Weapons that are not meant to hit anything (they don't count for accuracy).
export const UTILITY = new Set(['dirtball', 'slinger', 'tracer', 'teleport', 'shield', 'wall', 'mine']);

export function snakeOrder(nPlayers, rounds) {
  const order = [];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < nPlayers; i++) order.push(r % 2 === 0 ? i : nPlayers - 1 - i);
  }
  return order;
}

// Pool drawn with replacement (it can be bigger than 40), weighted by rarity, max 1 Nuke.
export function drawPool(rng, size) {
  const total = WEAPONS.reduce((s, w) => s + RARITY_WEIGHT[w.rarity], 0);
  const pool = [];
  let nukes = 0;
  while (pool.length < size) {
    let r = rng() * total, w = WEAPONS[0];
    for (const c of WEAPONS) { r -= RARITY_WEIGHT[c.rarity]; if (r < 0) { w = c; break; } }
    if (w.id === 'nuke' && nukes >= 1) continue;
    if (w.id === 'nuke') nukes++;
    pool.push({ slot: pool.length, weapon: w.id, by: -1 });
  }
  return pool;
}

export class Match {
  // players: [{ id, name, color, style, team }], settings: see DEFAULT_SETTINGS
  constructor(players, settings, seed) {
    this.players = players.map((p, i) => ({ ...p, index: i, team: settings.teams ? p.team : i }));
    this.settings = { ...settings };
    this.rng = mulberry32(seed);
    this.phase = 'draft';
    const n = this.players.length;
    this.shotsLeft = this.players.map(() => settings.weapons);
    this.stats = this.players.map(() => ({ damage: 0, points: 0, lost: 0, self: 0, healed: 0, shots: 0, offensive: 0, hits: 0, terrain: 0, best: null }));
    this.state = null;
    this.turn = null;
    this.turnNo = 0;
    this.lastShooter = -1;
    this.winner = null;
    this.pick = 0;
    if (settings.arsenal === 'unlimited') {
      this.pool = [];
      this.order = [];
      this.inv = this.players.map(() => fullArsenal());
      this.startPlay();
    } else {
      this.pool = drawPool(this.rng, settings.weapons * n + POOL_EXTRA);
      this.order = snakeOrder(n, settings.weapons);
      this.inv = this.players.map(() => []);
    }
  }

  get free() { return this.settings.pace === 'free'; }

  // ---------- draft ----------
  get picker() { return this.phase === 'draft' ? this.order[this.pick] : -1; }

  draftPick(player, slot) {
    if (this.phase !== 'draft' || player !== this.picker) return { error: 'Not your pick' };
    const item = this.pool[slot];
    if (!item || item.by !== -1) return { error: 'Already taken' };
    item.by = player;
    this.inv[player].push({ slot: item.slot, weapon: item.weapon, used: false });
    this.pick++;
    if (this.pick >= this.order.length) this.startPlay();
    return { ok: true, slot, weapon: item.weapon, player };
  }

  autoPick() {
    const free = this.pool.filter((p) => p.by === -1);
    return this.draftPick(this.picker, free[Math.floor(this.rng() * free.length)].slot);
  }

  // ---------- play ----------
  startPlay() {
    const s = this.settings;
    const mapId = s.map === 'random' || !MAPS.some((m) => m.id === s.map) ? MAPS[Math.floor(this.rng() * MAPS.length)].id : s.map;
    this.mapId = mapId;
    const n = this.players.length;
    const { terrain, spawns } = generateTerrain(mapId, this.rng.seed(), n);
    // spread teams out: alternate team members across the spawn points
    let order = this.players.map((p) => p.index);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (s.teams) {
      const a = order.filter((i) => this.players[i].team === 0), b = order.filter((i) => this.players[i].team !== 0);
      order = [];
      while (a.length || b.length) { if (a.length) order.push(a.shift()); if (b.length) order.push(b.shift()); }
    }
    const xs = [];
    order.forEach((pi, k) => { xs[pi] = spawns[k]; });
    this.state = {
      map: mapId, terrain, wind: 0, mode: s.mode, friendlyFire: s.friendlyFire, walls: s.walls,
      tanks: this.players.map((p, i) => makeTank({ id: p.id, team: p.team, x: xs[i], terrain })),
      mines: [], nextMine: 1,
    };
    this.state.tanks.forEach((t) => { t.angle = t.x < 800 ? 60 : 120; }); // moving is free and unlimited
    finalizeState(this.state);
    this.phase = 'play';
    this.turnNo = 0;
    this.nextIndex = 0;
  }

  aliveTeams() {
    return new Set(this.state.tanks.filter((t) => t.alive).map((t) => t.team));
  }

  canPlay(i) {
    return this.state.tanks[i].alive && this.shotsLeft[i] > 0 && this.inv[i].some((w) => !w.used);
  }

  // Who may act right now: the active player (turns) or any player with shots left (Free Fire).
  canControl(player) {
    if (this.phase !== 'play') return false;
    return this.free ? this.canPlay(player) : this.isActive(player);
  }

  // Free Fire: a living tank can keep driving after its shots are used up.
  canMove(player) {
    if (this.phase !== 'play') return false;
    return this.free ? this.state.tanks[player]?.alive : this.isActive(player);
  }

  // Next turn. Detonates the player's own mines first (they can change the outcome).
  // Returns { done } or { player, mineShots }.
  beginTurn() {
    const mineShots = [];
    for (let guard = 0; guard < this.players.length * 2 + 2; guard++) {
      if (this.isOver()) return this.finish(mineShots);
      const n = this.players.length;
      let p = -1;
      for (let k = 0; k < n; k++) {
        const i = (this.nextIndex + k) % n;
        if (this.canPlay(i)) { p = i; break; }
      }
      if (p < 0) return this.finish(mineShots);
      this.nextIndex = (p + 1) % n;
      for (const m of this.state.mines) m.armed = true; // everything placed before this turn is armed now
      for (const m of this.state.mines.filter((mm) => mm.owner === p)) mineShots.push(this.detonate(m));
      if (!this.canPlay(p)) continue;
      this.turnNo++;
      const tank = this.state.tanks[p];
      this.turn = {
        player: p, number: this.turnNo, round: Math.min(this.settings.weapons, Math.floor((this.turnNo - 1) / n) + 1),
        fired: false, frozen: tank.frozen > 0,
      };
      return { player: p, mineShots };
    }
    return this.finish(mineShots);
  }

  detonate(mine) {
    const seed = this.rng.seed();
    const res = simulateShot(this.state, { shooter: mine.owner, mine: mine.id }, seed);
    return this.applyShot({ shooter: mine.owner, mine: mine.id }, seed, res, null);
  }

  isActive(player) {
    return this.phase === 'play' && this.turn && !this.turn.fired && this.turn.player === player;
  }

  move(player, dir) {
    if (!this.canMove(player)) return { error: 'Not your turn' };
    const tank = this.state.tanks[player];
    if (this.free ? tank.frozen > 0 : this.turn.frozen) return { error: 'Frozen' };
    if (tank.buried > 0) return { error: 'Buried! Shoot your way out first' };
    if (dir !== -1 && dir !== 1) return { error: 'Bad direction' };
    const dist = Math.round(MOVE_DISTANCE * getMap(this.state.map).moveMult);
    const path = planMove(this.state, player, dir, dist);
    if (path.length < 2) return { error: 'Blocked' };
    tank.x = path[path.length - 1];
    settleTank(this.state.terrain, tank);
    finalizeState(this.state);
    const mineShots = this.mineCheck([player]);
    if (this.isOver()) this.finish([]);
    return { ok: true, path, tank: { ...tank }, mineShots };
  }

  // Armed mines blow when a tank that just moved is within range.
  mineCheck(moved) {
    const out = [];
    for (const m of [...this.state.mines]) {
      if (!m.armed || !this.state.mines.includes(m)) continue;
      if (moved.some((i) => this.state.tanks[i].alive && Math.abs(this.state.tanks[i].x - m.x) < MINE_TRIGGER)) out.push(this.detonate(m));
    }
    return out;
  }

  fire(player, msg) {
    if (this.free) return { error: 'Free Fire match: use fireFree' };
    if (!this.isActive(player)) return { error: 'Not your turn' };
    const ok = this.checkShot(player, msg);
    if (ok.error) return ok;
    this.turn.fired = true;
    const shot = this.shoot(player, ok.item, ok.angle, this.turn.frozen ? Math.min(ok.power, FROZEN_POWER_CAP) : ok.power);
    this.endTurn();
    return shot;
  }

  // Free Fire: anyone with shots left fires whenever the room says they've reloaded.
  // Their own armed mines go off first (like the start of a turn). Returns { pre, shot }.
  fireFree(player, msg) {
    if (!this.free) return { error: 'Not a Free Fire match' };
    if (!this.canControl(player)) return { error: 'No shots left' };
    const ok = this.checkShot(player, msg);
    if (ok.error) return ok;
    for (const m of this.state.mines) m.armed = true;
    const pre = this.state.mines.filter((m) => m.owner === player).map((m) => this.detonate(m));
    if (!this.canPlay(player)) { if (this.isOver()) this.finish([]); return { pre, shot: null }; }
    const tank = this.state.tanks[player];
    const frozen = tank.frozen > 0;
    const shot = this.shoot(player, ok.item, ok.angle, frozen ? Math.min(ok.power, FROZEN_POWER_CAP) : ok.power);
    if (frozen) this.state.tanks[player].frozen = 0;
    this.wearShields(player);
    if (this.isOver()) this.finish([]);
    shot.shotsLeft = [...this.shotsLeft];
    // statuses that changed after the shot (thaw, shields wearing off): clients apply these
    // once the shot and any mines it set off are applied, so their next replay starts in sync
    shot.after = { tanks: this.publicTanks(), hash: hashState(this.state) };
    return { pre, shot };
  }

  checkShot(player, { slot, angle, power }) {
    const item = this.inv[player].find((w) => w.slot === Number(slot) && !w.used);
    if (!item) return { error: 'Weapon not available' };
    angle = Number(angle); power = Number(power);
    if (!Number.isFinite(angle) || !Number.isFinite(power) || angle < 0 || angle > 180 || power < 0 || power > 100) return { error: 'Bad aim' };
    return { item, angle, power };
  }

  shoot(player, item, angle, power) {
    if (!item.infinite) item.used = true;
    this.shotsLeft[player]--;
    const input = { shooter: player, weapon: item.weapon, angle: Math.round(angle * 10) / 10, power: Math.round(power * 10) / 10 };
    const before = this.state.tanks.map((t) => t.x);
    const seed = this.rng.seed();
    const res = simulateShot(this.state, input, seed);
    const shot = this.applyShot(input, seed, res, item.weapon);
    const moved = this.state.tanks.map((t, i) => i).filter((i) => Math.abs(this.state.tanks[i].x - before[i]) > 2);
    shot.mineShots = this.mineCheck(moved);
    return shot;
  }

  // Turn timer ran out: the shot is lost (its weapon is discarded, so the match still ends).
  skip(player) {
    if (!this.isActive(player)) return { error: 'Not your turn' };
    // the shot is lost; with a drafted arsenal its weapon is discarded too
    const item = this.inv[player].find((w) => !w.used && !w.infinite);
    if (item && this.settings.arsenal !== 'unlimited') { item.used = true; item.skipped = true; }
    this.shotsLeft[player]--;
    this.turn.fired = true;
    this.endTurn();
    return { ok: true, weapon: item?.weapon };
  }

  applyShot(input, seed, res, weaponId) {
    const before = this.state;
    this.state = res.state;
    const st = this.stats[input.shooter];
    const sum = res.summary;
    st.damage += sum.dealt;
    st.points += sum.points;
    sum.lost.forEach((n, i) => { this.stats[i].lost += n; });
    st.self += sum.self;
    st.terrain += sum.terrain;
    if (this.state.mode === 'classic') st.healed += sum.healed;
    if (weaponId) {
      st.shots++;
      if (!UTILITY.has(weaponId)) { st.offensive++; if (sum.dealt > 0) st.hits++; }
      if (sum.dealt > 0 && (!st.best || sum.dealt > st.best.dmg)) st.best = { weapon: weaponId, dmg: sum.dealt };
    }
    this.lastShooter = input.shooter;
    return {
      input, seed, steps: res.steps, hash: res.hash,
      events: res.events,
      terrain: diffTerrain(before.terrain, this.state.terrain),
      tanks: this.publicTanks(), mines: this.state.mines.map((m) => ({ ...m })),
      shotsLeft: [...this.shotsLeft],
    };
  }

  endTurn() {
    const p = this.turn.player;
    const me = this.state.tanks[p];
    if (this.turn.frozen) me.frozen = 0;
    this.wearShields(p);
    if (this.isOver()) this.finish([]);
  }

  // Shields wear off after 2 enemy turns (Free Fire: 2 enemy shots).
  wearShields(p) {
    this.state.tanks.forEach((t, i) => {
      if (t.shield > 0 && i !== p && !sameTeam(this.state, i, p) && --t.shieldTurns <= 0) { t.shield = 0; t.shieldTurns = 0; }
    });
  }

  // Free Fire match clock ran out.
  finishNow() {
    if (this.phase === 'play') this.finish([]);
  }

  isOver() {
    if (this.phase === 'over') return true;
    if (this.state.mode === 'survival' && this.aliveTeams().size <= 1) return true;
    return !this.players.some((p, i) => this.canPlay(i));
  }

  finish(mineShots) {
    if (this.phase !== 'over') {
      this.phase = 'over';
      this.turn = null;
      this.winner = this.computeResults();
    }
    return { done: true, mineShots };
  }

  computeResults() {
    const s = this.state, survival = s.mode === 'survival';
    const key = (i) => {
      const t = s.tanks[i];
      return survival ? [t.alive ? 1 : 0, t.hp, t.score] : [t.score, 0, 0];
    };
    const cmp = (a, b) => { for (let k = 0; k < 3; k++) if (a[k] !== b[k]) return b[k] - a[k]; return 0; };
    const idx = this.players.map((p) => p.index).sort((a, b) => cmp(key(a), key(b)) || a - b);
    let winners;
    if (this.settings.teams) {
      const teams = [...new Set(this.players.map((p) => p.team))];
      const teamKey = (team) => {
        const m = idx.filter((i) => s.tanks[i].team === team);
        return survival
          ? [m.some((i) => s.tanks[i].alive) ? 1 : 0, m.reduce((a, i) => a + s.tanks[i].hp, 0), m.reduce((a, i) => a + s.tanks[i].score, 0)]
          : [m.reduce((a, i) => a + s.tanks[i].score, 0), 0, 0];
      };
      teams.sort((a, b) => cmp(teamKey(a), teamKey(b)));
      const tie = teams.length > 1 && cmp(teamKey(teams[0]), teamKey(teams[1])) === 0;
      const winTeams = tie ? teams.filter((t) => cmp(teamKey(t), teamKey(teams[0])) === 0) : [teams[0]];
      winners = idx.filter((i) => winTeams.includes(s.tanks[i].team));
      return this.table(idx, winners, tie, winTeams);
    }
    winners = idx.filter((i) => cmp(key(i), key(idx[0])) === 0);
    return this.table(idx, winners, winners.length > 1, null);
  }

  table(idx, winners, tie, winTeams) {
    const s = this.state;
    const rows = idx.map((i) => {
      const t = s.tanks[i], st = this.stats[i];
      return {
        index: i, id: this.players[i].id, name: this.players[i].name, color: this.players[i].color, team: t.team,
        score: t.score, hp: t.hp, alive: t.alive, damage: st.damage, self: st.self, best: st.best,
        accuracy: st.offensive ? Math.round((st.hits / st.offensive) * 100) : 0, terrain: st.terrain,
      };
    });
    const rank = (fn) => rows.reduce((b, r) => (fn(r) > fn(b) ? r : b), rows[0]);
    const awards = [];
    const sharp = rank((r) => r.accuracy);
    if (sharp.accuracy > 0) awards.push({ title: 'Sharpshooter', index: sharp.index, value: `${sharp.accuracy}%` });
    const demo = rank((r) => r.terrain);
    if (demo.terrain > 0) awards.push({ title: 'Demolition Expert', index: demo.index, value: `${Math.round(demo.terrain / 1000)}k px` });
    const big = rank((r) => r.best?.dmg || 0);
    if (big.best) awards.push({ title: 'Biggest Hit', index: big.index, value: `${big.best.dmg} (${getWeapon(big.best.weapon).name})` });
    return { winners, tie, winTeams, rows, awards, mode: s.mode };
  }

  // ---------- views ----------
  publicTanks() {
    return this.state.tanks.map((t) => ({ ...t }));
  }

  snapshot() {
    return {
      phase: this.phase,
      players: this.players.map((p) => ({ id: p.id, name: p.name, color: p.color, style: p.style, team: p.team })),
      settings: this.settings,
      pool: this.pool, order: this.order, pick: this.pick,
      inv: this.inv,
      shotsLeft: this.shotsLeft,
      state: this.state && {
        map: this.state.map, terrain: terrainToInts(this.state.terrain), wind: this.state.wind, mode: this.state.mode,
        friendlyFire: this.state.friendlyFire, walls: this.state.walls, tanks: this.publicTanks(),
        mines: this.state.mines, nextMine: this.state.nextMine, hash: hashState(this.state),
      },
      turn: this.turn,
      stats: this.stats,
      results: this.phase === 'over' ? this.winner : null,
    };
  }
}
