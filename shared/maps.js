// The 6 tracks. Each `points` entry is [x, y, cornerRadius] in world units
// (world ≈ 2400 x 1600). The track runs through the points in order and closes
// back to the first one. Radius 0 = no rounding (use it on straights). The first
// point is the start/finish line, so put it in the middle of a straight.

const THEMES = {
  grass:  { ground: '#7cb860', ground2: '#72ad57', asphalt: '#6b6e73', wall: '#3d3f43', line: '#f4f4f4' },
  city:   { ground: '#a9adb3', ground2: '#9fa3a9', asphalt: '#5c5f64', wall: '#2f3135', line: '#f4f4f4' },
  forest: { ground: '#5f9a4c', ground2: '#578f45', asphalt: '#66696e', wall: '#383a3e', line: '#f4f4f4' },
  rock:   { ground: '#a39283', ground2: '#9a8879', asphalt: '#62656a', wall: '#3a3631', line: '#f4f4f4' },
  sand:   { ground: '#e3c98f', ground2: '#dbbf83', asphalt: '#707378', wall: '#7a5c34', line: '#f4f4f4' },
};

export const MAPS = [
  {
    id: 'speed-ring', name: 'Speed Ring', difficulty: 'Easy', width: 90, theme: THEMES.grass,
    points: [
      [1200, 300, 0], [2050, 300, 300], [2050, 1300, 300],
      [1520, 1300, 80], [1420, 1210, 80], [1300, 1210, 80], [1200, 1300, 80],
      [350, 1300, 300], [350, 300, 300],
    ],
  },
  {
    id: 'gp-classic', name: 'Grand Prix Classic', difficulty: 'Medium', width: 80, theme: THEMES.grass,
    points: [
      [1000, 220, 0], [2200, 220, 85], [2200, 400, 85], [1750, 400, 160],
      [1650, 760, 200], [2180, 980, 200], [2180, 1400, 160],
      [1550, 1400, 120], [1330, 1180, 120], [1100, 1400, 120], [870, 1180, 120], [640, 1400, 120],
      [220, 1400, 180], [220, 220, 180],
    ],
  },
  {
    id: 'harbour-streets', name: 'Harbour Streets', difficulty: 'Hard', width: 70, theme: THEMES.city,
    points: [
      [1200, 220, 0], [2150, 220, 60], [2150, 1360, 60], [1560, 1360, 60], [1560, 1080, 60],
      [1220, 1080, 60], [1220, 1360, 60], [460, 1360, 60], [460, 980, 60], [860, 980, 75],
      [860, 810, 75], [220, 810, 60], [220, 220, 60],
    ],
  },
  {
    id: 'serpent-valley', name: 'Serpent Valley', difficulty: 'Medium', width: 80, theme: THEMES.forest,
    points: [
      [1200, 1420, 0], [200, 1420, 200], [200, 820, 180],
      [520, 380, 170], [860, 860, 170], [1200, 380, 170], [1540, 860, 170], [1880, 380, 170],
      [2200, 760, 200], [2200, 1420, 200],
    ],
  },
  {
    id: 'hairpin-mountain', name: 'Hairpin Mountain', difficulty: 'Hard', width: 75, theme: THEMES.rock,
    points: [
      [1900, 800, 0], [1900, 300, 90],
      [700, 300, 62], [700, 500, 62], [1300, 500, 62], [1300, 700, 62],
      [700, 700, 62], [700, 900, 62], [1300, 900, 62], [1300, 1100, 62],
      [450, 1100, 80], [450, 1330, 80], [1900, 1330, 90],
    ],
  },
  {
    id: 'desert-loop', name: 'Desert Loop', difficulty: 'Easy', width: 90, theme: THEMES.sand,
    points: [
      [1200, 220, 0], [2120, 220, 260], [2240, 1020, 200], [2000, 1420, 200],
      [280, 1420, 280], [200, 220, 280],
    ],
  },
];

export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}
