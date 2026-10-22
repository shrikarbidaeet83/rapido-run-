// Track geometry: rounded-polygon control points -> Catmull-Rom spline -> evenly
// spaced centerline samples, plus nearest-point lookup, checkpoints and grid slots.
// Pure functions only (no DOM / Node APIs).

import {
  SAMPLE_SPACING, KERB_WIDTH, NEAREST_WINDOW, CHECKPOINTS, CAR_RADIUS,
  WORLD_WIDTH, WORLD_HEIGHT,
} from './constants.js';

// Turn each [x, y, r] vertex into points on a circular arc of radius r tangent to
// both neighbouring edges. r = 0 keeps the vertex as-is (use it on straights).
export function roundedPolygon(vertices) {
  const out = [];
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const [px, py, r = 0] = vertices[i];
    const [ax, ay] = vertices[(i - 1 + n) % n];
    const [bx, by] = vertices[(i + 1) % n];
    let d1x = px - ax, d1y = py - ay;
    let d2x = bx - px, d2y = by - py;
    const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
    d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;
    const cross = d1x * d2y - d1y * d2x;
    const theta = Math.acos(Math.max(-1, Math.min(1, d1x * d2x + d1y * d2y)));
    if (r <= 0 || theta < 1e-3) { out.push([px, py]); continue; }
    const t = r * Math.tan(theta / 2);
    const sx = px - d1x * t, sy = py - d1y * t;          // arc start
    const side = cross > 0 ? 1 : -1;
    const cx = sx - d1y * side * r, cy = sy + d1x * side * r; // arc center
    const a0 = Math.atan2(sy - cy, sx - cx);
    const steps = Math.max(2, Math.ceil(theta / (Math.PI / 12)));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + side * theta * (k / steps);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return out;
}

// Centripetal Catmull-Rom point between p1 and p2.
function catmullRom(p0, p1, p2, p3, u) {
  const alpha = 0.5;
  const tj = (ti, a, b) => ti + Math.max(1e-6, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha));
  const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a, b, ta, tb) => {
    const k = (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

export function buildTrack(map) {
  const ctrl = roundedPolygon(map.points);
  const m = ctrl.length;

  // Dense spline, then resample at a fixed spacing.
  const dense = [];
  for (let i = 0; i < m; i++) {
    const p0 = ctrl[(i - 1 + m) % m], p1 = ctrl[i], p2 = ctrl[(i + 1) % m], p3 = ctrl[(i + 2) % m];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(segLen / 1));
    for (let k = 0; k < steps; k++) dense.push(catmullRom(p0, p1, p2, p3, k / steps));
  }
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const totalDense = cum[dense.length];
  const n = Math.round(totalDense / SAMPLE_SPACING);
  const xs = new Float64Array(n), ys = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / n) * totalDense;
    while (cum[j + 1] < target) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length];
    const k = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
    xs[i] = a[0] + (b[0] - a[0]) * k;
    ys[i] = a[1] + (b[1] - a[1]) * k;
  }

  // Per-segment data: segment i goes from sample i to sample i+1 (wrapping).
  const tx = new Float64Array(n), ty = new Float64Array(n);   // segment tangent
  const nx = new Float64Array(n), ny = new Float64Array(n);   // segment normal (left of travel)
  const segLen = new Float64Array(n), s = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const dx = xs[i2] - xs[i], dy = ys[i2] - ys[i];
    const len = Math.hypot(dx, dy) || 1e-9;
    tx[i] = dx / len; ty[i] = dy / len;
    nx[i] = ty[i]; ny[i] = -tx[i];
    segLen[i] = len; s[i] = acc; acc += len;
  }
  const length = acc;
  const width = map.width;
  const halfWidth = width / 2;

  const track = {
    id: map.id, name: map.name, width, halfWidth, kerbWidth: KERB_WIDTH,
    n, xs, ys, tx, ty, nx, ny, segLen, s, length,
    worldWidth: map.worldWidth || WORLD_WIDTH, worldHeight: map.worldHeight || WORLD_HEIGHT,
    theme: map.theme, difficulty: map.difficulty,
  };

  // Checkpoints: lines across the track every 1/CHECKPOINTS of the length. 0 = finish line.
  track.checkpoints = [];
  for (let c = 0; c < CHECKPOINTS; c++) {
    const i = Math.round((c / CHECKPOINTS) * n) % n;
    track.checkpoints.push({
      index: c, seg: i, s: s[i], x: xs[i], y: ys[i], nx: nx[i], ny: ny[i], tx: tx[i], ty: ty[i],
      ax: xs[i] + nx[i] * halfWidth, ay: ys[i] + ny[i] * halfWidth,
      bx: xs[i] - nx[i] * halfWidth, by: ys[i] - ny[i] * halfWidth,
    });
  }

  // Grid: 2 columns x 4 rows, staggered, behind the finish line facing forward.
  track.gridSlots = [];
  for (let k = 0; k < 8; k++) {
    const row = k >> 1, col = k & 1;
    const back = 24 + row * 26 + col * 13;
    const lat = (col === 0 ? 1 : -1) * halfWidth * 0.38;
    const p = pointAt(track, length - back);
    track.gridSlots.push({
      x: p.x + p.nx * lat, y: p.y + p.ny * lat,
      angle: Math.atan2(p.tx, -p.ty), seg: p.seg,
    });
  }
  return track;
}

