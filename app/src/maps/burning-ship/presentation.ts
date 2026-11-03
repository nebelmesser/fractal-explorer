import type { MapPresentation, MapPresentationFactory, PresentationHost } from '../../viewer/presentation';
import { bindMenu, syncBudgetReadout, type MenuBinding } from '../../viewer/menu';
import { drawBurningShipAxes } from './axes';
import { shipCompositor } from './compositor';
import { SHIP_DEFAULT_ITER, ORBIT_PREFERENCE_KEY } from './constants';
import { mountShipOrbit } from './orbit-overlay';

function requireElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`BurningShip presentation is missing #${id}`);
  return element as unknown as T;
}

function mountBurningShipPresentation(host: PresentationHost): MapPresentation {
  const orbit = mountShipOrbit(host);
  const showOrbit = requireElement<HTMLInputElement>('show-ship-orbit');
  try { showOrbit.checked = localStorage.getItem(ORBIT_PREFERENCE_KEY) !== 'false'; } catch { /* Storage may be unavailable. */ }
  orbit.setEnabled(showOrbit.checked);
  showOrbit.addEventListener('change', () => {
    orbit.setEnabled(showOrbit.checked);
    try { localStorage.setItem(ORBIT_PREFERENCE_KEY, String(showOrbit.checked)); } catch { /* Keep the in-memory preference. */ }
  });
  const axes = requireElement<HTMLCanvasElement>('map-axes');
  const xScale = requireElement<HTMLElement>('map-scale-x');
  const yScale = requireElement<HTMLElement>('map-scale-y');
  const hud = requireElement<HTMLElement>('map-hud');
  const readout = requireElement<HTMLElement>('ship-readout');
  const sidebar = requireElement<HTMLElement>('sidebar');
  const locale = requireElement<HTMLElement>('narration-locale');
  const menuToggle = requireElement<HTMLElement>('menu-toggle');
  let hover: { x: number; y: number } | null = null;
  let picked: { x: number; y: number } | null = null;
  let drawFrame = 0;
  let menuUi: MenuBinding | null = null;

  function syncHudBounds(): void {
    const gap = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--ctrl-gap'),
    ) || 0;
    const left = sidebar.getBoundingClientRect().right + gap;
    const right = Math.min(
      locale.getBoundingClientRect().left,
      menuToggle.getBoundingClientRect().left,
    ) - gap;
    const width = Math.max(0, right - left);
    hud.style.setProperty('--burning-ship-hud-center-x', `${left + width / 2}px`);
    hud.style.setProperty('--burning-ship-hud-max-width', `${width}px`);
  }

  function drawNow(): void {
    drawFrame = 0;
    drawBurningShipAxes(axes, host.getView(), xScale, yScale, picked);
    orbit.draw();
    const point = hover ? host.snapToRenderedPixel(host.clientToWorld(hover.x, hover.y)) : picked;
    const iterations = Math.round(host.params.MAX_ITERATIONS ?? SHIP_DEFAULT_ITER);
    readout.textContent = point
      ? `Re ${point.x.toPrecision(7)} · Im ${point.y.toPrecision(7)}`
      : `Burning Ship · ${iterations}`;
  }

  function draw(): void {
    if (!drawFrame) drawFrame = requestAnimationFrame(drawNow);
  }

  host.clip.addEventListener('pointermove', (event) => {
    if (event.buttons !== 0 || (event.target instanceof Element && event.target.closest('[data-viewer-ui]'))) hover = null;
    else hover = { x: event.clientX, y: event.clientY };
    draw();
  });
  host.clip.addEventListener('pointerleave', () => {
    hover = null;
    draw();
  });

  const hudResize = new ResizeObserver(syncHudBounds);
  hudResize.observe(sidebar);
  hudResize.observe(locale);
  hudResize.observe(menuToggle);
  window.addEventListener('resize', syncHudBounds);
  syncHudBounds();

  menuUi = bindMenu(
    host.map,
    host.controls,
    host.onParamsChange,
    host.resetTransition,
    host.signals,
  );

  return {
    draw,
    tick: orbit.tick,
    reset() {
      hover = null;
      picked = null;
      orbit.clear();
      draw();
    },
    noteActivity() {},
    resize() {
      syncHudBounds();
      draw();
    },
    dismiss: () => menuUi?.setOpen(false),
    pickPoint(x, y, _clientX, _clientY, pointerType) {
      orbit.pickPoint(x, y, _clientX, _clientY, pointerType);
      const compactLayout = window.matchMedia('(max-width: 700px), (max-height: 500px)').matches;
      if (pointerType === 'mouse' && !compactLayout) return false;
      picked = { x, y };
      hover = null;
      draw();
      return false;
    },
    syncBudget: syncBudgetReadout,
  };
}

export const shipPresentation: MapPresentationFactory = {
  compositor: shipCompositor,
  mount: mountBurningShipPresentation,
};
