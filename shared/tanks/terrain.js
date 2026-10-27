// Heightmap terrain: one surface y per x column (screen coords, y grows downwards,
// so a bigger value means lower ground). No overhangs, so no floating dirt.

import { WORLD_W, GROUND_MIN, GROUND_MAX } from './constants.js';

export function createTerrain(fill = 600) {
  return new Float32Array(WORLD_W).fill(fill);
}

const clampY = (y) => (y < GROUND_MIN ? GROUND_MIN : y > GROUND_MAX ? GROUND_MAX : y);
const col = (x) => (x < 0 ? 0 : x >= WORLD_W ? WORLD_W - 1 : x | 0);

// Surface y at any x (linear between columns). Outside the map: the edge column.
export function groundAt(t, x) {
  if (!(x > 0)) return t[0];
  if (x >= WORLD_W - 1) return t[WORLD_W - 1];
  const i = x | 0, f = x - i;
  return t[i] + (t[i + 1] - t[i]) * f;
}

// Highest surface point under a footprint: where a tank's tracks rest.
export function surfaceY(t, x, half = 8) {
  let y = Infinity;
  for (let i = col(x - half); i <= col(x + half); i++) if (t[i] < y) y = t[i];
  return y;
}

export function slopeAt(t, x, half = 14) {
  return Math.atan2(groundAt(t, x + half) - groundAt(t, x - half), half * 2);
}

// Range of columns covered by a span, or null.
function span(a, b) {
  a = Math.max(0, Math.floor(a));
  b = Math.min(WORLD_W - 1, Math.ceil(b));
  return a <= b ? [a, b] : null;
}

// Explosion crater. Dirt above an underground blast collapses into the hole.
export function carveCircle(t, cx, cy, r) {
  const s = span(cx - r, cx + r);
  if (!s || r <= 0) return null;
  let changed = null;
  for (let x = s[0]; x <= s[1]; x++) {
    const dx = x - cx;
    const h2 = r * r - dx * dx;
    if (h2 <= 0) continue;
    const h = Math.sqrt(h2);
    const bot = cy + h, g = t[x];
    if (bot <= g) continue;
    const removed = bot - Math.max(g, cy - h);
    const ny = clampY(g + removed);
    if (ny !== g) { t[x] = ny; changed = grow(changed, x); }
  }
  return changed;
}

// Dirt ball: the part of the circle above the ground lands on the ground.
export function addCircle(t, cx, cy, r) {
  const s = span(cx - r, cx + r);
  if (!s || r <= 0) return null;
  let changed = null;
  for (let x = s[0]; x <= s[1]; x++) {
    const dx = x - cx;
    const h2 = r * r - dx * dx;
    if (h2 <= 0) continue;
    const h = Math.sqrt(h2);
    const g = t[x];
    const added = Math.min(cy + h, g) - (cy - h);
    if (added <= 0) continue;
    const ny = clampY(g - added);
    if (ny !== g) { t[x] = ny; changed = grow(changed, x); }
  }
  return changed;
}

// Raise (positive) or lower (negative) columns a..b by fn(x) pixels.
export function raise(t, a, b, fn) {
  const s = span(a, b);
  if (!s) return null;
  let changed = null;
  for (let x = s[0]; x <= s[1]; x++) {
    const d = fn(x);
    if (!d || !Number.isFinite(d)) continue;
    const ny = clampY(t[x] - d);
    if (ny !== t[x]) { t[x] = ny; changed = grow(changed, x); }
  }
  return changed;
}

// Build up to at least height y (walls, spikes).
export function buildTo(t, a, b, fn) {
  const s = span(a, b);
  if (!s) return null;
  let changed = null;
  for (let x = s[0]; x <= s[1]; x++) {
    const y = clampY(fn(x));
    if (y < t[x]) { t[x] = y; changed = grow(changed, x); }
  }
  return changed;
}

function grow(range, x) {
  if (!range) return [x, x];
  if (x < range[0]) range[0] = x;
  if (x > range[1]) range[1] = x;
  return range;
}

export function mergeRange(a, b) {
  if (!a) return b ? [b[0], b[1]] : null;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
}

// Smooth 1-px spikes and pits left by deformation, and keep values valid.
export function settle(t, range) {
  if (!range) return;
  const a = Math.max(1, range[0] - 1), b = Math.min(WORLD_W - 2, range[1] + 1);
  for (let x = a; x <= b; x++) {
    const l = t[x - 1], r = t[x + 1];
    const lo = Math.min(l, r), hi = Math.max(l, r);
    if (t[x] < lo - 2) t[x] = lo;
    else if (t[x] > hi + 2) t[x] = hi;
  }
  sanitize(t, range[0] - 2, range[1] + 2);
}

export function sanitize(t, a = 0, b = WORLD_W - 1) {
  a = Math.max(0, a); b = Math.min(WORLD_W - 1, b);
  for (let x = a; x <= b; x++) {
    const v = t[x];
    t[x] = Number.isFinite(v) ? clampY(v) : GROUND_MAX;
  }
}

// Network / hashing form: integer hundredths of a pixel.
export const toInt = (v) => Math.round(v * 100);
export function quantize(t) {
  for (let x = 0; x < WORLD_W; x++) t[x] = toInt(t[x]) / 100;
}
export function terrainToInts(t) {
  return Array.from(t, toInt);
}
export function terrainFromInts(ints) {
  const t = new Float32Array(WORLD_W);
  for (let x = 0; x < WORLD_W; x++) t[x] = ints[x] / 100;
  return t;
}

// Changed column ranges between two terrains: [[start, [ints...]], ...]
export function diffTerrain(before, after) {
  const out = [];
  let x = 0;
  while (x < WORLD_W) {
    if (toInt(before[x]) === toInt(after[x])) { x++; continue; }
    const start = x, vals = [];
    // join runs separated by small unchanged gaps
    let quiet = 0;
    while (x < WORLD_W && quiet < 8) {
      const same = toInt(before[x]) === toInt(after[x]);
      quiet = same ? quiet + 1 : 0;
      vals.push(toInt(after[x]));
      x++;
    }
    vals.length -= quiet;
    out.push([start, vals]);
  }
  return out;
}

export function applyDiff(t, ranges) {
  let changed = null;
  for (const [start, vals] of ranges) {
    for (let i = 0; i < vals.length; i++) {
      const x = start + i;
      if (x >= 0 && x < WORLD_W) t[x] = vals[i] / 100;
    }
    changed = mergeRange(changed, [start, start + vals.length - 1]);
  }
  return changed;
}
