// Decorative scenery for the empty ground around a track (trees, buildings, rocks,
// cacti, a grandstand, tyre stacks), plus the animated backdrop behind the menus.
// Flat, top-down shapes in the same minimal style as the cars. Placement is
// seeded by the map id, so every player sees the same scenery.

import { CAR_WIDTH, CAR_LENGTH, ROOF_WIDTH, ROOF_LENGTH, CAR_COLORS } from '/shared/constants.js';
import { MAPS } from '/shared/maps.js';
import { buildTrack, nearest, pointAt } from '/shared/track.js';

export const SCENERY_PAD = 500; // scenery also covers this much ground outside the world

function seeded(str) {
  let a = 2166136261;
  for (const ch of str) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHADOW = 'rgba(0,0,0,0.16)';

function circle(g, x, y, r, color) {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function tree(g, x, y, r, dark, light) {
  circle(g, x + r * 0.25, y + r * 0.3, r, SHADOW);
  circle(g, x, y, r, dark);
  circle(g, x - r * 0.25, y - r * 0.25, r * 0.6, light);
}

function pine(g, x, y, r) {
  circle(g, x + r * 0.3, y + r * 0.35, r, SHADOW);
  circle(g, x, y, r, '#2f6b35');
  circle(g, x, y, r * 0.66, '#3b7f40');
  circle(g, x, y, r * 0.3, '#4a9150');
}

function bush(g, x, y, r, color, light) {
  for (const [dx, dy, k] of [[-0.5, 0.1, 0.7], [0.45, 0.2, 0.65], [0, -0.35, 0.75]]) {
    circle(g, x + dx * r + 1, y + dy * r + 1.2, r * k, SHADOW);
  }
  for (const [dx, dy, k] of [[-0.5, 0.1, 0.7], [0.45, 0.2, 0.65], [0, -0.35, 0.75]]) {
    circle(g, x + dx * r, y + dy * r, r * k, color);
  }
  circle(g, x - r * 0.1, y - r * 0.45, r * 0.3, light);
}

function rock(g, x, y, r, rng, base, top) {
  const n = 7, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, rr = r * (0.75 + rng() * 0.3);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  const poly = (dx, dy, k, color) => {
    g.fillStyle = color;
    g.beginPath();
    pts.forEach(([px, py], i) => {
      const qx = x + (px - x) * k + dx, qy = y + (py - y) * k + dy;
      if (i) g.lineTo(qx, qy); else g.moveTo(qx, qy);
    });
    g.closePath();
    g.fill();
  };
  poly(r * 0.25, r * 0.3, 1, SHADOW);
  poly(0, 0, 1, base);
  poly(-r * 0.15, -r * 0.18, 0.55, top);
}

function building(g, x, y, w, h, rng) {
  const roofs = ['#8d8f94', '#7a7d82', '#b5a48f', '#9aa4ad', '#a68b7c', '#c2c4c7'];
  const roof = roofs[Math.floor(rng() * roofs.length)];
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(x - w / 2 + 4, y - h / 2 + 5, w, h);
  g.fillStyle = roof;
  g.fillRect(x - w / 2, y - h / 2, w, h);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(x - w / 2 + 3, y - h / 2 + 3, w - 6, h - 6);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  const units = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < units; i++) {
    g.fillRect(x - w / 2 + 6 + rng() * (w - 18), y - h / 2 + 6 + rng() * (h - 16), 6, 5);
  }
}

function cactus(g, x, y, r) {
  circle(g, x + 2, y + 2.5, r, SHADOW);
  g.fillStyle = '#4f8a3c';
  g.fillRect(x - r * 0.35, y - r, r * 0.7, r * 2);
  g.fillRect(x - r, y - r * 0.35, r * 2, r * 0.7);
  circle(g, x, y, r * 0.42, '#6aa651');
}

function palm(g, x, y, r) {
  circle(g, x + r * 0.3, y + r * 0.35, r * 0.8, SHADOW);
  g.strokeStyle = '#4c8a3b';
  g.lineCap = 'round';
  g.lineWidth = r * 0.38;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    g.stroke();
  }
  circle(g, x, y, r * 0.22, '#7a5a35');
}

function flowers(g, x, y, rng) {
  const colors = ['#fff59d', '#ffffff', '#f48fb1', '#ce93d8'];
  for (let i = 0; i < 6; i++) circle(g, x + (rng() - 0.5) * 14, y + (rng() - 0.5) * 14, 1, colors[Math.floor(rng() * colors.length)]);
}

