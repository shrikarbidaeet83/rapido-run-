// Car vs car: oriented boxes, Separating Axis Theorem, impulse response.

import {
  CAR_WIDTH, CAR_LENGTH, CAR_RESTITUTION, CAR_FRICTION, CAR_SPIN, BROAD_PHASE_DIST,
} from './constants.js';
import { carPoints } from './track.js';
import { constrainToTrack } from './physics.js';

const HALF_W = CAR_WIDTH / 2, HALF_L = CAR_LENGTH / 2;

function corners(c) {
  return carPoints(c.x, c.y, c.angle, HALF_W, HALF_L).slice(0, 4);
}

function axesOf(c) {
  return [[Math.sin(c.angle), -Math.cos(c.angle)], [Math.cos(c.angle), Math.sin(c.angle)]];
}

function project(pts, ax, ay) {
  let min = Infinity, max = -Infinity;
  for (const [x, y] of pts) {
    const d = x * ax + y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

// SAT test. Returns null or { nx, ny, depth } where n points from a to b.
export function overlap(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx * dx + dy * dy > BROAD_PHASE_DIST * BROAD_PHASE_DIST) return null;
  const ca = corners(a), cb = corners(b);
  let best = null;
  for (const [ax, ay] of [...axesOf(a), ...axesOf(b)]) {
    const [amin, amax] = project(ca, ax, ay);
    const [bmin, bmax] = project(cb, ax, ay);
    const fwd = amax - bmin;  // push b along +axis by this much to separate
    const back = bmax - amin; // ...or along -axis by this much
    if (fwd <= 0 || back <= 0) return null;
    const depth = Math.min(fwd, back);
    if (!best || depth < best.depth) {
      const sign = fwd < back || (fwd === back && dx * ax + dy * ay >= 0) ? 1 : -1;
      best = { nx: ax * sign, ny: ay * sign, depth };
    }
  }
  return best;
}

// Contact point estimate: the corner of one box that lies deepest inside the other.
function contactPoint(a, b, nx, ny) {
  let best = null, bestD = -Infinity;
  for (const [x, y] of corners(a)) {
    const d = (x - a.x) * nx + (y - a.y) * ny;
    if (d > bestD) { bestD = d; best = [x, y]; }
  }
  let best2 = null, bestD2 = -Infinity;
  for (const [x, y] of corners(b)) {
    const d = -((x - b.x) * nx + (y - b.y) * ny);
    if (d > bestD2) { bestD2 = d; best2 = [x, y]; }
  }
  return [(best[0] + best2[0]) / 2, (best[1] + best2[1]) / 2];
}

// Resolves one pair in place (equal mass). Returns { x, y, impact } or null.
// A car pinned against a wall (`_pinned`, set by settle) is not moved: the other
// car takes the whole separation.
export function resolvePair(a, b) {
  const m = overlap(a, b);
  if (!m) return null;
  const { nx, ny, depth } = m;
  let shareA = 0.5;
  if (a._pinned && !b._pinned) shareA = 0;
  else if (b._pinned && !a._pinned) shareA = 1;
  const push = depth + 0.02;
  a.x -= nx * push * shareA; a.y -= ny * push * shareA;
  b.x += nx * push * (1 - shareA); b.y += ny * push * (1 - shareA);

  const rvx = b.xVelocity - a.xVelocity, rvy = b.yVelocity - a.yVelocity;
  const vn = rvx * nx + rvy * ny;
  const [cx, cy] = contactPoint(a, b, nx, ny);
  if (vn >= 0) return { x: cx, y: cy, impact: 0 };

  const j = (-(1 + CAR_RESTITUTION) * vn) / 2;
  a.xVelocity -= j * nx; a.yVelocity -= j * ny;
  b.xVelocity += j * nx; b.yVelocity += j * ny;

  // a bit of friction along the contact
  const tx = -ny, ty = nx;
  const vt = rvx * tx + rvy * ty;
  const jt = Math.max(-j * 0.5, Math.min(j * 0.5, -vt * CAR_FRICTION / 2));
  a.xVelocity -= jt * tx; a.yVelocity -= jt * ty;
  b.xVelocity += jt * tx; b.yVelocity += jt * ty;

  // angular kick from where they hit
  const ra = (cx - a.x) * ny - (cy - a.y) * nx;
  const rb = (cx - b.x) * ny - (cy - b.y) * nx;
  a.angularVelocity -= ra * j * CAR_SPIN * 0.1;
  b.angularVelocity += rb * j * CAR_SPIN * 0.1;
  return { x: cx, y: cy, impact: -vn };
}

// Resolve all pairs. `cars` items need .ghost (skipped) plus physics fields.
export function resolveAll(cars) {
  const hits = [];
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    if (a.ghost) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (b.ghost) continue;
      const h = resolvePair(a, b);
      if (h) hits.push({ ...h, a: a.id, b: b.id });
    }
  }
  return hits;
}

// Car-vs-car first, then walls; repeated so a car shoved into a wall ends up
// inside the track AND clear of the other car. Walls always get the last word.
export function settle(states, track, iterations = 4) {
  const carHits = [], wallHits = [];
  for (const s of states) s._pinned = false;
  for (let k = 0; k < iterations; k++) {
    const hits = resolveAll(states);
    if (k === 0) carHits.push(...hits);
    let wallMoved = false;
    for (const s of states) {
      const x = s.x, y = s.y;
      const h = constrainToTrack(s, track);
      if (h && k === 0) wallHits.push({ ...h, id: s.id });
      if (s.x !== x || s.y !== y) { s._pinned = true; wallMoved = true; }
    }
    if (hits.length === 0 && !wallMoved) break;
  }
  return { carHits, wallHits };
}
