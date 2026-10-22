// Headless race: `node scripts/simulate.js [mapId] [laps]` (no sockets, as fast as possible).
import { Room, getTrack } from '../server/room.js';
import { MAPS } from '../shared/maps.js';
import { isOutside } from '../shared/physics.js';

export function simulateRace(mapId, { seed = 1, check = true, maxTicks = 200000 } = {}) {
  const room = new Room('TEST', { seed });
  room.mapId = mapId;
  room.fillBots = true;
  room.startRace(undefined, { realtime: false });
  const track = getTrack(mapId);
  const stats = { outside: 0, nan: 0, respawns: 0, ticks: 0 };
  const respawnSeen = new Map();
  while (room.phase === 'race' && stats.ticks < maxTicks) {
    room.step();
    stats.ticks++;
    if (!room.race || room.race.ended) break;
    for (const c of room.race.cars) {
      const s = c.state;
      if (![s.x, s.y, s.angle, s.xVelocity, s.yVelocity].every(Number.isFinite)) stats.nan++;
      if (check && isOutside(s, track, 0.5, s.seg)) stats.outside++;
      if (c.respawnAt !== (respawnSeen.get(c) ?? 0)) { stats.respawns++; respawnSeen.set(c, c.respawnAt); }
    }
  }
  return { room, results: room.results, stats };
}

if (process.argv[1] && process.argv[1].endsWith('simulate.js')) {
  const ids = process.argv[2] ? [process.argv[2]] : MAPS.map((m) => m.id);
  for (const id of ids) {
    const t0 = Date.now();
    const { results, stats } = simulateRace(id);
    const fmt = (ms) => ms == null ? '-' : (ms / 1000).toFixed(1) + 's';
    console.log(`\n${id}: ${stats.ticks} ticks, ${Date.now() - t0}ms wall, outside=${stats.outside} nan=${stats.nan} respawns=${stats.respawns}`);
    for (const r of results?.rows || []) console.log(`  P${r.pos} ${r.name.padEnd(12)} ${r.status.padEnd(8)} total ${fmt(r.totalMs)} best ${fmt(r.bestLapMs)} laps ${r.laps}`);
  }
}
