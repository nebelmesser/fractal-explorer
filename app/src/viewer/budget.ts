import {
  BUDGET_BLEND,
  MAP_DISPLAY_MIN_PX,
  DISPLAY_DPR_CAP,
  MAX_COMPUTE_PX,
  MAX_OVERSCAN_PX,
  MIN_COMPUTE_PX,
  TARGET_FRAME_MS_MAX,
  TARGET_FRAME_MS_MIN,
} from '../constants';
import type { WorkBudget } from '../maps/types';

export type MapSize = { width: number; height: number };

/** Snap to a multiple of the 8×8 compute workgroup. */
export function snapComputePx(side: number): number {
  const snapped = Math.round(side / 8) * 8;
  return Math.min(MAX_COMPUTE_PX, Math.max(MIN_COMPUTE_PX, snapped));
}

function snapWorkgroup(side: number): number {
  return Math.round(side / 8) * 8;
}

export function snapWork(n: number, budget: WorkBudget): number {
  const stepped = Math.round(n / budget.step) * budget.step;
  return Math.min(budget.max, Math.max(budget.min, stepped));
}

/** Per-pixel work cap implied by the frame-budget slider. */
export function preferredWork(targetMs: number, budget: WorkBudget): number {
  const span = TARGET_FRAME_MS_MAX - TARGET_FRAME_MS_MIN;
  const t = span > 0
    ? Math.min(1, Math.max(0, (targetMs - TARGET_FRAME_MS_MIN) / span))
    : 0;
  return snapWork(budget.min + t * (budget.max - budget.min), budget);
}

/** CSS short side, snapped to the workgroup. */
export function cssShortPx(display: MapSize): number {
  return snapComputePx(Math.min(display.width, display.height));
}

/** Highest short-side compute size the budget may grow into (CSS × DPR, capped). */
export function maxBudgetPx(display: MapSize, dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio): number {
  const css = Math.min(display.width, display.height);
  const scaled = css * Math.min(DISPLAY_DPR_CAP, Math.max(1, dpr || 1));
  return snapComputePx(Math.min(MAX_COMPUTE_PX, scaled));
}

/**
 * Split the frame-time budget between pixels and iteration cap.
 * Fill the CSS screen at the minimum 1000 steps first; leftover time raises
 * iterations, then physical resolution up to `maxShortPx`.
 */
export function nextWorkBudget(
  current: { shortPx: number; work: number },
  measuredMs: number,
  targetMs: number,
  display: MapSize,
  budget: WorkBudget,
  maxShortPx = cssShortPx(display),
): { shortPx: number; work: number } {
  const vis = computeSize(display, current.shortPx);
  const pixels = Math.max(1, vis.width * vis.height);
  const work = snapWork(current.work, budget);
  const scale = targetMs / Math.max(measuredMs, 1);
  const blended = 1 - BUDGET_BLEND + scale * BUDGET_BLEND;
  const targetWork = pixels * work * blended;

  const cssPx = cssShortPx(display);
  const maxPx = snapComputePx(Math.max(cssPx, maxShortPx));
  const full = computeSize(display, cssPx);
  const fullPixels = Math.max(1, full.width * full.height);
  const cap = preferredWork(targetMs, budget);
  const workAtFull = targetWork / fullPixels;
  if (workAtFull >= budget.min) {
    const nextWork = snapWork(Math.min(cap, Math.max(budget.min, workAtFull)), budget);
    const workAtCap = fullPixels * cap;
    if (targetWork > workAtCap * 1.08 && maxPx > cssPx) {
      const grow = Math.sqrt(targetWork / workAtCap);
      return { shortPx: snapComputePx(Math.min(maxPx, cssPx * grow)), work: cap };
    }
    return { shortPx: cssPx, work: nextWork };
  }

  const targetPixels = targetWork / budget.min;
  const area = Math.max(1, display.width * display.height);
  const short = Math.max(1, Math.min(display.width, display.height));
  const shortPx = short * Math.sqrt(targetPixels / area);
  return { shortPx: snapComputePx(shortPx), work: budget.min };
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

/** Largest symmetric halo pad that keeps the visible map's current pixel density. */
export function densityPreservingPad(base: MapSize, requested: number, maxPx: number): number {
  const long = Math.max(base.width, base.height);
  if (!(long > 0) || !(requested > 0)) return 0;
  const maxRatio = Math.max(1, maxPx / long);
  return Math.min(requested, Math.max(0, (maxRatio - 1) / 2));
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
