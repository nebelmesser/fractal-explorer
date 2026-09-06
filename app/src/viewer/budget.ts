import {
  BUDGET_BLEND,
  MAP_DISPLAY_MIN_PX,
  MAX_COMPUTE_PX,
  MAX_OVERSCAN_PX,
  MIN_COMPUTE_PX,
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

/**
 * Move compute resolution toward the side length that would have taken
 * targetMs, blending so a noisy timer cannot oscillate the grain.
 */
export function nextComputePx(
  current: number,
  measuredMs: number,
  targetMs: number,
): number {
  const safeMs = Math.max(measuredMs, 1);
  const pixelScale = targetMs / safeMs;
  const targetSide = current * Math.sqrt(pixelScale);
  const blended = current * (1 - BUDGET_BLEND) + targetSide * BUDGET_BLEND;
  return snapComputePx(blended);
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
