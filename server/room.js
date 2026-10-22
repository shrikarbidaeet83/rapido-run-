// Room: lobby, race state machine and the fixed-step game loop.
// Has no socket code of its own: it talks to the outside world through
// `opts.send(player, event, data)`, so the headless tests can drive it directly.

import {
  TICK_MS, SNAPSHOT_EVERY, LAPS, CHECKPOINTS, COUNTDOWN_MS, FINISH_GRACE_MS,
  WRONG_WAY_ANGLE, WRONG_WAY_MS, RESPAWN_GHOST_MS, RESPAWN_COOLDOWN_MS, POINTS,
  MAX_PLAYERS, CAR_COLORS, RECONNECT_GRACE_MS,
} from '../shared/constants.js';
import { MAPS, getMap } from '../shared/maps.js';
import { buildTrack, crossedCheckpoint } from '../shared/track.js';
import { createCar, integrate, speedOf } from '../shared/physics.js';
import { settle } from '../shared/collision.js';
import { createBotBrain, botInput, BOT_NAMES, mulberry32 } from './bot.js';

const ticks = (ms) => Math.round(ms / TICK_MS);
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const NO_INPUT = Object.freeze({ up: false, down: false, left: false, right: false });

const trackCache = new Map();
export function getTrack(mapId) {
  if (!trackCache.has(mapId)) trackCache.set(mapId, buildTrack(getMap(mapId)));
  return trackCache.get(mapId);
}

// Advances lap/checkpoint progress for a move (x0,y0)->(x1,y1) during `tick`.
// Only the NEXT checkpoint in order counts, and only when crossed forwards.
// Returns 'cp' | 'lap' | 'finish' | null.
export function updateProgress(rc, x0, y0, x1, y1, track, tick, laps = LAPS) {
  if (rc.finished) return null;
  const cp = track.checkpoints[rc.cpPassed % CHECKPOINTS];
  const f = crossedCheckpoint(cp, x0, y0, x1, y1);
  if (f < 0) return null;
  const at = tick - 1 + f; // fractional tick of the crossing
  rc.cpPassed++;
  if (cp.index !== 0 || rc.cpPassed === 1) return 'cp';
  const lapMs = (at - rc.lapStart) * TICK_MS;
  rc.lapTimes.push(lapMs);
  rc.lapStart = at;
  if (rc.bestLap == null || lapMs < rc.bestLap) rc.bestLap = lapMs;
  if (rc.lapTimes.length >= laps) {
    rc.finished = true;
    rc.finishAt = at;
    return 'finish';
  }
  return 'lap';
}

export function newRaceCar(index, info, slot, startTick) {
  return {
    index, id: info.id, name: info.name, color: info.color, isBot: !!info.isBot, brain: info.brain || null,
    state: createCar(slot.x, slot.y, slot.angle, slot.seg), slot,
    cpPassed: 0, lapStart: startTick, lapTimes: [], bestLap: null,
    finished: false, finishAt: null, dnf: false, removed: false,
    ghostUntil: 0, respawnAt: 0, wantRespawn: false, wrongTicks: 0, wrongWay: false,
  };
}

function distToNext(rc, track) {
  const cp = track.checkpoints[rc.cpPassed % CHECKPOINTS];
  const along = track.s[Math.max(0, rc.state.seg)];
  return (((cp.s - along) % track.length) + track.length) % track.length;
}

// Finished cars by finish time, then everyone else by progress.
export function standings(cars, track) {
  return [...cars].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished) return a.finishAt - b.finishAt;
    if (a.cpPassed !== b.cpPassed) return b.cpPassed - a.cpPassed;
    return distToNext(a, track) - distToNext(b, track);
  });
}

