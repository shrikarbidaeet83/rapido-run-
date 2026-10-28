// simulateShot(state, input, seed) -> { state, events, summary, hash }
// Pure and deterministic: same state + input + seed => identical result on server and client.
// The server's result is authoritative; clients replay it as animation (opts.record adds frames).

import {
  WORLD_W, GROUND_MAX, DT, STEP_RATE, MAX_STEPS, MAX_PROJECTILES, MAX_EXPLOSIONS, DIRECT_HIT_BONUS,
  SELF_SAFE_SECONDS, SUBSTEP_PX, SHELL_MAX_SECONDS, MAX_WALL_HITS, TANK_HP, MINE_RADIUS, MINE_DAMAGE, FROZEN_POWER_CAP,
} from './constants.js';
import { mulberry32, hashInts } from './rng.js';
import { groundAt, surfaceY, carveCircle, settle, mergeRange, quantize, toInt } from './terrain.js';
import {
  launchVelocity, muzzle, gravityOf, windAccel, ballistic, pointInTank, distToTank, settleTank, fallDamage, DEG,
} from './physics.js';
import { getWeapon, BEHAVIORS, weaponPoints } from './weapons.js';

export const FRAME_EVERY = 2; // recorded animation frames: 60 per second
export const FRAME_STRIDE = 4; // frame.p holds [style, x, y, heading] per projectile

// ---------- state ----------
export function makeTank({ id, team, x, terrain }) {
  const t = { id, team, x, y: 0, tilt: 0, hp: TANK_HP, score: 0, alive: true, shield: 0, shieldTurns: 0, frozen: 0, buried: 0, angle: 60, power: 60 };
  settleTank(terrain, t);
  return t;
}

export function cloneState(s) {
  return {
    ...s,
    terrain: new Float32Array(s.terrain),
    tanks: s.tanks.map((t) => ({ ...t })),
    mines: s.mines.map((m) => ({ ...m })),
  };
}

export function hashState(s) {
  const ints = Array.from(s.terrain, toInt);
  for (const t of s.tanks) {
    ints.push(toInt(t.x), toInt(t.y), t.hp, t.score, t.alive ? 1 : 0, t.shield, t.shieldTurns, t.frozen, toInt(t.buried || 0));
  }
  for (const m of s.mines) ints.push(m.id, toInt(m.x), toInt(m.y), m.owner, m.armed ? 1 : 0);
  return hashInts(ints);
}

// Round positions so the final state has an exact, transferable form.
export function finalizeState(s) {
  quantize(s.terrain);
  for (const t of s.tanks) {
    t.x = toInt(t.x) / 100;
    settleTank(s.terrain, t); // the rounded x can rest on slightly different columns
    t.y = toInt(t.y) / 100;
    t.tilt = Math.round(t.tilt * 1e4) / 1e4;
  }
  for (const m of s.mines) { m.x = toInt(m.x) / 100; m.y = toInt(m.y) / 100; }
}

export const sameTeam = (s, a, b) => s.tanks[a].team === s.tanks[b].team;

// ---------- simulation ----------
export class Sim {
  constructor(state, seed, shooter, record) {
    this.s = state;
    this.rng = mulberry32(seed);
    this.shooter = shooter;
    this.record = record;
    this.step = 0;
    this.ents = [];
    this.events = [];
    this.frames = record ? [] : null;
    this.explosions = 0;
    this.dirty = null;
    this.g = gravityOf(state);
    this.wind = windAccel(state);
    this.summary = { dealt: 0, points: 0, self: 0, hits: 0, terrain: 0, healed: 0, direct: false, lost: state.tanks.map(() => 0) };
    this.pointsMult = 1; // set from the fired weapon
  }

  get tank() { return this.s.tanks[this.shooter]; }

  event(type, data) {
    const e = { t: this.step, type, ...data };
    this.events.push(e);
    return e;
  }

  add(ent) {
    if (this.ents.length >= MAX_PROJECTILES) return null;
    ent.age = 0;
    this.ents.push(ent);
    return ent;
  }

  // Delayed callback, `steps` physics steps from now.
  after(steps, fn) {
    return this.add({ kind: 'timer', left: Math.max(1, Math.round(steps)), fn, update: updateTimer });
  }

