// 40 weapons: data (WEAPONS) + behaviors (BEHAVIORS).
// A behavior is launch(sim, params, { angle, power, weapon }) and uses the Sim API from simulate.js:
//   sim.fire / sim.shell / sim.explode / sim.hurt / sim.after / sim.add / sim.carve / sim.terrainOp / sim.event / sim.rng

import {
  WORLD_W, DT, STEP_RATE, SHIELD_HP, SHIELD_TURNS, TANK_MIN_GAP, EDGE_MARGIN, GROUND_MAX,
} from './constants.js';
import { groundAt, surfaceY, addCircle, raise, buildTo } from './terrain.js';
import { muzzle, pointInTank, distToTank, settleTank, fallDamage, DEG } from './physics.js';

const sec = (s) => Math.round(s * STEP_RATE);
const rnd = (v) => Math.round(v * 10) / 10;

// rarity: draft pool weight. icon: emoji drawn on canvas/DOM.
export const WEAPONS = [
  // ---- A. classic-style set ----
  { id: 'single', name: 'Single Shell', icon: '●', rarity: 'common', color: '#ffd166', behavior: 'shell', params: { r: 30, dmg: 30 }, desc: 'One reliable shell.' },
  { id: 'heavy', name: 'Heavy Shell', icon: '⬤', rarity: 'common', color: '#ff9f43', behavior: 'shell', params: { r: 50, dmg: 45 }, desc: 'A bigger shell with a bigger bang.' },
  { id: 'mega', name: 'Mega Bomb', icon: '💣', rarity: 'rare', color: '#ff6b6b', behavior: 'shell', params: { r: 90, dmg: 60 }, desc: 'Huge blast, huge crater.' },
  { id: 'triple', name: 'Triple Shot', icon: '⁂', rarity: 'common', color: '#feca57', behavior: 'spread', params: { n: 3, spread: 6, r: 28, dmg: 22 }, desc: '3 shells in a 6° spread.' },
  { id: 'five', name: 'Five Spread', icon: '✳', rarity: 'rare', color: '#ff9ff3', behavior: 'spread', params: { n: 5, spread: 12, r: 24, dmg: 16 }, desc: '5 shells in a 12° spread.' },
  { id: 'sniper', name: 'Sniper Round', icon: '⌖', rarity: 'rare', color: '#ffffff', behavior: 'sniper', params: { r: 8, dmg: 70, speed: 2.2, gmult: 0.3 }, desc: 'Very fast and flat. 70 damage on a direct hit only.' },
  { id: 'mgun', name: 'Machine Gun', icon: '⋯', rarity: 'common', color: '#f6e58d', behavior: 'burst', params: { n: 12, gap: 5, r: 10, dmg: 6, jitter: 2 }, desc: '12 small rounds fired in sequence, 6 dmg each.' },
  { id: 'napalm', name: 'Napalm', icon: '🔥', rarity: 'rare', color: '#ff5e1a', behavior: 'napalm', params: { r: 14, dmg: 6, n: 26, life: 3, tickDmg: 3 }, desc: 'Burning liquid flows downhill for 3 s, 3 dmg per tick.' },
  { id: 'dirtball', name: 'Dirt Ball', icon: '🟤', rarity: 'common', color: '#c08552', behavior: 'dirtball', params: { r: 60 }, desc: 'Drops a ball of dirt: bury enemies or build cover.' },
  { id: 'slinger', name: 'Dirt Slinger', icon: '〰', rarity: 'common', color: '#a0703c', behavior: 'dirtwave', params: { width: 110, h: 40 }, desc: 'Throws a wave of dirt that raises the ground 40 px.' },
  { id: 'digger', name: 'Digger', icon: '⛏', rarity: 'common', color: '#b8a07e', behavior: 'digger', params: { r: 16, dmg: 10, depth: 120 }, desc: 'Tunnels 120 px down from the impact.' },
  { id: 'roller', name: 'Roller', icon: '◉', rarity: 'common', color: '#54a0ff', behavior: 'roller', params: { r: 40, dmg: 35 }, desc: 'Lands, rolls downhill and explodes when it stops or hits a tank.' },
  { id: 'skipper', name: 'Skipper', icon: '⤳', rarity: 'rare', color: '#48dbfb', behavior: 'skipper', params: { r: 22, dmg: 12, skips: 4 }, desc: 'Skips across the ground 4 times with small blasts.' },
  { id: 'chain', name: 'Chain Reaction', icon: '⛓', rarity: 'rare', color: '#ff7f50', behavior: 'chain', params: { n: 6, gap: 40, r: 28, dmg: 14 }, desc: '6 explosions in a line moving forward from the impact.' },
  { id: 'splitter', name: 'Splitter', icon: '⑂', rarity: 'common', color: '#7bed9f', behavior: 'splitter', params: { n: 3, r: 30, dmg: 24 }, desc: 'Splits into 3 shells at the top of its arc.' },
  { id: 'tracer', name: 'Tracer', icon: '┄', rarity: 'common', color: '#00ffd0', behavior: 'tracer', params: {}, desc: 'No damage. Leaves a glowing trail to help you aim.' },
  { id: 'leech', name: 'Leech', icon: '🩸', rarity: 'rare', color: '#c0392b', behavior: 'shell', params: { r: 30, dmg: 25, leech: true }, desc: '25 damage, and you gain the same back as points (or HP).' },
  { id: 'hail', name: 'Hail Storm', icon: '❄', rarity: 'rare', color: '#c7ecee', behavior: 'hail', params: { n: 8, area: 200, r: 12, dmg: 7 }, desc: '8 ice pellets fall over a 200 px area.' },
  { id: 'crazy', name: 'Crazy Shot', icon: '🎲', rarity: 'rare', color: '#e056fd', behavior: 'crazy', params: {}, desc: 'A random classic weapon effect.' },
  { id: 'spike', name: 'Earth Spike', icon: '▲', rarity: 'rare', color: '#9c6644', behavior: 'spike', params: { h: 150, half: 40, r: 25, dmg: 10 }, desc: 'A rock spike bursts up and launches tanks into the air.' },
  // ---- B. add-on set ----
  { id: 'meteor', name: 'Meteor Shower', icon: '☄', rarity: 'epic', color: '#ff6348', behavior: 'meteor', params: { n: 6, area: 180, r: 28, dmg: 15 }, desc: 'Opens a sky portal: 6 meteors rain down, 15 dmg each.' },
  { id: 'blackhole', name: 'Black Hole', icon: '🌀', rarity: 'epic', color: '#a29bfe', behavior: 'blackhole', params: { pull: 260, life: 2, r: 70, dmg: 50, dmgR: 160 }, desc: 'A singularity pulls tanks in for 2 s, then collapses.' },
  { id: 'lightning', name: 'Lightning Strike', icon: '⚡', rarity: 'epic', color: '#fff200', behavior: 'lightning', params: { range: 250, dmg: 35, r: 20 }, desc: 'A bolt jumps to the nearest enemy within 250 px for 35.' },
  { id: 'cluster', name: 'Cluster Bomb', icon: '✺', rarity: 'rare', color: '#ffa502', behavior: 'cluster', params: { n: 7, r: 22, dmg: 12 }, desc: 'Splits into 7 bomblets at the top of its arc.' },
  { id: 'betty', name: 'Bouncing Betty', icon: '⥁', rarity: 'rare', color: '#2ed573', behavior: 'betty', params: { bounces: 3, restitution: 0.6, r: 30, dmg: 18 }, desc: 'Bounces 3 times, exploding on each bounce for 18.' },
  { id: 'homing', name: 'Homing Missile', icon: '🚀', rarity: 'epic', color: '#dfe4ea', behavior: 'homing', params: { r: 35, dmg: 40, turn: 2 }, desc: 'After the apex it steers toward the nearest enemy.' },
  { id: 'laser', name: 'Laser Beam', icon: '⟿', rarity: 'epic', color: '#ff3838', behavior: 'laser', params: { perPower: 12, dmg: 45, cut: 5 }, desc: 'Instant straight beam (power × 12 px), cuts through terrain.' },
  { id: 'quake', name: 'Earthquake', icon: '〽', rarity: 'epic', color: '#cd6133', behavior: 'quake', params: { range: 300, life: 2, dmg: 10 }, desc: 'Shakes and breaks the ground within 300 px. +10 damage.' },
  { id: 'volcano', name: 'Volcano', icon: '🌋', rarity: 'epic', color: '#ff4500', behavior: 'volcano', params: { h: 70, n: 8, r: 18, dmg: 8 }, desc: 'Raises a cone that erupts 8 lava blobs. The lava flows.' },
  { id: 'ice', name: 'Ice Bomb', icon: '🧊', rarity: 'rare', color: '#7efff5', behavior: 'ice', params: { r: 50, dmg: 25 }, desc: 'Frozen tanks cannot move next turn and power is capped at 80%.' },
  { id: 'acid', name: 'Acid Rain', icon: '☁', rarity: 'epic', color: '#badc58', behavior: 'acid', params: { life: 3, every: 8, r: 7, dmg: 2 }, desc: 'A cloud drifts with the wind for 3 s, dripping acid.' },
  { id: 'drill', name: 'Drill Torpedo', icon: '🔩', rarity: 'rare', color: '#95afc0', behavior: 'drill', params: { depth: 200, r: 55, dmg: 40 }, desc: 'Burrows up to 200 px through terrain, then explodes.' },
  { id: 'teleport', name: 'Teleport Shot', icon: '✦', rarity: 'rare', color: '#be2edd', behavior: 'teleport', params: {}, desc: 'No damage. Your tank teleports to where it lands.' },
  { id: 'shield', name: 'Energy Shield', icon: '🛡', rarity: 'rare', color: '#4bcffa', behavior: 'shield', params: { hp: SHIELD_HP, turns: SHIELD_TURNS }, desc: 'Not fired: a bubble absorbs the next 40 damage (2 enemy turns).' },
  { id: 'airstrike', name: 'Airstrike', icon: '✈', rarity: 'epic', color: '#778ca3', behavior: 'airstrike', params: { n: 5, gap: 60, r: 35, dmg: 22 }, desc: 'A jet drops 5 bombs in a line over the impact.' },
  { id: 'firework', name: 'Firework', icon: '🎆', rarity: 'rare', color: '#ff4dd2', behavior: 'firework', params: { n: 12, r: 14, dmg: 5 }, desc: 'Bursts at its apex into 12 colorful sparks, 5 dmg each.' },
  { id: 'mine', name: 'Sticky Mine', icon: '✹', rarity: 'rare', color: '#eb4d4b', behavior: 'mine', params: {}, desc: 'Arms after 1 turn. Blows (45 px, 40 dmg) when a tank moves within 60 px, or at your next turn.' },
  { id: 'wall', name: 'Mega Wall', icon: '▮', rarity: 'common', color: '#8d6e63', behavior: 'wall', params: { w: 30, h: 180 }, desc: 'Builds a 30 × 180 px dirt wall.' },
  { id: 'magnet', name: 'Magnet Pulse', icon: '🧲', rarity: 'rare', color: '#e84393', behavior: 'magnet', params: { range: 250, pull: 80, dmg: 15 }, desc: 'Pulls enemies within 250 px up to 80 px in, 15 dmg.' },
  { id: 'nuke', name: 'Nuke', icon: '☢', rarity: 'legendary', color: '#fffa65', behavior: 'shell', params: { r: 150, dmg: 80, speed: 0.75, craterR: 120, fx: 'nuke' }, desc: 'Slow shell. Radius 150, 80 damage, huge crater.' },
];

