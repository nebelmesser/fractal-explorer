// Display vs compute.
export const MAP_FLOAT_BITS = 32; // GPU map + postprocess stay f32
export const F32_MANTISSA_BITS = 23;
export const F64_MANTISSA_BITS = 52;
export const MAP_DISPLAY_MIN_PX = 160; // floor so a tiny window still has a panel
export const MIN_COMPUTE_PX = 64; // refuse a grainier map than this
export const MAX_COMPUTE_PX = 4096; // longest visible compute side when the budget allows
export const MAX_OVERSCAN_PX = 8192; // halo may cover 2× the viewport without losing settled pixel density
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
export const PARAM_RESET_MS = 5000; // Reset parameters; sliders and home unzoom share this ease
export const UNZOOM_GROW = 2; // each lookahead cover doubles span toward the landing view
export const MIN_VIEW_SPAN = 1e-5; // default zoom floor for maps without an f64 CPU kernel
/** Deepest navigable span when a map supplies an f64 CPU kernel. */
export const MIN_VIEW_SPAN_F64 = MIN_VIEW_SPAN * 2 ** (F32_MANTISSA_BITS - F64_MANTISSA_BITS);
/** Same floor in degrees (~1.07e-12°). Narration uses a slightly looser lte. */
export const MIN_VIEW_SPAN_F64_DEG = MIN_VIEW_SPAN_F64 * (180 / Math.PI);
export const OVERSCAN_PAD = 0.5; // half a screen on each side of the visible view
export const OVERSCAN_RELOAD = 0.6; // prefetch a new halo while this much pad remains

// World-aligned LOD cache. Raw f32 values survive camera movement and are
// normalized only while the visible tile set is composed.
export const LOD_TILE_PX = 256;
export const LOD_CACHE_TILES = 192;
export const LOD_PREFETCH_PAD = 0.35;
export const LOD_COARSE_GAP = 2;
export const LOD_MAX_LEVEL = 24; // finest GPU LOD; f32 floor sits around here
export const LOD_MAX_LEVEL_F64 = 52; // tile indices stay inside JS safe integers
export const LOD_CPU_MIN_PX = 8; // wait until an uncomputed CPU cell covers this many map pixels
export const LOD_CPU_GPU_PX = 4; // hand off once one distinct f32 value spans this many pixels
export const LOD_CPU_STEP = 3; // 8× world between CPU LOD levels
export const LOD_CPU_TILE_PX = 64; // compact CPU tile; kept at native size on the GPU
export const LOD_CPU_INITIAL_RES = 16; // quick first paint; later refinement replaces it with 64×64
export const LOD_CPU_REFINE_FACTOR = 4; // 16→64
export const LOD_CPU_SPARSE_START_PX = 4; // start revealing the void at this sample pitch
export const LOD_CPU_SPARSE_MAX_PX = 16; // sample squares grow more slowly and stop here
export const LOD_CPU_VOID_FADE_START_PX = 3; // reveal the background shortly before separation
export const LOD_CPU_VOID_MAP_OPACITY = 0.82;
export const LOD_CPU_RINGS = 4; // fovea rings; later waves raise center before the edge
export const LOD_CPU_PARALLEL = 8; // fallback if the map does not report worker count
export const LOD_CPU_SLICE_MS = 50; // keep workers busy this long before a compose
export const LOD_CPU_EXPOSURE_FRAME_MS = 90; // low-rate exposure tween while CPU tiles are refining
export const LOD_EXPOSURE_LOW = 0.01;
export const LOD_EXPOSURE_HIGH = 0.9995;
export const LOD_EXPOSURE_TAU_MS = 360;

// Post-process. Median kills single-pixel fireflies after log-normalization.
export const MEDIAN_DEFAULT = 3; // scipy-style window (3 → 3×3)
export const MEDIAN_MAX = 5; // shader sorts n² samples; keep n small
export const INVERT_DEFAULT = false;

export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 36;

// Menu / prefs.
export const SLIDER_THUMB_PX = 14; // reference diameter for value-scaled slider thumbs

export const PREFS_WRITE_MS = 250;
export const COMPACT_QUERY = '(max-width: 900px), (max-height: 520px)';
