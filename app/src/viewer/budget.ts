import {
  BUDGET_BLEND,
  MAP_DISPLAY_MIN_PX,
  MAX_COMPUTE_PX,
  MAX_OVERSCAN_PX,
  MIN_COMPUTE_PX,
  PENDULUM_MAX_ITER,
  PENDULUM_MIN_ITER,
  TARGET_FRAME_MS_MAX,
  TARGET_FRAME_MS_MIN,
} from '../constants';

export type MapSize = { width: number; height: number };

/** Snap to a multiple of the 8×8 compute workgroup. */
export function snapComputePx(side: number): number {
  const snapped = Math.round(side / 8) * 8;
  return Math.min(MAX_COMPUTE_PX, Math.max(MIN_COMPUTE_PX, snapped));
}

function snapWorkgroup(side: number): number {
  return Math.round(side / 8) * 8;
}

export function snapIters(n: number): number {
  const stepped = Math.round(n / 50) * 50;
  return Math.min(PENDULUM_MAX_ITER, Math.max(PENDULUM_MIN_ITER, stepped));
}

/** Iteration cap implied by the frame-budget slider. Measurement may only lower it. */
export function preferredIters(targetMs: number): number {
  const span = TARGET_FRAME_MS_MAX - TARGET_FRAME_MS_MIN;
  const t = span > 0
    ? Math.min(1, Math.max(0, (targetMs - TARGET_FRAME_MS_MIN) / span))
    : 0;
  return snapIters(PENDULUM_MIN_ITER + t * (PENDULUM_MAX_ITER - PENDULUM_MIN_ITER));
}

/**
 * Split the frame-time budget between pixels and iteration cap.
 * Fill the screen at the minimum 1000 steps first; leftover time raises iterations.
 */
export function nextWorkBudget(
  current: { shortPx: number; iters: number },
  measuredMs: number,
  targetMs: number,
  display: MapSize,
): { shortPx: number; iters: number } {
  const vis = computeSize(display, current.shortPx);
  const pixels = Math.max(1, vis.width * vis.height);
  const iters = snapIters(current.iters);
  const scale = targetMs / Math.max(measuredMs, 1);
  const blended = 1 - BUDGET_BLEND + scale * BUDGET_BLEND;
  const targetWork = pixels * iters * blended;

  const full = computeSize(display, snapComputePx(Math.min(display.width, display.height)));
  const fullPixels = Math.max(1, full.width * full.height);
  const cap = preferredIters(targetMs);
  const itersAtFull = targetWork / fullPixels;
  if (itersAtFull >= PENDULUM_MIN_ITER) {
    return {
      shortPx: snapComputePx(Math.min(display.width, display.height)),
      iters: snapIters(Math.min(cap, Math.max(PENDULUM_MIN_ITER, itersAtFull))),
    };
  }

  const targetPixels = targetWork / PENDULUM_MIN_ITER;
  const area = Math.max(1, display.width * display.height);
  const short = Math.max(1, Math.min(display.width, display.height));
  const shortPx = short * Math.sqrt(targetPixels / area);
  return { shortPx: snapComputePx(shortPx), iters: PENDULUM_MIN_ITER };
}

/** CSS size of the fullscreen map. */
export function fitMapDisplay(stage: HTMLElement): MapSize {
  const style = getComputedStyle(stage);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  return {
    width: Math.max(MAP_DISPLAY_MIN_PX, Math.floor(stage.clientWidth - padX)),
    height: Math.max(MAP_DISPLAY_MIN_PX, Math.floor(stage.clientHeight - padY)),
  };
}

/** Grow a compute size by `ratio`, never past `maxPx` on the long side. */
export function scaleSize(base: MapSize, ratio: number, maxPx = MAX_OVERSCAN_PX): MapSize {
  let width = base.width * ratio;
  let height = base.height * ratio;
  const long = Math.max(width, height);
  if (long > maxPx) {
    const shrink = maxPx / long;
    width *= shrink;
    height *= shrink;
  }
  return {
    width: Math.max(MIN_COMPUTE_PX, snapWorkgroup(width)),
    height: Math.max(MIN_COMPUTE_PX, snapWorkgroup(height)),
  };
}

/** Compute buffer size from the display and a short-side budget. */
export function computeSize(display: MapSize, shortPx: number): MapSize {
  const short = Math.max(Math.min(display.width, display.height), 1);
  const scale = shortPx / short;
  let width = display.width * scale;
  let height = display.height * scale;
  const long = Math.max(width, height);
  if (long > MAX_COMPUTE_PX) {
    const shrink = MAX_COMPUTE_PX / long;
    width *= shrink;
    height *= shrink;
  }
  return {
    width: Math.max(MIN_COMPUTE_PX, snapWorkgroup(width)),
    height: Math.max(MIN_COMPUTE_PX, snapWorkgroup(height)),
  };
}