function grandstand(g, cx, cy, angle, len, depth, rng) {
  g.save();
  g.translate(cx, cy);
  g.rotate(angle);
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(-len / 2 + 4, -depth / 2 + 5, len, depth);
  g.fillStyle = '#d7d9dc';
  g.fillRect(-len / 2, -depth / 2, len, depth);
  // rows of spectators
  for (let row = 0; row < 3; row++) {
    const ry = -depth / 2 + 5 + row * 7;
    g.fillStyle = '#b9bcc1';
    g.fillRect(-len / 2 + 3, ry - 2.5, len - 6, 5);
    for (let px = -len / 2 + 6; px < len / 2 - 4; px += 4) {
      if (rng() < 0.8) circle(g, px + rng(), ry, 1.4, CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)]);
    }
  }
  g.fillStyle = '#9ea2a8';
  g.fillRect(-len / 2, depth / 2 - 4, len, 4); // roof edge
  g.restore();
}

function tyres(g, x, y, tx, ty) {
  for (let k = -1.5; k <= 1.5; k++) {
    const px = x + tx * k * 5.4, py = y + ty * k * 5.4;
    circle(g, px + 0.8, py + 1, 2.7, SHADOW);
    circle(g, px, py, 2.7, '#26282b');
    circle(g, px, py, 1.1, '#6b6e73');
  }
}

