import { MIN_VIEW_SPAN, VIEW_HALF } from '../constants';
import {
  copyView,
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
  return viewAround(c.x, c.y, spanX, spanY);
}

export function shortSpan(view: ViewRect): number {
  return Math.min(viewSpanX(view), viewSpanY(view));
}

/**
 * Zoom about a point. Unzoom never goes wider than `world` — the last step
 * lands on that original view instead of overshooting.
 */
export function zoomAbout(
  view: ViewRect,
  x: number,
  y: number,
  factor: number,
  world: ViewRect,
): ViewRect {
  const nextX = viewSpanX(view) * factor;
  const nextY = viewSpanY(view) * factor;
  const capX = viewSpanX(world);
  const capY = viewSpanY(world);
  if (factor > 1 && (nextX >= capX || nextY >= capY)) {
    return copyView(world);
  }
  const spanX = clampSpan(nextX, capX);
  const spanY = clampSpan(nextY, capY);
  const fx = (x - view.xMin) / viewSpanX(view);
  const fy = (y - view.yMin) / viewSpanY(view);
  return {
    xMin: x - fx * spanX,
    xMax: x + (1 - fx) * spanX,
    yMin: y - fy * spanY,
    yMax: y + (1 - fy) * spanY,
  };
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
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
  return {
    xMin: view.xMin - dx,
    xMax: view.xMax - dx,
    yMin: view.yMin - dy,
    yMax: view.yMax - dy,
  };
}

function clampSpan(span: number, cap: number): number {
  return Math.min(Math.max(span, MIN_VIEW_SPAN), cap);
}

export function canZoomIn(view: ViewRect): boolean {
  return shortSpan(view) > MIN_VIEW_SPAN * 1.01;
}

export function canZoomOut(view: ViewRect, world: ViewRect): boolean {
  return shortSpan(view) < shortSpan(world) * 0.99;
}

export function viewHistoryPush(stack: ViewRect[], view: ViewRect): ViewRect[] {
  return [...stack, copyView(view)];
}

export { copyView, viewCenter, viewSpanX, viewSpanY };
