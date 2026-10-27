// Projectile launch, wind, gravity, tank geometry, settling and movement.

import {
  WORLD_W, DT, GRAVITY, POWER_K, WIND_FACTOR, TANK_W, TANK_H, TURRET_LEN, TURRET_PIVOT, TANK_MAX_TILT,
  MOVE_MAX_SLOPE, TANK_MIN_GAP, EDGE_MARGIN, FALL_DMG_PER_PX, FALL_DMG_MAX, FALL_MIN_PX, GROUND_MAX,
} from './constants.js';
import { groundAt, surfaceY, slopeAt } from './terrain.js';
import { getMap } from './maps.js';

export const DEG = Math.PI / 180;

export function launchVelocity(angleDeg, power, speedMult = 1) {
  const v = power * POWER_K * speedMult;
  return { vx: Math.cos(angleDeg * DEG) * v, vy: -Math.sin(angleDeg * DEG) * v };
}

export function turretPivot(tank) {
  return { x: tank.x, y: tank.y - TURRET_PIVOT };
}

export function muzzle(tank, angleDeg) {
  const p = turretPivot(tank);
  return { x: p.x + Math.cos(angleDeg * DEG) * TURRET_LEN, y: p.y - Math.sin(angleDeg * DEG) * TURRET_LEN };
}

export function gravityOf(state) {
  return GRAVITY * getMap(state.map).gravity;
}

export function windAccel(state) {
  return state.wind * WIND_FACTOR * getMap(state.map).windMult;
}

// One ballistic step (semi-implicit Euler). Returns the displacement to sweep.
export function ballistic(p, g, wind) {
  p.vy += g * DT;
  p.vx += wind * DT;
  return { dx: p.vx * DT, dy: p.vy * DT };
}

// Axis-aligned hitbox: the tank stands on (x, y).
export function tankBox(tank) {
  return { l: tank.x - TANK_W / 2, r: tank.x + TANK_W / 2, t: tank.y - TANK_H, b: tank.y + 2 };
}

export function pointInTank(tank, x, y) {
  const b = tankBox(tank);
  return x >= b.l && x <= b.r && y >= b.t && y <= b.b;
}

// Distance from a point to the nearest point of the tank's hitbox (0 inside).
export function distToTank(tank, x, y) {
  const b = tankBox(tank);
  const dx = x < b.l ? b.l - x : x > b.r ? x - b.r : 0;
  const dy = y < b.t ? b.t - y : y > b.b ? y - b.b : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

// Rest the tank on the terrain; returns how far it fell (0 if it was pushed up).
export function settleTank(terrain, tank) {
  tank.x = Math.min(WORLD_W - EDGE_MARGIN, Math.max(EDGE_MARGIN, tank.x));
  const y = Math.min(GROUND_MAX, surfaceY(terrain, tank.x));
  const fell = y - tank.y;
  tank.y = y;
  tank.tilt = Math.max(-TANK_MAX_TILT, Math.min(TANK_MAX_TILT, slopeAt(terrain, tank.x)));
  return fell > 0 ? fell : 0;
}

export function fallDamage(fall) {
  if (fall < FALL_MIN_PX) return 0;
  return Math.min(FALL_DMG_MAX, Math.round(fall * FALL_DMG_PER_PX));
}

// Drive along the terrain. Stops at steep slopes (> 60°), map edges and other tanks.
// Returns the list of x positions (1 px apart) for the animation.
export function planMove(state, idx, dir, distance) {
  const tank = state.tanks[idx];
  const path = [tank.x];
  let x = tank.x;
  for (let i = 0; i < distance; i++) {
    const nx = x + dir;
    if (nx < EDGE_MARGIN || nx > WORLD_W - EDGE_MARGIN) break;
    const rise = groundAt(state.terrain, x) - groundAt(state.terrain, x + dir * 4);
    if (rise / 4 > MOVE_MAX_SLOPE) break;
    if (state.tanks.some((o, j) => j !== idx && o.alive && Math.abs(o.x - nx) < TANK_MIN_GAP && Math.abs(o.x - nx) < Math.abs(o.x - x))) break;
    x = nx;
    path.push(x);
  }
  return path;
}

// Shell path ignoring terrain, for the aim guide.
export function previewPath(state, tank, angleDeg, power, maxSeconds = 4) {
  const m = muzzle(tank, angleDeg);
  const p = { x: m.x, y: m.y, ...launchVelocity(angleDeg, power) };
  const g = gravityOf(state), w = windAccel(state);
  const pts = [{ x: p.x, y: p.y }];
  const steps = Math.round(maxSeconds / DT);
  for (let i = 0; i < steps; i++) {
    const d = ballistic(p, g, w);
    p.x += d.dx; p.y += d.dy;
    if (i % 3 === 0) pts.push({ x: p.x, y: p.y });
    if (p.y > groundAt(state.terrain, p.x) || p.x < -50 || p.x > WORLD_W + 50) break;
  }
  return pts;
}
