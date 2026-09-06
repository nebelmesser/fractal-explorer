import { CLICK_ZOOM_FACTOR, PINCH_ZOOM, WHEEL_ZOOM } from '../constants';
import type { ViewRect } from '../maps/types';
import { closeMenu } from './menu';
import { panView, screenToMap, zoomAbout } from './view';

function isUiEvent(event: Event): boolean {
  return event.target instanceof Element && Boolean(
    event.target.closest('#ui-container')
    || event.target.closest('#menu-toggle')
    || event.target.closest('#menu-backdrop')
    || event.target.closest('#sidebar')
    || event.target.closest('#zoom-bar')
    || event.target.closest('#map-hud'),
  );
}

export type ViewOpts = {
  pushHistory?: boolean;
  immediate?: boolean;
  navigating?: boolean;
  animate?: boolean;
};

export type InputHandlers = {
  getView(): ViewRect;
  getWorld(): ViewRect;
  setView(view: ViewRect, opts?: ViewOpts): void;
  popHistory(): void;
  pickPoint(x: number, y: number, clientX: number, clientY: number): void;
  hoverPoint?(x: number, y: number, clientX: number, clientY: number): void;
  hoverEnd?(): void;
};

export function bindMapInput(surface: HTMLElement, handlers: InputHandlers): void {
  const pointers = new Map<number, { x: number; y: number }>();
  let dragging = false;
  let moved = false;
  let lastPinch = 0;
  let last = { x: 0, y: 0 };
  let origin = { x: 0, y: 0 };
  let tapSlop = 2;
  let hoverRaf = 0;
  let hoverClient = { x: 0, y: 0 };

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

  surface.addEventListener('contextmenu', (event) => event.preventDefault());

  surface.addEventListener('pointerdown', (event) => {
    if (isUiEvent(event)) return;
    closeMenu();
    try {
      surface.setPointerCapture(event.pointerId);
    } catch {
      // Untrusted / synthetic events may not capture.
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    last = { x: event.clientX, y: event.clientY };
    origin = { x: event.clientX, y: event.clientY };
    tapSlop = event.pointerType === 'touch' ? 12 : 2;
    moved = false;
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
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastPinch > 0 && dist > 0) {
        const mid = at((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
        handlers.setView(zoomAbout(handlers.getView(), mid.x, mid.y, (lastPinch / dist) ** PINCH_ZOOM, handlers.getWorld()), {
          navigating: true,
        });
      }
      lastPinch = dist;
      dragging = false;
      return;
    }
    if (!dragging) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > tapSlop) moved = true;
    last = { x: event.clientX, y: event.clientY };
    const box = surface.getBoundingClientRect();
    handlers.setView(panView(handlers.getView(), dx, dy, box.width, box.height), { navigating: true });
    surface.classList.add('is-dragging');
    emitHover(event.clientX, event.clientY);
  });

  function endPointer(event: PointerEvent): void {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) lastPinch = 0;
    if (event.button === 0 && dragging && !moved) {
      const point = at(event.clientX, event.clientY);
      handlers.pickPoint(point.x, point.y, event.clientX, event.clientY);
      // A finger tap poses the pendulum. Click-to-zoom is a mouse/pen action.
      if (event.pointerType !== 'touch') {
        handlers.setView(
          zoomAbout(handlers.getView(), point.x, point.y, CLICK_ZOOM_FACTOR, handlers.getWorld()),
          { pushHistory: true, animate: true },
        );
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
    closeMenu();
    const point = at(event.clientX, event.clientY);
    handlers.setView(
      zoomAbout(handlers.getView(), point.x, point.y, Math.exp(event.deltaY * WHEEL_ZOOM), handlers.getWorld()),
      { navigating: true },
    );
    emitHover(event.clientX, event.clientY);
  }, { passive: false });
}
