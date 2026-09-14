/** Logistic-map parameter plane. The classical Lyapunov fractal lives in [2, 4]^2. */
export const LYAPUNOV_PARAM_MIN = 2;
export const LYAPUNOV_PARAM_MAX = 4;

/** The asymmetric five-beat forcing produces the well-known "jellyfish" map. */
export const LYAPUNOV_RHYTHMS = ['AABAB', 'AB', 'AAB', 'ABB', 'AABB'] as const;
export const LYAPUNOV_RHYTHM_DEFAULT = 0;
export const LYAPUNOV_SEQUENCE = LYAPUNOV_RHYTHMS[LYAPUNOV_RHYTHM_DEFAULT];

export const LYAPUNOV_SEED = 0.5;
/** Whole AABAB cycles let both kernels avoid a modulo and branch at every step. */
export const LYAPUNOV_TRANSIENT = 200;
/** Keep superstable points finite and identical between the f32 and f64 kernels. */
export const LYAPUNOV_DERIVATIVE_EPSILON = 1e-7;
/** Shift signed exponents into the non-negative domain used by shared histogram exposure. */
export const LYAPUNOV_ENCODE_OFFSET = -Math.log(LYAPUNOV_DERIVATIVE_EPSILON);

export const LYAPUNOV_MIN_ITER = 200;
export const LYAPUNOV_MAX_ITER = 1600;
export const LYAPUNOV_ITER_STEP = 40;
export const LYAPUNOV_DEFAULT_ITER = 480;
export const LYAPUNOV_CPU_WORKERS = 4;
