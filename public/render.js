// Canvas 2D rendering: pre-rendered track, camera, cars, skid marks, particles, minimap.

import {
  CAR_WIDTH, CAR_LENGTH, ROOF_WIDTH, ROOF_LENGTH, ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX,
  MAX_PARTICLES, MAX_SKIDS,
} from '/shared/constants.js';
import { buildTrack } from '/shared/track.js';

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function tracePath(ctx, track, k = 1) {
  ctx.beginPath();
  ctx.moveTo(track.xs[0] * k, track.ys[0] * k);
  for (let i = 1; i < track.n; i++) ctx.lineTo(track.xs[i] * k, track.ys[i] * k);
  ctx.closePath();
}

// Draws the whole track once into an offscreen canvas.
export function prerenderTrack(track, scale) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(track.worldWidth * scale);
  c.height = Math.ceil(track.worldHeight * scale);
  const g = c.getContext('2d');
  const th = track.theme;
  g.scale(scale, scale);

  // ground with a faint checker so speed is easy to read
  g.fillStyle = th.ground;
  g.fillRect(0, 0, track.worldWidth, track.worldHeight);
  g.fillStyle = th.ground2;
  const T = 80;
  for (let y = 0; y < track.worldHeight; y += T) {
    for (let x = (y / T) % 2 ? T : 0; x < track.worldWidth; x += 2 * T) g.fillRect(x, y, T, T);
  }

  // minimal look: plain asphalt with a single thin edge line on each side
  // (the line marks where the slower edge zone starts; the asphalt ends at the wall)
  g.lineJoin = 'round';
  g.lineCap = 'round';
  tracePath(g, track);
  g.strokeStyle = th.asphalt;
  g.lineWidth = track.width;
  g.stroke();
  const inner = track.width - 2 * track.kerbWidth, lw = 1.2;
  g.strokeStyle = th.line;
  g.lineWidth = inner + 2 * lw;
  g.stroke();
  g.strokeStyle = th.asphalt;
  g.lineWidth = inner;
  g.stroke();

  // grid boxes
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1.2;
  for (const s of track.gridSlots) {
    g.save();
    g.translate(s.x, s.y);
    g.rotate(s.angle);
    g.beginPath();
    g.moveTo(-7, -11); g.lineTo(7, -11);
    g.moveTo(-7, -11); g.lineTo(-7, -5);
    g.moveTo(7, -11); g.lineTo(7, -5);
    g.stroke();
    g.restore();
  }

  // checkerboard start/finish line
  const cp = track.checkpoints[0];
  g.save();
  g.translate(cp.x, cp.y);
  g.rotate(Math.atan2(cp.ty, cp.tx));
  const sq = 5, half = track.halfWidth - track.kerbWidth;
  for (let row = 0; row < 2; row++) {
    for (let k = -half, col = 0; k < half; k += sq, col++) {
      g.fillStyle = (row + col) % 2 ? '#111' : '#fff';
      g.fillRect(-sq + row * sq, k, sq, Math.min(sq, half - k));
    }
  }
  g.restore();
  return c;
}

// Small map preview for the lobby.
export function drawThumbnail(canvas, map) {
  const track = buildTrack(map);
  const g = canvas.getContext('2d');
  const k = canvas.width / track.worldWidth;
  g.fillStyle = map.theme.ground;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.lineJoin = 'round';
  tracePath(g, track, k);
  g.strokeStyle = map.theme.asphalt;
  g.lineWidth = Math.max(3, track.width * k);
  g.stroke();
  const cp = track.checkpoints[0];
  g.fillStyle = '#fff';
  g.fillRect(cp.x * k - 2, cp.y * k - 2, 4, 4);
  return track;
}

export class Renderer {
  constructor(canvas, minimap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.minimap = minimap;
    this.mctx = minimap.getContext('2d');
    this.track = null;
    this.trackImg = null;
    this.scale = 1;
    this.zoom = this.defaultZoom();
    this.cam = { x: 0, y: 0, init: false };
    this.shake = 0;
    this.particles = Array.from({ length: MAX_PARTICLES }, () => ({ life: 0 }));
    this.pIndex = 0;
    this.skids = [];
    this.dpr = 1;
    this.resize();
  }