export const WEAPON_IDS = WEAPONS.map((w) => w.id);
const BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));
export function getWeapon(id) {
  return BY_ID.get(id) || WEAPONS[0];
}
export const RARITY_WEIGHT = { common: 4, rare: 3, epic: 2, legendary: 1 };
export const CLASSIC_IDS = WEAPON_IDS.slice(0, 20);

// Short stats line for tooltips.
export function weaponStats(w) {
  const p = w.params;
  const bits = [];
  if (p.dmg) bits.push(`${p.dmg} dmg${p.n ? ` × ${p.n}` : ''}`);
  if (p.r) bits.push(`radius ${p.r}`);
  return bits.join(' · ') || w.rarity;
}

// ---------- shared pieces ----------
const shellOpts = (P) => ({
  r: P.r, dmg: P.dmg, speed: P.speed, gmult: P.gmult ?? 1, style: P.style, leech: P.leech, craterR: P.craterR,
  onHit: P.fx ? fxHit : craterHit,
});

function craterHit(sim, p, hit) {
  sim.explode(p.x, p.y, p.r, p.dmg, { direct: hit.tank, kind: p.style, leech: p.leech, craterR: p.craterR, flat: p.flat, carve: p.carve });
}

function fxHit(sim, p, hit) {
  sim.event(p.fx || 'nuke', { x: rnd(p.x), y: rnd(p.y) });
  craterHit(sim, p, hit);
}