// Draw scenery on a context already transformed to world units.
export function drawScenery(g, track) {
  const rng = seeded(track.id || track.name || 'track');
  const kind = (track.theme && track.theme.kind) || 'grass';
  const P = SCENERY_PAD, W = track.worldWidth, H = track.worldHeight, hw = track.halfWidth;
  const placed = [];
  const free = (x, y, r) => {
    for (const o of placed) if ((o.x - x) ** 2 + (o.y - y) ** 2 < (o.r + r + 2) ** 2) return false;
    return Math.abs(nearest(track, x, y).dist) > hw + r + 6;
  };

  // soft ground patches first (dunes / meadow / gravel); they may tuck under the track
  for (let i = 0; i < 26; i++) {
    const x = -P + rng() * (W + 2 * P), y = -P + rng() * (H + 2 * P), r = 40 + rng() * 70;
    g.fillStyle = kind === 'sand' ? 'rgba(160,120,60,0.10)' : kind === 'city' ? 'rgba(255,255,255,0.08)'
      : kind === 'rock' ? 'rgba(90,70,55,0.10)' : 'rgba(255,255,200,0.07)';
    g.beginPath();
    g.ellipse(x, y, r, r * (0.45 + rng() * 0.3), rng() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }

  // grandstand beside the start/finish line, on whichever side has room
  const cp = track.checkpoints[0];
  const len = 110, depth = 26;
  for (const side of [1, -1]) {
    const off = hw + 16 + depth / 2;
    const cx = cp.x + cp.nx * off * side, cy = cp.y + cp.ny * off * side;
    const corners = [-1, 1].flatMap((a) => [-1, 1].map((b) => [cx + cp.tx * a * len / 2 + cp.nx * b * depth / 2, cy + cp.ty * a * len / 2 + cp.ny * b * depth / 2]));
    if (corners.every(([x, y]) => nearest(track, x, y).dist > hw + 6)) {
      // seats face the track
      grandstand(g, cx, cy, Math.atan2(cp.ty, cp.tx) + (side > 0 ? Math.PI : 0), len, depth, rng);
      for (let k = -2; k <= 2; k++) placed.push({ x: cx + cp.tx * k * 24, y: cy + cp.ty * k * 24, r: 18 });
      break;
    }
  }

  // one tyre stack on the outside of each corner, at its apex (sharpest point)
  const n = track.n;
  const turnAt = (i) => {
    const a = (i - 3 + n) % n, b = (i + 3) % n;
    return track.tx[a] * track.ty[b] - track.ty[a] * track.tx[b];
  };
  const turns = Array.from({ length: n }, (_, i) => turnAt(i));
  const stacks = [];
  for (let i = 0; i < n; i++) {
    const t = turns[i];
    if (Math.abs(t) < 0.12) continue;
    let apex = true;
    for (let k = -12; k <= 12 && apex; k++) if (Math.abs(turns[(i + k + n) % n]) > Math.abs(t)) apex = false;
    if (!apex) continue;
    const out = t > 0 ? 1 : -1; // normal points left; a right turn's outside is the left
    const x = track.xs[i] + track.nx[i] * out * (hw + 7), y = track.ys[i] + track.ny[i] * out * (hw + 7);
    if (nearest(track, x, y).dist < hw + 5) continue;
    if (stacks.some((s) => (s.x - x) ** 2 + (s.y - y) ** 2 < 110 ** 2)) continue;
    if (!placed.every((o) => (o.x - x) ** 2 + (o.y - y) ** 2 > (o.r + 10) ** 2)) continue;
    tyres(g, x, y, track.tx[i], track.ty[i]);
    stacks.push({ x, y });
    placed.push({ x, y, r: 9 });
  }

  // main scatter, by theme
  const density = { grass: 0.55, forest: 0.85, city: 0.6, rock: 0.5, sand: 0.4 }[kind];
  const cell = kind === 'city' ? 70 : 34;
  for (let gy = -P; gy < H + P; gy += cell) {
    for (let gx = -P; gx < W + P; gx += cell) {
      if (rng() > density) continue;
      const x = gx + rng() * cell, y = gy + rng() * cell, pick = rng();
      if (kind === 'city') {
        if (pick < 0.75) {
          const w = 28 + rng() * 34, h = 24 + rng() * 30, r = Math.hypot(w, h) / 2;
          if (free(x, y, r)) { building(g, x, y, w, h, rng); placed.push({ x, y, r }); }
        } else {
          const r = 6 + rng() * 4;
          if (free(x, y, r)) { tree(g, x, y, r, '#5b8f4a', '#77a862'); placed.push({ x, y, r }); }
        }
      } else if (kind === 'sand') {
        const r = pick < 0.45 ? 4 + rng() * 2 : pick < 0.75 ? 4 + rng() * 6 : 8 + rng() * 3;
        if (!free(x, y, r)) continue;
        if (pick < 0.45) cactus(g, x, y, r);
        else if (pick < 0.75) rock(g, x, y, r, rng, '#b89a6e', '#d1b88f');
        else palm(g, x, y, r);
        placed.push({ x, y, r });
      } else if (kind === 'rock') {
        const r = pick < 0.6 ? 4 + rng() * 8 : 6 + rng() * 4;
        if (!free(x, y, r)) continue;
        if (pick < 0.6) rock(g, x, y, r, rng, '#7d7369', '#958b80');
        else pine(g, x, y, r);
        placed.push({ x, y, r });
      } else if (kind === 'forest') {
        const r = pick < 0.7 ? 7 + rng() * 6 : 4 + rng() * 2;
        if (!free(x, y, r)) continue;
        if (pick < 0.7) pine(g, x, y, r); else bush(g, x, y, r, '#3f7a36', '#5a9a4c');
        placed.push({ x, y, r });
      } else {
        if (pick < 0.15) { if (free(x, y, 7)) flowers(g, x, y, rng); continue; }
        const r = pick < 0.65 ? 7 + rng() * 6 : 4 + rng() * 2;
        if (!free(x, y, r)) continue;
        if (pick < 0.65) tree(g, x, y, r, '#4e8f3d', '#66a853'); else bush(g, x, y, r, '#5a9a45', '#79b562');
        placed.push({ x, y, r });
      }
    }
  }
}

// Live scene behind the menu screens: a track with a few cars lapping it.
export class Backdrop {
  constructor(canvas, prerender) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.prerender = prerender;
    this.running = false;
    this.mapIndex = Math.floor(Math.random() * MAPS.length);
    this.loop = this.loop.bind(this);
  }

  setup() {
    const map = MAPS[this.mapIndex % MAPS.length];
    this.track = buildTrack(map);
    this.scale = 1.5;
    this.img = this.prerender(this.track, this.scale);
    this.cars = CAR_COLORS.slice(0, 6).map((color, i) => ({
      color, roof: null, s: this.track.length - 20 - i * 26,
      lane: (i % 2 ? 1 : -1) * this.track.halfWidth * 0.3,
      speed: 78 + (i * 37) % 17,
    }));
    this.cam = null;
    this.started = performance.now();
  }

  start() {
    if (this.running) return;
    if (!this.track) this.setup();
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  stop() { this.running = false; }

  loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    if (document.hidden) { this.last = now; return; }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // a new track every 40 s
    if (now - this.started > 40000) { this.mapIndex++; this.setup(); }

    const { canvas, ctx, track } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    for (const c of this.cars) {
      c.s += c.speed * dt;
      const p = pointAt(track, c.s), q = pointAt(track, c.s + 6);
      c.x = p.x + p.nx * c.lane;
      c.y = p.y + p.ny * c.lane;
      c.angle = Math.atan2(q.x - p.x, -(q.y - p.y));
    }

    // camera drifts after the leading car, zoomed so the track fills the screen
    const lead = this.cars[0];
    const zoom = Math.max(0.9, Math.min(2.2, Math.min(w, h) / 380));
    if (!this.cam) this.cam = { x: lead.x, y: lead.y };
    const k = 1 - Math.pow(0.15, dt);
    this.cam.x += (lead.x - this.cam.x) * k;
    this.cam.y += (lead.y - this.cam.y) * k;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = track.theme.ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (w / 2 - this.cam.x * zoom), dpr * (h / 2 - this.cam.y * zoom));
    ctx.drawImage(this.img, -SCENERY_PAD, -SCENERY_PAD, this.img.width / this.scale, this.img.height / this.scale);
    for (const c of this.cars) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(-CAR_WIDTH / 2 + 0.8, -CAR_LENGTH / 2 + 1.2, CAR_WIDTH, CAR_LENGTH);
      ctx.fillStyle = c.color;
      ctx.fillRect(-CAR_WIDTH / 2, -CAR_LENGTH / 2, CAR_WIDTH, CAR_LENGTH);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-ROOF_WIDTH / 2, -ROOF_LENGTH / 2 + 1, ROOF_WIDTH, ROOF_LENGTH);
      ctx.restore();
    }
  }
}
