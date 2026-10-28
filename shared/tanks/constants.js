// Shell Shock Arena: every tunable number. Shared by server and client.

export const WORLD_W = 1600;
export const WORLD_H = 900;
export const GROUND_MIN = 60;          // terrain surface can never rise above this y
export const GROUND_MAX = WORLD_H - 6; // bedrock: terrain surface can never sink below this y

export const STEP_RATE = 120;          // projectile physics steps per second
export const DT = 1 / STEP_RATE;
export const SUBSTEP_PX = 4;           // max distance a projectile moves per collision check
// Game speed: shells fly SPEED× faster; gravity scales by SPEED² so every arc (and aim) stays the same.
export const SPEED = 1.35;
export const GRAVITY = 300 * SPEED * SPEED; // px/s²
export const POWER_K = 7 * SPEED;          // launch speed (px/s) per power point
export const WIND_FACTOR = 6;          // px/s² per wind point (the game has no wind: state.wind is always 0)

// safety limits per shot
export const MAX_PROJECTILES = 400;
export const MAX_SIM_SECONDS = 20;
export const MAX_STEPS = MAX_SIM_SECONDS * STEP_RATE;
export const MAX_EXPLOSIONS = 60;
export const SHELL_MAX_SECONDS = 12;  // a shell still flying after this fizzles out
export const MAX_WALL_HITS = 4;        // wrap/bounce walls: a shell can use them this many times

// tanks
export const TANK_W = 36;
export const TANK_H = 18;
export const TURRET_LEN = 22;
export const TURRET_PIVOT = 14;        // turret pivot height above the ground
export const TANK_MAX_TILT = 0.6;      // radians
export const TANK_HP = 100;
export const FALL_DMG_PER_PX = 0.2;
export const FALL_DMG_MAX = 20;
export const FALL_MIN_PX = 3;          // smaller drops are just settling
export const SELF_SAFE_SECONDS = 0.15; // a shell can't hit its own tank right after leaving the barrel
export const DIRECT_HIT_BONUS = 0.25;

// moves
export const MOVE_DISTANCE = 60;
export const MOVE_MAX_SLOPE = Math.tan(60 * Math.PI / 180);
export const MOVE_SPEED = 150;         // px/s, tank driving animation
export const TANK_MIN_GAP = 30;        // tanks can't drive into each other
export const EDGE_MARGIN = 20;         // tank center keeps this far from the map edges

// statuses
export const SHIELD_HP = 40;
export const SHIELD_TURNS = 2;         // enemy turns a shield lasts
export const FROZEN_POWER_CAP = 80;
export const MINE_RADIUS = 45;
export const MINE_DAMAGE = 40;
export const MINE_TRIGGER = 60;

// match setup
export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;
export const WEAPON_COUNTS = [5, 10, 15, 30, 40, 50, 100];   // rounds (shots per player)
export const TURN_TIMES = [20, 30, 45, 0];     // seconds, 0 = off
export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'classic',          // 'classic' | 'survival'
  map: 'random',
  weapons: 10,              // rounds: shots per player
  pace: 'turns',            // 'turns' | 'free' (Free Fire: everyone shoots whenever reloaded)
  arsenal: 'draft',         // 'draft' | 'unlimited' (every weapon, every round; legendaries once)
  turnTime: 30,
  friendlyFire: true,
  walls: 'none',            // 'none' | 'wrap' | 'bounce'
  teams: false,             // 2v2 when 4 players
  public: false,
});
export const DRAFT_PICK_SECONDS = 15;
export const HIT_POINT_LOSS = 0.25;       // a tank that's hit loses this share of the points scored on it (never below 0)
export const FREE_RELOAD_MS = 2000;        // Free Fire: time between your shots
export const FREE_SECONDS_PER_ROUND = 8;   // Free Fire match clock = rounds × this
export const FREE_MIN_SECONDS = 90;
export const POOL_EXTRA = 5;               // pool size = weapons × players + 5
export const SPAWN_MIN_GAP = 300;

// network / server
export const ROOM_CODE_LEN = 5;
export const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_ROOMS = 500;
export const NAME_MAX = 12;
export const CHAT_MAX = 120;
export const CHAT_PER_10S = 6;
export const RATE_LIMIT_PER_SEC = 30;
export const RECONNECT_SECONDS = 60;
export const EMPTY_ROOM_MINUTES = 5;
export const BOT_THINK_MS = [500, 1100];
export const SHOT_END_PAUSE_MS = 400;      // pause after the animation before the next turn
export const EMOJIS = ['😂', '🔥', '💀', '👏', 'GG'];

export const TANK_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ecf0f1'];
export const TANK_STYLES = ['classic', 'heavy', 'scout', 'dome', 'twin', 'hover'];
