// Display vs compute. The map fills the window; the short side is the 2π default.
export const MAP_FLOAT_BITS = 32; // map + postprocess stay f32 on the GPU
export const MAP_DISPLAY_MIN_PX = 160; // floor so a tiny window still has a panel
export const MIN_COMPUTE_PX = 64; // refuse a grainier map than this
export const MAX_COMPUTE_PX = 4096; // longest visible compute side when the budget allows
export const MAX_OVERSCAN_PX = 4096; // halo long side; keep storage textures within common GPU limits
export const TARGET_FRAME_MS = 1000; // budget for one settled map pass; user can change
export const TARGET_FRAME_MS_MIN = 200;
export const TARGET_FRAME_MS_MAX = 4000;
export const BUDGET_BLEND = 0.7; // first frames jump harder toward the time budget
export const DISPLAY_DPR_CAP = 2; // compute denser than CSS up to this device-pixel ratio
export const LIVE_ZOOM_MS = 90; // live-recompute while zooming if the last pass was faster
export const SMOOTH_ZOOM_MS = 840; // click / +/− zoom; 3× the original 280 ms, ease-in-out

// Navigation. Click, +, and − share the same step (2× in / 2× out).
export const CLICK_ZOOM_FACTOR = 0.5; // new span = old span × this; matches −
export const BUTTON_ZOOM_FACTOR = 0.5; // + / − beside the overview; two clicks = 4×
export const WHEEL_ZOOM = 0.004; // per wheel-delta scale of ln(span); two-finger trackpad scroll
export const WHEEL_ZOOM_PINCH = 0.01; // Mac/Chrome trackpad pinch arrives as ctrl+wheel
export const PINCH_ZOOM = 1; // pinch ratio maps 1:1 onto span
export const COAST_FRICTION = 3.2; // 1/s; flick speed halves in ~200 ms
export const COAST_VEL_TAU = 0.05; // seconds; smooth the release velocity
export const COAST_STALE_MS = 64; // ignore a flick if the finger already stopped
export const COAST_MIN_PX = 48; // stop when |pan| falls below this (px/s)
export const COAST_MIN_ZOOM = 0.06; // stop when |d ln span / s| falls below this
export const VIEW_DEBOUNCE_MS = 40; // batch wheel ticks before a new compute
export const PARAM_LIVE_MS = 100; // if a param pass is slower, drop resolution while the slider moves
export const MIN_VIEW_SPAN = 1e-5; // radians; stop zooming before float32 collapses
export const OVERSCAN_PAD = 1.05; // extra screens on each side for the halo pass
export const OVERSCAN_RELOAD = 0.6; // prefetch a new halo while this much pad remains

// Post-process. Median kills single-pixel fireflies after log-normalization.
export const MEDIAN_DEFAULT = 3; // scipy-style window (3 → 3×3)
export const MEDIAN_MAX = 5; // shader sorts n² samples; keep n small
export const INVERT_DEFAULT = false;

// Default map view: 2π on the short side. Unique compute strip on θ₂ is ±2π.
export const VIEW_HALF = Math.PI; // ±180° default framing on the short side
export const TILE_HALF = Math.PI * 2; // ±360°: Y wraps; X can be centered here

// Pendulum physics defaults. Must stay in sync with crates/map_core/src/constants.rs.
export const PENDULUM_L1 = 1;
export const PENDULUM_L2 = 1;
export const PENDULUM_M1 = 1;
export const PENDULUM_M2 = 1;
export const PENDULUM_G = 9.81;
export const PENDULUM_DT = 0.2; // coarse step used by the escape-time map
export const PENDULUM_FRICTION = 0; // linear drag on ω; 0 = conservative
export const PENDULUM_MIN_ITER = 1000; // floor the budget will not go below
export const PENDULUM_MAX_ITER = 8000; // cap when the frame budget has room
export const PENDULUM_SINGULAR = 1e-9; // treat a vanishing denominator as α = 0

// Overview + on-map probes.
export const OVERVIEW_PX = 160; // CSS and GPU side of the overview map
export const PROBE_SEP_PX = 48; // horizontal gap between the two screen-center samples
export const PROBE_HIT_PX = 88; // click/tap half-size of the center launch zone
export const PROBE_PX_PER_LEN = 38; // CSS px for L=1; L1/L2 draw absolutely, not normalized
export const PROBE_CROSS_PX = 7; // half-length of the reticle
export const PROBE_PIVOT_DOWN_PX = 18; // hang the rods this far below the sights
export const PROBE_PIVOT_R = 2; // CSS px; keep smaller than the sights
export const PROBE_BOB_R = 4; // CSS px radius at mass = 1; area scales with M
export const PROBE_DIVERGE_DEG = 10; // |Δθ₁| that counts as diverged
export const PROBE_SNAP_DEG = 720; // |Δθ₁| in one overlay frame that tears the first rod off the pin
export const PROBE_FLY_TIME = 0.55; // fly integrates this fraction of map DT per frame
export const PROBE_ALPHA = 0.5; // overlay pendulums stay see-through
export const PROBE_PLAY_FPS = 24; // overlay steps once per frame at this rate
export const PROBE_ESTIMATE_STEPS = 600; // lookahead steps per frame for the countdown
export const PROBE_MAX_STEPS = 40000; // fine dt would hit the map cap too soon
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 36;
export const SCALE_BAR_TARGET_PX = 80; // Google-maps-like bar aims at this length
export const SCALE_BAR_MIN_PX = 48;
export const SCALE_BAR_MAX_PX = 120;

// Menu / prefs.
export const PREFS_KEY = 'fractal-explorer';
export const PREFS_WRITE_MS = 250;
export const COMPACT_QUERY = '(max-width: 900px), (max-height: 520px)';
