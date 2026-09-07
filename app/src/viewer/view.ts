import { COAST_FRICTION, COAST_MIN_PX, COAST_MIN_ZOOM, MIN_VIEW_SPAN, TILE_HALF, VIEW_HALF } from '../constants';
import {
  copyView,
  lerpView,
  viewsEqual,
  viewAround,
  viewCenter,
  viewSpanX,
  viewSpanY,
  type ViewRect,
} from '../maps/types';

export function screenToMap(
  view: ViewRect,
  px: number,
  py: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: view.xMin + (px / width) * viewSpanX(view),
    y: view.yMin + (py / height) * viewSpanY(view),
  };
}

/** Default view: 2π on the short side, extra range beyond ±π on the long side. */
export function worldFromDisplay(widthPx: number, heightPx: number, half = VIEW_HALF): ViewRect {
  const short = Math.max(Math.min(widthPx, heightPx), 1);
  const span = half * 2;
  return viewAround(0, 0, span * (widthPx / short), span * (heightPx / short));
}

/** Keep the short-axis span and center; match the window aspect. */
export function fitViewAspect(
  view: ViewRect,
  widthPx: number,
  heightPx: number,
  world: ViewRect,
): ViewRect {
  const c = viewCenter(view);
  const short = Math.max(Math.min(widthPx, heightPx), 1);
  const spanShort = Math.min(viewSpanX(view), viewSpanY(view));
  const spanX = spanShort * (widthPx / short);
  const spanY = spanShort * (heightPx / short);
  if (spanX >= viewSpanX(world) * 0.99 && spanY >= viewSpanY(world) * 0.99) {
    return copyView(world);
  }
  return clampViewX(viewAround(c.x, c.y, spanX, spanY));
}

export function shortSpan(view: ViewRect): number {
  return Math.min(viewSpanX(view), viewSpanY(view));
}

/**
 * Zoom about a point. Unzoom never goes wider than `world`, and at the
 * max span it stays put — it does not snap back to the world origin.
 */
