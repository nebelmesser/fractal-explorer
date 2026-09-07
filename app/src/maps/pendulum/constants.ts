// Coordinate domain.
export const PENDULUM_VIEW_HALF = Math.PI;
export const PENDULUM_TILE_HALF = Math.PI * 2;

// Physics defaults. Keep these synchronized with crates/map_core/src/constants.rs.
export const PENDULUM_L1 = 1;
export const PENDULUM_L2 = 1;
export const PENDULUM_M1 = 1;
export const PENDULUM_M2 = 1;
export const PENDULUM_G = 9.81;
export const PENDULUM_DT = 0.2;
export const PENDULUM_FRICTION = 0;
export const PENDULUM_MIN_ITER = 1000;
export const PENDULUM_MAX_ITER = 8000;

// On-map pendulum presentation.
export const PROBE_SEP_PX = 168;
export const PROBE_CELL_PX = 96;
export const PROBE_CELL_MIN_PX = 44;
export const PROBE_GRID_MAX = 720;
export const PROBE_LEVEL_DEFAULT = 1;
export const PROBE_AUTOSTART_MS = 2000;
export const PROBE_SCALE_BAND_X = 52;
export const PROBE_SCALE_BAND_Y = 48;
export const PROBE_PX_PER_LEN = 38;
export const PROBE_CROSS_PX = 7;
export const PROBE_PIVOT_R = 2;
export const PROBE_LARGE_BOB_R = 8;
export const PROBE_GRID_BOB_R = 4;
export const PROBE_GRID_ROD_PX = 2;
export const PROBE_OUTLINE_PX = 1;
export const PROBE_SIGHT_ALPHA = 0.42;
export const PROBE_SIGHT_FLY_ALPHA = 0.14;
export const PROBE_SNAP_DEG = 720;
export const PROBE_FLY_TIME = 0.55;
export const PROBE_ALPHA = 0.5;
export const PROBE_PLAY_FPS = 24;
export const PROBE_MAX_STEPS = 40000;

