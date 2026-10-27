// Shared fixtures for the Shell Shock Arena tests.
import { createTerrain } from '../../shared/tanks/terrain.js';
import { makeTank } from '../../shared/tanks/simulate.js';
import { generateTerrain } from '../../shared/tanks/maps.js';

// Flat ground at y=600 with tanks at the given x positions (one team each unless teams given).
export function flatState(xs, { mode = 'classic', teams = null, friendlyFire = true, wind = 0, map = 'hills', walls = 'none' } = {}) {
  const terrain = createTerrain(600);
  return {
    map, terrain, wind, mode, friendlyFire, walls, mines: [], nextMine: 1,
    tanks: xs.map((x, i) => makeTank({ id: `t${i}`, team: teams ? teams[i] : i, x, terrain })),
  };
}

export function mapState(mapId, seed, n = 3, opts = {}) {
  const { terrain, spawns } = generateTerrain(mapId, seed, n);
  return {
    map: mapId, terrain, wind: opts.wind ?? 0, mode: opts.mode || 'classic', friendlyFire: true, walls: opts.walls || 'none', mines: [], nextMine: 1,
    tanks: spawns.map((x, i) => makeTank({ id: `t${i}`, team: i, x, terrain })),
  };
}

export const PLAYERS = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: '#fff', style: 'classic', team: i % 2 }));