export function sanitizeName(raw) {
  let s = String(raw ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').trim();
  s = s.slice(0, 12).trim();
  return s || `Driver${100 + Math.floor(Math.random() * 900)}`;
}

export class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.players = new Map();          // id -> player
    this.hostId = null;
    this.mapId = MAPS[0].id;
    this.fillBots = true;
    this.phase = 'lobby';              // lobby | race | results
    this.session = new Map();          // key -> { name, color, isBot, wins, points, races }
    this.race = null;
    this.results = null;
    this.send = opts.send || (() => {});
    this.onEmpty = opts.onEmpty || (() => {});
    this.seed = opts.seed ?? Date.now();
    this.timer = null;
    this.destroyed = false;
  }

  // ---------- players ----------
  humans() { return [...this.players.values()]; }

  freeColor(prefer) {
    const used = new Set(this.humans().map((p) => p.color));
    if (CAR_COLORS.includes(prefer) && !used.has(prefer)) return prefer;
    return CAR_COLORS.find((c) => !used.has(c)) || CAR_COLORS[0];
  }

  addPlayer({ id, socketId, name, color }) {
    if (this.players.size >= MAX_PLAYERS) return { error: 'Room is full' };
    const player = {
      id, socketId, name: sanitizeName(name), color: this.freeColor(color),
      ready: false, connected: true, spectator: this.phase !== 'lobby',
      input: { ...NO_INPUT }, seq: 0, reconnectTimer: null,
    };
    this.players.set(id, player);
    if (!this.hostId) this.hostId = id;
    this.broadcastRoom();
    if (this.phase === 'race') this.send(player, 'race', this.raceInfo(player));
    if (this.phase === 'results') this.send(player, 'results', this.results);
    return { player };
  }

  // A disconnected player coming back (same token, or same name) during the grace period.
  findReconnect(token, name) {
    for (const p of this.players.values()) {
      if (!p.connected && (p.id === token || p.name === sanitizeName(name))) return p;
    }
    return null;
  }

  reattach(player, socketId) {
    clearTimeout(player.reconnectTimer);
    player.reconnectTimer = null;
    player.socketId = socketId;
    player.connected = true;
    player.input = { ...NO_INPUT };
    player.seq = 0; // a reloaded page starts counting input sequence numbers again
    this.broadcastRoom();
    if (this.phase === 'race') this.send(player, 'race', this.raceInfo(player));
    if (this.phase === 'results') this.send(player, 'results', this.results);
  }

  disconnect(id) {
    const p = this.players.get(id);
    if (!p) return;
    const car = this.race && this.race.cars.find((c) => c.id === id);
    if (this.phase === 'race' && car && !car.removed) {
      p.connected = false;
      p.input = { ...NO_INPUT };
      p.reconnectTimer = setTimeout(() => this.removePlayer(id), RECONNECT_GRACE_MS);
      this.broadcastRoom();
    } else {
      this.removePlayer(id);
    }
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    clearTimeout(p.reconnectTimer);
    this.players.delete(id);
    if (this.race) {
      const car = this.race.cars.find((c) => c.id === id);
      if (car && !car.finished) { car.dnf = true; car.removed = true; }
    }
    if (this.hostId === id) {
      const next = this.humans().find((h) => h.connected) || this.humans()[0];
      this.hostId = next ? next.id : null;
    }
    if (this.players.size === 0) { this.destroy(); return; }
    this.broadcastRoom();
  }

  setReady(id, ready) {
    const p = this.players.get(id);
    if (p && this.phase === 'lobby') { p.ready = !!ready; this.broadcastRoom(); }
  }

  setColor(id, color) {
    const p = this.players.get(id);
    if (!p || this.phase === 'race' || !CAR_COLORS.includes(color)) return;
    if (this.humans().some((h) => h.id !== id && h.color === color)) return;
    p.color = color;
    this.broadcastRoom();
  }

  setMap(id, mapId) {
    if (id !== this.hostId || this.phase === 'race' || !MAPS.some((m) => m.id === mapId)) return;
    this.mapId = mapId;
    this.broadcastRoom();
  }

  setFillBots(id, on) {
    if (id !== this.hostId || this.phase === 'race') return;
    this.fillBots = !!on;
    this.broadcastRoom();
  }

  setInput(id, bits, seq) {
    const p = this.players.get(id);
    if (!p || !Number.isInteger(bits) || !Number.isInteger(seq) || seq < p.seq) return;
    p.seq = seq;
    p.input = { up: !!(bits & 1), down: !!(bits & 2), left: !!(bits & 4), right: !!(bits & 8) };
  }

  requestRespawn(id) {
    const car = this.race && this.race.cars.find((c) => c.id === id);
    if (car) car.wantRespawn = true;
  }

  backToLobby(id) {
    if (id !== this.hostId || this.phase !== 'results') return;
    this.phase = 'lobby';
    this.race = null;
    for (const p of this.players.values()) { p.ready = false; p.spectator = false; }
    this.broadcastRoom();
  }

  // ---------- race ----------
  canStart(id) {
    return id === this.hostId && this.phase !== 'race' && this.humans().some((p) => p.ready || this.phase === 'results');
  }

  startRace(id, { realtime = true } = {}) {
    if (id !== undefined && !this.canStart(id)) return false;
    const track = getTrack(this.mapId);
    const rng = mulberry32(this.seed++);
    const entrants = this.humans().filter((p) => p.connected).map((p) => ({ id: p.id, name: p.name, color: p.color }));
    if (this.fillBots) {
      const used = new Set(entrants.map((e) => e.color));
      const names = [...BOT_NAMES].sort(() => rng() - 0.5);
      while (entrants.length < MAX_PLAYERS) {
        const color = CAR_COLORS.find((c) => !used.has(c));
        used.add(color);
        const name = `Bot ${names.pop()}`;
        entrants.push({ id: `bot:${name}`, name, color, isBot: true, brain: createBotBrain(rng) });
      }
    }
    if (entrants.length === 0) return false;
    // shuffle grid order
    for (let i = entrants.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [entrants[i], entrants[j]] = [entrants[j], entrants[i]];
    }
    const goTick = ticks(COUNTDOWN_MS);
    this.race = {
      mapId: this.mapId, track, tick: 0, goTick, winnerAt: null, graceEnd: null, events: [], ended: false,
      cars: entrants.map((e, i) => newRaceCar(i, e, track.gridSlots[i], goTick)),
    };
    for (const c of this.race.cars) { c.state.id = c.index; c.state.ghost = false; }
    this.phase = 'race';
    this.results = null;
    for (const p of this.players.values()) { p.spectator = !entrants.some((e) => e.id === p.id); p.input = { ...NO_INPUT }; }
    this.broadcastRoom();
    for (const p of this.players.values()) this.send(p, 'race', this.raceInfo(p));
    if (realtime) this.startLoop();
    return true;
  }

  raceInfo(player) {
    const r = this.race;
    return {
      mapId: r.mapId, tick: r.tick, goTick: r.goTick, laps: LAPS,
      cars: r.cars.map((c) => ({ index: c.index, id: c.id, name: c.name, color: c.color, isBot: c.isBot })),
      you: r.cars.findIndex((c) => c.id === player.id),
    };
  }

  startLoop() {
    this.stopLoop();
    let last = performance.now();
    let acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += now - last;
      last = now;
      if (acc > 250) acc = 250; // after a stall, don't try to catch up forever
      while (acc >= TICK_MS && this.phase === 'race') {
        this.step();
        acc -= TICK_MS;
      }
    }, TICK_MS / 2);
  }

  stopLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  respawn(car) {
    const r = this.race;
    if (r.tick < car.respawnAt) return false;
    const track = r.track;
    let x, y, angle, seg;
    if (car.cpPassed === 0) {
      ({ x, y, angle, seg } = car.slot);
    } else {
      const cp = track.checkpoints[(car.cpPassed - 1) % CHECKPOINTS];
      x = cp.x + cp.tx * 2; y = cp.y + cp.ty * 2; seg = cp.seg;
      angle = Math.atan2(cp.tx, -cp.ty);
    }
    const id = car.state.id;
    car.state = createCar(x, y, angle, seg);
    car.state.id = id;
    car.ghostUntil = r.tick + ticks(RESPAWN_GHOST_MS);
    car.respawnAt = r.tick + ticks(RESPAWN_COOLDOWN_MS);
    car.wrongTicks = 0;
    car.wrongWay = false;
    return true;
  }

  step() {
    const r = this.race;
    if (!r || r.ended) return;
    r.tick++;
    const { track } = r;

    if (r.tick > r.goTick) {
      const active = r.cars.filter((c) => !c.removed);
      const prev = new Map();
      for (const car of active) {
        let input = NO_INPUT;
        if (car.isBot) {
          input = botInput(car.brain, car, track);
          if (input.respawn) car.wantRespawn = true;
        } else {
          const p = this.players.get(car.id);
          if (p && p.connected) input = p.input;
        }
        let respawned = false;
        if (car.wantRespawn) { car.wantRespawn = false; respawned = this.respawn(car); }
        prev.set(car, respawned ? null : [car.state.x, car.state.y]);
        integrate(car.state, input, track);
        car.state.ghost = car.finished || r.tick < car.ghostUntil;
      }

      const { carHits, wallHits } = settle(active.map((c) => c.state), track);
      for (const h of carHits) if (h.impact > 0.15) this.event(['c', r2(h.x), r2(h.y), r2(h.impact), h.a, h.b]);
      for (const h of wallHits) if (h.impact > 0.2) this.event(['w', r2(h.x), r2(h.y), r2(h.impact), h.id]);

      for (const car of active) {
        const st = car.state;

        if (![st.x, st.y, st.angle, st.xVelocity, st.yVelocity, st.angularVelocity, st.power].every(Number.isFinite)) {
          car.respawnAt = 0;
          this.respawn(car);
          continue;
        }

        const p0 = prev.get(car);
        if (p0) {
          const res = updateProgress(car, p0[0], p0[1], st.x, st.y, track, r.tick);
          if (res === 'finish' && r.winnerAt == null) {
            r.winnerAt = car.finishAt;
            r.graceEnd = r.tick + ticks(FINISH_GRACE_MS);
          }
          if (res === 'lap' || res === 'finish') this.event(['l', car.index, res === 'finish' ? 1 : 0]);
        }

        // wrong way: heading more than 120° off the track direction while moving
        const fx = Math.sin(st.angle), fy = -Math.cos(st.angle);
        const dot = fx * track.tx[st.seg] + fy * track.ty[st.seg];
        if (!car.finished && speedOf(st) > 0.3 && dot < Math.cos(WRONG_WAY_ANGLE)) car.wrongTicks++;
        else car.wrongTicks = 0;
        car.wrongWay = car.wrongTicks > ticks(WRONG_WAY_MS);
      }

      const done = r.cars.every((c) => c.finished || c.dnf || c.removed);
      if (done || (r.graceEnd != null && r.tick >= r.graceEnd)) {
        this.endRace();
        return;
      }
    }
    if (r.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
  }

  event(e) {
    const r = this.race;
    if (r.events.length < 24) r.events.push(e);
  }

  flags(c) {
    const r = this.race;
    return (c.state.ghost || r.tick < c.ghostUntil ? 1 : 0) | (c.state.onKerb ? 2 : 0) | (c.wrongWay ? 4 : 0)
      | (c.finished ? 8 : 0) | (c.dnf ? 16 : 0) | (c.removed ? 32 : 0);
  }

  snapshot() {
    const r = this.race;
    return {
      t: r.tick, go: r.goTick,
      g: r.graceEnd != null ? Math.max(0, r.graceEnd - r.tick) : -1,
      c: r.cars.map((c) => {
        const s = c.state;
        return [r2(s.x), r2(s.y), Math.round(s.angle * 1000) / 1000, r4(s.xVelocity), r4(s.yVelocity),
          r4(s.power), r4(s.reverse), r4(s.angularVelocity), this.flags(c), c.cpPassed,
          r2(c.lapStart), c.bestLap == null ? 0 : Math.round(c.bestLap),
          c.finished ? Math.round((c.finishAt - r.goTick) * TICK_MS) : 0, s.seg];
      }),
      o: standings(r.cars, r.track).map((c) => c.index),
      e: r.events,
    };
  }

  broadcastSnapshot() {
    const snap = this.snapshot();
    this.race.events = [];
    for (const p of this.players.values()) {
      if (p.connected) this.send(p, 's', { ...snap, a: p.seq });
    }
  }

  endRace() {
    const r = this.race;
    r.ended = true;
    this.stopLoop();
    for (const c of r.cars) if (!c.finished) c.dnf = true;
    const order = standings(r.cars, r.track);
    const winner = order.find((c) => c.finished);
    const winMs = winner ? Math.round((winner.finishAt - r.goTick) * TICK_MS) : null;
    const rows = order.map((c, i) => {
      const totalMs = c.finished ? Math.round((c.finishAt - r.goTick) * TICK_MS) : null;
      return {
        pos: i + 1, id: c.id, name: c.name, color: c.color, isBot: c.isBot,
        status: c.finished ? 'Finished' : 'DNF',
        totalMs, bestLapMs: c.bestLap == null ? null : Math.round(c.bestLap),
        gapMs: c.finished && winMs != null ? totalMs - winMs : null,
        laps: c.lapTimes.length,
        points: c.finished && i < POINTS.length ? POINTS[i] : 0,
        winner: c === winner,
      };
    });
    for (const row of rows) {
      const key = row.id;
      const e = this.session.get(key) || { name: row.name, color: row.color, isBot: row.isBot, wins: 0, points: 0, races: 0 };
      e.name = row.name; e.color = row.color;
      e.races++; e.points += row.points; if (row.winner) e.wins++;
      this.session.set(key, e);
    }
    this.results = { mapId: r.mapId, rows, session: this.sessionTable() };
    this.phase = 'results';
    for (const p of this.players.values()) { p.ready = false; if (p.connected) this.send(p, 'results', this.results); }
    this.broadcastRoom();
  }

  sessionTable() {
    return [...this.session.values()].sort((a, b) => b.points - a.points || b.wins - a.wins)
      .map(({ name, color, isBot, wins, points, races }) => ({ name, color, isBot, wins, points, races }));
  }

  roomInfo(player) {
    return {
      code: this.code, phase: this.phase, hostId: this.hostId, mapId: this.mapId, fillBots: this.fillBots,
      you: player.id, laps: LAPS,
      players: this.humans().map((p) => ({
        id: p.id, name: p.name, color: p.color, ready: p.ready, connected: p.connected, spectator: p.spectator,
      })),
      session: this.sessionTable(),
    };
  }

  broadcastRoom() {
    for (const p of this.players.values()) if (p.connected) this.send(p, 'room', this.roomInfo(p));
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopLoop();
    for (const p of this.players.values()) clearTimeout(p.reconnectTimer);
    this.players.clear();
    this.race = null;
    this.onEmpty(this);
  }
}