// Burning liquid (napalm, lava) that flows downhill along the surface.
function spawnFluid(sim, x, n, life, tickDmg, style, spread) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const px = Math.max(1, Math.min(WORLD_W - 2, x + sim.rng.range(-8, 8)));
    parts.push({ x: px, y: groundAt(sim.s.terrain, px), vx: sim.rng.range(-spread, spread) });
  }
  return sim.add({ kind: 'fluid', style, parts, left: sec(life), tickDmg, update: updateFluid });
}

function updateFluid(sim, e) {
  const t = sim.s.terrain;
  for (const q of e.parts) {
    const slope = (groundAt(t, q.x + 2) - groundAt(t, q.x - 2)) / 4;
    q.vx = (q.vx + slope * 900 * DT) * 0.965;
    q.x = Math.max(1, Math.min(WORLD_W - 2, q.x + q.vx * DT));
    q.y = groundAt(t, q.x);
  }
  if (e.age % sec(0.25) === 0) {
    sim.s.tanks.forEach((tk, i) => {
      if (!tk.alive || tk.flying) return;
      if (e.parts.some((q) => Math.abs(q.x - tk.x) < 22 && q.y >= tk.y - 26)) sim.hurt(i, e.tickDmg, { kind: 'burn' });
    });
  }
  if (--e.left <= 0) e.dead = true;
}

function reviveOnGround(sim, p) {
  p.dead = false;
  p.y = Math.min(p.y, groundAt(sim.s.terrain, p.x) - 2);
}

// Tank thrown into the air (Earth Spike); lands with fall damage from its highest point.
function launchTank(sim, i, vx, vy) {
  const tk = sim.s.tanks[i];
  tk.flying = true;
  sim.add({ kind: 'flyer', hidden: true, i, vx, vy, top: tk.y, update: updateFlyer });
}

