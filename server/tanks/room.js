// Room: lobby -> draft -> match -> results state machine, timers, bots, reconnects, chat.
// Talks to the outside only through opts.send(socketId, event, data), so tests can drive it directly.

import {
  MAX_PLAYERS, MIN_PLAYERS, DEFAULT_SETTINGS, WEAPON_COUNTS, TURN_TIMES, DRAFT_PICK_SECONDS, STEP_RATE,
  RECONNECT_SECONDS, EMPTY_ROOM_MINUTES, BOT_THINK_MS, SHOT_END_PAUSE_MS, NAME_MAX, CHAT_MAX, CHAT_PER_10S,
  EMOJIS, TANK_COLORS, TANK_STYLES, MOVE_SPEED, FREE_RELOAD_MS, FREE_SECONDS_PER_ROUND, FREE_MIN_SECONDS,
} from '../../shared/tanks/constants.js';
import { MAP_IDS } from '../../shared/tanks/maps.js';
import { mulberry32 } from '../../shared/tanks/rng.js';
import { Match } from './game.js';
import { planBotTurn, BOT_LEVELS, BOT_NAMES } from './bot.js';

export function sanitizeName(raw, fallback = 'Player') {
  let s = String(raw ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').trim();
  s = Array.from(s).slice(0, NAME_MAX).join('').trim();
  return s || fallback;
}

export function sanitizeChat(raw) {
  return Array.from(String(raw ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ')).slice(0, CHAT_MAX).join('').trim();
}

const pickColor = (c, used) => (TANK_COLORS.includes(c) && !used.has(c) ? c : TANK_COLORS.find((x) => !used.has(x)) || TANK_COLORS[0]);

// How long clients need to play a shot back (server waits this long before the next turn).
export function shotDuration(shot) {
  let ms = (shot.steps / STEP_RATE) * 1000 + 400;
  if (shot.events.some((e) => e.type === 'laser' || e.type === 'shield')) ms += 500;
  if (shot.final) ms += 2400; // slow motion on the deciding shot
  return Math.min(24000, ms + (shot.mineShots || []).reduce((s, m) => s + shotDuration(m), 0));
}

export class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.send = opts.send || (() => {});
    this.onEmpty = opts.onEmpty || (() => {});
    this.fast = opts.fast || 1; // tests speed timers up
    this.local = !!opts.local;
    this.members = new Map();  // id -> member
    this.seats = [];           // member ids playing (max 4)
    this.hostId = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.phase = 'lobby';
    this.match = null;
    this.session = new Map();  // id -> { name, wins }
    this.timers = new Set();
    this.turnTimer = null;
    this.emptyTimer = null;
    this.botSeq = 0;
    this.lastActive = Date.now();
    this.destroyed = false;
  }

  // ---------- timers ----------
  later(ms, fn) {
    const h = setTimeout(() => { this.timers.delete(h); if (!this.destroyed) fn(); }, ms / this.fast);
    this.timers.add(h);
    return h;
  }
  cancel(h) { if (h) { clearTimeout(h); this.timers.delete(h); } }
  clearAll() {
    for (const h of this.timers) clearTimeout(h);
    this.timers.clear();
    this.turnTimer = null;
    this.draftTimer = null;
    this.freeClock = null;
    this.ending = false;
  }

  destroy() {
    this.destroyed = true;
    this.clearAll();
    this.cancel(this.emptyTimer);
    for (const m of this.members.values()) this.cancel(m.dropTimer);
    this.members.clear();
    this.match = null;
  }

  // ---------- members ----------
  humans() { return [...this.members.values()].filter((m) => !m.isBot); }
  connectedHumans() { return this.humans().filter((m) => m.connected); }
  seated() { return this.seats.map((id) => this.members.get(id)).filter(Boolean); }

  addMember({ id, token, socketId, name, color, style, localOf = null }) {
    if (this.members.has(id)) return { error: 'Duplicate id' };
    const used = new Set(this.seated().map((m) => m.color));
    const m = {
      id, token, socketId, name: sanitizeName(name), color: pickColor(color, used), style: TANK_STYLES.includes(style) ? style : 'classic',
      isBot: false, bot: null, ready: this.local, connected: true, team: 0, localOf, spectator: false, chat: [],
    };
    this.members.set(id, m);
    if (this.phase === 'lobby' && this.seats.length < MAX_PLAYERS) {
      this.seats.push(id);
      m.team = this.seats.length % 2 === 1 ? 0 : 1;
    } else {
      m.spectator = true;
    }
    if (!this.hostId) this.hostId = id;
    this.session.set(id, this.session.get(id) || { name: m.name, color: m.color, wins: 0 });
    this.cancel(this.emptyTimer);
    this.emptyTimer = null;
    this.broadcastRoom();
    if (this.phase !== 'lobby') this.sendMatch(m);
    return { ok: true, member: m };
  }

  addBot(byId, level = 'medium') {
    if (byId !== this.hostId || this.phase !== 'lobby' || this.seats.length >= MAX_PLAYERS) return false;
    if (!BOT_LEVELS.includes(level)) level = 'medium';
    const used = new Set(this.seated().map((m) => m.color));
    const names = new Set(this.seated().map((m) => m.name));
    const name = BOT_NAMES.find((n) => !names.has(n)) || `Bot${this.botSeq}`;
    const id = `bot-${++this.botSeq}`;
    this.members.set(id, {
      id, name, color: pickColor(null, used), style: TANK_STYLES[this.botSeq % TANK_STYLES.length],
      isBot: true, bot: level, ready: true, connected: true, team: this.seats.length % 2 === 0 ? 0 : 1, socketId: null,
    });
    this.seats.push(id);
    this.broadcastRoom();
    return true;
  }

  controls(socketId, memberId) {
    const m = this.members.get(memberId);
    return !!m && !m.isBot && m.socketId === socketId;
  }

  removeMember(id, reason = 'left') {
    const m = this.members.get(id);
    if (!m) return;
    this.cancel(m.dropTimer);
    // local seats leave together with their owner
    for (const o of [...this.members.values()]) if (o.localOf === id) this.removeMember(o.id, reason);
    if (this.phase === 'lobby' || this.phase === 'results' || m.spectator || m.isBot) {
      this.members.delete(id);
      this.seats = this.seats.filter((s) => s !== id);
    } else {
      // mid-match: a bot takes over the tank
      this.toBot(m);
      m.socketId = null;
    }
    if (this.hostId === id) this.hostId = this.humans().filter((h) => h.connected && !h.localOf)[0]?.id || null;
    this.afterMembership();
  }

  toBot(m) {
    m.isBot = true;
    m.bot = 'medium';
    m.takenOver = true;
    m.connected = true;
    if (this.isTurnOf(m.id)) this.scheduleActor();
    if (this.phase === 'draft' && this.match.picker === this.seatIndex(m.id)) this.scheduleDraftActor();
    if (this.phase === 'match' && this.match.free) this.scheduleFreeBot(this.seatIndex(m.id));
  }

  disconnect(socketId) {
    for (const m of this.members.values()) {
      if (m.socketId !== socketId || m.isBot) continue;
      if (this.phase === 'lobby' || this.phase === 'results' || m.spectator) { this.removeMember(m.id); continue; }
      m.connected = false;
      m.droppedAt = Date.now();
      m.dropTimer = this.later(RECONNECT_SECONDS * 1000, () => { if (!m.connected) { this.toBot(m); this.broadcastRoom(); } });
      if (this.isTurnOf(m.id)) this.scheduleActor();
      if (this.phase === 'draft' && this.match.picker === this.seatIndex(m.id)) this.scheduleDraftActor();
    }
    this.afterMembership();
  }

  findReconnect(token) {
    if (typeof token !== 'string') return null;
    return [...this.members.values()].find((m) => m.token === token && !m.localOf && (!m.connected || m.takenOver)) || null;
  }

  reattach(m, socketId) {
    for (const o of this.members.values()) {
      if (o === m || o.localOf === m.id) {
        o.socketId = socketId;
        o.connected = true;
        this.cancel(o.dropTimer);
        if (o.takenOver) { o.isBot = false; o.bot = null; o.takenOver = false; }
      }
    }
    if (!this.hostId) this.hostId = m.id;
    this.cancel(this.emptyTimer);
    this.emptyTimer = null;
    this.broadcastRoom();
    this.sendMatch(m);
  }

  afterMembership() {
    if (this.destroyed) return;
    if (!this.connectedHumans().length) {
      if (!this.emptyTimer) this.emptyTimer = this.later(EMPTY_ROOM_MINUTES * 60000, () => { this.destroy(); this.onEmpty(this); });
      if (!this.humans().length && this.phase === 'lobby') { this.destroy(); this.onEmpty(this); return; }
    }
    this.broadcastRoom();
  }

  kick(byId, targetId) {
    if (byId !== this.hostId || targetId === this.hostId || this.phase !== 'lobby') return false;
    const m = this.members.get(targetId);
    if (!m || m.localOf) return false;
    if (!m.isBot && m.socketId) this.send(m.socketId, 'kicked', {});
    this.removeMember(targetId, 'kicked');
    return m;
  }

  // ---------- lobby ----------
  setReady(memberId, ready) {
    const m = this.members.get(memberId);
    if (!m || this.phase !== 'lobby') return;
    m.ready = !!ready;
    for (const o of this.members.values()) if (o.localOf === memberId) o.ready = m.ready;
    this.broadcastRoom();
  }

  setLook(memberId, { color, style, name }) {
    const m = this.members.get(memberId);
    if (!m || this.phase !== 'lobby') return;
    if (typeof color === 'string' && TANK_COLORS.includes(color) && !this.seated().some((o) => o !== m && o.color === color)) m.color = color;
    if (TANK_STYLES.includes(style)) m.style = style;
    if (name != null) m.name = sanitizeName(name, m.name);
    this.broadcastRoom();
  }

  setTeam(byId, targetId, team) {
    const m = this.members.get(targetId);
    if (byId !== this.hostId || this.phase !== 'lobby' || !m) return;
    m.team = team ? 1 : 0;
    this.broadcastRoom();
  }

  setSettings(byId, raw) {
    if (byId !== this.hostId || this.phase !== 'lobby' || !raw || typeof raw !== 'object') return;
    const s = this.settings;
    if (raw.mode === 'classic' || raw.mode === 'survival') s.mode = raw.mode;
    if (raw.map === 'random' || MAP_IDS.includes(raw.map)) s.map = raw.map;
    if (WEAPON_COUNTS.includes(raw.weapons)) s.weapons = raw.weapons;
    if (TURN_TIMES.includes(raw.turnTime)) s.turnTime = raw.turnTime;
    for (const k of ['friendlyFire', 'teams', 'public']) if (typeof raw[k] === 'boolean') s[k] = raw[k];
    if (['none', 'wrap', 'bounce'].includes(raw.walls)) s.walls = raw.walls;
    if (raw.pace === 'turns' || raw.pace === 'free') s.pace = raw.pace;
    if (raw.arsenal === 'draft' || raw.arsenal === 'unlimited') s.arsenal = raw.arsenal;
    if (this.local) { s.public = false; s.pace = 'turns'; } // one device can't aim two tanks at once
    this.broadcastRoom();
  }

  canStart() {
    const seated = this.seated();
    if (seated.length < MIN_PLAYERS) return 'Need at least 2 players';
    if (!seated.every((m) => m.ready || m.isBot)) return 'Everyone must be ready';
    if (this.settings.teams && new Set(seated.map((m) => m.team)).size < 2) return 'Both teams need a player';
    return null;
  }

  start(byId) {
    if (byId !== this.hostId || this.phase !== 'lobby') return { error: 'Only the host can start' };
    const err = this.canStart();
    if (err) return { error: err };
    this.startMatch();
    return { ok: true };
  }

  startMatch() {
    this.clearAll();
    // spectators fill free seats for the new match
    for (const m of this.members.values()) {
      if (m.spectator && m.connected && this.seats.length < MAX_PLAYERS) { m.spectator = false; this.seats.push(m.id); }
    }
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.botRng = mulberry32(seed ^ 0x9e3779b9);
    this.match = new Match(this.seated().map((m) => ({ id: m.id, name: m.name, color: m.color, style: m.style, team: m.team })), this.settings, seed);
    this.lastActive = Date.now();
    if (this.match.phase !== 'draft') return this.beginPlay(); // unlimited arsenal: no draft
    this.phase = 'draft';
    this.broadcastRoom();
    this.broadcastMatch();
    this.nextPick();
  }

  // ---------- draft ----------
  seatIndex(id) { return this.match ? this.match.players.findIndex((p) => p.id === id) : -1; }
  memberAt(i) { return this.members.get(this.match.players[i]?.id); }

  nextPick() {
    this.cancel(this.draftTimer);
    if (this.match.phase !== 'draft') return this.beginPlay();
    this.match.pickDeadline = Date.now() + DRAFT_PICK_SECONDS * 1000 / this.fast;
    this.broadcast('draftTurn', { pick: this.match.pick, player: this.match.picker, deadline: this.match.pickDeadline });
    this.draftTimer = this.later(DRAFT_PICK_SECONDS * 1000, () => this.applyPick(this.match.autoPick()));
    this.scheduleDraftActor();
  }

  scheduleDraftActor() {
    const m = this.memberAt(this.match.picker);
    if (!m || (!m.isBot && m.connected)) return;
    const pickNo = this.match.pick;
    this.later(m.isBot ? 500 + Math.random() * 500 : 900, () => {
      if (this.phase !== 'draft' || this.match.pick !== pickNo) return;
      this.applyPick(this.botDraftPick(this.match.picker, m));
    });
  }

  botDraftPick(i, m) {
    const free = this.match.pool.filter((p) => p.by === -1);
    if (m.bot === 'easy' || !m.isBot) return this.match.autoPick();
    const pick = free.reduce((b, p) => (botPickValue(p.weapon) > botPickValue(b.weapon) ? p : b), free[0]);
    return this.match.draftPick(i, pick.slot);
  }

  pick(socketId, slot) {
    if (this.phase !== 'draft') return { error: 'Not drafting' };
    const m = this.memberAt(this.match.picker);
    if (!m || !this.controls(socketId, m.id)) return { error: 'Not your pick' };
    const res = this.match.draftPick(this.match.picker, Number(slot));
    if (res.error) return res;
    this.applyPick(res);
    return { ok: true };
  }

  applyPick(res) {
    if (!res || res.error) return;
    this.broadcast('picked', { slot: res.slot, player: res.player, weapon: res.weapon, pick: this.match.pick });
    this.nextPick();
  }

  // ---------- match ----------
  beginPlay() {
    this.phase = 'match';
    this.broadcastRoom();
    this.broadcastMatch();
    this.later(800, () => (this.match.free ? this.startFree() : this.nextTurn()));
  }

  // ---------- Free Fire ----------
  // No turns: everyone fires whenever reloaded. The match ends when all shots are used,
  // one side is left (Survival), or the clock runs out.
  startFree() {
    if (this.phase !== 'match') return;
    const secs = Math.max(FREE_MIN_SECONDS, this.settings.weapons * FREE_SECONDS_PER_ROUND);
    this.freeEndsAt = Date.now() + (secs * 1000) / this.fast;
    this.reloadUntil = this.match.players.map(() => 0);
    this.broadcast('free', { duration: (secs * 1000) / this.fast, reload: FREE_RELOAD_MS / this.fast, shotsLeft: this.match.shotsLeft });
    this.freeClock = this.later(secs * 1000, () => { this.match.finishNow(); this.endMatch(); });
    this.match.players.forEach((_, i) => this.scheduleFreeBot(i, 400 + Math.random() * 800));
  }

  // Seat the socket plays in a Free Fire match.
  freeSeat(socketId) {
    if (this.phase !== 'match' || !this.match?.free) return -1;
    return this.match.players.findIndex((pl) => this.controls(socketId, pl.id));
  }

  freeFire(p, msg) {
    const now = Date.now();
    if (now < this.reloadUntil[p]) return { error: 'Reloading' };
    const res = this.match.fireFree(p, msg);
    if (res.error) return res;
    this.reloadUntil[p] = now + FREE_RELOAD_MS / this.fast;
    let longest = 0;
    for (const shot of [...res.pre, res.shot].filter(Boolean)) {
      shot.final = this.match.phase === 'over';
      this.broadcast('shot', shot);
      longest = Math.max(longest, shotDuration(shot));
    }
    if (this.match.phase === 'over' && !this.ending) {
      this.ending = true;
      this.cancel(this.freeClock);
      this.later(longest + SHOT_END_PAUSE_MS, () => this.endMatch());
    }
    return { ok: true, reload: FREE_RELOAD_MS / this.fast };
  }

  scheduleFreeBot(p, delay) {
    const m = this.memberAt(p);
    if (!m || !m.isBot || !this.match?.free) return;
    const think = BOT_THINK_MS[0] + Math.random() * (BOT_THINK_MS[1] - BOT_THINK_MS[0]);
    // later() takes game-time ms; reloadUntil is wall-clock (already sped up by `fast`)
    const wait = delay ?? Math.max(0, ((this.reloadUntil?.[p] || 0) - Date.now()) * this.fast);
    this.later(Math.max(10, wait + think * 0.5), () => {
      if (this.phase !== 'match' || this.match.phase !== 'play' || !m.isBot || !this.match.canPlay(p)) return;
      const plan = planBotTurn(this.match, p, m.bot, this.botRng, { noMove: true });
      this.broadcast('aim', { player: p, angle: plan.angle, power: plan.power, slot: plan.slot });
      this.later(300, () => {
        if (this.phase !== 'match' || this.match.phase !== 'play' || !m.isBot || !this.match.canPlay(p)) return;
        const r = this.freeFire(p, plan);
        this.scheduleFreeBot(p, r.error === 'Reloading' ? 300 : undefined);
      });
    });
  }

  isTurnOf(memberId) {
    return this.phase === 'match' && !!this.match?.turn && !this.match.turn.fired && this.match.players[this.match.turn.player]?.id === memberId;
  }

  nextTurn() {
    if (this.phase !== 'match') return;
    this.cancel(this.turnTimer);
    const res = this.match.beginTurn();
    const mines = res.mineShots || [];
    let delay = 0;
    for (const shot of mines) {
      shot.final = res.done && shot === mines[mines.length - 1];
      this.later(delay, () => this.broadcast('shot', shot));
      delay += shotDuration(shot);
    }
    this.later(delay, () => {
      if (res.done) return this.endMatch();
      const t = this.match.turn;
      t.deadline = this.settings.turnTime ? Date.now() + this.settings.turnTime * 1000 / this.fast : 0;
      this.broadcast('turn', { ...t, tanks: this.match.publicTanks(), mines: this.match.state.mines });
      if (this.settings.turnTime) this.turnTimer = this.later(this.settings.turnTime * 1000, () => this.timeout());
      this.scheduleActor();
    });
  }

  timeout() {
    if (!this.match?.turn || this.match.turn.fired) return;
    const p = this.match.turn.player;
    const res = this.match.skip(p);
    if (res.error) return;
    this.broadcast('skipped', { player: p, weapon: res.weapon });
    this.afterShot(1200);
  }

  // Bots (and players who dropped) act on their own.
  scheduleActor() {
    const t = this.match?.turn;
    if (!t || t.fired) return;
    const m = this.memberAt(t.player);
    if (!m) return;
    const turnNo = t.number;
    const still = () => this.phase === 'match' && this.match.turn && this.match.turn.number === turnNo && !this.match.turn.fired;
    if (!m.isBot) {
      if (!m.connected) this.later(1500, () => { if (still() && !m.connected) this.timeout(); });
      return;
    }
    const think = BOT_THINK_MS[0] + Math.random() * (BOT_THINK_MS[1] - BOT_THINK_MS[0]);
    this.later(think * 0.6, () => {
      if (!still()) return;
      let plan = planBotTurn(this.match, t.player, m.bot, this.botRng);
      let wait = 0;
      if (plan.move) {
        const mv = this.match.move(t.player, plan.move);
        if (!mv.error) {
          this.broadcastMove(t.player, mv);
          wait = (mv.path.length / MOVE_SPEED) * 1000 + mv.mineShots.reduce((s, x) => s + shotDuration(x), 0);
        }
        if (!still()) return;
        plan = planBotTurn(this.match, t.player, m.bot, this.botRng, { noMove: true });
      }
      this.broadcast('aim', { player: t.player, angle: plan.angle, power: plan.power, slot: plan.slot });
      this.later(think * 0.4 + 350 + wait, () => { if (still()) this.doFire(t.player, plan); });
    });
  }

  // Socket actions during a turn. `who` = seat index the socket wants to act for.
  activeFor(socketId) {
    const t = this.match?.turn;
    if (this.phase !== 'match' || !t || t.fired) return -1;
    const m = this.memberAt(t.player);
    return m && this.controls(socketId, m.id) ? t.player : -1;
  }

  aim(socketId, { angle, power, slot }) {
    const p = this.match?.free ? this.freeSeat(socketId) : this.activeFor(socketId);
    if (p < 0) return;
    const a = Number(angle), pw = Number(power);
    if (!Number.isFinite(a) || !Number.isFinite(pw)) return;
    this.broadcast('aim', { player: p, angle: Math.max(0, Math.min(180, a)), power: Math.max(0, Math.min(100, pw)), slot: Number(slot) || 0 }, socketId);
  }

  move(socketId, dir) {
    const p = this.match?.free ? this.freeSeat(socketId) : this.activeFor(socketId);
    if (p < 0) return { error: 'Not your turn' };
    const res = this.match.move(p, dir === -1 ? -1 : dir === 1 ? 1 : 0);
    if (res.error) return res;
    this.broadcastMove(p, res);
    return { ok: true };
  }

  broadcastMove(p, res) {
    this.broadcast('moved', { player: p, path: res.path, tank: res.tank });
    // mines set off by the move play right after it
    let delay = (res.path.length / MOVE_SPEED) * 1000;
    for (const shot of res.mineShots) {
      this.later(delay, () => this.broadcast('shot', shot));
      delay += shotDuration(shot);
    }
    if (this.match.phase === 'over') { if (!this.ending) { this.ending = true; this.later(delay, () => this.endMatch()); } }
    else if (this.match.state.tanks[p] && !this.match.state.tanks[p].alive && this.match.turn) {
      this.match.skip(p);
      this.afterShot(delay);
    }
  }

  fire(socketId, msg) {
    if (this.match?.free) {
      const p = this.freeSeat(socketId);
      return p < 0 ? { error: 'Not in this match' } : this.freeFire(p, msg);
    }
    const p = this.activeFor(socketId);
    if (p < 0) return { error: 'Not your turn' };
    return this.doFire(p, msg);
  }

  doFire(p, { slot, angle, power }) {
    const shot = this.match.fire(p, { slot: Number(slot), angle, power });
    if (shot.error) return shot;
    this.cancel(this.turnTimer);
    shot.final = this.match.phase === 'over';
    this.broadcast('shot', shot);
    this.afterShot(shotDuration(shot) + SHOT_END_PAUSE_MS);
    return { ok: true };
  }

  afterShot(ms) {
    this.later(ms, () => (this.match.phase === 'over' ? this.endMatch() : this.nextTurn()));
  }

  endMatch() {
    if (this.phase !== 'match') return;
    this.cancel(this.turnTimer);
    this.cancel(this.freeClock);
    this.ending = false;
    if (this.match.phase !== 'over') this.match.finishNow();
    this.phase = 'results';
    const res = this.match.winner;
    if (!res.tie) {
      for (const i of res.winners) {
        const s = this.session.get(this.match.players[i].id);
        if (s) s.wins++;
      }
    }
    for (const m of this.members.values()) if (!m.isBot || m.takenOver) m.ready = this.local;
    this.broadcastRoom();
    this.broadcast('results', { ...res, session: this.sessionBoard() });
  }

  rematch(byId) {
    if (byId !== this.hostId || this.phase !== 'results') return { error: 'Only the host can start a rematch' };
    // players who left mid-match (bot took over) are dropped from the rematch
    for (const m of [...this.members.values()]) if (m.takenOver) this.members.delete(m.id);
    this.seats = this.seats.filter((id) => this.members.has(id));
    if (this.seats.length < MIN_PLAYERS) { this.toLobby(byId); return { error: 'Not enough players' }; }
    this.startMatch();
    return { ok: true };
  }

  toLobby(byId) {
    if (byId !== this.hostId || this.phase === 'lobby') return;
    this.clearAll();
    for (const m of [...this.members.values()]) if (m.takenOver) this.members.delete(m.id);
    this.seats = this.seats.filter((id) => this.members.has(id));
    for (const m of this.members.values()) {
      if (m.spectator && this.seats.length < MAX_PLAYERS) { m.spectator = false; this.seats.push(m.id); }
      if (!m.isBot) m.ready = this.local;
    }
    this.phase = 'lobby';
    this.match = null;
    this.broadcastRoom();
  }

  // ---------- chat ----------
  chat(memberId, text) {
    const m = this.members.get(memberId);
    if (!m) return;
    const now = Date.now();
    m.chat = (m.chat || []).filter((t) => now - t < 10000);
    if (m.chat.length >= CHAT_PER_10S) return;
    const clean = sanitizeChat(text);
    if (!clean) return;
    m.chat.push(now);
    this.broadcast('chat', { from: m.id, name: m.name, color: m.color, text: clean });
  }

  emoji(memberId, e) {
    const m = this.members.get(memberId);
    if (!m || !EMOJIS.includes(e)) return;
    const now = Date.now();
    m.chat = (m.chat || []).filter((t) => now - t < 10000);
    if (m.chat.length >= CHAT_PER_10S * 2) return;
    m.chat.push(now);
    this.broadcast('emoji', { from: m.id, seat: this.seatIndex(m.id), e });
  }

  // ---------- views ----------
  sessionBoard() {
    return [...this.session.entries()]
      .filter(([id]) => this.members.has(id))
      .map(([id, s]) => ({ id, name: this.members.get(id).name, color: this.members.get(id).color, wins: s.wins }))
      .sort((a, b) => b.wins - a.wins);
  }

  roomView() {
    return {
      code: this.code, phase: this.phase, hostId: this.hostId, settings: this.settings, local: this.local,
      seats: this.seated().map((m) => ({
        id: m.id, name: m.name, color: m.color, style: m.style, ready: !!m.ready, isBot: m.isBot, bot: m.bot,
        team: m.team, connected: m.connected, takenOver: !!m.takenOver, localOf: m.localOf || null,
      })),
      spectators: [...this.members.values()].filter((m) => m.spectator).map((m) => ({ id: m.id, name: m.name })),
      session: this.sessionBoard(),
      canStart: this.canStart(),
    };
  }

  broadcastRoom() {
    for (const s of this.sockets()) this.send(s, 'room', { ...this.roomView(), you: this.idsFor(s) });
  }

  broadcastMatch() {
    if (!this.match) return;
    const snap = this.matchView();
    for (const s of this.sockets()) this.send(s, 'match', snap);
  }

  sendMatch(m) {
    if (!this.match || !m.socketId) return;
    this.send(m.socketId, 'room', { ...this.roomView(), you: this.idsFor(m.socketId) });
    this.send(m.socketId, 'match', this.matchView());
  }

  matchView() {
    const snap = this.match.snapshot();
    snap.pickDeadline = this.match.pickDeadline;
    if (this.match.free && this.freeEndsAt) {
      const now = Date.now();
      snap.free = { endsIn: Math.max(0, this.freeEndsAt - now), reload: FREE_RELOAD_MS / this.fast, reloadIn: (this.reloadUntil || []).map((t) => Math.max(0, t - now)) };
    }
    if (snap.turn) snap.turn = { ...snap.turn };
    return snap;
  }

  idsFor(socketId) {
    return [...this.members.values()].filter((m) => m.socketId === socketId && !m.isBot).map((m) => m.id);
  }

  sockets() {
    return [...new Set([...this.members.values()].filter((m) => m.socketId && m.connected && !m.isBot).map((m) => m.socketId))];
  }

  broadcast(event, data, exceptSocket) {
    for (const s of this.sockets()) if (s !== exceptSocket) this.send(s, event, data);
  }
}

function botPickValue(id) {
  const order = ['nuke', 'mega', 'blackhole', 'meteor', 'airstrike', 'homing', 'laser', 'lightning', 'five', 'cluster', 'heavy', 'napalm', 'volcano', 'chain'];
  const i = order.indexOf(id);
  return i < 0 ? 0 : order.length - i;
}
