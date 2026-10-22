// Car physics, same model as car.js.org. Pure and deterministic: no DOM/Node APIs,
// no randomness, and stepCar() never mutates its input.

import {
  PHYSICS, KERB_DRAG, KERB_POWER_CAP, CAR_WIDTH, CAR_LENGTH, CAR_RADIUS,
  WALL_RESTITUTION, WALL_FRICTION, WALL_SPIN, WALL_ITERATIONS,
} from './constants.js';
import { nearest, carPoints } from './track.js';

const HALF_W = CAR_WIDTH / 2, HALF_L = CAR_LENGTH / 2;

export function createCar(x, y, angle, seg = -1) {
  return { x, y, angle, xVelocity: 0, yVelocity: 0, power: 0, reverse: 0, angularVelocity: 0, seg, onKerb: false };
}

export function cloneCar(c) {
  return {
    x: c.x, y: c.y, angle: c.angle, xVelocity: c.xVelocity, yVelocity: c.yVelocity,
    power: c.power, reverse: c.reverse, angularVelocity: c.angularVelocity, seg: c.seg, onKerb: c.onKerb,
  };
}

export function speedOf(c) {
  return Math.hypot(c.xVelocity, c.yVelocity);
}

// Throttle, steering, movement and kerb drag. Mutates `car` (callers pass a copy).
export function integrate(car, input, track, p = PHYSICS) {
  if (input.up) car.power = Math.min(car.power + p.powerFactor, p.maxPower);
  else car.power = Math.max(car.power - p.powerFactor, 0);
  if (input.down) car.reverse = Math.min(car.reverse + p.reverseFactor, p.maxReverse);
  else car.reverse = Math.max(car.reverse - p.reverseFactor, 0);

  const direction = car.power > car.reverse ? 1 : -1;
  if (input.left) car.angularVelocity -= direction * p.turnSpeed;
  if (input.right) car.angularVelocity += direction * p.turnSpeed;

  car.xVelocity += Math.sin(car.angle) * (car.power - car.reverse);
  car.yVelocity -= Math.cos(car.angle) * (car.power - car.reverse);

  car.x += car.xVelocity;
  car.y += car.yVelocity;
  car.xVelocity *= p.drag;
  car.yVelocity *= p.drag;
  car.angle += car.angularVelocity;
  car.angularVelocity *= p.angularDrag;

  // Kerb: any part of the car touching the striped edge slows it a little.
  car.onKerb = false;
  if (track) {
    const near = nearest(track, car.x, car.y, car.seg);
    car.seg = near.seg;
    const kerbStart = track.halfWidth - track.kerbWidth;
    if (Math.abs(near.lat) + CAR_RADIUS >= kerbStart) {
      for (const [px, py] of carPoints(car.x, car.y, car.angle, HALF_W, HALF_L)) {
        if (Math.abs(nearest(track, px, py, car.seg).lat) >= kerbStart) { car.onKerb = true; break; }
      }
    }
    if (car.onKerb) {
      car.xVelocity *= KERB_DRAG;
      car.yVelocity *= KERB_DRAG;
      car.power = Math.min(car.power, p.maxPower * KERB_POWER_CAP);
    }
  }
  return car;
}

// Keeps every corner of the car inside the walls. Mutates `car`.
// Returns the strongest wall impact this tick ({x, y, impact}) or null.
export function constrainToTrack(car, track) {
  let hit = null;
  const hw = track.halfWidth;
  for (let iter = 0; iter < WALL_ITERATIONS; iter++) {
    const center = nearest(track, car.x, car.y, car.seg);
    car.seg = center.seg;
    if (Math.abs(center.lat) + CAR_RADIUS <= hw) break; // no corner can reach a wall
    let worst = 0, wp = null, wn = null;
    for (const pt of carPoints(car.x, car.y, car.angle, HALF_W, HALF_L)) {
      const near = nearest(track, pt[0], pt[1], car.seg);
      const over = Math.abs(near.lat) - hw;
      if (over > worst) { worst = over; wp = pt; wn = near; }
    }
    if (!wp) break;
    const side = wn.lat > 0 ? 1 : -1;
    const ox = track.nx[wn.seg] * side, oy = track.ny[wn.seg] * side; // outward normal
    car.x -= ox * (worst + 0.01);
    car.y -= oy * (worst + 0.01);
    const vn = car.xVelocity * ox + car.yVelocity * oy;
    if (vn > 0) {
      const tvx = car.xVelocity - vn * ox, tvy = car.yVelocity - vn * oy;
      const fr = 1 - (1 - WALL_FRICTION) * Math.min(1, vn / 0.6);
      car.xVelocity = tvx * fr - vn * WALL_RESTITUTION * ox;
      car.yVelocity = tvy * fr - vn * WALL_RESTITUTION * oy;
      const rx = wp[0] - car.x, ry = wp[1] - car.y;
      car.angularVelocity -= (rx * oy - ry * ox) * vn * WALL_SPIN * 0.1;
      if (!hit || vn > hit.impact) hit = { x: wp[0], y: wp[1], impact: vn };
    }
  }

  // Safety net: if still poking through, pull the centre toward the centerline so
  // every corner is guaranteed inside (|lat| + carRadius < halfWidth).
  const near = nearest(track, car.x, car.y, car.seg);
  car.seg = near.seg;
  const maxLat = hw - CAR_RADIUS - 0.05;
  let outside = Math.abs(near.lat) > maxLat;
  if (outside) {
    outside = false;
    for (const [px, py] of carPoints(car.x, car.y, car.angle, HALF_W, HALF_L)) {
      if (Math.abs(nearest(track, px, py, car.seg).lat) > hw) { outside = true; break; }
    }
  }
  if (outside) {
    const lat = Math.max(-maxLat, Math.min(maxLat, near.lat));
    car.x = near.qx + track.nx[near.seg] * lat;
    car.y = near.qy + track.ny[near.seg] * lat;
    const side = near.lat > 0 ? 1 : -1;
    const vn = (car.xVelocity * track.nx[near.seg] + car.yVelocity * track.ny[near.seg]) * side;
    if (vn > 0) {
      car.xVelocity -= vn * track.nx[near.seg] * side;
      car.yVelocity -= vn * track.ny[near.seg] * side;
    }
  }

  // Final net: never leave the world.
  car.x = Math.max(CAR_RADIUS, Math.min(track.worldWidth - CAR_RADIUS, car.x));
  car.y = Math.max(CAR_RADIUS, Math.min(track.worldHeight - CAR_RADIUS, car.y));
  if (!Number.isFinite(car.angularVelocity)) car.angularVelocity = 0;
  return hit;
}

// One full tick for a single car (used by client prediction and tests).
// Returns a NEW state; the input state is untouched.
export function stepCar(state, input, track, p = PHYSICS) {
  const car = cloneCar(state);
  integrate(car, input, track, p);
  if (track) car.wallHit = constrainToTrack(car, track);
  return car;
}

// Is any corner of the car outside the walls? (tests & debug)
export function isOutside(car, track, tolerance = 0.5, hint = -1) {
  const c = nearest(track, car.x, car.y, hint);
  if (Math.abs(c.lat) + CAR_RADIUS <= track.halfWidth) return false;
  for (const [px, py] of carPoints(car.x, car.y, car.angle, HALF_W, HALF_L)) {
    if (Math.abs(nearest(track, px, py, c.seg).lat) > track.halfWidth + tolerance) return true;
  }
  return false;
}
