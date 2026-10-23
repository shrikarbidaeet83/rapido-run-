// The 6 tracks. Each `points` entry is [x, y, cornerRadius] in world units.
// The track runs through the points in order and closes back to the first one.
// Radius 0 = no rounding (use it on straights). The first point is the
// start/finish line, so put it in the middle of a straight. The world is sized
// automatically around the track.

// One quiet, neutral look for every track: graph-paper background, light grey road.
const PLAIN = { ground: '#fbfbfb', grid: '#eef0f2', asphalt: '#e6e8eb', line: '#c3c7cc' };

export const MAPS = [
  {
    id: 'speed-ring', name: 'Speed Ring', difficulty: 'Easy', width: 120, theme: PLAIN,
    points: [
      [525, 126, 0], [916, 126, 170], [916, 559, 170],
      [695, 559, 85], [631, 495, 85], [555, 495, 85], [491, 559, 85],
      [134, 559, 170], [134, 126, 170],
    ],
  },
  {
    id: 'gp-classic', name: 'Grand Prix Classic', difficulty: 'Medium', width: 110, theme: PLAIN,
    points: [
      [500, 110, 0], [1080, 110, 75], [1080, 270, 75], [800, 270, 90],
      [920, 470, 110], [1080, 520, 90], [1080, 700, 80],
      [790, 700, 76], [670, 610, 76], [550, 700, 76], [430, 610, 76], [310, 700, 76],
      [110, 700, 110], [110, 110, 110],
    ],
  },
  {
    id: 'harbour-streets', name: 'Harbour Streets', difficulty: 'Hard', width: 100, theme: PLAIN,
    points: [
      [600, 100, 0], [1060, 100, 70], [1060, 290, 70], [890, 290, 70], [890, 480, 70],
      [1060, 480, 70], [1060, 700, 70], [240, 700, 70], [240, 530, 70], [470, 530, 75],
      [470, 370, 75], [100, 370, 70], [100, 100, 70],
    ],
  },
  {
    id: 'serpent-valley', name: 'Serpent Valley', difficulty: 'Medium', width: 110, theme: PLAIN,
    points: [
      [525, 610, 0], [109, 610, 120], [109, 355, 100],
      [279, 160, 90], [449, 355, 90], [619, 160, 90], [789, 355, 90],
      [959, 355, 100], [959, 610, 120],
    ],
  },
  {
    id: 'hairpin-mountain', name: 'Hairpin Mountain', difficulty: 'Hard', width: 95, theme: PLAIN,
    points: [
      [560, 560, 0], [1000, 560, 80], [1000, 100, 70], [860, 100, 65],
      [860, 360, 65], [720, 360, 65], [720, 100, 65], [580, 100, 65],
      [580, 360, 65], [440, 360, 65], [440, 100, 65], [300, 100, 65],
      [300, 360, 65], [110, 360, 70], [110, 560, 70],
    ],
  },
  {
    id: 'desert-loop', name: 'Desert Loop', difficulty: 'Easy', width: 120, theme: PLAIN,
    points: [
      [491, 109, 0], [831, 109, 160], [874, 398, 130], [780, 559, 130],
      [143, 559, 170], [109, 109, 170],
    ],
  },
];

export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}
