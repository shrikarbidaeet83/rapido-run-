// 6 map themes: palette, special rule and terrain generator.

import { WORLD_W, SPAWN_MIN_GAP } from './constants.js';
import { mulberry32 } from './rng.js';
import { createTerrain, sanitize, quantize, carveCircle } from './terrain.js';

export const MAPS = [
  {
    id: 'hills', name: 'Green Hills', rule: 'Normal', gravity: 1, windMult: 1, moveMult: 1,
    sky: ['#5fb4f0', '#a9dcff', '#e3f4ff'], ground: ['#6aa84f', '#5b3d22', '#3b2614'], edge: '#8fe060', strata: '#4a3019',
  },
  {
    id: 'dunes', name: 'Desert Dunes', rule: 'Normal', gravity: 1, windMult: 1, moveMult: 1,
    sky: ['#3b1f5c', '#e0663a', '#ffc26b'], ground: ['#e2b25c', '#c48a3f', '#8d5a26'], edge: '#ffe3a1', strata: '#a87134',
  },
  {
    id: 'snow', name: 'Snow Peaks', rule: 'Slippery: moves go 1.5× farther', gravity: 1, windMult: 1, moveMult: 1.5,
    sky: ['#9fb8d6', '#d6e4f2', '#f4f8fc'], ground: ['#dfe9f3', '#7d8ea3', '#4b5868'], edge: '#ffffff', strata: '#a8c4e0',
  },
  {
    id: 'volcanic', name: 'Volcanic', rule: 'Normal (ember hazard off)', gravity: 1, windMult: 1, moveMult: 1,
    sky: ['#1a0505', '#5c1208', '#b8340f'], ground: ['#3a2a28', '#2a1c1a', '#140c0b'], edge: '#ff7a2a', strata: '#ff4d1a',
  },
  {
    id: 'moon', name: 'Moon Base', rule: 'Low gravity (0.4×)', gravity: 0.4, windMult: 1, moveMult: 1,
    sky: ['#000004', '#05060f', '#0d1020'], ground: ['#a7a9ad', '#6e7075', '#3c3e42'], edge: '#d9dadc', strata: '#55575c',
  },
  {
    id: 'neon', name: 'Neon City', rule: 'Normal, glow-heavy', gravity: 1, windMult: 1, moveMult: 1,
    sky: ['#05010f', '#1a0638', '#3d0a5c'], ground: ['#1b1036', '#120a26', '#080414'], edge: '#00f0ff', strata: '#ff2bd6',
  },
];

export const MAP_IDS = MAPS.map((m) => m.id);
export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}

// The ground sits this much higher than the generators' base shapes (more room above the HUD).
const GROUND_LIFT = 70;

// Spawn x for n tanks, spread across the map, at least SPAWN_MIN_GAP apart.
export function spawnPoints(n, rng) {
  const margin = 140;
  if (n <= 1) return [WORLD_W / 2];
  const gap = (WORLD_W - margin * 2) / (n - 1);
  const jitter = Math.max(0, Math.min(60, (gap - SPAWN_MIN_GAP) / 2 - 1));
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(Math.round(margin + i * gap + rng.range(-jitter, jitter)));
  return xs;
}

function sines(rng, waves) {
  const parts = waves.map(([len, amp]) => ({ k: (Math.PI * 2) / (len * rng.range(0.8, 1.25)), amp: amp * rng.range(0.7, 1.1), ph: rng.range(0, Math.PI * 2) }));
  return (x) => parts.reduce((s, p) => s + Math.sin(x * p.k + p.ph) * p.amp, 0);
}

// Midpoint displacement for jagged ridges, values in about [-1, 1].
function midpoint(rng, rough) {
  const n = 2048, h = new Float32Array(n + 1);
  h[0] = rng.range(-0.5, 0.5); h[n] = rng.range(-0.5, 0.5);
  for (let step = n, amp = 1; step > 1; step >>= 1, amp *= rough) {
    for (let i = 0; i < n; i += step) {
      h[i + step / 2] = (h[i] + h[i + step]) / 2 + rng.range(-amp, amp);
    }
  }
  return (x) => h[Math.min(n, Math.max(0, Math.round((x / WORLD_W) * n)))];
}

const GENERATORS = {
  hills(rng) {
    const f = sines(rng, [[1400, 110], [600, 60], [260, 22], [110, 6]]);
    return (x) => 600 + f(x);
  },
  dunes(rng) {
    const f = sines(rng, [[900, 70], [400, 45]]);
    const k = (Math.PI * 2) / rng.range(320, 420), ph = rng.range(0, 6);
    return (x) => 620 + f(x) - Math.pow(Math.abs(Math.sin(x * k + ph)), 1.6) * 70;
  },
  snow(rng) {
    const m = midpoint(rng, 0.55);
    const f = sines(rng, [[1600, 80]]);
    return (x) => 560 + m(x) * 210 + f(x);
  },
  volcanic(rng) {
    const f = sines(rng, [[1100, 90], [450, 50]]);
    const m = midpoint(rng, 0.5);
    const cone = rng.range(500, 1100);
    return (x) => 640 + f(x) + m(x) * 50 - Math.max(0, 220 - Math.abs(x - cone) * 0.9);
  },
  moon(rng) {
    const f = sines(rng, [[1300, 70], [500, 35], [180, 8]]);
    return (x) => 610 + f(x);
  },
  neon(rng) {
    // stepped terraces with soft edges
    const levels = [];
    for (let x = 0; x < WORLD_W; x += rng.int(140, 260)) levels.push({ x, y: rng.range(470, 720) });
    const f = sines(rng, [[300, 6]]);
    return (x) => {
      let i = 0;
      while (i + 1 < levels.length && levels[i + 1].x <= x) i++;
      const a = levels[i], b = levels[i + 1];
      if (!b) return a.y + f(x);
      const t = Math.min(1, Math.max(0, (x - (b.x - 30)) / 30));
      return a.y + (b.y - a.y) * t * t * (3 - 2 * t) + f(x);
    };
  },
};

// Seeded terrain + spawn pads. Generated on the server and sent to clients as data,
// so floating-point differences between JS engines can never matter.
export function generateTerrain(mapId, seed, nTanks) {
  const map = getMap(mapId);
  const rng = mulberry32(seed);
  const shape = GENERATORS[map.id](rng);
  const t = createTerrain();
  for (let x = 0; x < WORLD_W; x++) t[x] = Math.min(820 - GROUND_LIFT, Math.max(220, shape(x) - GROUND_LIFT));
  if (map.id === 'moon') {
    const craters = rng.int(4, 7);
    for (let i = 0; i < craters; i++) {
      const cx = rng.range(60, WORLD_W - 60), r = rng.range(40, 90);
      carveCircle(t, cx, t[Math.round(cx)] - r * 0.55, r);
    }
  }
  const spawns = spawnPoints(nTanks, rng);
  for (const sx of spawns) flatten(t, sx);
  sanitize(t);
  quantize(t);
  return { terrain: t, spawns };
}

function flatten(t, sx) {
  const pad = 24, blend = 30;
  let y = 0;
  for (let x = sx - pad; x <= sx + pad; x++) y += t[Math.round(x)];
  y = Math.min(800 - GROUND_LIFT, y / (pad * 2 + 1));
  for (let x = sx - pad - blend; x <= sx + pad + blend; x++) {
    if (x < 0 || x >= WORLD_W) continue;
    const d = Math.abs(x - sx);
    const w = d <= pad ? 1 : 1 - (d - pad) / blend;
    t[x] = t[x] * (1 - w) + y * w;
  }
}