// Point on the centerline at arc length d (wraps).
export function pointAt(track, d) {
  const L = track.length;
  d = ((d % L) + L) % L;
  let lo = 0, hi = track.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.s[mid] <= d) lo = mid; else hi = mid - 1;
  }
  const i = lo, k = (d - track.s[i]) / track.segLen[i];
  return {
    x: track.xs[i] + track.tx[i] * track.segLen[i] * k,
    y: track.ys[i] + track.ty[i] * track.segLen[i] * k,
    tx: track.tx[i], ty: track.ty[i], nx: track.nx[i], ny: track.ny[i], seg: i,
  };
}

function projectSeg(track, i, px, py, out) {
  const ax = track.xs[i], ay = track.ys[i];
  const len = track.segLen[i];
  let t = (px - ax) * track.tx[i] + (py - ay) * track.ty[i];
  if (t < 0) t = 0; else if (t > len) t = len;
  const qx = ax + track.tx[i] * t, qy = ay + track.ty[i] * t;
  const dx = px - qx, dy = py - qy;
  const d2 = dx * dx + dy * dy;
  if (d2 < out.d2) {
    out.d2 = d2; out.seg = i; out.t = t; out.qx = qx; out.qy = qy;
  }
}

// Nearest point on the centerline polyline. `hint` = last known segment index
// (searches ±NEAREST_WINDOW around it, falls back to a full search if far off).
export function nearest(track, px, py, hint = -1) {
  const out = { d2: Infinity, seg: 0, t: 0, qx: 0, qy: 0 };
  const n = track.n;
  if (hint >= 0) {
    for (let k = -NEAREST_WINDOW; k <= NEAREST_WINDOW; k++) projectSeg(track, (hint + k + n) % n, px, py, out);
  }
  const limit = track.halfWidth + 20;
  if (hint < 0 || out.d2 > limit * limit) {
    for (let i = 0; i < n; i++) projectSeg(track, i, px, py, out);
  }
  const i = out.seg;
  out.dist = Math.sqrt(out.d2);
  out.lat = (px - out.qx) * track.nx[i] + (py - out.qy) * track.ny[i]; // signed, + = left
  out.along = track.s[i] + out.t;
  return out;
}