  // A ballistic projectile. Most weapons are shells with hooks.
  shell(o) {
    return this.add({
      kind: 'shell', style: 'shell', r: 30, dmg: 30, gmult: 1, safe: true, carve: true,
      ...o, update: updateShell,
    });
  }

  fire(angle, power, o = {}) {
    const m = muzzle(this.tank, angle);
    const v = launchVelocity(angle, power, o.speed || 1);
    return this.shell({ x: m.x, y: m.y, vx: v.vx, vy: v.vy, ...o });
  }

  // Explosion: crater + falloff damage. Returns false once the explosion cap is hit.
  explode(x, y, r, dmg, o = {}) {
    if (this.explosions >= MAX_EXPLOSIONS) return false;
    this.explosions++;
    this.event('explode', { x: rnd(x), y: rnd(y), r, kind: o.kind || 'shell' });
    if (o.carve !== false) this.carve(x, y, o.craterR ?? r);
    const dr = o.dmgR ?? r;
    if (dmg > 0) {
      this.s.tanks.forEach((tk, i) => {
        if (!tk.alive || tk.flying) return;
        const d = distToTank(tk, x, y);
        if (d >= dr) return;
        let amt = o.flat ? dmg : dmg * (1 - d / dr);
        if (o.direct === i) amt *= 1 + DIRECT_HIT_BONUS;
        this.hurt(i, amt, o);
      });
    }
    this.settleAll();
    return true;
  }

  carve(x, y, r) {
    const before = this.sumRange(x, r);
    const ch = carveCircle(this.s.terrain, x, y, r);
    if (ch) { this.summary.terrain += Math.round(this.sumRange(x, r) - before); this.markDirty(ch); }
  }

  sumRange(x, r) {
    let s = 0;
    const t = this.s.terrain;
    for (let i = Math.max(0, Math.floor(x - r)); i <= Math.min(WORLD_W - 1, Math.ceil(x + r)); i++) s += t[i];
    return s;
  }

  // bury = dirt landing from above: tanks under it get buried instead of lifted.
  terrainOp(range, bury = false) {
    if (range) this.markDirty(range);
    this.settleAll(bury);
  }

  markDirty(range) { this.dirty = mergeRange(this.dirty, range); }

  // Damage one tank. Shields absorb first. Points go to the shooter.
  // The shooter is immune to its own attack; teammate damage (friendly fire on)
  // costs points (Classic) and HP (Survival).
  hurt(i, amount, o = {}) {
    const s = this.s, tk = s.tanks[i];
    if (!tk.alive) return 0;
    if (i === this.shooter) return 0;
    const mate = sameTeam(s, i, this.shooter);
    if (mate && !s.friendlyFire) return 0;
    let amt = Math.round(amount);
    if (!(amt > 0)) return 0;
    if (tk.shield > 0) {
      const absorbed = Math.min(tk.shield, amt);
      tk.shield -= absorbed;
      amt -= absorbed;
      this.event('shieldHit', { tank: i, absorbed, broken: tk.shield === 0 });
      if (tk.shield === 0) tk.shieldTurns = 0;
      if (amt <= 0) return 0;
    }
    if (s.mode === 'survival') amt = Math.min(amt, tk.hp);
    if (amt <= 0) return 0;
    if (s.mode === 'survival') tk.hp -= amt;
    const shooter = s.tanks[this.shooter];
    // the tank that was hit loses the points its attacker scores (teammates: the raw damage)
    const loss = mate ? amt : Math.round(amt * this.pointsMult);
    tk.score -= loss;
    this.summary.lost[i] += loss;
    if (mate) {
      shooter.score -= amt;
      this.summary.self += amt;
    } else {
      const pts = Math.round(amt * this.pointsMult);
      shooter.score += pts;
      this.summary.dealt += amt;
      this.summary.points += pts;
      this.summary.hits++;
      if (o.direct === i) this.summary.direct = true;
      if (o.leech) {
        if (s.mode === 'survival') {
          const heal = Math.min(amt, TANK_HP - shooter.hp);
          if (shooter.alive && heal > 0) { shooter.hp += heal; this.summary.healed += heal; this.event('heal', { tank: this.shooter, amount: heal }); }
        } else {
          shooter.score += amt;
          this.summary.healed += amt;
          this.event('heal', { tank: this.shooter, amount: amt });
        }
      }
    }
    this.event('damage', { tank: i, amount: amt, points: mate ? -amt : Math.round(amt * this.pointsMult), lost: loss, by: this.shooter, x: rnd(tk.x), y: rnd(tk.y - 30), direct: o.direct === i, kind: o.kind || '' });
    if (s.mode === 'survival' && tk.hp <= 0) {
      tk.alive = false;
      tk.shield = 0;
      this.event('destroyed', { tank: i, x: rnd(tk.x), y: rnd(tk.y) });
      const ch = carveCircle(s.terrain, tk.x, tk.y, 34);
      if (ch) this.markDirty(ch);
    }
    return amt;
  }