  setTrack(track) {
    this.track = track;
    // ~2 px per world unit, but stay under mobile canvas size limits (~16M px)
    const maxScale = Math.sqrt(15e6 / (track.worldWidth * track.worldHeight));
    this.scale = Math.min(2, maxScale);
    this.trackImg = prerenderTrack(track, this.scale);
    this.skids.length = 0;
    for (const p of this.particles) p.life = 0;
    this.cam.init = false;
    this.zoom = this.defaultZoom();
    this.minimapScale = Math.min((this.minimap.width - 12) / track.worldWidth, (this.minimap.height - 12) / track.worldHeight);
  }

  clear() {
    this.track = null;
    this.trackImg = null;
    this.skids.length = 0;
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.w = w; this.h = h;
  }

  // small screens (phones) zoom out so you can see the road ahead
  defaultZoom() {
    const short = Math.min(window.innerWidth, window.innerHeight);
    return ZOOM_DEFAULT * Math.max(0.55, Math.min(1, short / 700));
  }

  zoomBy(factor) {
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * factor));
  }

  addShake(amount) { this.shake = Math.min(6, this.shake + amount); }

  emit(x, y, n, kind, power = 1) {
    for (let i = 0; i < n; i++) {
      const p = this.particles[this.pIndex];
      this.pIndex = (this.pIndex + 1) % this.particles.length;
      const a = Math.random() * Math.PI * 2;
      const sp = (kind === 'spark' ? 0.6 + Math.random() * 1.6 : 0.1 + Math.random() * 0.3) * power;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
      p.max = p.life = kind === 'spark' ? 18 + Math.random() * 14 : 30 + Math.random() * 20;
      p.kind = kind;
      p.size = kind === 'spark' ? 0.9 : 1.5 + Math.random() * 1.5;
    }
  }

  // boost flame out of the back of the car
  flame(car) {
    const fx = Math.sin(car.angle), fy = -Math.cos(car.angle);
    for (let i = 0; i < 2; i++) {
      const p = this.particles[this.pIndex];
      this.pIndex = (this.pIndex + 1) % this.particles.length;
      const side = (Math.random() - 0.5) * 5;
      p.x = car.x - fx * (CAR_LENGTH / 2 + 1) + Math.cos(car.angle) * side;
      p.y = car.y - fy * (CAR_LENGTH / 2 + 1) + Math.sin(car.angle) * side;
      p.vx = -fx * (0.6 + Math.random() * 0.6) + car.vx * 0.5;
      p.vy = -fy * (0.6 + Math.random() * 0.6) + car.vy * 0.5;
      p.max = p.life = 10 + Math.random() * 8;
      p.kind = 'flame';
      p.size = 1.6 + Math.random() * 1.4;
    }
  }

  addSkid(car, now) {
    const fx = Math.sin(car.angle), fy = -Math.cos(car.angle);
    const rx = Math.cos(car.angle), ry = Math.sin(car.angle);
    const bx = car.x - fx * (CAR_LENGTH / 2 - 2), by = car.y - fy * (CAR_LENGTH / 2 - 2);
    const prev = car._skid;
    const pts = [bx + rx * 3, by + ry * 3, bx - rx * 3, by - ry * 3];
    if (prev && now - prev.t < 80) {
      this.skids.push({ a: prev.pts, b: pts, t: now });
      if (this.skids.length > MAX_SKIDS) this.skids.shift();
    }
    car._skid = { pts, t: now };
  }

  // frame: { cars: [{x, y, angle, color, name, ghost, me, removed}], focus: {x, y}, dt, now }
  draw(frame) {
    const { ctx, track } = this;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = track ? track.theme.ground : '#e8e8e8';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!track) return;

    // camera: smooth follow, clamped to the world
    const z = this.zoom;
    const halfW = this.w / 2 / z, halfH = this.h / 2 / z;
    if (frame.focus) {
      if (!this.cam.init) { this.cam.x = frame.focus.x; this.cam.y = frame.focus.y; this.cam.init = true; }
      const k = 1 - Math.pow(0.001, frame.dt / 1000);
      this.cam.x += (frame.focus.x - this.cam.x) * k;
      this.cam.y += (frame.focus.y - this.cam.y) * k;
    }
    const clamp = (v, half, size) => (half * 2 >= size ? size / 2 : Math.max(half, Math.min(size - half, v)));
    let cx = clamp(this.cam.x, halfW, track.worldWidth);
    let cy = clamp(this.cam.y, halfH, track.worldHeight);
    if (this.shake > 0.05) {
      cx += (Math.random() - 0.5) * this.shake;
      cy += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.02, frame.dt / 1000);
    }
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (this.w / 2 - cx * z), dpr * (this.h / 2 - cy * z));

    // visible part of the pre-rendered track
    const vx = Math.max(0, cx - halfW), vy = Math.max(0, cy - halfH);
    const vw = Math.min(track.worldWidth - vx, halfW * 2 + 2), vh = Math.min(track.worldHeight - vy, halfH * 2 + 2);
    const s = this.scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.trackImg, vx * s, vy * s, vw * s, vh * s, vx, vy, vw, vh);

    // skid marks
    const now = frame.now;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (const sk of this.skids) {
      const age = (now - sk.t) / 5000;
      if (age >= 1) continue;
      ctx.strokeStyle = `rgba(20,20,20,${0.35 * (1 - age)})`;
      ctx.beginPath();
      ctx.moveTo(sk.a[0], sk.a[1]); ctx.lineTo(sk.b[0], sk.b[1]);
      ctx.moveTo(sk.a[2], sk.a[3]); ctx.lineTo(sk.b[2], sk.b[3]);
      ctx.stroke();
    }
    while (this.skids.length && now - this.skids[0].t > 5000) this.skids.shift();

    // cars (car.js style: body + darker roof)
    for (const car of frame.cars) {
      if (car.removed) continue;
      ctx.save();
      ctx.globalAlpha = car.ghost ? 0.4 : 1;
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(-CAR_WIDTH / 2 + 0.8, -CAR_LENGTH / 2 + 1.2, CAR_WIDTH, CAR_LENGTH);
      ctx.fillStyle = car.color;
      ctx.fillRect(-CAR_WIDTH / 2, -CAR_LENGTH / 2, CAR_WIDTH, CAR_LENGTH);
      ctx.fillStyle = car.roof || (car.roof = shade(car.color, -0.25));
      ctx.fillRect(-ROOF_WIDTH / 2, -ROOF_LENGTH / 2 + 1, ROOF_WIDTH, ROOF_LENGTH);
      ctx.restore();
    }

    // particles
    const dtk = frame.dt / 16.67;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dtk;
      p.x += p.vx * dtk; p.y += p.vy * dtk;
      p.vx *= 0.94; p.vy *= 0.94;
      const a = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.kind === 'spark' ? `rgba(255,${180 + Math.floor(60 * a)},60,${a})`
        : p.kind === 'flame' ? `rgba(${120 + Math.floor(135 * a)},${180 + Math.floor(70 * a)},255,${a * 0.9})`
          : `rgba(170,150,120,${a * 0.5})`;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }

    // name labels in screen space (not rotated)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    for (const car of frame.cars) {
      if (car.removed) continue;
      const sx = (car.x - cx) * z + this.w / 2, sy = (car.y - cy) * z + this.h / 2 - 12 * z - 4;
      if (sx < -50 || sy < -20 || sx > this.w + 50 || sy > this.h + 30) continue;
      ctx.globalAlpha = car.ghost ? 0.5 : 1;
      const px = this.w < 760 ? 9 : 11;
      ctx.font = `${car.me ? 'bold ' : ''}${px}px -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.strokeText(car.name, sx, sy);
      ctx.fillStyle = '#222';
      ctx.fillText(car.name, sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  drawMinimap(cars) {
    const { mctx: g, track, minimap } = this;
    if (!track) return;
    const k = this.minimapScale;
    const ox = (minimap.width - track.worldWidth * k) / 2, oy = (minimap.height - track.worldHeight * k) / 2;
    g.clearRect(0, 0, minimap.width, minimap.height);
    g.save();
    g.translate(ox, oy);
    g.lineJoin = 'round';
    tracePath(g, track, k);
    g.strokeStyle = '#999';
    g.lineWidth = Math.max(3, track.width * k);
    g.stroke();
    let me = null;
    for (const c of cars) {
      if (c.removed) continue;
      if (c.me) { me = c; continue; }
      g.fillStyle = c.color;
      g.fillRect(c.x * k - 2, c.y * k - 2, 4, 4);
    }
    if (me) {
      g.fillStyle = me.color;
      g.strokeStyle = '#000';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(me.x * k, me.y * k, 3.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.restore();
  }
}
