import { COAST_FRICTION, COAST_MIN_PX, COAST_MIN_ZOOM, MIN_VIEW_SPAN, UNZOOM_GROW } from '../constants';
import {
  copyView,
  lerpView,
  viewsEqual,
  viewAround,
  viewCenter,
  viewSpanX,
  viewSpanY,
  type NavigationPolicy,
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

/** Fit the complete default domain and extend only the screen's longer axis. */
export function worldFromDisplay(widthPx: number, heightPx: number, base: ViewRect): ViewRect {
  const c = viewCenter(base);
  const displayAspect = Math.max(widthPx, 1) / Math.max(heightPx, 1);
  const baseX = viewSpanX(base);
  const baseY = viewSpanY(base);
  const baseAspect = baseX / Math.max(baseY, MIN_VIEW_SPAN);
  const spanX = displayAspect > baseAspect ? baseY * displayAspect : baseX;
  const spanY = displayAspect > baseAspect ? baseY : baseX / displayAspect;
  return viewAround(c.x, c.y, spanX, spanY);
}

/** Keep the short-axis span and center; match the window aspect. */
export function fitViewAspect(
  view: ViewRect,
  _widthPx: number,
  _heightPx: number,
  world: ViewRect,
  navigation: NavigationPolicy,
): ViewRect {
  const c = viewCenter(view);
  const { spanX, spanY } = spansForShort(shortSpan(view), world);
  if (spanX >= viewSpanX(world) * 0.99 && spanY >= viewSpanY(world) * 0.99) {
    return copyView(world);
  }
  return clampViewX(viewAround(c.x, c.y, spanX, spanY), navigation);
}

export function shortSpan(view: ViewRect): number {
  return Math.min(viewSpanX(view), viewSpanY(view));
}

/** Axis spans that keep `world`'s aspect for a given short-axis length. */
function spansForShort(short: number, world: ViewRect): { spanX: number; spanY: number } {
  const worldShort = Math.max(shortSpan(world), MIN_VIEW_SPAN);
  return {
    spanX: short * (viewSpanX(world) / worldShort),
    spanY: short * (viewSpanY(world) / worldShort),
  };
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
  navigation: NavigationPolicy,
  minSpan = MIN_VIEW_SPAN,
): ViewRect {
  const nextShort = clampSpan(shortSpan(view) * factor, shortSpan(world), minSpan);
  const { spanX, spanY } = spansForShort(nextShort, world);
  const fx = (x - view.xMin) / viewSpanX(view);
  const fy = (y - view.yMin) / viewSpanY(view);
  return clampViewX({
    xMin: x - fx * spanX,
    xMax: x + (1 - fx) * spanX,
    yMin: y - fy * spanY,
    yMax: y + (1 - fy) * spanY,
  }, navigation);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

/** Interpolate views, taking the short way around either optional period. */
export function lerpViewShortY(
  a: ViewRect,
  b: ViewRect,
  t: number,
  navigation: NavigationPolicy,
): ViewRect {
  const dx = wrapDeltaX(viewCenter(b).x - viewCenter(a).x, navigation);
  const dy = wrapDeltaY(viewCenter(b).y - viewCenter(a).y, navigation);
  const shifted = shiftView(
    b,
    viewCenter(a).x + dx - viewCenter(b).x,
    viewCenter(a).y + dy - viewCenter(b).y,
  );
  return lerpView(a, shifted, t);
}

export function panView(
  view: ViewRect,
  dxPx: number,
  dyPx: number,
  width: number,
  height: number,
  navigation: NavigationPolicy,
): ViewRect {
  const dx = (dxPx / width) * viewSpanX(view);
  const dy = (dyPx / height) * viewSpanY(view);
  return clampViewX({
    xMin: view.xMin - dx,
    xMax: view.xMax - dx,
    yMin: view.yMin - dy,
    yMax: view.yMax - dy,
  }, navigation);
}

function clampSpan(span: number, cap: number, floor: number): number {
  return Math.min(Math.max(span, floor), cap);
}

function yPeriod(navigation: NavigationPolicy): number | null {
  const period = navigation.yPeriod?.period;
  return period && period > 0 ? period : null;
}

function xPeriod(navigation: NavigationPolicy): number | null {
  const period = navigation.xPeriod?.period;
  return period && period > 0 ? period : null;
}

/** Wrap an absolute X coordinate into the map's canonical period. */
export function wrapViewX(x: number, navigation: NavigationPolicy): number {
  const period = xPeriod(navigation);
  if (!period) return x;
  const center = navigation.xPeriod?.center ?? 0;
  return center + wrapDelta(x - center, period);
}

/** Wrap an absolute Y coordinate into the map's canonical period. */
export function wrapViewY(y: number, navigation: NavigationPolicy): number {
  const period = yPeriod(navigation);
  if (!period) return y;
  const center = navigation.yPeriod?.center ?? 0;
  return center + wrapDelta(y - center, period);
}

function wrapDeltaY(delta: number, navigation: NavigationPolicy): number {
  const period = yPeriod(navigation);
  return period ? wrapDelta(delta, period) : delta;
}

function wrapDeltaX(delta: number, navigation: NavigationPolicy): number {
  const period = xPeriod(navigation);
  return period ? wrapDelta(delta, period) : delta;
}

function wrapDelta(value: number, period: number): number {
  return value - period * Math.round(value / period);
}

/** Wrap `value` onto the period centered at `center` (default 0). */
export function wrapToPeriod(value: number, period: number, center = 0): number {
  if (!(period > 0) || !Number.isFinite(value)) return value;
  return center + wrapDelta(value - center, period);
}

export function shiftViewY(view: ViewRect, dy: number): ViewRect {
  if (dy === 0) return view;
  return { xMin: view.xMin, xMax: view.xMax, yMin: view.yMin + dy, yMax: view.yMax + dy };
}

function shiftView(view: ViewRect, dx: number, dy: number): ViewRect {
  if (dx === 0 && dy === 0) return view;
  return {
    xMin: view.xMin + dx,
    xMax: view.xMax + dx,
    yMin: view.yMin + dy,
    yMax: view.yMax + dy,
  };
}

/** Shift `cover` by whole periods so both axes line up with `target`. */
export function alignViewY(
  cover: ViewRect,
  target: ViewRect,
  navigation: NavigationPolicy,
): ViewRect {
  const pc = viewCenter(cover);
  const tc = viewCenter(target);
  const px = xPeriod(navigation);
  const py = yPeriod(navigation);
  const dx = px ? Math.round((tc.x - pc.x) / px) * px : 0;
  const dy = py ? Math.round((tc.y - pc.y) / py) * py : 0;
  return shiftView(cover, dx, dy);
}

/** Fold a view so its center sits in the configured canonical periods. */
export function foldViewY(view: ViewRect, navigation: NavigationPolicy): ViewRect {
  const c = viewCenter(view);
  return shiftView(
    view,
    wrapViewX(c.x, navigation) - c.x,
    wrapViewY(c.y, navigation) - c.y,
  );
}

/**
 * How far `inner` sits inside `outer`, honoring optional periods on both axes.
 * Negative means the inner view sticks out of every nearby copy.
 */
export function tiledInset(
  inner: ViewRect,
  outer: ViewRect,
  navigation: NavigationPolicy,
): number {
  const aligned = alignViewY(outer, inner, navigation);
  const sx = viewSpanX(inner);
  if (!(sx > 0)) return -1;
  const sy = viewSpanY(inner);
  if (!(sy > 0)) return -1;
  const px = xPeriod(navigation);
  const py = yPeriod(navigation);
  const xPad = (candidate: ViewRect): number => (
    Math.min(inner.xMin - candidate.xMin, candidate.xMax - inner.xMax) / sx
  );
  const yPad = (candidate: ViewRect): number => (
    Math.min(inner.yMin - candidate.yMin, candidate.yMax - inner.yMax) / sy
  );
  let mx = px && viewSpanX(aligned) >= px - 1e-9 ? Number.POSITIVE_INFINITY : xPad(aligned);
  let my = py && viewSpanY(aligned) >= py - 1e-9 ? Number.POSITIVE_INFINITY : yPad(aligned);
  if (px && Number.isFinite(mx)) {
    for (const k of [-1, 1]) mx = Math.max(mx, xPad(shiftView(aligned, k * px, 0)));
  }
  if (py && Number.isFinite(my)) {
    for (const k of [-1, 1]) my = Math.max(my, yPad(shiftView(aligned, 0, k * py)));
  }
  return Math.min(mx, my);
}

export function wrapPointToCover(
  point: { x: number; y: number },
  cover: ViewRect,
  navigation: NavigationPolicy,
): { x: number; y: number } {
  const center = viewCenter(cover);
  return {
    x: center.x + wrapDeltaX(point.x - center.x, navigation),
    y: center.y + wrapDeltaY(point.y - center.y, navigation),
  };
}

/** Apply optional horizontal camera-center limits. */
export function clampViewX(view: ViewRect, navigation: NavigationPolicy): ViewRect {
  const bounds = navigation.xCenter;
  if (!bounds) return view;
  const c = viewCenter(view);
  const x = Math.min(bounds.max, Math.max(bounds.min, c.x));
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
  navigation: NavigationPolicy,
  minSpan = MIN_VIEW_SPAN,
): ViewRect {
  const k = COAST_FRICTION;
  let next = view;
  if (anchor && Math.abs(velLog) >= COAST_MIN_ZOOM) {
    next = zoomAbout(next, anchor.x, anchor.y, Math.exp(velLog / k), world, navigation, minSpan);
  }
  if (Math.hypot(velX, velY) >= COAST_MIN_PX) {
    next = panView(next, velX / k, velY / k, width, height, navigation);
  }
  return clampViewX(next, navigation);
}

export function canZoomIn(view: ViewRect, minSpan = MIN_VIEW_SPAN): boolean {
  return shortSpan(view) > minSpan * 1.01;
}

export function canZoomOut(view: ViewRect, world: ViewRect): boolean {
  return shortSpan(view) < shortSpan(world) * 0.99;
}

/** True when the camera is growing — the next cover must be wider, not denser. */
export function isUnzoom(from: ViewRect, to: ViewRect): boolean {
  return viewSpanX(to) > viewSpanX(from) * 1.04 || viewSpanY(to) > viewSpanY(from) * 1.04;
}

/**
 * Next lookahead cover on the way from `have` to `target`: about `UNZOOM_GROW` ×
 * the current cover, or the landing view when that hop would overshoot.
 */
export function nextUnzoomCover(
  have: ViewRect,
  target: ViewRect,
  navigation: NavigationPolicy,
): ViewRect {
  const landing = foldViewY(target, navigation);
  const aligned = alignViewY(foldViewY(have, navigation), landing, navigation);
  if (tiledInset(landing, aligned, navigation) >= 0) return copyView(landing);
  const s0 = Math.max(viewSpanX(aligned), viewSpanY(aligned));
  const s1 = Math.max(viewSpanX(landing), viewSpanY(landing));
  if (!(s1 > s0 * UNZOOM_GROW * 1.02)) return copyView(landing);
  const u = (s0 * UNZOOM_GROW - s0) / (s1 - s0);
  return lerpViewShortY(aligned, landing, Math.min(1, Math.max(0, u)), navigation);
}

/** True when this camera is the default framing, ignoring equivalent periods. */
export function atDefaultView(
  view: ViewRect,
  world: ViewRect,
  navigation: NavigationPolicy,
): boolean {
  return viewsEqual(foldViewY(view, navigation), world);
}

export function viewHistoryPush(stack: ViewRect[], view: ViewRect): ViewRect[] {
  return [...stack, copyView(view)];
}

export { copyView, viewCenter, viewSpanX, viewSpanY };
