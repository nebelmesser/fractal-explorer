import type { MapPresentation, MapPresentationFactory, PresentationHost } from '../../viewer/presentation';
import { bindMenu, syncBudgetReadout, type MenuBinding } from '../../viewer/menu';
import { drawLyapunovAxes } from './axes';
import { lyapunovCompositor } from './compositor';
import {
  LYAPUNOV_MIN_ITER,
  LYAPUNOV_RHYTHM_DEFAULT,
  LYAPUNOV_RHYTHMS,
  LYAPUNOV_SEED,
} from './constants';
import { lyapunovExponent } from './physics';

function requireElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Lyapunov presentation is missing #${id}`);
  return element as unknown as T;
}

function formatExponent(value: number): string {
  const sign = value < 0 ? '−' : '+';
  return `${sign}${Math.abs(value).toFixed(4)}`;
}

function currentRhythm(params: Record<string, number>): string {
  const index = Math.max(0, Math.min(
    LYAPUNOV_RHYTHMS.length - 1,
    Math.round(params.RHYTHM ?? LYAPUNOV_RHYTHM_DEFAULT),
  ));
  return LYAPUNOV_RHYTHMS[index];
}

function mountLyapunovPresentation(host: PresentationHost): MapPresentation {
  const axes = requireElement<HTMLCanvasElement>('map-axes');
  const xScale = requireElement<HTMLElement>('map-scale-x');
  const yScale = requireElement<HTMLElement>('map-scale-y');
  const hud = requireElement<HTMLElement>('map-hud');
  const readout = requireElement<HTMLElement>('lyapunov-readout');
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
    hud.style.setProperty('--lyapunov-hud-center-x', `${left + width / 2}px`);
    hud.style.setProperty('--lyapunov-hud-max-width', `${width}px`);
  }

  function drawNow(): void {
    drawFrame = 0;
    drawLyapunovAxes(axes, host.getView(), xScale, yScale, picked);
    const point = hover ? host.clientToWorld(hover.x, hover.y) : picked;
    if (!point) {
      readout.textContent = currentRhythm(host.params);
      return;
    }
    const measured = Math.min(640, host.params.MAX_ITERATIONS ?? LYAPUNOV_MIN_ITER);
    const exponent = lyapunovExponent(
      point.x,
      point.y,
      measured,
      host.params.RHYTHM ?? LYAPUNOV_RHYTHM_DEFAULT,
      host.params.SEED ?? LYAPUNOV_SEED,
    );
    readout.textContent = `A ${point.x.toFixed(5)} · B ${point.y.toFixed(5)} · λ ${formatExponent(exponent)}`;
  }

  function draw(): void {
    if (!drawFrame) drawFrame = requestAnimationFrame(drawNow);
  }

  host.clip.addEventListener('pointermove', (event) => {
    if (event.buttons !== 0) hover = null;
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
    tick() {},
    reset() {
      hover = null;
      draw();
    },
    noteActivity() {},
    resize() {
      syncHudBounds();
      draw();
    },
    dismiss: () => menuUi?.setOpen(false),
    pickPoint(x, y, _clientX, _clientY, pointerType) {
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

export const lyapunovPresentation: MapPresentationFactory = {
  compositor: lyapunovCompositor,
  mount: mountLyapunovPresentation,
};
