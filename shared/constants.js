// All tunable numbers live here. Shared by server and client.

export const TICK_RATE = 60;                 // physics updates per second
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 20;             // state broadcasts per second
export const SNAPSHOT_EVERY = TICK_RATE / SNAPSHOT_RATE;

// Car body (world units). Same proportions as car.js.org.
export const CAR_WIDTH = 8;
export const CAR_LENGTH = 16;
export const ROOF_WIDTH = 8;
export const ROOF_LENGTH = 6;
export const CAR_RADIUS = Math.hypot(CAR_WIDTH / 2, CAR_LENGTH / 2); // half diagonal ≈ 8.94

// Car physics (car.js.org model). Velocities are in world units per tick.
export const PHYSICS = {
  maxPower: 0.09,
  maxReverse: 0.0375,
  powerFactor: 0.0012,
  reverseFactor: 0.0005,
  drag: 0.95,
  angularDrag: 0.95,
  turnSpeed: 0.002,
};

// Track surfaces
export const KERB_WIDTH = 10;
export const KERB_DRAG = 0.985;              // extra velocity multiplier per tick on a kerb
export const KERB_POWER_CAP = 0.8;           // fraction of maxPower allowed on a kerb
export const SAMPLE_SPACING = 4;             // centerline sample spacing (world units)
export const NEAREST_WINDOW = 40;            // ± samples searched around the last known index

// Walls
export const WALL_RESTITUTION = 0.3;
export const WALL_FRICTION = 0.8;            // tangential multiplier on a full-strength impact
export const WALL_SPIN = 0.004;
export const WALL_ITERATIONS = 3;

// Car vs car
export const CAR_RESTITUTION = 0.4;
export const CAR_FRICTION = 0.1;
export const CAR_SPIN = 0.012;
export const BROAD_PHASE_DIST = 30;

// Race rules
export const LAPS = 10;
export const CHECKPOINTS = 16;
export const COUNTDOWN_MS = 3000;
export const FINISH_GRACE_MS = 30000;        // others get this long after the winner finishes
export const WRONG_WAY_ANGLE = (120 * Math.PI) / 180;
export const WRONG_WAY_MS = 1000;
export const RESPAWN_GHOST_MS = 1500;
export const RESPAWN_COOLDOWN_MS = 3000;
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4];

// Rooms & networking
export const MAX_PLAYERS = 8;
export const NAME_MAX = 12;
export const ROOM_CODE_LEN = 4;
export const RECONNECT_GRACE_MS = 15000;
export const INPUT_HEARTBEAT_MS = 100;
export const INTERP_DELAY_MS = 100;
export const SNAP_DISTANCE = 30;             // reconcile error above this snaps instead of blends
export const RATE_LIMIT_PER_SEC = 60;        // socket messages per second per client
export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 1600;

export const CAR_COLORS = [
  '#e53935', '#1e88e5', '#43a047', '#fdd835',
  '#8e24aa', '#fb8c00', '#00acc1', '#ec407a',
];

// Camera / rendering
export const ZOOM_DEFAULT = 2.5;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const MAX_PARTICLES = 300;
export const MAX_SKIDS = 400;