export function zoomAbout(
  view: ViewRect,
  x: number,
  y: number,
  factor: number,
  world: ViewRect,
): ViewRect {
  const capX = viewSpanX(world);
  const capY = viewSpanY(world);
  if (factor > 1 && !canZoomOut(view, world)) {
    return copyView(view);
  }
  const spanX = clampSpan(viewSpanX(view) * factor, capX);
  const spanY = clampSpan(viewSpanY(view) * factor, capY);
  const fx = (x - view.xMin) / viewSpanX(view);
  const fy = (y - view.yMin) / viewSpanY(view);
  return clampViewX({
    xMin: x - fx * spanX,
    xMax: x + (1 - fx) * spanX,
    yMin: y - fy * spanY,
    yMax: y + (1 - fy) * spanY,
  });
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

/** Interpolate views, taking the short way around the θ₂ period. */
export function lerpViewShortY(a: ViewRect, b: ViewRect, t: number): ViewRect {
  const dy = wrapToTile(viewCenter(b).y - viewCenter(a).y);
  const shifted = shiftViewY(b, viewCenter(a).y + dy - viewCenter(b).y);
  return lerpView(a, shifted, t);
}

export function panView(
  view: ViewRect,
  dxPx: number,
  dyPx: number,
  width: number,
  height: number,
): ViewRect {
  const dx = (dxPx / width) * viewSpanX(view);
  const dy = (dyPx / height) * viewSpanY(view);
  return clampViewX({
    xMin: view.xMin - dx,
    xMax: view.xMax - dx,
    yMin: view.yMin - dy,
    yMax: view.yMax - dy,
  });
}

function clampSpan(span: number, cap: number): number {
  return Math.min(Math.max(span, MIN_VIEW_SPAN), cap);
}

/** θ₂ period matching the unique compute strip [−360°, 360°]. */
export function tileSpan(): number {
  return TILE_HALF * 2;
}

/** Unique computed square: θ₁ and θ₂ in [−2π, 2π]. */
export function tileView(): ViewRect {
  return {
    xMin: -TILE_HALF,
    xMax: TILE_HALF,
    yMin: -TILE_HALF,
    yMax: TILE_HALF,
  };
}

/** Wrap an angle into (−half, half], here ±360°. */
export function wrapToTile(y: number, half = TILE_HALF): number {
  const span = half * 2;
  return y - span * Math.round(y / span);
}

export function shiftViewY(view: ViewRect, dy: number): ViewRect {
  if (dy === 0) return view;
  return { xMin: view.xMin, xMax: view.xMax, yMin: view.yMin + dy, yMax: view.yMax + dy };
}

/** Shift `cover` by k periods so its Y lines up with `target`. */
export function alignViewY(cover: ViewRect, target: ViewRect): ViewRect {
  const span = tileSpan();
  const k = Math.round((viewCenter(target).y - viewCenter(cover).y) / span);
  return shiftViewY(cover, k * span);
}

/** Fold a view so its Y center sits in the unique compute strip. */
export function foldViewY(view: ViewRect): ViewRect {
  const c = viewCenter(view);
  return shiftViewY(view, wrapToTile(c.y) - c.y);
}

/** Unique θ₂ strip: compute only [−360°, 360°]; the rest is tiled from this. */
export function clipViewYToTile(view: ViewRect): ViewRect {
  const yMin = Math.max(view.yMin, -TILE_HALF);
  const yMax = Math.min(view.yMax, TILE_HALF);
  if (yMax - yMin < MIN_VIEW_SPAN) {
    return { xMin: view.xMin, xMax: view.xMax, yMin: -TILE_HALF, yMax: TILE_HALF };
  }
  return { xMin: view.xMin, xMax: view.xMax, yMin, yMax };
}

/**
 * How far `inner` sits inside `outer`, treating `outer` as repeating every 720° in Y.
 * Negative means the inner view sticks out of every nearby copy.
 */
export function tiledInset(inner: ViewRect, outer: ViewRect): number {
  const aligned = alignViewY(outer, inner);
  const sx = viewSpanX(inner);
  if (!(sx > 0)) return -1;
  const mx = Math.min(inner.xMin - aligned.xMin, aligned.xMax - inner.xMax) / sx;
  const sy = viewSpanY(inner);
  if (!(sy > 0)) return -1;
  const period = tileSpan();
  const yPad = (outer: ViewRect): number => (
    Math.min(inner.yMin - outer.yMin, outer.yMax - inner.yMax) / sy
  );
  if (viewSpanY(aligned) >= period - 1e-9) return mx;
  let my = yPad(aligned);
  for (const k of [-1, 1]) my = Math.max(my, yPad(shiftViewY(aligned, k * period)));
  return Math.min(mx, my);
}

export function wrapPointToCover(
  point: { x: number; y: number },
  cover: ViewRect,
): { x: number; y: number } {
  const cy = viewCenter(cover).y;
  return { x: point.x, y: cy + wrapToTile(point.y - cy) };
}

/** Keep θ₁ so ±360° can sit at the screen center; Y is free (wrapped). */
export function clampViewX(view: ViewRect, maxCenter = TILE_HALF): ViewRect {
  const c = viewCenter(view);
  const x = Math.min(maxCenter, Math.max(-maxCenter, c.x));
  const dx = x - c.x;
  if (dx === 0) return view;
  return { xMin: view.xMin + dx, xMax: view.xMax + dx, yMin: view.yMin, yMax: view.yMax };
}

/**
 * Where exponential coast friction lands: remaining pan is v/k pixels,
 * remaining zoom is exp(velLog / k).
 */
export function coastStopView(
  view: ViewRect,
  world: ViewRect,
  velX: number,
  velY: number,
  velLog: number,
  anchor: { x: number; y: number } | null,
  width: number,
  height: number,
): ViewRect {
  const k = COAST_FRICTION;
  let next = view;
  if (anchor && Math.abs(velLog) >= COAST_MIN_ZOOM) {
    next = zoomAbout(next, anchor.x, anchor.y, Math.exp(velLog / k), world);
  }
  if (Math.hypot(velX, velY) >= COAST_MIN_PX) {
    next = panView(next, velX / k, velY / k, width, height);
  }
  return clampViewX(next);
}

export function canZoomIn(view: ViewRect): boolean {
  return shortSpan(view) > MIN_VIEW_SPAN * 1.01;
}

export function canZoomOut(view: ViewRect, world: ViewRect): boolean {
  return shortSpan(view) < shortSpan(world) * 0.99;
}

/** True when this camera is the default framing, ignoring θ₂ periods. */
export function atDefaultView(view: ViewRect, world: ViewRect): boolean {
  return viewsEqual(foldViewY(view), world);
}

export function viewHistoryPush(stack: ViewRect[], view: ViewRect): ViewRect[] {
  return [...stack, copyView(view)];
}

export { copyView, viewCenter, viewSpanX, viewSpanY };
