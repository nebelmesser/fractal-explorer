// Display vs compute. The map fills the window; the short side is the 2π default.
export const MAP_FLOAT_BITS = 32; // map + postprocess stay f32 on the GPU
export const MAP_DISPLAY_MIN_PX = 160; // floor so a tiny window still has a panel
export const MIN_COMPUTE_PX = 64; // refuse a grainier map than this
export const MAX_COMPUTE_PX = 2048; // longest visible compute side
export const MAX_OVERSCAN_PX = 4096; // halo pass; half a screen on every side at the same density
export const TARGET_FRAME_MS = 1000; // budget for one settled map pass; user can change
export const TARGET_FRAME_MS_MIN = 200;
export const TARGET_FRAME_MS_MAX = 4000;
export const BUDGET_BLEND = 0.7; // first frames jump harder toward the time budget
export const LIVE_ZOOM_MS = 90; // live-recompute while zooming if the last pass was faster
export const SMOOTH_ZOOM_MS = 840; // click / +/− zoom; 3× the original 280 ms, ease-in-out

// Navigation. Click, +, and − share the same step (2× in / 2× out).
export const CLICK_ZOOM_FACTOR = 0.5; // new span = old span × this; matches −
export const BUTTON_ZOOM_FACTOR = 0.5; // + / − beside the overview; two clicks = 4×
export const WHEEL_ZOOM = 0.0015; // per wheel-delta scale of ln(span)
export const PINCH_ZOOM = 1; // pinch ratio maps 1:1 onto span
export const VIEW_DEBOUNCE_MS = 140; // after a zoom gesture, recompute at the budgeted size
export const MIN_VIEW_SPAN = 1e-5; // radians; stop zooming before float32 collapses
export const OVERSCAN_PAD = 0.5; // half a screen on each side (N,S,E,W and the four corners)
export const OVERSCAN_RELOAD = 0.2; // prefetch a new halo when remaining pad falls below this

// Post-process. Median kills single-pixel fireflies after log-normalization.
export const MEDIAN_DEFAULT = 3; // scipy-style window (3 → 3×3)
export const MEDIAN_MAX = 5; // shader sorts n² samples; keep n small
export const INVERT_DEFAULT = false;

// Default map view: full angle square, same as the pendulum kernel.
export const VIEW_HALF = Math.PI; // ±π radians on both axes

// Pendulum physics defaults. Must stay in sync with crates/map_core/src/constants.rs.
export const PENDULUM_L1 = 1;
export const PENDULUM_L2 = 1;
export const PENDULUM_M1 = 1;
export const PENDULUM_M2 = 1;
export const PENDULUM_G = 9.81;
export const PENDULUM_DT = 0.2; // coarse step used by the escape-time map
export const PENDULUM_MAX_ITER = 3000;
export const PENDULUM_SINGULAR = 1e-9; // treat a vanishing denominator as α = 0

// Overview + preview chrome. These are UI tiles, not the main map.
export const OVERVIEW_PX = 160; // CSS and GPU side of the overview map
export const PREVIEW_PX = 160; // pendulum sketch under the overview
export const PREVIEW_SPEED = 1; // one kernel Euler step per frame; brightness is the running step count
export const PREVIEW_IDLE_MS = 1000; // hover/tap stillness before the preview integrates
export const SCALE_BAR_TARGET_PX = 80; // Google-maps-like bar aims at this length
export const SCALE_BAR_MIN_PX = 48;
export const SCALE_BAR_MAX_PX = 120;

// Menu / prefs.
export const PREFS_KEY = 'fractal-explorer';
export const PREFS_WRITE_MS = 250;
export const COMPACT_QUERY = '(max-width: 900px), (max-height: 520px)';