  // Smooth deformed terrain, then drop tanks and mines onto it (with fall damage).
  settleAll(bury = false) {
    const s = this.s;
    if (this.dirty) {
      settle(s.terrain, this.dirty);
      if (this.record) {
        const [a, b] = [Math.max(0, this.dirty[0] - 3), Math.min(WORLD_W - 1, this.dirty[1] + 3)];
        this.event('terrain', { a, vals: Array.from(s.terrain.subarray(a, b + 1)) });
      }
      this.dirty = null;
    }
    s.tanks.forEach((tk, i) => {
      if (tk.flying) return;
      const fell = settleTank(s.terrain, tk, bury);
      const dmg = fallDamage(fell);
      if (dmg > 0) {
        this.event('fall', { tank: i, height: Math.round(fell) });
        this.hurt(i, dmg, { kind: 'fall' });
      }
    });
    for (const m of s.mines) m.y = groundAt(s.terrain, m.x);
  }

  enemies(of = this.shooter) {
    return this.s.tanks.map((t, i) => i).filter((i) => i !== of && this.s.tanks[i].alive && !sameTeam(this.s, i, of));
  }

  nearestEnemy(x, y, maxDist = Infinity) {
    let best = -1, bd = maxDist;
    for (const i of this.enemies()) {
      const tk = this.s.tanks[i];
      const d = Math.hypot(tk.x - x, tk.y - 10 - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Move a tank sideways along the terrain (black hole, magnet).
  shove(i, dx) {
    const tk = this.s.tanks[i];
    tk.x += dx;
    const fell = settleTank(this.s.terrain, tk);
    const dmg = fallDamage(fell);
    if (dmg > 0) { this.event('fall', { tank: i, height: Math.round(fell) }); this.hurt(i, dmg, { kind: 'fall' }); }
  }

  run() {
    while (this.ents.length && this.step < MAX_STEPS) {
      this.step++;
      const ents = this.ents;
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (e.dead) continue;
        e.age++;
        e.update(this, e);
      }
      if (ents.some((e) => e.dead)) this.ents = ents.filter((e) => !e.dead);
      if (this.record && this.step % FRAME_EVERY === 0) this.recordFrame();
    }
    if (this.ents.length) {
      this.event('timeout', {});
      this.ents = [];
    }
    for (const tk of this.s.tanks) delete tk.flying;
    this.settleAll();
    this.event('end', {});
  }

  recordFrame() {
    const p = [];
    for (const e of this.ents) {
      if (e.hidden || e.kind === 'timer') continue;
      if (e.parts) { for (const q of e.parts) p.push(e.style, q.x, q.y, 0); continue; }
      p.push(e.style || e.kind, e.x, e.y, e.vx != null ? Math.atan2(e.vy, e.vx) : 0);
    }
    this.frames.push({ t: this.step, p, tanks: this.s.tanks.map((t) => [t.x, t.y, t.tilt]) });
  }
}

const rnd = (v) => Math.round(v * 10) / 10;

function updateTimer(sim, e) {
  if (--e.left <= 0) { e.dead = true; e.fn(sim); }
}

// Ballistic flight with sub-stepping so fast shells never tunnel through thin hills.
export function updateShell(sim, p) {
  const s = sim.s;
  if (p.onStep) p.onStep(sim, p);
  if (p.dead) return;
  if (p.age > SHELL_MAX_SECONDS * STEP_RATE) { p.dead = true; sim.event('lost', { x: rnd(p.x), y: rnd(p.y) }); return; }
  const prevVy = p.vy;
  const d = ballistic(p, sim.g * p.gmult, p.noWind ? 0 : sim.wind);
  if (p.onApex && prevVy < 0 && p.vy >= 0) {
    const f = p.onApex; p.onApex = null;
    f(sim, p);
    if (p.dead) return;
  }
  const n = Math.max(1, Math.ceil(Math.hypot(d.dx, d.dy) / SUBSTEP_PX));
  for (let k = 0; k < n; k++) {
    p.x += d.dx / n;
    p.y += d.dy / n;
    if (p.x < 0 || p.x > WORLD_W) {
      p.wallHits = (p.wallHits || 0) + 1;
      if (p.wallHits > MAX_WALL_HITS) { p.dead = true; sim.event('lost', { x: rnd(Math.max(0, Math.min(WORLD_W, p.x))), y: rnd(p.y) }); return; }
      if (s.walls === 'wrap') p.x = (p.x + WORLD_W) % WORLD_W;
      else if (s.walls === 'bounce') { p.x = p.x < 0 ? -p.x : 2 * WORLD_W - p.x; p.vx = -p.vx * 0.8; d.dx = -d.dx; }
      else { p.dead = true; sim.event('lost', { x: rnd(Math.max(0, Math.min(WORLD_W, p.x))), y: rnd(p.y) }); return; }
    }
    let hit = null;
    if (p.y >= GROUND_MAX) hit = { type: 'ground' };
    else if (!p.drilling && p.y >= groundAt(s.terrain, p.x)) hit = { type: 'ground' };
    else {
      const safe = p.safe && p.age < SELF_SAFE_SECONDS * STEP_RATE;
      for (let i = 0; i < s.tanks.length; i++) {
        if (!s.tanks[i].alive || s.tanks[i].flying || (safe && i === sim.shooter)) continue;
        if (pointInTank(s.tanks[i], p.x, p.y)) { hit = { type: 'tank', tank: i }; break; }
      }
    }
    if (p.drilling && !hit) {
      p.drilled += Math.hypot(d.dx, d.dy) / n;
      if (p.y < groundAt(s.terrain, p.x) - 2 && p.drilled > 10) { p.drilling = false; p.gmult = 1; p.noWind = false; }
      else if (p.drilled >= p.drillMax) hit = { type: 'drill' };
    }
    if (hit) {
      p.dead = true;
      const fn = p.onHit || defaultHit;
      fn(sim, p, hit);
      return;
    }
  }
}

export function defaultHit(sim, p, hit) {
  sim.explode(p.x, p.y, p.r, p.dmg, { direct: hit.tank, kind: p.style, carve: p.carve, leech: p.leech, flat: p.flat });
}

// Main entry point.
//   input: { shooter, weapon, angle, power }  - a fired weapon
//          { shooter, mine }                  - a mine detonating (shooter = its owner)
export function simulateShot(state, input, seed, opts = {}) {
  const s = cloneState(state);
  const sim = new Sim(s, seed >>> 0, input.shooter, !!opts.record);
  const shooter = s.tanks[input.shooter];
  if (input.mine != null) {
    const idx = s.mines.findIndex((m) => m.id === input.mine);
    if (idx >= 0) {
      const m = s.mines[idx];
      s.mines.splice(idx, 1);
      sim.event('mineBoom', { x: rnd(m.x), y: rnd(m.y) });
      sim.explode(m.x, m.y, MINE_RADIUS, MINE_DAMAGE, { kind: 'mine' });
    }
  } else if (shooter && shooter.alive) {
    const w = getWeapon(input.weapon);
    const angle = Math.max(0, Math.min(180, Number(input.angle) || 0));
    const power = Math.max(0, Math.min(shooter.frozen ? FROZEN_POWER_CAP : 100, Number(input.power) || 0));
    shooter.angle = angle;
    shooter.power = power;
    sim.pointsMult = weaponPoints(w);
    sim.event('fire', { tank: input.shooter, weapon: w.id, angle, power });
    BEHAVIORS[w.behavior](sim, { ...w.params, style: w.id, color: w.color }, { angle, power, weapon: w });
  }
  sim.run();
  finalizeState(s);
  return { state: s, events: sim.events, frames: sim.frames, summary: sim.summary, steps: sim.step, hash: hashState(s) };
}

export { DEG, surfaceY };
