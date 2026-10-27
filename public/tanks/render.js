// Layers, camera, parallax backgrounds, terrain drawing, tanks, projectiles, UI in the world.

import { WORLD_W, WORLD_H, TURRET_PIVOT, TURRET_LEN, TANK_HP } from '/shared/tanks/constants.js';
import { getMap } from '/shared/tanks/maps.js';
import { getWeapon, WEAPON_IDS } from '/shared/tanks/weapons.js';
import { glowSprite } from './fx.js';

const DEG = Math.PI / 180;

export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Seeded random for decorative layers (stable between redraws; not part of the simulation).
function srand(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- tanks ----------
// t: { x, y, tilt, angle, color, style, recoil, wheel, alive, frozen, shield }
export function drawTank(ctx, t, time = 0) {
  const c = t.color, dark = shade(c, -0.35), light = shade(c, 0.35);
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.tilt || 0);
  if (!t.alive) {
    ctx.fillStyle = '#2a2522';
    rr(ctx, -17, -9, 34, 9, 3); ctx.fill();
    ctx.fillStyle = '#1a1614';
    ctx.beginPath(); ctx.moveTo(-12, -9); ctx.lineTo(-4, -16); ctx.lineTo(8, -14); ctx.lineTo(13, -9); ctx.fill();
    ctx.restore();
    return;
  }
  const style = t.style || 'classic';
  // treads / hover pads
  if (style === 'hover') {
    const g = ctx.createRadialGradient(0, -1, 2, 0, -1, 20);
    g.addColorStop(0, light); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.6 + Math.sin(time * 8) * 0.2;
    ctx.fillStyle = g; ctx.fillRect(-20, -6, 40, 8);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#20232b'; rr(ctx, -16, -8, 32, 4, 2); ctx.fill();
  } else {
    ctx.fillStyle = '#1d1f24'; rr(ctx, -18, -8, 36, 8, 4); ctx.fill();
    ctx.strokeStyle = '#3b3f48'; ctx.lineWidth = 1; rr(ctx, -18, -8, 36, 8, 4); ctx.stroke();
    for (let i = -2; i <= 2; i++) {
      const wx = i * 6.5;
      ctx.fillStyle = '#4a4f5a'; ctx.beginPath(); ctx.arc(wx, -4, 2.8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
      const a = (t.wheel || 0) + i;
      ctx.beginPath(); ctx.moveTo(wx - Math.cos(a) * 2.5, -4 - Math.sin(a) * 2.5); ctx.lineTo(wx + Math.cos(a) * 2.5, -4 + Math.sin(a) * 2.5); ctx.stroke();
    }
  }
  // barrel(s): world angle -> local
  const local = -(t.angle ?? 60) * DEG - (t.tilt || 0);
  const len = TURRET_LEN - (t.recoil || 0) * 7;
  const barrel = (off, w) => {
    ctx.save();
    ctx.translate(0, -TURRET_PIVOT);
    ctx.rotate(local);
    ctx.fillStyle = '#2b2e35';
    rr(ctx, 0, -w / 2 + off, len, w, w / 2); ctx.fill();
    ctx.fillStyle = '#4d525d';
    ctx.fillRect(len - 4, -w / 2 - 0.5 + off, 4, w + 1);
    ctx.restore();
  };
  if (style === 'twin') { barrel(-2.2, 3); barrel(2.2, 3); } else barrel(0, style === 'heavy' ? 5.5 : style === 'scout' ? 3 : 4);
  // body
  const body = ctx.createLinearGradient(0, -20, 0, -6);
  body.addColorStop(0, light); body.addColorStop(1, dark);
  ctx.fillStyle = body;
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1;
  ctx.beginPath();
  switch (style) {
    case 'heavy':
      rr(ctx, -17, -17, 34, 10, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c; rr(ctx, -8, -21, 16, 7, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      for (let i = -12; i <= 12; i += 8) { ctx.beginPath(); ctx.arc(i, -12, 1.1, 0, Math.PI * 2); ctx.fill(); }
      break;
    case 'scout':
      ctx.moveTo(-17, -8); ctx.lineTo(17, -8); ctx.lineTo(13, -13); ctx.lineTo(-10, -14); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, -14, 6, 4, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
      break;
    case 'dome':
      ctx.arc(0, -8, 14, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(-5, -15, 4, 2, -0.5, 0, Math.PI * 2); ctx.fill();
      break;
    case 'hover':
      ctx.ellipse(0, -11, 17, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, -15, 6, Math.PI, 0); ctx.fill(); ctx.stroke();
      break;
    default: // classic, twin
      ctx.moveTo(-16, -8); ctx.lineTo(16, -8); ctx.lineTo(11, -16); ctx.lineTo(-11, -16); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, -16, 7, Math.PI, 0); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.fillRect(-12, -15, 10, 1.5);
  if (t.frozen) {
    ctx.fillStyle = 'rgba(190,240,255,.55)';
    rr(ctx, -19, -24, 38, 24, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1;
    for (const [x, y] of [[-12, -18], [4, -21], [12, -10], [-4, -6]]) {
      ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); ctx.stroke();
    }
  }
  ctx.restore();
  if (t.shield > 0) {
    const pulse = 1 + Math.sin(time * 4) * 0.04;
    const g = ctx.createRadialGradient(t.x, t.y - 10, 10, t.x, t.y - 10, 32 * pulse);
    g.addColorStop(0, 'rgba(75,207,250,0)'); g.addColorStop(0.75, 'rgba(75,207,250,.18)'); g.addColorStop(1, 'rgba(160,235,255,.75)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(t.x, t.y - 10, 32 * pulse, 0, Math.PI * 2); ctx.fill();
  }
}

// ---------- backgrounds ----------
function buildBackground(map, seed) {
  const rnd = srand(seed);
  const W = WORLD_W + 200, H = WORLD_H + 100;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const sky = mk(), far = mk(), near = mk();
  const s = sky.getContext('2d');
  const g = s.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, map.sky[0]); g.addColorStop(0.55, map.sky[1]); g.addColorStop(1, map.sky[2]);
  s.fillStyle = g; s.fillRect(0, 0, W, H);
  const f = far.getContext('2d'), n = near.getContext('2d');
  const ridge = (ctx, base, amp, len, color, jag) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(0, H);
    const ph = rnd() * 10;
    for (let x = 0; x <= W; x += 8) {
      let y = base + Math.sin(x / len + ph) * amp + Math.sin(x / (len * 0.37) + ph * 2) * amp * 0.4;
      if (jag) y += (rnd() - 0.5) * jag;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  };
  switch (map.id) {
    case 'hills': {
      s.fillStyle = 'rgba(255,255,220,.9)'; s.beginPath(); s.arc(1350, 140, 46, 0, Math.PI * 2); s.fill();
      const sg = s.createRadialGradient(1350, 140, 40, 1350, 140, 180); sg.addColorStop(0, 'rgba(255,255,200,.4)'); sg.addColorStop(1, 'rgba(255,255,200,0)');
      s.fillStyle = sg; s.fillRect(1100, 0, 500, 400);
      ridge(f, 430, 70, 160, '#8fb8d8', 10);
      f.fillStyle = 'rgba(255,255,255,.7)';
      ridge(n, 560, 40, 120, '#6f9e78', 0);
      break;
    }
    case 'dunes': {
      const sg = s.createRadialGradient(800, 520, 20, 800, 520, 420); sg.addColorStop(0, 'rgba(255,240,180,1)'); sg.addColorStop(0.15, 'rgba(255,200,110,.9)'); sg.addColorStop(1, 'rgba(255,140,60,0)');
      s.fillStyle = sg; s.fillRect(0, 0, W, H);
      ridge(f, 520, 40, 220, '#b8603a', 0);
      ridge(n, 600, 35, 140, '#d08a4c', 0);
      break;
    }
    case 'snow': {
      ridge(f, 380, 120, 110, '#b9c9dc', 50);
      f.globalCompositeOperation = 'source-atop';
      const cap = f.createLinearGradient(0, 240, 0, 420);
      cap.addColorStop(0, 'rgba(255,255,255,.85)'); cap.addColorStop(1, 'rgba(255,255,255,0)');
      f.fillStyle = cap; f.fillRect(0, 0, W, 420);
      f.globalCompositeOperation = 'source-over';
      ridge(n, 540, 60, 90, '#93a8c0', 20);
      break;
    }
    case 'volcanic': {
      ridge(f, 470, 90, 170, '#2a0d08', 30);
      f.fillStyle = 'rgba(255,90,20,.25)';
      for (let i = 0; i < 6; i++) { const x = rnd() * W; f.fillRect(x, 0, 2, H); }
      ridge(n, 600, 50, 110, '#1c0a07', 10);
      const glow = n.createLinearGradient(0, 600, 0, H); glow.addColorStop(0, 'rgba(255,70,0,0)'); glow.addColorStop(1, 'rgba(255,70,0,.35)');
      n.fillStyle = glow; n.fillRect(0, 600, W, H - 600);
      break;
    }
    case 'moon': {
      for (let i = 0; i < 420; i++) {
        s.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.8})`;
        const r = rnd() < 0.08 ? 1.6 : 0.8;
        s.fillRect(rnd() * W, rnd() * H * 0.8, r, r);
      }
      // Earth
      const ex = 360, ey = 190, er = 62;
      const eg = s.createRadialGradient(ex - 20, ey - 20, 5, ex, ey, er);
      eg.addColorStop(0, '#6fb7ff'); eg.addColorStop(0.7, '#1f5fb8'); eg.addColorStop(1, '#0b2a5a');
      s.fillStyle = eg; s.beginPath(); s.arc(ex, ey, er, 0, Math.PI * 2); s.fill();
      s.save(); s.clip();
      s.fillStyle = '#3d9a52';
      for (let i = 0; i < 6; i++) { s.beginPath(); s.ellipse(ex - 40 + rnd() * 80, ey - 40 + rnd() * 80, 10 + rnd() * 18, 6 + rnd() * 12, rnd() * 3, 0, Math.PI * 2); s.fill(); }
      s.fillStyle = 'rgba(255,255,255,.5)';
      for (let i = 0; i < 4; i++) { s.beginPath(); s.ellipse(ex - 50 + rnd() * 100, ey - 50 + rnd() * 100, 20, 4, rnd(), 0, Math.PI * 2); s.fill(); }
      s.fillStyle = 'rgba(0,0,0,.45)'; s.beginPath(); s.arc(ex + 30, ey + 10, er, 0, Math.PI * 2); s.fill();
      s.restore();
      ridge(f, 560, 30, 200, '#2a2c33', 4);
      break;
    }
    case 'neon': {
      for (let i = 0; i < 160; i++) { s.fillStyle = `rgba(255,255,255,${rnd() * 0.6})`; s.fillRect(rnd() * W, rnd() * H * 0.5, 1, 1); }
      const city = (ctx, base, hmin, hmax, color, winColor, density) => {
        for (let x = -20; x < W; x += 30 + rnd() * 50) {
          const w = 30 + rnd() * 60, h = hmin + rnd() * (hmax - hmin);
          ctx.fillStyle = color; ctx.fillRect(x, base - h, w, h + 200);
          for (let wy = base - h + 8; wy < base - 6; wy += 12) {
            for (let wx = x + 5; wx < x + w - 6; wx += 9) {
              if (rnd() < density) { ctx.fillStyle = winColor[Math.floor(rnd() * winColor.length)]; ctx.fillRect(wx, wy, 4, 6); }
            }
          }
        }
      };
      city(f, 640, 120, 360, '#140a2a', ['rgba(255,43,214,.55)', 'rgba(0,240,255,.5)', 'rgba(255,230,120,.4)'], 0.25);
      city(n, 720, 80, 220, '#0c0620', ['rgba(255,43,214,.8)', 'rgba(0,240,255,.8)'], 0.18);
      n.strokeStyle = 'rgba(255,43,214,.35)'; n.lineWidth = 1;
      for (let y = 760; y < H; y += 16) { n.beginPath(); n.moveTo(0, y); n.lineTo(W, y); n.stroke(); }
      for (let x = -800; x < W + 800; x += 60) { n.beginPath(); n.moveTo(W / 2 + (x - W / 2) * 0.2, 740); n.lineTo(x, H); n.stroke(); }
      break;
    }
  }
  return { sky, far, near };
}

function buildTexture(map, seed) {
  const rnd = srand(seed ^ 0xabc);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = map.ground[1];
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const light = rnd() < 0.5;
    g.fillStyle = light ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.12)';
    const s = 1 + rnd() * 2.5;
    g.fillRect(rnd() * 128, rnd() * 128, s, s);
  }
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(0,0,0,${0.08 + rnd() * 0.1})`;
    g.beginPath(); g.ellipse(rnd() * 128, rnd() * 128, 2 + rnd() * 4, 1.5 + rnd() * 3, rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  if (map.id === 'neon') {
    g.strokeStyle = 'rgba(0,240,255,.12)';
    for (let i = 0; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
  }
  return c;
}

// ---------- renderer ----------
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.terrainCanvas = document.createElement('canvas');
    this.tctx = this.terrainCanvas.getContext('2d');
    this.map = getMap('hills');
    this.terrain = null;
    this.q = 1;
    this.ambient = [];
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.cw = w; this.ch = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.scale = Math.min(w / WORLD_W, h / WORLD_H);
    this.ox = (w - WORLD_W * this.scale) / 2;
    this.oy = (h - WORLD_H * this.scale) / 2;
    const q = this.scale * dpr > 1.25 ? 2 : 1;
    if (q !== this.q || this.terrainCanvas.width !== WORLD_W * q) {
      this.q = q;
      this.terrainCanvas.width = WORLD_W * q;
      this.terrainCanvas.height = WORLD_H * q;
      if (this.terrain) this.redrawTerrain(0, WORLD_W - 1);
    }
  }

  setMap(mapId, seed = 1) {
    this.map = getMap(mapId);
    this.bg = buildBackground(this.map, seed);
    this.texture = buildTexture(this.map, seed);
    this.pattern = this.tctx.createPattern(this.texture, 'repeat');
    const rnd = srand(seed ^ 77);
    this.ambient = [];
    const n = { hills: 6, dunes: 3, snow: 160, volcanic: 70, moon: 40, neon: 30 }[this.map.id];
    for (let i = 0; i < n; i++) this.ambient.push({ x: rnd() * WORLD_W, y: rnd() * WORLD_H, s: rnd(), p: rnd() * 10 });
  }

  setTerrain(t) {
    this.terrain = t;
    this.redrawTerrain(0, WORLD_W - 1);
  }

  // Re-render only the changed column range.
  redrawTerrain(a, b) {
    if (!this.terrain || !this.pattern) return;
    const t = this.terrain, ctx = this.tctx, m = this.map, q = this.q;
    a = Math.max(0, Math.floor(a) - 2); b = Math.min(WORLD_W - 1, Math.ceil(b) + 2);
    ctx.setTransform(q, 0, 0, q, 0, 0);
    ctx.save();
    ctx.beginPath(); ctx.rect(a, 0, b - a + 1, WORLD_H); ctx.clip();
    ctx.clearRect(a, 0, b - a + 1, WORLD_H);
    const x0 = Math.max(0, a - 3), x1 = Math.min(WORLD_W - 1, b + 3);
    const surface = (off) => { ctx.beginPath(); for (let x = x0; x <= x1; x++) { if (x === x0) ctx.moveTo(x, t[x] + off); else ctx.lineTo(x, t[x] + off); } };
    surface(0);
    ctx.lineTo(x1 + 1, WORLD_H); ctx.lineTo(x0, WORLD_H); ctx.closePath();
    ctx.fillStyle = this.pattern; ctx.fill();
    ctx.globalCompositeOperation = 'source-atop';
    const dg = ctx.createLinearGradient(0, 300, 0, WORLD_H);
    dg.addColorStop(0, 'rgba(255,255,255,.06)'); dg.addColorStop(0.5, 'rgba(0,0,0,.05)'); dg.addColorStop(1, m.ground[2]);
    ctx.fillStyle = dg; ctx.fillRect(a, 0, b - a + 1, WORLD_H);
    // strata following the surface
    ctx.lineJoin = 'round';
    for (const [off, w, al] of [[34, 4, 0.35], [90, 6, 0.25], [170, 8, 0.18]]) {
      ctx.globalAlpha = al; ctx.strokeStyle = m.strata; ctx.lineWidth = w; surface(off); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // top layer (grass / sand / snow)
    ctx.strokeStyle = m.ground[0]; ctx.lineWidth = 12; surface(5); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    const glow = m.id === 'neon' || m.id === 'volcanic';
    if (glow) { ctx.shadowColor = m.edge; ctx.shadowBlur = 10; }
    ctx.strokeStyle = m.edge; ctx.lineWidth = glow ? 2.5 : 3; surface(1); ctx.stroke();
    ctx.shadowBlur = 0;
    if (!glow) { ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; surface(0); ctx.stroke(); }
    ctx.restore();
  }

  // camera: { x, y, zoom } world point at screen center
  worldTransform(cam, shake) {
    const s = this.scale * cam.zoom;
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    return { s, tx: this.ox + this.scale * WORLD_W / 2 - cam.x * s + sx * this.scale, ty: this.oy + this.scale * WORLD_H / 2 - cam.y * s + sy * this.scale };
  }

  clientToWorld(cx, cy, cam) {
    const rect = this.canvas.getBoundingClientRect();
    const T = this.worldTransform(cam, 0);
    return { x: (cx - rect.left - T.tx) / T.s, y: (cy - rect.top - T.ty) / T.s };
  }

  draw(scene, fx) {
    const ctx = this.ctx, dpr = this.dpr;
    const cam = scene.cam;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, this.cw, this.ch);
    const T = this.worldTransform(cam, fx.shake);
    // clip to the letterboxed world
    ctx.save();
    ctx.beginPath(); ctx.rect(this.ox, this.oy, WORLD_W * this.scale, WORLD_H * this.scale); ctx.clip();
    // parallax background
    if (this.bg) {
      const dx = cam.x - WORLD_W / 2, dy = cam.y - WORLD_H / 2;
      for (const [layer, k] of [[this.bg.sky, 0.05], [this.bg.far, 0.25], [this.bg.near, 0.5]]) {
        const z = 1 + (cam.zoom - 1) * k * 1.5;
        const s = this.scale * z;
        ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (this.ox + this.scale * WORLD_W / 2 - (WORLD_W / 2 + dx * k) * s), dpr * (this.oy + this.scale * WORLD_H / 2 - (WORLD_H / 2 + dy * k) * s));
        ctx.drawImage(layer, -100, -50);
      }
    }
    ctx.setTransform(dpr * T.s, 0, 0, dpr * T.s, dpr * T.tx, dpr * T.ty);
    const view = { l: -T.tx / T.s, t: -T.ty / T.s, r: (this.cw - T.tx) / T.s, b: (this.ch - T.ty) / T.s };
    this.drawAmbientBack(ctx, scene.time);
    ctx.drawImage(this.terrainCanvas, 0, 0, WORLD_W, WORLD_H);
    // tracers
    for (const tr of scene.tracers) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = tr.color;
      for (let i = 0; i < tr.pts.length; i += 2) {
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(scene.time * 3 + i * 0.2);
        ctx.beginPath(); ctx.arc(tr.pts[i], tr.pts[i + 1], 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    // mines
    for (const m of scene.mines) {
      ctx.fillStyle = '#2b2b30';
      ctx.beginPath(); ctx.arc(m.x, m.y - 3, 6, Math.PI, 0); ctx.fill();
      const blink = m.armed ? (Math.sin(scene.time * 8) > 0 ? '#ff3b3b' : '#5a1010') : '#888';
      ctx.fillStyle = blink;
      ctx.beginPath(); ctx.arc(m.x, m.y - 7, 2, 0, Math.PI * 2); ctx.fill();
      if (m.armed) { ctx.globalAlpha = 0.12; ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(m.x, m.y - 4, 14 + Math.sin(scene.time * 8) * 3, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    }
    fx.drawBack(ctx, view);
    for (const t of scene.tanks) drawTank(ctx, t, scene.time);
    if (scene.aim) this.drawAim(ctx, scene.aim);
    this.drawProjectiles(ctx, scene, view);
    fx.drawFront(ctx, view);
    this.drawAmbientFront(ctx, scene.time, scene.wind);
    // keep world text readable on small screens
    const k = Math.min(2.4, Math.max(1, 0.75 / (this.scale * cam.zoom)));
    for (const t of scene.tanks) {
      ctx.save();
      ctx.translate(t.x, t.y); ctx.scale(k, k); ctx.translate(-t.x, -t.y);
      this.drawTags(ctx, t, scene);
      ctx.restore();
    }
    fx.drawNumbers(ctx, k);
    ctx.restore();
    // off-screen arrows (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawOffscreen(ctx, scene, T);
    if (scene.sling) this.drawSling(ctx, scene.sling, scene.slingColor);
    if (fx.flash > 0) {
      ctx.globalAlpha = Math.min(0.85, fx.flash);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, this.cw, this.ch);
      ctx.globalAlpha = 1;
    }
  }

  // Slingshot in screen space: anchor, stretched band, shot arrow and power ring.
  drawSling(ctx, s, color) {
    const { ax, ay, px, py } = s;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ax, ay, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (s.cancel) {
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.arc(ax, ay, 18, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      return;
    }
    const k = s.power / 100;
    const band = `hsl(${120 - k * 120}, 90%, 55%)`;
    const nx = -(py - ay), ny = px - ax, nl = Math.hypot(nx, ny) || 1;
    ctx.strokeStyle = band;
    ctx.lineWidth = 6 - k * 3;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(ax + (nx / nl) * 9 * sgn, ay + (ny / nl) * 9 * sgn);
      ctx.lineTo(px, py);
      ctx.stroke();
    }
    const dx = ax - px, dy = ay - py, d = Math.hypot(dx, dy) || 1;
    const len = 30 + k * 60, ex = ax + (dx / d) * len, ey = ay + (dy / d) * len;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    const a = Math.atan2(dy, dx);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath();
    ctx.moveTo(ex + Math.cos(a) * 8, ey + Math.sin(a) * 8);
    ctx.lineTo(ex + Math.cos(a + 2.5) * 8, ey + Math.sin(a + 2.5) * 8);
    ctx.lineTo(ex + Math.cos(a - 2.5) * 8, ey + Math.sin(a - 2.5) * 8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = band; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(px, py, 19, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke();
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)';
    const label = `${Math.round(s.power)}%`;
    ctx.strokeText(label, px, py - 28);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, px, py - 28);
    ctx.restore();
  }

  drawAim(ctx, aim) {
    ctx.save();
    ctx.fillStyle = aim.color;
    const n = aim.pts.length;
    for (let i = 1; i < n; i++) {
      ctx.globalAlpha = 0.95 - (i / n) * 0.75;
      ctx.beginPath(); ctx.arc(aim.pts[i].x, aim.pts[i].y, 3.2 - (i / n) * 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  drawProjectiles(ctx, scene, view) {
    const hist = scene.history;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // fading trails from recent frames
    for (let h = 0; h < hist.length - 1; h++) {
      const p = hist[h];
      const a = (h + 1) / hist.length;
      for (let i = 0; i < p.length; i += 3) {
        const st = p[i];
        if (NO_TRAIL.has(st)) continue;
        ctx.globalAlpha = a * 0.6;
        const s = 4 + a * 8;
        ctx.drawImage(glowSprite(styleColor(st)), p[i + 1] - s / 2, p[i + 2] - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
    const cur = hist[hist.length - 1] || [];
    for (let i = 0; i < cur.length; i += 3) {
      const st = cur[i], x = cur[i + 1], y = cur[i + 2];
      if (x < view.l - 80 || x > view.r + 80 || y > view.b + 80) continue;
      this.drawProjectile(ctx, st, x, y, scene.time);
    }
    ctx.restore();
  }

  drawProjectile(ctx, st, x, y, time) {
    const c = styleColor(st);
    switch (st) {
      case 'napalm': case 'lava': {
        const s = 14 + Math.sin(time * 20 + x) * 4;
        ctx.drawImage(glowSprite(st === 'lava' ? '#ff4500' : '#ff7b00'), x - s / 2, y - s / 2 - 2, s, s);
        return;
      }
      case 'blackhole': {
        ctx.globalCompositeOperation = 'source-over';
        const g = ctx.createRadialGradient(x, y, 2, x, y, 46);
        g.addColorStop(0, '#000'); g.addColorStop(0.35, '#05010f'); g.addColorStop(0.55, 'rgba(108,92,231,.7)'); g.addColorStop(1, 'rgba(108,92,231,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 46, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#d6ccff'; ctx.lineWidth = 2;
        for (let k = 0; k < 3; k++) {
          ctx.globalAlpha = 0.6;
          ctx.beginPath(); ctx.arc(x, y, 18 + k * 7, time * (4 - k) + k * 2, time * (4 - k) + k * 2 + 2.2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'lighter';
        return;
      }
      case 'acid': {
        ctx.globalCompositeOperation = 'source-over';
        for (let k = 0; k < 7; k++) {
          ctx.fillStyle = k % 2 ? 'rgba(120,150,60,.85)' : 'rgba(160,190,80,.85)';
          ctx.beginPath(); ctx.arc(x - 48 + k * 16, y + Math.sin(time * 2 + k) * 4 - (k % 3) * 6, 18 + (k % 3) * 5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalCompositeOperation = 'lighter';
        return;
      }
      case 'acidDrop':
        ctx.strokeStyle = '#c6ff5c'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y); ctx.stroke();
        return;
      case 'jet': {
        ctx.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.translate(x, y);
        ctx.fillStyle = '#5d6d7e';
        ctx.beginPath(); ctx.moveTo(-34, -3); ctx.lineTo(28, -4); ctx.lineTo(38, 0); ctx.lineTo(28, 4); ctx.lineTo(-34, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#34495e';
        ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-20, 18); ctx.lineTo(-12, 18); ctx.lineTo(10, 0); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-28, 0); ctx.lineTo(-38, -12); ctx.lineTo(-32, -12); ctx.lineTo(-20, 0); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(glowSprite('#ff9f43'), x - 60, y - 10, 24, 20);
        return;
      }
      case 'portal': {
        ctx.strokeStyle = '#ff6348'; ctx.lineWidth = 4;
        for (let k = 0; k < 3; k++) {
          ctx.globalAlpha = 0.7;
          ctx.beginPath(); ctx.ellipse(x, y, 70 - k * 18, 16 - k * 4, 0, time * 3 + k, time * 3 + k + 4.5); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.drawImage(glowSprite('#ff6348'), x - 90, y - 30, 180, 60);
        return;
      }
      default: {
        const big = st === 'nuke' ? 30 : st === 'meteor' ? 26 : st === 'mega' ? 22 : 16;
        ctx.drawImage(glowSprite(c), x - big / 2, y - big / 2, big, big);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x, y, st === 'nuke' ? 5 : 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawTags(ctx, t, scene) {
    const y = t.y - 40;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)';
    const label = t.name + (t.bot ? ' · BOT' : '') + (t.offline ? ' · ⚠' : '');
    ctx.strokeText(label, t.x, y - (scene.survival ? 8 : 0));
    ctx.fillStyle = t.alive ? '#fff' : '#999';
    ctx.fillText(label, t.x, y - (scene.survival ? 8 : 0));
    if (scene.survival && t.alive) {
      const w = 40, k = Math.max(0, t.hp) / TANK_HP;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(t.x - w / 2 - 1, y - 3, w + 2, 6);
      ctx.fillStyle = k > 0.5 ? '#2ecc71' : k > 0.25 ? '#f1c40f' : '#e74c3c';
      ctx.fillRect(t.x - w / 2, y - 2, w * k, 4);
    }
    if (t.active) {
      const by = y - 26 + Math.sin(scene.time * 6) * 3;
      ctx.fillStyle = '#ffb703';
      ctx.beginPath(); ctx.moveTo(t.x - 7, by); ctx.lineTo(t.x + 7, by); ctx.lineTo(t.x, by + 8); ctx.closePath(); ctx.fill();
    }
    if (t.bubble) {
      const k = t.bubble.t;
      ctx.globalAlpha = k > 3 ? Math.max(0, 4 - k) : Math.min(1, k * 6);
      const isEmoji = t.bubble.emoji;
      ctx.font = isEmoji ? '26px system-ui, sans-serif' : '13px system-ui, sans-serif';
      const text = t.bubble.text;
      const w = Math.min(220, ctx.measureText(text).width + 18), h = isEmoji ? 38 : 26;
      const bx = t.x, by = y - (t.active ? 56 : 34) - h - Math.min(1, k * 4) * 6;
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      rr(ctx, bx - w / 2, by, w, h, 10); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx - 6, by + h); ctx.lineTo(bx + 6, by + h); ctx.lineTo(bx, by + h + 7); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx, by + h / 2 + 1, 210);
    }
    ctx.restore();
  }

  drawOffscreen(ctx, scene, T) {
    const cur = scene.history[scene.history.length - 1];
    if (!cur) return;
    const top = Math.max(this.oy, 0);
    for (let i = 0; i < cur.length; i += 3) {
      const sy = cur[i + 2] * T.s + T.ty;
      if (sy > top - 4) continue;
      const sx = Math.max(this.ox + 14, Math.min(this.ox + WORLD_W * this.scale - 14, cur[i + 1] * T.s + T.tx));
      const c = styleColor(cur[i]);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.moveTo(sx, top + 6); ctx.lineTo(sx - 8, top + 18); ctx.lineTo(sx + 8, top + 18); ctx.closePath(); ctx.fill();
      ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(`${Math.round((top - sy) / T.s)}`, sx, top + 30);
    }
  }

  drawAmbientBack(ctx, time) {
    const id = this.map.id;
    if (id === 'hills' || id === 'dunes') {
      ctx.fillStyle = id === 'hills' ? 'rgba(255,255,255,.85)' : 'rgba(255,230,200,.5)';
      for (const a of this.ambient) {
        const x = ((a.x + time * (8 + a.s * 14)) % (WORLD_W + 300)) - 150, y = 60 + a.y * 0.25;
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(x + k * 26, y + (k % 2) * 6, 34 - k * 3, 16, 0, 0, Math.PI * 2); ctx.fill(); }
      }
    } else if (id === 'moon' || id === 'neon') {
      ctx.fillStyle = '#fff';
      for (const a of this.ambient) {
        ctx.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(time * (0.5 + a.s) + a.p));
        ctx.fillRect(a.x, a.y * 0.45, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }
  }

  drawAmbientFront(ctx, time, wind = 0) {
    const id = this.map.id;
    if (id === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (const a of this.ambient) {
        const y = (a.y + time * (30 + a.s * 40)) % WORLD_H;
        const x = ((a.x + time * wind * 4 + Math.sin(time + a.p) * 10) % WORLD_W + WORLD_W) % WORLD_W;
        ctx.beginPath(); ctx.arc(x, y, 1 + a.s * 1.8, 0, Math.PI * 2); ctx.fill();
      }
    } else if (id === 'volcanic') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const a of this.ambient) {
        const y = WORLD_H - ((a.y + time * (20 + a.s * 40)) % WORLD_H);
        const x = a.x + Math.sin(time * 1.5 + a.p) * 14;
        ctx.globalAlpha = Math.min(1, y / 400) * 0.8;
        ctx.drawImage(glowSprite('#ff7a2a'), x - 4, y - 4, 8, 8);
      }
      ctx.restore();
    }
  }
}

const NO_TRAIL = new Set(['napalm', 'lava', 'blackhole', 'acid', 'jet', 'portal', 'acidDrop']);
const SPECIAL = {
  meteor: '#ff6348', bomb: '#cfd8dc', bomblet: '#ffa502', lava: '#ff4500', napalm: '#ff7b00', acidDrop: '#c6ff5c',
  spark0: '#ff4dd2', spark1: '#7efff5', spark2: '#fff200', spark3: '#2ed573', shell: '#ffd166',
};
const COLOR_CACHE = new Map();
export function styleColor(st) {
  let c = COLOR_CACHE.get(st);
  if (!c) {
    c = SPECIAL[st] || (WEAPON_IDS.includes(st) ? getWeapon(st).color : '#ffd166');
    COLOR_CACHE.set(st, c);
  }
  return c;
}
