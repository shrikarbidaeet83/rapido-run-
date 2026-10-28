// Particles, explosions, shockwaves, smoke, debris, bolts, beams, damage numbers.
// Particles come from a fixed pool (no allocations while playing) and are skipped when off-screen.

const MAX_PARTICLES = 1500;
const spriteCache = new Map();

// Soft round glow sprite, cached per color.
export function glowSprite(color) {
  let c = spriteCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.22, color);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  spriteCache.set(color, c);
  return c;
}

function smokeSprite() {
  let c = spriteCache.get('#smoke');
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,.55)');
  gr.addColorStop(0.6, 'rgba(255,255,255,.18)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  spriteCache.set('#smoke', c);
  return c;
}

const FIRE = ['#fff3b0', '#ffd166', '#ff9f1c', '#ff5400', '#c1121f'];
const KIND_COLORS = {
  ice: ['#ffffff', '#c7f9ff', '#7efff5', '#48dbfb'], lightning: ['#ffffff', '#fff200', '#a0e9ff'], laser: ['#ffffff', '#ff7675', '#ff3838'],
  acid: ['#eaffc2', '#badc58', '#6ab04c'], blackhole: ['#ffffff', '#a29bfe', '#6c5ce7', '#341f97'], firework: ['#ff4dd2', '#7efff5', '#fff200', '#2ed573', '#ff6b6b'],
  magnet: ['#ffffff', '#fd79a8', '#e84393'], spark: ['#ffffff', '#fff200', '#ffd166'], hail: ['#ffffff', '#dff9fb', '#c7ecee'],
};

export class FX {
  constructor() {
    this.pool = [];
    for (let i = 0; i < MAX_PARTICLES; i++) this.pool.push({ on: false });
    this.cursor = 0;
    this.live = 0;
    this.budget = MAX_PARTICLES; // lowered on slow devices (see adapt)
    this.ema = 1 / 60;
    this.blasts = [];   // fireballs and flashes
    this.rings = [];    // shockwaves
    this.bolts = [];    // lightning
    this.beams = [];    // lasers
    this.numbers = [];  // floating damage numbers
    this.banners = [];  // combo text in world space
    this.shake = 0;
    this.flash = 0;
    this.shakeScale = 1;
  }

  clear() {
    for (const p of this.pool) p.on = false;
    this.live = 0;
    this.blasts.length = this.rings.length = this.bolts.length = this.beams.length = this.numbers.length = this.banners.length = 0;
    this.shake = this.flash = 0;
  }

  spawn(kind, x, y, vx, vy, life, size, color, opt) {
    // past half the budget, thin new particles out more and more, so busy moments stay smooth
    const half = this.budget / 2;
    if (this.live > half && Math.random() < (this.live - half) / half) return null;
    // ring buffer over the pool: if all slots are busy, the oldest particle is reused
    for (let n = 0; n < MAX_PARTICLES; n++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      if (p.on && n < MAX_PARTICLES - 1) continue;
      if (!p.on) this.live++;
      p.on = true; p.kind = kind; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life;
      p.size = size; p.color = color; p.g = opt?.g ?? 0; p.drag = opt?.drag ?? 1; p.grow = opt?.grow ?? 0; p.rot = Math.random() * 6; p.vr = (Math.random() - 0.5) * 10;
      return p;
    }
    return null;
  }

  // Frame-time feedback: shrink the particle budget when frames run slow, grow it back when fast.
  adapt(dt) {
    this.ema += (dt - this.ema) * 0.05;
    if (this.ema > 1 / 45) this.budget = Math.max(200, this.budget * 0.97);
    else if (this.ema < 1 / 56) this.budget = Math.min(MAX_PARTICLES, this.budget + 4);
  }

  addShake(v) { this.shake = Math.min(30, this.shake + v * this.shakeScale); }

