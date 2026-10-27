// AI players. They aim by simulating candidate shots with the shared physics:
// a fast ballistic probe over angle/power (wind included) finds shots that land near the
// target, then the best few are scored with the real simulateShot (damage dealt - self damage).

import { WORLD_W, GROUND_MAX, DT, SUBSTEP_PX, SHIELD_HP } from '../../shared/tanks/constants.js';
import { groundAt } from '../../shared/tanks/terrain.js';
import { launchVelocity, muzzle, gravityOf, windAccel, pointInTank } from '../../shared/tanks/physics.js';
import { simulateShot } from '../../shared/tanks/simulate.js';
import { getWeapon } from '../../shared/tanks/weapons.js';

export const BOT_LEVELS = ['easy', 'medium', 'hard'];
export const BOT_NAMES = ['Rusty', 'Boomer', 'Sarge', 'Tiny', 'Major', 'Dozer', 'Blaze', 'Crater'];

const ERROR = { easy: [9, 12], medium: [2.5, 4], hard: [0.6, 1] };
const CANDIDATES = { easy: 2, medium: 4, hard: 6 };

// Where a plain shell would land, ignoring terrain changes.
export function probe(state, shooter, angle, power, speed = 1, gmult = 1) {
  const tank = state.tanks[shooter];
  const m = muzzle(tank, angle);
  const p = { x: m.x, y: m.y, ...launchVelocity(angle, power, speed) };
  const g = gravityOf(state) * gmult, w = windAccel(state);
  for (let i = 0; i < 2400; i++) {
    p.vy += g * DT; p.vx += w * DT;
    const n = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy) * DT / SUBSTEP_PX));
    for (let k = 0; k < n; k++) {
      p.x += (p.vx * DT) / n; p.y += (p.vy * DT) / n;
      if (p.x < 0 || p.x > WORLD_W) return { x: p.x, y: p.y, lost: true };
      if (p.y >= GROUND_MAX || p.y >= groundAt(state.terrain, p.x)) return { x: p.x, y: p.y };
      if (i > 18) {
        for (let t = 0; t < state.tanks.length; t++) {
          if (state.tanks[t].alive && pointInTank(state.tanks[t], p.x, p.y)) return { x: p.x, y: p.y, tank: t };
        }
      }
    }
  }
  return { x: p.x, y: p.y, lost: true };
}

export function weaponValue(id) {
  const w = getWeapon(id);
  const p = w.params;
  if (['dirtball', 'slinger', 'tracer', 'teleport', 'wall', 'shield', 'mine'].includes(id)) return 2;
  return (p.dmg || 20) * (p.n || 1) * (p.r ? Math.min(2, 0.6 + p.r / 60) : 1);
}

function enemiesOf(state, me) {
  return state.tanks.map((t, i) => i).filter((i) => i !== me && state.tanks[i].alive && state.tanks[i].team !== state.tanks[me].team);
}

function pickTarget(state, me, level, rng) {
  const es = enemiesOf(state, me);
  if (!es.length) return -1;
  if (level === 'easy') return es[Math.floor(rng() * es.length)];
  const mx = state.tanks[me].x;
  const score = (i) => Math.abs(state.tanks[i].x - mx) + (state.mode === 'survival' ? state.tanks[i].hp * 4 : 0);
  return es.reduce((b, i) => (score(i) < score(b) ? i : b), es[0]);
}

// Best aims toward a target for one weapon, scored with the real simulation.
function searchAim(state, me, target, weaponId, level, rng, seed) {
  const tk = state.tanks[target], my = state.tanks[me];
  const w = getWeapon(weaponId);
  const right = tk.x >= my.x;
  const aims = [];
  if (w.behavior === 'laser') {
    const m = muzzle(my, 45);
    const ang = Math.atan2(m.y - (tk.y - 9), tk.x - m.x) * 180 / Math.PI;
    const dist = Math.hypot(tk.x - m.x, tk.y - 9 - m.y);
    aims.push({ angle: Math.max(0, Math.min(180, ang)), power: Math.min(100, dist / 12 + 4), miss: 0 });
  } else {
    const speed = w.params.speed || 1, gmult = w.params.gmult || 1;
    for (let a = 12; a <= 86; a += 3.7) {
      for (let pw = 18; pw <= 100; pw += 3.5) {
        const ang = right ? a : 180 - a;
        const hit = probe(state, me, ang, pw, speed, gmult);
        if (hit.lost) continue;
        const miss = hit.tank === target ? 0 : Math.abs(hit.x - tk.x) + (hit.tank === me ? 400 : 0);
        aims.push({ angle: ang, power: pw, miss });
      }
    }
    aims.sort((a, b) => a.miss - b.miss);
  }
  const top = aims.slice(0, CANDIDATES[level]);
  if (!top.length) top.push({ angle: right ? 45 : 135, power: 60, miss: 999 });
  let best = null;
  for (const aim of top) {
    const res = simulateShot(state, { shooter: me, weapon: weaponId, angle: aim.angle, power: aim.power }, seed);
    const sc = res.summary.dealt - res.summary.self * 1.5 - aim.miss * 0.01;
    if (!best || sc > best.score) best = { ...aim, score: sc };
  }
  return best;
}

// Returns { slot, angle, power } or { move: -1|1 }.
export function planBotTurn(match, me, level = 'medium', rng = Math.random, { noMove = false } = {}) {
  const state = match.state;
  const items = match.inv[me].filter((w) => !w.used);
  const tank = state.tanks[me];
  const target = pickTarget(state, me, level, rng);
  const seed = Math.floor(rng() * 2 ** 31);
  const [angErr, powErr] = ERROR[level] || ERROR.medium;
  const jitter = (a) => ({
    slot: a.slot,
    angle: Math.max(0, Math.min(180, a.angle + (rng() * 2 - 1) * angErr)),
    power: Math.max(5, Math.min(tank.frozen ? 80 : 100, a.power + (rng() * 2 - 1) * powErr)),
  });
  if (target < 0) return { slot: items[0].slot, angle: 90, power: 30 };

  let choices;
  if (level === 'easy') {
    choices = [items[Math.floor(rng() * items.length)]];
  } else {
    const byValue = [...items].sort((a, b) => weaponValue(b.weapon) - weaponValue(a.weapon));
    if (level === 'hard') {
      const shield = items.find((w) => w.weapon === 'shield');
      if (shield && state.mode === 'survival' && tank.hp < 45 && tank.shield < SHIELD_HP / 2) {
        return { slot: shield.slot, angle: tank.angle, power: tank.power };
      }
      // last few weapons: utility first while damage weapons are still worth saving
      const seen = new Set();
      choices = byValue.filter((w) => !seen.has(w.weapon) && seen.add(w.weapon)).slice(0, 3);
    } else {
      choices = [byValue[0]];
    }
  }

  let best = null;
  for (const item of choices) {
    const aim = searchAim(state, me, target, item.weapon, level, rng, seed);
    if (!best || aim.score > best.score) best = { ...aim, slot: item.slot };
  }
  if (level === 'hard' && !noMove && best.score < 6 && tank.moves > 0 && !match.turn?.frozen) {
    return { move: state.tanks[target].x > tank.x ? 1 : -1 };
  }
  return jitter(best);
}