// Car corners + long-side midpoints (6 points) in world space.
export function carPoints(x, y, angle, halfW, halfL) {
  const fx = Math.sin(angle), fy = -Math.cos(angle);
  const rx = Math.cos(angle), ry = Math.sin(angle);
  return [
    [x + fx * halfL + rx * halfW, y + fy * halfL + ry * halfW],
    [x + fx * halfL - rx * halfW, y + fy * halfL - ry * halfW],
    [x - fx * halfL - rx * halfW, y - fy * halfL - ry * halfW],
    [x - fx * halfL + rx * halfW, y - fy * halfL + ry * halfW],
    [x + rx * halfW, y + ry * halfW],
    [x - rx * halfW, y - ry * halfW],
  ];
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// Did the move (x0,y0)->(x1,y1) cross checkpoint `cp` in the race direction?
// Returns the fraction (0..1) of the move where it crossed, or -1.
export function crossedCheckpoint(cp, x0, y0, x1, y1) {
  if (!segmentsIntersect(x0, y0, x1, y1, cp.ax, cp.ay, cp.bx, cp.by)) return -1;
  const fwd = (x1 - x0) * cp.tx + (y1 - y0) * cp.ty;
  if (fwd <= 0) return -1;
  const before = (cp.x - x0) * cp.tx + (cp.y - y0) * cp.ty;
  return Math.max(0, Math.min(1, before / fwd));
}

// Returns a list of problems (empty = valid).
export function validateTrack(track) {
  const errors = [];
  const { n, xs, ys, width, halfWidth } = track;

  // 1. no self-intersection of the centerline
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const j2 = (j + 1) % n;
      if (segmentsIntersect(xs[i], ys[i], xs[i2], ys[i2], xs[j], ys[j], xs[j2], ys[j2])) {
        errors.push(`self-intersection near (${xs[i].toFixed(0)},${ys[i].toFixed(0)})`);
        i = n; break;
      }
    }
  }

  // 2. parts far apart along the track must be far apart in space
  const minAlong = 3 * width, minSpace = width + 40;
  outer:
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let along = Math.abs(track.s[j] - track.s[i]);
      along = Math.min(along, track.length - along);
      if (along <= minAlong) continue;
      const d = Math.hypot(xs[j] - xs[i], ys[j] - ys[i]);
      if (d < minSpace) {
        errors.push(`walls too close (${d.toFixed(0)} < ${minSpace}) near (${xs[i].toFixed(0)},${ys[i].toFixed(0)})`);
        break outer;
      }
    }
  }

  // 3. corners must be wider than the half-width, or the inner wall folds over itself
  const minRadius = halfWidth + CAR_RADIUS + 3;
  const w = 3;
  for (let i = 0; i < n; i++) {
    const a = (i - w + n) % n, b = (i + w) % n;
    let da = Math.atan2(track.ty[b], track.tx[b]) - Math.atan2(track.ty[a], track.tx[a]);
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const arc = 2 * w * (track.length / n);
    if (Math.abs(da) > 1e-6 && arc / Math.abs(da) < minRadius) {
      errors.push(`corner too tight (r=${(arc / Math.abs(da)).toFixed(0)} < ${minRadius.toFixed(0)}) near (${xs[i].toFixed(0)},${ys[i].toFixed(0)})`);
      break;
    }
  }

  // 4. whole track (walls included) inside the world
  for (let i = 0; i < n; i++) {
    if (xs[i] - halfWidth < 20 || ys[i] - halfWidth < 20 ||
        xs[i] + halfWidth > track.worldWidth - 20 || ys[i] + halfWidth > track.worldHeight - 20) {
      errors.push(`track leaves the world near (${xs[i].toFixed(0)},${ys[i].toFixed(0)})`);
      break;
    }
  }
  return errors;
}

// Curvature (rad per unit) ahead of distance d over `span` units — used by bots.
export function turnAhead(track, d, span) {
  const a = pointAt(track, d), b = pointAt(track, d + span);
  let da = Math.atan2(b.ty, b.tx) - Math.atan2(a.ty, a.tx);
  return Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
}