function updateFlyer(sim, e) {
  const tk = sim.s.tanks[e.i];
  e.vy += sim.g * DT;
  tk.x = Math.max(EDGE_MARGIN, Math.min(WORLD_W - EDGE_MARGIN, tk.x + e.vx * DT));
  tk.y += e.vy * DT;
  if (tk.y < e.top) e.top = tk.y;
  const ground = surfaceY(sim.s.terrain, tk.x);
  if ((e.vy > 0 && tk.y >= ground) || e.age > sec(6)) {
    e.dead = true;
    tk.flying = false;
    settleTank(sim.s.terrain, tk);
    const dmg = fallDamage(tk.y - e.top);
    if (dmg > 0) { sim.event('fall', { tank: e.i, height: Math.round(tk.y - e.top) }); sim.hurt(e.i, dmg, { kind: 'fall' }); }
  }
}

// ---------- behaviors ----------
export const BEHAVIORS = {
  shell(sim, P, c) {
    sim.fire(c.angle, c.power, shellOpts(P));
  },

  spread(sim, P, c) {
    for (let k = 0; k < P.n; k++) {
      sim.fire(c.angle - P.spread / 2 + (k * P.spread) / (P.n - 1), c.power, shellOpts(P));
    }
  },

  sniper(sim, P, c) {
    sim.fire(c.angle, c.power, {
      ...shellOpts(P),
      onHit(s, p, hit) {
        s.explode(p.x, p.y, P.r, 0, { kind: 'sniper' });
        if (hit.tank != null) s.hurt(hit.tank, P.dmg, { direct: hit.tank, kind: 'sniper' });
      },
    });
  },

  burst(sim, P, c) {
    for (let k = 0; k < P.n; k++) {
      sim.after(1 + k * P.gap, (s) => {
        if (!s.tank.alive) return;
        s.fire(c.angle + s.rng.range(-P.jitter, P.jitter), c.power + s.rng.range(-P.jitter, P.jitter), shellOpts(P));
      });
    }
  },

  napalm(sim, P, c) {
    sim.fire(c.angle, c.power, {
      ...shellOpts(P),
      onHit(s, p, hit) {
        s.explode(p.x, p.y, P.r, P.dmg, { direct: hit.tank, kind: 'napalm' });
        s.event('napalm', { x: rnd(p.x) });
        spawnFluid(s, p.x, P.n, P.life, P.tickDmg, 'napalm', 70);
      },
    });
  },

  dirtball(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style,
      onHit(s, p) {
        s.event('dirt', { x: rnd(p.x), y: rnd(p.y), r: P.r });
        s.terrainOp(addCircle(s.s.terrain, p.x, p.y - P.r * 0.4, P.r));
      },
    });
  },

  dirtwave(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style,
      onHit(s, p) {
        s.event('dirt', { x: rnd(p.x), y: rnd(p.y), r: P.width });
        s.terrainOp(raise(s.s.terrain, p.x - P.width, p.x + P.width, (x) => {
          const k = Math.cos(((x - p.x) / P.width) * (Math.PI / 2));
          return P.h * k * k;
        }));
      },
    });
  },

  digger(sim, P, c) {
    sim.fire(c.angle, c.power, {
      ...shellOpts(P),
      onHit(s, p, hit) {
        s.explode(p.x, p.y, P.r, P.dmg, { direct: hit.tank, kind: 'digger' });
        const x = p.x, y = p.y;
        for (let k = 1; k <= 8; k++) {
          s.after(k * 4, (ss) => {
            ss.event('dig', { x: rnd(x), y: rnd(y + (k * P.depth) / 8) });
            ss.carve(x, y + (k * P.depth) / 8, 12);
            ss.terrainOp(null);
          });
        }
      },
    });
  },

  roller(sim, P, c) {
    sim.fire(c.angle, c.power, {
      ...shellOpts(P),
      onHit(s, p, hit) {
        if (hit.type === 'tank') return craterHit(s, p, hit);
        s.add({ kind: 'roller', style: P.style, x: p.x, y: p.y, vx: p.vx * 0.5, update: updateRoller, P });
      },
    });
  },

  skipper(sim, P, c) {
    sim.fire(c.angle, c.power, {
      ...shellOpts(P),
      skips: 0,
      onHit(s, p, hit) {
        const ok = s.explode(p.x, p.y, P.r, P.dmg, { direct: hit.tank, kind: 'skipper' });
        if (ok && hit.type === 'ground' && ++p.skips < P.skips) {
          reviveOnGround(s, p);
          p.vy = Math.min(-90, -Math.abs(p.vy) * 0.6);
          p.vx *= 0.85;
        }
      },
    });
  },

  chain(sim, P, c) {
    sim.fire(c.angle, c.power, {
      ...shellOpts(P),
      onHit(s, p, hit) {
        const dir = p.vx < 0 ? -1 : 1, x0 = p.x;
        s.explode(p.x, p.y, P.r, P.dmg, { direct: hit.tank, kind: 'chain' });
        for (let k = 1; k < P.n; k++) {
          s.after(k * 8, (ss) => {
            const x = x0 + dir * k * P.gap;
            if (x < 0 || x > WORLD_W) return;
            ss.explode(x, groundAt(ss.s.terrain, x), P.r, P.dmg, { kind: 'chain' });
          });
        }
      },
    });
  },

  splitter(sim, P, c) {
    sim.fire(c.angle, c.power, {
      ...shellOpts(P),
      onApex(s, p) {
        p.dead = true;
        s.event('split', { x: rnd(p.x), y: rnd(p.y) });
        for (let k = 0; k < P.n; k++) {
          s.shell({ ...shellOpts(P), x: p.x, y: p.y, vx: p.vx + (k - (P.n - 1) / 2) * 70, vy: p.vy, safe: false });
        }
      },
    });
  },

  tracer(sim, P, c) {
    const ev = sim.event('tracer', { tank: sim.shooter, pts: [] });
    sim.fire(c.angle, c.power, {
      style: P.style, r: 0, dmg: 0,
      onStep(s, p) { if (p.age % 6 === 1) ev.pts.push(rnd(p.x), rnd(p.y)); },
      onHit(s, p) { ev.pts.push(rnd(p.x), rnd(p.y)); },
    });
  },

  hail(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style, r: 12, dmg: 4,
      onHit(s, p, hit) {
        s.explode(p.x, p.y, 12, 4, { direct: hit.tank, kind: 'hail' });
        const x0 = p.x, top = Math.max(-150, Math.min(p.y, groundAt(s.s.terrain, p.x)) - 320);
        s.event('hail', { x: rnd(x0), y: rnd(top) });
        for (let k = 0; k < P.n; k++) {
          s.after(1 + k * 4, (ss) => ss.shell({
            ...shellOpts(P), x: x0 + ss.rng.range(-P.area / 2, P.area / 2), y: top, vx: ss.rng.range(-20, 20), vy: 80, safe: false,
          }));
        }
      },
    });
  },

  crazy(sim, P, c) {
    const pool = WEAPONS.slice(0, 20).filter((w) => w.id !== 'crazy');
    const w = pool[Math.floor(sim.rng() * pool.length)];
    sim.event('crazy', { weapon: w.id });
    BEHAVIORS[w.behavior](sim, { ...w.params, style: w.id }, { ...c, weapon: w });
  },

  spike(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style,
      onHit(s, p) {
        const x0 = p.x, base = groundAt(s.s.terrain, x0);
        s.event('spike', { x: rnd(x0), y: rnd(base) });
        s.explode(x0, base, P.r, P.dmg, { kind: 'spike', carve: false });
        s.terrainOp(buildTo(s.s.terrain, x0 - P.half, x0 + P.half, (x) => base - P.h * (1 - Math.abs(x - x0) / P.half)));
        s.s.tanks.forEach((tk, i) => {
          if (tk.alive && !tk.flying && Math.abs(tk.x - x0) < P.half + 8) launchTank(s, i, (tk.x >= x0 ? 1 : -1) * 90, -420);
        });
      },
    });
  },

  meteor(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style, r: 20, dmg: 8,
      onHit(s, p, hit) {
        s.explode(p.x, p.y, 20, 8, { direct: hit.tank, kind: 'meteor' });
        const x0 = p.x, py = 70;
        s.event('portal', { x: rnd(x0), y: py });
        s.add({ kind: 'portal', style: 'portal', x: x0, y: py, left: sec(1.6), update: (ss, e) => { if (--e.left <= 0) e.dead = true; } });
        for (let k = 0; k < P.n; k++) {
          s.after(20 + k * 12, (ss) => {
            const tx = x0 + ss.rng.range(-P.area, P.area), sx = x0 + ss.rng.range(-40, 40);
            ss.shell({ ...shellOpts(P), style: 'meteor', x: sx, y: py, vx: (tx - sx) / 1.4, vy: 220, safe: false, noWind: true });
          });
        }
      },
    });
  },

  blackhole(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style, r: 10, dmg: 0,
      onHit(s, p) {
        const hx = p.x, hy = Math.min(p.y, groundAt(s.s.terrain, p.x)) - 30;
        s.event('blackhole', { x: rnd(hx), y: rnd(hy), life: P.life });
        s.add({
          kind: 'blackhole', style: 'blackhole', x: hx, y: hy, update(ss, e) {
            ss.s.tanks.forEach((tk, i) => {
              if (!tk.alive || tk.flying) return;
              const dx = e.x - tk.x;
              const d = Math.hypot(dx, e.y - tk.y);
              if (d < P.pull && Math.abs(dx) > 6) ss.shove(i, Math.sign(dx) * 0.35 * (1 - d / P.pull));
            });
            if (e.age >= sec(P.life)) {
              e.dead = true;
              ss.explode(e.x, e.y, P.r, P.dmg, { dmgR: P.dmgR, kind: 'blackhole' });
            }
          },
        });
      },
    });
  },

  lightning(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style,
      onHit(s, p, hit) {
        s.explode(p.x, p.y, P.r, 6, { direct: hit.tank, kind: 'spark' });
        const target = s.nearestEnemy(p.x, p.y, P.range);
        if (target >= 0) {
          const tk = s.s.tanks[target];
          s.event('lightning', { x1: rnd(p.x), y1: rnd(p.y), x2: rnd(tk.x), y2: rnd(tk.y - 10), tank: target });
          s.hurt(target, P.dmg, { direct: target, kind: 'lightning' });
        }
      },
    });
  },

  cluster(sim, P, c) {
    sim.fire(c.angle, c.power, {
      ...shellOpts(P), r: 30, dmg: 20,
      onApex(s, p) {
        p.dead = true;
        s.event('split', { x: rnd(p.x), y: rnd(p.y) });
        for (let k = 0; k < P.n; k++) {
          s.shell({ ...shellOpts(P), style: 'bomblet', x: p.x, y: p.y, vx: p.vx * 0.6 + s.rng.range(-90, 90), vy: s.rng.range(-120, 10), safe: false });
        }
      },
    });
  },

  betty(sim, P, c) {
    sim.fire(c.angle, c.power, {
      ...shellOpts(P),
      booms: 0,
      onHit(s, p, hit) {
        const ok = s.explode(p.x, p.y, P.r, P.dmg, { direct: hit.tank, kind: 'betty' });
        if (!ok || hit.type !== 'ground' || ++p.booms >= P.bounces) return;
        const t = s.s.terrain;
        const th = Math.atan2(groundAt(t, p.x + 3) - groundAt(t, p.x - 3), 6);
        const nx = Math.sin(th), ny = -Math.cos(th);
        const dot = p.vx * nx + p.vy * ny;
        p.vx = (p.vx - 2 * dot * nx) * P.restitution;
        p.vy = Math.min(-120, (p.vy - 2 * dot * ny) * P.restitution);
        reviveOnGround(s, p);
      },
    });
  },

  homing(sim, P, c) {
    sim.fire(c.angle, c.power, {
      ...shellOpts(P),
      onApex(s, p) { p.target = s.nearestEnemy(p.x, p.y); },
      onStep(s, p) {
        if (p.target == null || p.target < 0) return;
        const tk = s.s.tanks[p.target];
        if (!tk.alive) return;
        const want = Math.atan2(tk.y - 9 - p.y, tk.x - p.x);
        const cur = Math.atan2(p.vy, p.vx);
        let diff = want - cur;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const turn = Math.max(-P.turn * DEG, Math.min(P.turn * DEG, diff));
        const sp = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(cur + turn) * sp;
        p.vy = Math.sin(cur + turn) * sp;
      },
    });
  },

  laser(sim, P, c) {
    const tk = sim.tank;
    const m = muzzle(tk, c.angle);
    const len = c.power * P.perPower;
    const dx = Math.cos(c.angle * DEG), dy = -Math.sin(c.angle * DEG);
    const hitSet = new Set();
    let x = m.x, y = m.y, d = 0;
    for (; d < len; d += 3) {
      x = m.x + dx * d; y = m.y + dy * d;
      if (x < 0 || x > WORLD_W || y > GROUND_MAX) break;
      if (y > groundAt(sim.s.terrain, x) - P.cut) sim.carve(x, y, P.cut);
      sim.s.tanks.forEach((o, i) => {
        if (i !== sim.shooter && o.alive && !hitSet.has(i) && pointInTank(o, x, y)) hitSet.add(i);
      });
    }
    sim.event('laser', { x1: rnd(m.x), y1: rnd(m.y), x2: rnd(x), y2: rnd(y) });
    sim.terrainOp(null);
    for (const i of hitSet) sim.hurt(i, P.dmg, { direct: i, kind: 'laser' });
  },

  quake(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style, r: 18, dmg: 0,
      onHit(s, p) {
        const x0 = p.x;
        s.explode(p.x, p.y, 18, 0, { kind: 'quake' });
        s.event('quake', { x: rnd(x0), life: P.life });
        s.add({ kind: 'quake', hidden: true, x: x0, y: p.y, update(ss, e) {
          if (e.age < sec(P.life)) return;
          e.dead = true;
          const jag = [];
          for (let i = 0; i <= (P.range * 2) / 12 + 1; i++) jag.push(ss.rng.range(0, 28));
          ss.terrainOp(raise(ss.s.terrain, x0 - P.range, x0 + P.range, (x) => {
            const f = (x - (x0 - P.range)) / 12, i = Math.floor(f), u = f - i;
            const j = jag[i] + ((jag[i + 1] ?? jag[i]) - jag[i]) * u;
            return -(30 * (1 - Math.abs(x - x0) / P.range) + j) * (1 - Math.abs(x - x0) / P.range);
          }));
          ss.s.tanks.forEach((tk, i) => { if (tk.alive && Math.abs(tk.x - x0) <= P.range) ss.hurt(i, P.dmg, { kind: 'quake' }); });
        } });
      },
    });
  },

  volcano(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style, r: 16, dmg: 8,
      onHit(s, p, hit) {
        const x0 = p.x, base = groundAt(s.s.terrain, x0), top = base - P.h;
        s.explode(p.x, p.y, 16, 8, { direct: hit.tank, kind: 'volcano', carve: false });
        s.terrainOp(buildTo(s.s.terrain, x0 - P.h, x0 + P.h, (x) => top + Math.abs(x - x0)));
        s.event('volcano', { x: rnd(x0), y: rnd(top) });
        for (let k = 0; k < P.n; k++) {
          s.after(10 + k * 6, (ss) => ss.shell({
            style: 'lava', r: P.r, dmg: P.dmg, x: x0, y: top - 6, vx: ss.rng.range(-170, 170), vy: ss.rng.range(-400, -230), safe: false,
            onHit(s3, q, h) {
              s3.explode(q.x, q.y, P.r, P.dmg, { direct: h.tank, kind: 'lava' });
              spawnFluid(s3, q.x, 4, 2.5, 2, 'lava', 30);
            },
          }));
        }
      },
    });
  },

  ice(sim, P, c) {
    sim.fire(c.angle, c.power, {
      ...shellOpts(P),
      onHit(s, p, hit) {
        s.explode(p.x, p.y, P.r, P.dmg, { direct: hit.tank, kind: 'ice' });
        const frozen = [];
        s.s.tanks.forEach((tk, i) => {
          if (tk.alive && distToTank(tk, p.x, p.y) < P.r) { tk.frozen = 1; frozen.push(i); }
        });
        s.event('freeze', { x: rnd(p.x), y: rnd(p.y), r: P.r, tanks: frozen });
      },
    });
  },

  acid(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style, r: 10, dmg: 4,
      onHit(s, p, hit) {
        s.explode(p.x, p.y, 10, 4, { direct: hit.tank, kind: 'acid' });
        const cy = Math.max(40, Math.min(p.y, groundAt(s.s.terrain, p.x)) - 260);
        s.event('acidCloud', { x: rnd(p.x), y: rnd(cy), life: P.life });
        s.add({
          kind: 'cloud', style: 'acid', x: p.x, y: cy, update(ss, e) {
            e.x = Math.max(0, Math.min(WORLD_W, e.x + ss.s.wind * 9 * DT));
            if (e.age % P.every === 0) {
              ss.shell({
                style: 'acidDrop', x: e.x + ss.rng.range(-50, 50), y: e.y + 12, vx: 0, vy: 30, noWind: true, safe: false,
                onHit(s3, q, h) {
                  s3.carve(q.x, q.y, P.r);
                  s3.terrainOp(null);
                  s3.event('acid', { x: rnd(q.x), y: rnd(q.y) });
                  s3.s.tanks.forEach((tk, i) => { if (tk.alive && distToTank(tk, q.x, q.y) < P.r + 4) s3.hurt(i, P.dmg, { kind: 'acid' }); });
                },
              });
            }
            if (e.age >= sec(P.life)) e.dead = true;
          },
        });
      },
    });
  },

  drill(sim, P, c) {
    sim.fire(c.angle, c.power, {
      ...shellOpts(P),
      onHit(s, p, hit) {
        if (hit.type === 'ground' && !p.drilledOnce && p.y < GROUND_MAX) {
          p.drilledOnce = true;
          p.drilling = true;
          p.drilled = 0;
          p.drillMax = P.depth;
          p.gmult = 0;
          p.noWind = true;
          const sp = Math.hypot(p.vx, p.vy) || 1;
          p.vx = (p.vx / sp) * 260; p.vy = (p.vy / sp) * 260;
          p.dead = false;
          s.event('drill', { x: rnd(p.x), y: rnd(p.y) });
          return;
        }
        craterHit(s, p, hit);
      },
    });
  },

  teleport(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style,
      onHit(s, p) {
        const tk = s.tank;
        let x = Math.max(EDGE_MARGIN, Math.min(WORLD_W - EDGE_MARGIN, p.x));
        for (const o of s.s.tanks) {
          if (o === tk || !o.alive || Math.abs(o.x - x) >= TANK_MIN_GAP + 6) continue;
          x = o.x + (x >= o.x ? 1 : -1) * (TANK_MIN_GAP + 6);
          x = Math.max(EDGE_MARGIN, Math.min(WORLD_W - EDGE_MARGIN, x));
        }
        const from = { x: rnd(tk.x), y: rnd(tk.y) };
        tk.x = x;
        settleTank(s.s.terrain, tk);
        s.event('teleport', { tank: s.shooter, from, to: { x: rnd(tk.x), y: rnd(tk.y) } });
      },
    });
  },

  shield(sim, P) {
    const tk = sim.tank;
    tk.shield = P.hp;
    tk.shieldTurns = P.turns;
    sim.event('shield', { tank: sim.shooter });
  },

  airstrike(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style, r: 12, dmg: 5,
      onHit(s, p, hit) {
        s.explode(p.x, p.y, 12, 5, { direct: hit.tank, kind: 'flare' });
        const dir = s.tank.x <= p.x ? 1 : -1;
        const drops = [];
        for (let k = 0; k < P.n; k++) drops.push(p.x + (k - (P.n - 1) / 2) * P.gap * dir);
        s.event('airstrike', { x: rnd(p.x), dir });
        s.add({
          kind: 'jet', style: 'jet', x: dir > 0 ? -80 : WORLD_W + 80, y: 55, vx: dir * 650, drops, update(ss, e) {
            e.x += e.vx * DT;
            while (e.drops.length && (e.x - e.drops[0]) * dir >= 0) {
              const bx = e.drops.shift();
              if (bx > 0 && bx < WORLD_W) ss.shell({ ...shellOpts(P), style: 'bomb', x: bx, y: e.y + 10, vx: e.vx * 0.12, vy: 60, safe: false, noWind: true });
            }
            if (!e.drops.length && (e.x < -100 || e.x > WORLD_W + 100)) e.dead = true;
          },
        });
      },
    });
  },

  firework(sim, P, c) {
    sim.fire(c.angle, c.power, {
      ...shellOpts(P), r: 20, dmg: 10,
      onApex(s, p) {
        p.dead = true;
        s.explode(p.x, p.y, 25, 0, { carve: false, kind: 'firework' });
        for (let k = 0; k < P.n; k++) {
          const a = (k / P.n) * Math.PI * 2;
          s.shell({ ...shellOpts(P), style: `spark${k % 4}`, x: p.x, y: p.y, vx: p.vx * 0.3 + Math.cos(a) * 160, vy: Math.sin(a) * 160 - 40, safe: false });
        }
      },
    });
  },

  mine(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style,
      onHit(s, p) {
        const st = s.s;
        const x = Math.max(4, Math.min(WORLD_W - 4, p.x));
        const m = { id: st.nextMine++, x, y: groundAt(st.terrain, x), owner: s.shooter, armed: false };
        st.mines.push(m);
        if (st.mines.length > 12) st.mines.shift();
        s.event('mine', { x: rnd(m.x), y: rnd(m.y), id: m.id });
      },
    });
  },

  wall(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style,
      onHit(s, p) {
        const base = groundAt(s.s.terrain, p.x);
        s.event('dirt', { x: rnd(p.x), y: rnd(base), r: P.w });
        s.terrainOp(buildTo(s.s.terrain, p.x - P.w / 2, p.x + P.w / 2, () => base - P.h));
      },
    });
  },

  magnet(sim, P, c) {
    sim.fire(c.angle, c.power, {
      style: P.style, r: 16, dmg: 0,
      onHit(s, p, hit) {
        const x0 = p.x;
        s.explode(p.x, p.y, 16, 0, { direct: hit.tank, kind: 'magnet' });
        const pulled = s.enemies().filter((i) => Math.hypot(s.s.tanks[i].x - x0, s.s.tanks[i].y - p.y) < P.range);
        s.event('magnet', { x: rnd(x0), y: rnd(p.y), tanks: pulled });
        const plan = pulled.map((i) => {
          const dx = x0 - s.s.tanks[i].x;
          return { i, step: (Math.sign(dx) * Math.min(P.pull, Math.max(0, Math.abs(dx) - 24))) / 60 };
        });
        s.add({ kind: 'pull', hidden: true, x: x0, y: p.y, update(ss, e) {
          for (const q of plan) if (ss.s.tanks[q.i].alive) ss.shove(q.i, q.step);
          if (e.age >= 60) {
            e.dead = true;
            for (const q of plan) ss.hurt(q.i, P.dmg, { kind: 'magnet' });
          }
        } });
      },
    });
  },
};

function updateRoller(sim, e) {
  const t = sim.s.terrain, P = e.P;
  const s = (groundAt(t, e.x + 3) - groundAt(t, e.x - 3)) / 6;
  e.vx = (e.vx + (320 * s) / Math.sqrt(1 + s * s) * DT) * 0.994;
  const nx = e.x + e.vx * DT;
  const wall = groundAt(t, e.x) - groundAt(t, nx) > 6; // sudden steep rise
  const out = nx < 2 || nx > WORLD_W - 2;
  if (!wall && !out) e.x = nx;
  e.y = groundAt(t, e.x) - 5;
  let tank = null;
  sim.s.tanks.forEach((tk, i) => { if (tank == null && tk.alive && !tk.flying && (i !== sim.shooter || e.age > sec(0.4)) && pointInTank(tk, e.x, e.y)) tank = i; });
  if (tank != null || wall || out || e.age > sec(6) || (e.age > sec(0.4) && Math.abs(e.vx) < 6)) {
    e.dead = true;
    sim.explode(e.x, e.y + 4, P.r, P.dmg, { direct: tank ?? undefined, kind: 'roller' });
  }
}
