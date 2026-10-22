// Prints validation results for every map: `node scripts/validate-maps.js`
import { MAPS } from '../shared/maps.js';
import { buildTrack, validateTrack } from '../shared/track.js';

let bad = 0;
for (const map of MAPS) {
  const track = buildTrack(map);
  const errors = validateTrack(track);
  if (errors.length) bad++;
  console.log(`${map.name.padEnd(20)} length ${track.length.toFixed(0).padStart(5)}  samples ${track.n}  ${errors.length ? 'FAIL: ' + errors.join('; ') : 'ok'}`);
}
process.exit(bad ? 1 : 0);
