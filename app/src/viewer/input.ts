import {
  CLICK_ZOOM_FACTOR,
  COAST_FRICTION,
  COAST_MIN_PX,
  COAST_MIN_ZOOM,
  COAST_STALE_MS,
  COAST_VEL_TAU,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_PX,
  PINCH_ZOOM,
  VIEW_DEBOUNCE_MS,
  WHEEL_ZOOM,
  WHEEL_ZOOM_PINCH,
} from '../constants';
import type { NavigationPolicy, ViewRect } from '../maps/types';
import { canZoomIn, canZoomOut, coastStopView, panView, screenToMap, zoomAbout } from './view';

function isUiEvent(event: Event): boolean {
  return event.target instanceof Element && Boolean(event.target.closest('[data-viewer-ui]'));
}

export type ViewOpts = {
  pushHistory?: boolean;
  immediate?: boolean;
  navigating?: boolean;
  animate?: boolean;
  coasting?: boolean;
  keepPrefetch?: boolean;
};

export type InputHandlers = {
  getView(): ViewRect;
  getWorld(): ViewRect;
  getNavigation(): NavigationPolicy;
  setView(view: ViewRect, opts?: ViewOpts): void;
  popHistory(): void;
  /** Return true to consume the tap (do not zoom). */
  pickPoint(x: number, y: number, clientX: number, clientY: number): boolean;
  hoverPoint?(x: number, y: number, clientX: number, clientY: number): void;
  hoverEnd?(): void;
  /** Compute the view inertia will rest at, before the coast finishes. */
  prefetchView?(view: ViewRect): void;
  /** Pointer down: drop click-zoom waits and leftover prefetch. */
  interrupt?(): void;
  /** Coast ended: allow a halo/refine pass at the rest view. */
  settleView?(): void;
  dismissUi?(): void;
};

