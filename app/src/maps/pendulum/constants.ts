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
/** WASM workers for f64 tiles; leave one core for the UI thread. */
export const PENDULUM_CPU_WORKERS = 16;

// On-map pendulum presentation.
export const PROBE_SEP_PX = 168;
export const PROBE_CELL_PX = 96;
export const PROBE_CELL_MIN_PX = 44;
/** Start-button grid cell in CSS pixels. Smaller is denser. Midway in the old slider's 96…44 range.
 *  At the f64 floor before samples separate, overlay probes sit on sample centers
 *  with a stride that keeps this CSS spacing. Once the pixels fly apart, every
 *  visible sample gets a pendulum. */
export const START_GRID_CELL_PX = 70;
/** Minimum CSS pitch between probes after map samples fly apart.
 * The renderer rounds this to an integer sample stride, so every pivot remains
 * exactly on a rendered pixel center. */
export const SPARSE_GRID_CELL_PX = 48;
/** Neighbor angle (rad) for the slowest one-by-one reveal. */
export const START_REVEAL_SLOW_RAD = (12 * Math.PI) / 180;
/** Below this neighbor angle, reveal whole rows. */
export const START_REVEAL_ROW_RAD = (2.5 * Math.PI) / 180;
/** Fastest neighbor angle (row sweep). */
export const START_REVEAL_FAST_RAD = (0.35 * Math.PI) / 180;
export const START_REVEAL_SLOW_ITEM_MS = 40;
export const START_REVEAL_FAST_ITEM_MS = 16;
export const START_REVEAL_SLOW_ROW_MS = 40;
export const START_REVEAL_FAST_ROW_MS = 16;
/** Pause after the last start pose appears, before physics. */
export const START_REVEAL_PAUSE_MS = 500;
/** Emit pendulum-hang after this many ms with fewer than half still on the pivot and no new detach. */
export const PENDULUM_HANG_MS = 5000;
export const PROBE_GRID_MAX = 720;
/** WASM constructors per intro frame so Start is not blocked on the kernel. */
export const PROBE_KERNEL_CHUNK = 512;
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

// "HIC SUNT DRACONES" sits in the black precision void behind sparse samples.
export const DRAGON_FONT_START_PX = 28;
export const DRAGON_OPACITY = 0.2;
export const DRAGON_TILE_X_PX = 340;
export const DRAGON_TILE_Y_PX = 230;
export const DRAGON_PARALLAX = 0.14;
export const DRAGON_SCALE_START_PX = 4;
/** Slow perspective growth per doubling of the distance between map samples. */
export const DRAGON_SCALE_PER_OCTAVE = 0.16;
