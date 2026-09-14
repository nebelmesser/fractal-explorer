/** Distance from the origin to each magnet (the triangle's circumradius). */
export const MAGNET_R = 1;
const SQRT3_2 = Math.sqrt(3) / 2;

export type MagnetPoint = { x: number; y: number };

/**
 * Equilateral triangle in engine coordinates (y increases downward).
 * Vertex toward yMin so it points at the top of the screen.
 */
export function magnetPositions(radius = MAGNET_R): MagnetPoint[] {
  const r = Math.max(1e-6, radius);
  const s = r * SQRT3_2;
  return [
    { x: 0, y: -r },
    { x: -s, y: r / 2 },
    { x: s, y: r / 2 },
  ];
}

/** Magnet 0 / 1 / 2 → red / green / blue. Overlay markers match the map. */
export const MAGNET_RGB = ['#ff2020', '#22c55e', '#3b82f6'] as const;
/** Short-axis half-span of the opening (and widest) camera. URL `span` = 192. */
export const MAGNET_VIEW_HALF = 96;
export const MAGNET_K = 1.5;
export const MAGNET_G = 1;
export const MAGNET_R_MIN = 0.25;
export const MAGNET_R_MAX = 2.5;
export const MAGNET_F = 0.22;
export const MAGNET_H = 0.28;
export const MAGNET_DT = 0.02;
export const MAGNET_SETTLE_SPEED = 0.03;
/** Capture if slow and this close to a magnet: max(floor, pad·R + H). */
export const MAGNET_CAPTURE_FLOOR = 0.22;
export const MAGNET_CAPTURE_PAD = 0.4;
/** Consecutive captured steps before stopping (turns ignore a one-frame dip). */
export const MAGNET_SETTLE_HOLD = 4;
/**
 * Inside this radius, a planned Euler hop longer than MAGNET_MAX_STEP is split
 * so the bob cannot jump over a magnet. Far-field rings stay on the user dt.
 */
export const MAGNET_CLOSE_RADIUS = 6;
export const MAGNET_MAX_STEP = 0.1;
export const MAGNET_SUBSTEP_MAX = 8;
export const MAGNET_CPU_WORKERS = 4;
export const MAGNET_MIN_ITER = 1200;
export const MAGNET_MAX_ITER = 8000;
/** Overlay polyline: record a vertex after this travel, cap the drawn count. */
export const MAGNET_OVERLAY_SEG = 0.05;
export const MAGNET_OVERLAY_MAX_POINTS = 1600;
export const MAGNET_MARKER_R = 8;
export const MAGNET_BOB_R = 5;