export function bindMapInput(surface: HTMLElement, handlers: InputHandlers): { stopCoast(): void } {
  const pointers = new Map<number, { x: number; y: number }>();
  let dragging = false;
  let moved = false;
  let lastPinch = 0;
  let lastMid: { x: number; y: number } | null = null;
  let pinchAnchor: { x: number; y: number } | null = null;
  let coastAfterPinch = false;
  let last = { x: 0, y: 0 };
  let origin = { x: 0, y: 0 };
  let tapSlop = 2;
  let hoverRaf = 0;
  let hoverClient = { x: 0, y: 0 };
  let lastTap: { t: number; x: number; y: number } | null = null;
  let lastMoveT = 0;
  let lastPinchT = 0;
  let velX = 0;
  let velY = 0;
  let velLog = 0;
  let pinchLogs: number[] = [];
  let pinchTimes: number[] = [];
  let coastRaf = 0;
  let wheelSettle = 0;

  function at(clientX: number, clientY: number): { x: number; y: number } {
    const rect = surface.getBoundingClientRect();
    return screenToMap(
      handlers.getView(),
      clientX - rect.left,
      clientY - rect.top,
      rect.width,
      rect.height,
    );
  }

  function emitHover(clientX: number, clientY: number): void {
    if (!handlers.hoverPoint) return;
    hoverClient = { x: clientX, y: clientY };
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const point = at(hoverClient.x, hoverClient.y);
      handlers.hoverPoint?.(point.x, point.y, hoverClient.x, hoverClient.y);
    });
  }

  function stopCoast(): void {
    if (coastRaf) cancelAnimationFrame(coastRaf);
    coastRaf = 0;
  }

  function resetVel(now = performance.now()): void {
    velX = 0;
    velY = 0;
    velLog = 0;
    pinchLogs = [];
    pinchTimes = [];
    lastPinchT = 0;
    pinchAnchor = null;
    coastAfterPinch = false;
    lastMoveT = now;
  }

  function noteVel(dx: number, dy: number, dLog: number, now: number): void {
    const dt = (now - lastMoveT) / 1000;
    if (dt <= 0 || dt > 0.12) {
      if (dt > 0) lastMoveT = now;
      return;
    }
    lastMoveT = now;
    const alpha = 1 - Math.exp(-dt / COAST_VEL_TAU);
    velX += ((dx / dt) - velX) * alpha;
    velY += ((dy / dt) - velY) * alpha;
    velLog += ((dLog / dt) - velLog) * alpha;
  }

  function recordPinch(dLog: number, now: number): void {
    pinchLogs.push(dLog);
    pinchTimes.push(now);
    while (pinchTimes.length && now - pinchTimes[0] > 140) {
      pinchLogs.shift();
      pinchTimes.shift();
    }
  }

  function releaseZoomVel(now: number): number {
    if (pinchTimes.length < 2) return velLog;
    const dt = (pinchTimes[pinchTimes.length - 1] - pinchTimes[0]) / 1000;
    if (dt < 0.02) return velLog;
    let sum = 0;
    for (const d of pinchLogs) sum += d;
    return sum / dt;
  }

  function startCoast(anchor: { x: number; y: number } | null, settleIfStill = true): void {
    stopCoast();
    if (performance.now() - lastMoveT > COAST_STALE_MS) {
      velX = 0;
      velY = 0;
      if (!anchor || Math.abs(velLog) < COAST_MIN_ZOOM) velLog = 0;
    }
    const zoomAnchor = anchor ?? pinchAnchor;
    if (zoomAnchor) velLog = releaseZoomVel(performance.now());
    if (Math.hypot(velX, velY) < COAST_MIN_PX && Math.abs(velLog) < COAST_MIN_ZOOM) {
      if (settleIfStill) handlers.settleView?.();
      return;
    }
    const box = surface.getBoundingClientRect();
    handlers.prefetchView?.(coastStopView(
      handlers.getView(),
      handlers.getWorld(),
      velX,
      velY,
      velLog,
      zoomAnchor,
      box.width,
      box.height,
      handlers.getNavigation(),
    ));
    let lastT = performance.now() - 16;
    const step = (now: number): void => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      const decay = Math.exp(-COAST_FRICTION * dt);
      velX *= decay;
      velY *= decay;
      velLog *= decay;
      const world = handlers.getWorld();
      let next = handlers.getView();
      if (Math.abs(velLog) >= COAST_MIN_ZOOM && zoomAnchor) {
        if ((velLog > 0 && !canZoomOut(next, world)) || (velLog < 0 && !canZoomIn(next))) {
          velLog = 0;
        } else {
          next = zoomAbout(next, zoomAnchor.x, zoomAnchor.y, Math.exp(velLog * dt), world, handlers.getNavigation());
        }
      }
      if (Math.hypot(velX, velY) >= COAST_MIN_PX) {
        const box = surface.getBoundingClientRect();
        next = panView(next, velX * dt, velY * dt, box.width, box.height, handlers.getNavigation());
      }
      handlers.setView(next, { navigating: true, coasting: true, keepPrefetch: true });
      if (Math.hypot(velX, velY) < COAST_MIN_PX && Math.abs(velLog) < COAST_MIN_ZOOM) {
        coastRaf = 0;
        handlers.settleView?.();
        return;
      }
      coastRaf = requestAnimationFrame(step);
    };
    step(performance.now());
  }

  surface.addEventListener('contextmenu', (event) => event.preventDefault());

  surface.addEventListener('pointerdown', (event) => {
    if (isUiEvent(event)) return;
    handlers.dismissUi?.();
    if (pointers.size === 0) {
      stopCoast();
      resetVel();
      moved = false;
      handlers.interrupt?.();
    } else {
      stopCoast();
      velX = 0;
      velY = 0;
      velLog = 0;
      pinchLogs = [];
      pinchTimes = [];
      lastPinchT = 0;
    }
    try {
      surface.setPointerCapture(event.pointerId);
    } catch {
      // Untrusted / synthetic events may not capture.
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    last = { x: event.clientX, y: event.clientY };
    origin = { x: event.clientX, y: event.clientY };
    tapSlop = event.pointerType === 'touch' ? 12 : 2;
    dragging = event.button === 0 && pointers.size === 1;
    if (event.button === 2) handlers.popHistory();
    emitHover(event.clientX, event.clientY);
  });

  surface.addEventListener('pointermove', (event) => {
    if (pointers.size === 0) {
      emitHover(event.clientX, event.clientY);
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const pts = [...pointers.values()];
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastMid && lastPinch > 0 && dist > 0) {
        const now = performance.now();
        const box = surface.getBoundingClientRect();
        const anchor = at(lastMid.x, lastMid.y);
        pinchAnchor = anchor;
        const factor = (lastPinch / dist) ** PINCH_ZOOM;
        const dLog = Math.log(factor);
        let next = zoomAbout(handlers.getView(), anchor.x, anchor.y, factor, handlers.getWorld(), handlers.getNavigation());
        next = panView(next, mid.x - lastMid.x, mid.y - lastMid.y, box.width, box.height, handlers.getNavigation());
        const pinchDt = lastPinchT ? (now - lastPinchT) / 1000 : 0;
        if (pinchDt > 0 && pinchDt <= 0.2) {
          noteVel(mid.x - lastMid.x, mid.y - lastMid.y, dLog, now);
          recordPinch(dLog, now);
        } else {
          lastMoveT = now;
        }
        lastPinchT = now;
        handlers.setView(next, { navigating: true });
      }
      lastPinch = dist;
      lastMid = mid;
      dragging = false;
      moved = true;
      surface.classList.add('is-dragging');
      return;
    }
    if (!dragging) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    if (coastAfterPinch && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 36) {
      return;
    }
    coastAfterPinch = false;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > tapSlop) moved = true;
    last = { x: event.clientX, y: event.clientY };
    noteVel(dx, dy, 0, performance.now());
    const box = surface.getBoundingClientRect();
    handlers.setView(panView(handlers.getView(), dx, dy, box.width, box.height, handlers.getNavigation()), {
      navigating: true,
      keepPrefetch: true,
    });
    surface.classList.add('is-dragging');
    emitHover(event.clientX, event.clientY);
  });

  function endPointer(event: PointerEvent): void {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) {
      lastPinch = 0;
      lastMid = null;
    }
    if (pointers.size === 1) {
      const leftover = [...pointers.values()][0];
      last = { x: leftover.x, y: leftover.y };
      origin = { x: leftover.x, y: leftover.y };
      dragging = true;
      moved = true;
      lastMoveT = performance.now();
      coastAfterPinch = true;
      startCoast(pinchAnchor, false);
      return;
    }
    if (moved) startCoast(pinchAnchor);
    if (event.button === 0 && dragging && !moved) {
      const point = at(event.clientX, event.clientY);
      const launched = handlers.pickPoint(point.x, point.y, event.clientX, event.clientY);
      if (launched) {
        lastTap = null;
      } else {
        const now = performance.now();
        const doubled = Boolean(
          event.pointerType === 'touch'
          && lastTap
          && now - lastTap.t < DOUBLE_TAP_MS
          && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < DOUBLE_TAP_PX,
        );
        lastTap = event.pointerType === 'touch' && !doubled
          ? { t: now, x: event.clientX, y: event.clientY }
          : null;
        // Mouse click zooms. A phone tap only poses; a second tap zooms about that point.
        if (event.pointerType !== 'touch' || doubled) {
          handlers.setView(
            zoomAbout(handlers.getView(), point.x, point.y, CLICK_ZOOM_FACTOR, handlers.getWorld(), handlers.getNavigation()),
            { pushHistory: true, animate: true },
          );
        }
      }
    }
    dragging = false;
    surface.classList.remove('is-dragging');
  }

  surface.addEventListener('pointerup', endPointer);
  surface.addEventListener('pointercancel', endPointer);
  surface.addEventListener('pointerleave', (event) => {
    if (pointers.size) return;
    if (event.pointerType === 'touch') return;
    handlers.hoverEnd?.();
  });

  surface.addEventListener('wheel', (event) => {
    event.preventDefault();
    handlers.dismissUi?.();
    stopCoast();
    resetVel();
    const point = at(event.clientX, event.clientY);
    const gain = event.ctrlKey ? WHEEL_ZOOM_PINCH : WHEEL_ZOOM;
    handlers.setView(
      zoomAbout(handlers.getView(), point.x, point.y, Math.exp(event.deltaY * gain), handlers.getWorld(), handlers.getNavigation()),
      { navigating: true },
    );
    window.clearTimeout(wheelSettle);
    wheelSettle = window.setTimeout(() => handlers.settleView?.(), VIEW_DEBOUNCE_MS);
    emitHover(event.clientX, event.clientY);
  }, { passive: false });

  return { stopCoast };
}
