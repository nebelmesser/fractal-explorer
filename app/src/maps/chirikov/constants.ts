export const CHIRIKOV_TAU = Math.PI * 2;
export const CHIRIKOV_HALF_TURN = Math.PI;

/** Near the breakup of the golden invariant circle: rich islands and chaotic layers coexist. */
export const CHIRIKOV_K_DEFAULT = 0.971635;
export const CHIRIKOV_K_MIN = 0;
export const CHIRIKOV_K_MAX = 4;
export const CHIRIKOV_K_STEP = 0.005;

export const CHIRIKOV_MIN_ITER = 48;
export const CHIRIKOV_MAX_ITER = 512;
export const CHIRIKOV_ITER_STEP = 16;
export const CHIRIKOV_DEFAULT_ITER = 160;
export const CHIRIKOV_CPU_WORKERS = 4;
/** Early phase remains stable between f32 and f64 while still bending the contour layers. */
export const CHIRIKOV_CONTOUR_ITER = 24;

/** Cycles across the orbit phase; high enough to expose resonance layers at the opening view. */
export const CHIRIKOV_COLOR_BANDS = 34;
export const CHIRIKOV_ORBIT_BANDS = 6;