  explosion(x, y, r, kind = 'shell', terrainColors = ['#6b4a2b']) {
    const palette = KIND_COLORS[kind] || FIRE;
    const k = Math.max(0.4, r / 40);
    this.blasts.push({ x, y, r: r * 1.15, t: 0, dur: 0.5 + k * 0.12, palette, flash: true });
    this.rings.push({ x, y, r: r * 0.4, max: r * 2.1, t: 0, dur: 0.45 + k * 0.1, color: palette[1] || '#fff' });
    const sparks = Math.min(60, 10 + r * 0.6);
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() * Math.PI * 2, s = (0.4 + Math.random()) * (120 + r * 6);
      this.spawn('spark', x, y, Math.cos(a) * s, Math.sin(a) * s - 40, 0.3 + Math.random() * 0.5, 1.5 + Math.random() * 2, palette[i % palette.length], { g: 300, drag: 0.96 });
    }
    if (kind !== 'firework' && kind !== 'lightning' && kind !== 'laser') {
      const chunks = Math.min(40, 6 + r * 0.45);
      for (let i = 0; i < chunks; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, s = (0.3 + Math.random()) * (150 + r * 4);
        this.spawn('debris', x, y, Math.cos(a) * s, Math.sin(a) * s, 1 + Math.random() * 1.2, 2 + Math.random() * (2 + r / 25),
          terrainColors[i % terrainColors.length], { g: 600, drag: 0.995 });
      }
      const puffs = Math.min(26, 4 + r * 0.25);
      for (let i = 0; i < puffs; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.6;
        this.spawn('smoke', x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, (Math.random() - 0.5) * 30, -20 - Math.random() * 30, 1.6 + Math.random() * 1.6,
          r * 0.35 + Math.random() * r * 0.3, kind === 'acid' ? '#7d9a3a' : kind === 'ice' ? '#d8f6ff' : '#3a3a40', { grow: 0.6, drag: 0.98 });
      }
      for (let i = 0; i < Math.min(25, r * 0.3); i++) {
        this.spawn('ember', x + (Math.random() - 0.5) * r, y - Math.random() * r * 0.5, (Math.random() - 0.5) * 60, -40 - Math.random() * 80, 1 + Math.random() * 1.5, 1.5 + Math.random() * 1.5, '#ff9f1c', { g: -10, drag: 0.98 });
      }
    }
    this.addShake(Math.min(24, 2 + r / 6));
    if (r >= 80) this.flash = Math.min(1, this.flash + r / 200);
  }

  dirtBurst(x, y, r, colors) {
    for (let i = 0; i < Math.min(50, r); i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2, s = 60 + Math.random() * 220;
      this.spawn('debris', x + (Math.random() - 0.5) * r, y, Math.cos(a) * s, Math.sin(a) * s, 0.8 + Math.random(), 2 + Math.random() * 4, colors[i % colors.length], { g: 600 });
    }
    this.addShake(3);
  }

  muzzle(x, y, angle) {
    this.blasts.push({ x, y, r: 14, t: 0, dur: 0.18, palette: FIRE, flash: false });
    for (let i = 0; i < 10; i++) {
      const a = angle + (Math.random() - 0.5) * 0.6, s = 80 + Math.random() * 160;
      this.spawn('smoke', x, y, Math.cos(a) * s, -Math.sin(a) * s, 0.6 + Math.random() * 0.6, 6 + Math.random() * 6, '#9a9a9a', { grow: 1.2, drag: 0.93 });
    }
  }

  trail(x, y, color, kind) {
    if (kind === 'smoke') this.spawn('smoke', x, y, (Math.random() - 0.5) * 10, -8, 0.9, 5, '#b0b0b0', { grow: 1, drag: 0.97 });
    else this.spawn('ember', x, y, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.35 + Math.random() * 0.3, 1.6 + Math.random() * 1.6, color, { drag: 0.95 });
  }

  bolt(x1, y1, x2, y2) {
    const make = (ax, ay, bx, by, depth) => {
      const pts = [[ax, ay]];
      const n = 10;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        pts.push([ax + (bx - ax) * t + (Math.random() - 0.5) * 40, ay + (by - ay) * t + (Math.random() - 0.5) * 24]);
      }
      pts.push([bx, by]);
      const out = [pts];
      if (depth > 0) {
        for (let b = 0; b < 2; b++) {
          const s = pts[2 + Math.floor(Math.random() * 6)];
          out.push(...make(s[0], s[1], s[0] + (Math.random() - 0.5) * 120, s[1] + 30 + Math.random() * 80, depth - 1));
        }
      }
      return out;
    };
    this.bolts.push({ paths: make(x1, Math.min(y1, y2) - 260, x2, y2, 2), t: 0, dur: 0.6 });
    this.flash = Math.min(1, this.flash + 0.55);
    this.addShake(6);
  }

  beam(x1, y1, x2, y2, colors = ['#ff3838', '#ff9f9f', '#ffffff']) {
    this.beams.push({ x1, y1, x2, y2, t: 0, dur: 0.7, colors });
    for (let i = 0; i < 40; i++) {
      const t = Math.random();
      this.spawn('spark', x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120, 0.4, 2, '#ff7675', { drag: 0.9 });
    }
    this.addShake(4);
  }

  ring(x, y, max, color, dur = 0.6) { this.rings.push({ x, y, r: 4, max, t: 0, dur, color }); }

  sparkle(x, y, color, n = 24, speed = 160) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * speed;
      this.spawn('spark', x, y, Math.cos(a) * s, Math.sin(a) * s, 0.5 + Math.random() * 0.5, 2, color, { drag: 0.93 });
    }
  }

  mushroom(x, y) {
    for (let i = 0; i < 70; i++) {
      const stem = i < 30;
      const px = x + (Math.random() - 0.5) * (stem ? 30 : 160);
      const py = y - (stem ? Math.random() * 200 : 200 + Math.random() * 60);
      this.spawn('smoke', px, y, (px - x) * 0.3, (py - y) / 2.2, 3 + Math.random() * 2, stem ? 22 : 34, i % 3 ? '#5a4a42' : '#8a5a3a', { grow: 0.5, drag: 0.985 });
    }
    this.flash = 1;
    this.addShake(30);
  }

  number(x, y, text, color, big = false) {
    this.numbers.push({ x: x + (Math.random() - 0.5) * 16, y, text, color, t: 0, dur: 1.6, big });
  }

  smokeFrom(x, y) {
    this.spawn('smoke', x, y, (Math.random() - 0.5) * 8, -20, 1.5, 6, '#2c2c2c', { grow: 1.4, drag: 0.98 });
  }

  update(dt, wind) {
    const windPush = wind * 3;
    for (const p of this.pool) {
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) { p.on = false; this.live--; continue; }
      p.vy += p.g * dt;
      if (p.kind === 'smoke' || p.kind === 'ember') p.vx += windPush * dt;
      p.vx *= p.drag; p.vy *= p.drag;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.size += p.grow * dt * 10;
      p.rot += p.vr * dt;
    }
    const age = (list) => { for (let i = list.length - 1; i >= 0; i--) { list[i].t += dt; if (list[i].t >= list[i].dur) list.splice(i, 1); } };
    age(this.blasts); age(this.rings); age(this.bolts); age(this.beams); age(this.numbers);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  // World-space drawing. view = {l, t, r, b} visible world rect.
  drawBack(ctx, view) {
    // smoke and debris (normal blending)
    const smoke = smokeSprite();
    for (const p of this.pool) {
      if (!p.on || (p.kind !== 'smoke' && p.kind !== 'debris')) continue;
      if (p.x < view.l - 60 || p.x > view.r + 60 || p.y < view.t - 60 || p.y > view.b + 60) continue;
      const a = Math.min(1, p.life / p.max * 1.5);
      if (p.kind === 'smoke') {
        ctx.globalAlpha = a * 0.7;
        const s = p.size * 2;
        ctx.drawImage(tinted(smoke, p.color), p.x - s / 2, p.y - s / 2, s, s);
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawFront(ctx, view) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.blasts) {
      const k = b.t / b.dur;
      const r = b.r * (0.35 + 0.75 * Math.sqrt(k));
      ctx.globalAlpha = Math.max(0, 1 - k);
      const spr = glowSprite(b.palette[Math.min(b.palette.length - 1, Math.floor(k * b.palette.length))]);
      ctx.drawImage(spr, b.x - r * 1.6, b.y - r * 1.6, r * 3.2, r * 3.2);
      if (b.flash && k < 0.25) {
        ctx.globalAlpha = 1 - k * 4;
        ctx.drawImage(glowSprite('#ffffff'), b.x - r, b.y - r, r * 2, r * 2);
      }
    }
    for (const p of this.pool) {
      if (!p.on || (p.kind !== 'spark' && p.kind !== 'ember')) continue;
      if (p.x < view.l - 20 || p.x > view.r + 20 || p.y < view.t - 20 || p.y > view.b + 20) continue;
      const a = Math.min(1, (p.life / p.max) * 2);
      ctx.globalAlpha = a;
      if (p.kind === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else {
        const s = p.size * 5;
        ctx.drawImage(glowSprite(p.color), p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
    for (const r of this.rings) {
      const k = r.t / r.dur;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r + (r.max - r.r) * (1 - (1 - k) * (1 - k)), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const b of this.bolts) {
      const k = b.t / b.dur;
      ctx.globalAlpha = (1 - k) * (Math.random() < 0.15 ? 0.3 : 1);
      for (const [i, path] of b.paths.entries()) {
        ctx.strokeStyle = i ? '#a0e9ff' : '#ffffff';
        ctx.lineWidth = i ? 1.5 : 3.5;
        ctx.shadowColor = '#7fd8ff';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        path.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    for (const b of this.beams) {
      const k = b.t / b.dur;
      for (const [w, c] of [[14, b.colors[0]], [6, b.colors[1]], [2, b.colors[2]]]) {
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.strokeStyle = c;
        ctx.lineWidth = w * (1 - k * 0.6);
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawNumbers(ctx, scale = 1) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const n of this.numbers) {
      const k = n.t / n.dur;
      const pop = k < 0.12 ? 0.6 + k / 0.12 * 0.6 : 1.2 - Math.min(0.2, (k - 0.12));
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `${Math.round((n.big ? 34 : 24) * pop * scale)}px "Russo One", system-ui, sans-serif`;
      const y = n.y - k * 50 * scale;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(n.text, n.x, y);
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, n.x, y);
    }
    ctx.restore();
  }
}

// Smoke sprite tinted to a color (cached).
function tinted(sprite, color) {
  const key = `#smoke-${color}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.drawImage(sprite, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, 64, 64);
  spriteCache.set(key, c);
  return c;
}
