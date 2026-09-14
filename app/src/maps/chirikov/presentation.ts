import type { MapPresentation, MapPresentationFactory, PresentationHost } from '../../viewer/presentation';
import { bindMenu, syncBudgetReadout, type MenuBinding } from '../../viewer/menu';
import { drawChirikovAxes } from './axes';
import { chirikovCompositor } from './compositor';
import {
  CHIRIKOV_DEFAULT_ITER,
  CHIRIKOV_K_DEFAULT,
} from './constants';
import { chirikovSignature } from './physics';

function requireElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Chirikov presentation is missing #${id}`);
  return element as unknown as T;
}

function signed(value: number, digits: number): string {
  const sign = value < 0 ? '−' : '+';
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

function mountChirikovPresentation(host: PresentationHost): MapPresentation {
  const axes = requireElement<HTMLCanvasElement>('map-axes');
  const xScale = requireElement<HTMLElement>('map-scale-x');
  const yScale = requireElement<HTMLElement>('map-scale-y');
  const readout = requireElement<HTMLElement>('chirikov-readout');
  let hover: { x: number; y: number } | null = null;
  let drawFrame = 0;
  let menuUi: MenuBinding | null = null;

  function drawNow(): void {
    drawFrame = 0;
    drawChirikovAxes(axes, host.getView(), xScale, yScale);
    const k = host.params.K ?? CHIRIKOV_K_DEFAULT;
    const iterations = host.params.MAX_ITERATIONS ?? CHIRIKOV_DEFAULT_ITER;
    if (!hover) {
      readout.textContent = `K ${k.toFixed(3)} · ${Math.round(iterations)}`;
      return;
    }
    const point = host.clientToWorld(hover.x, hover.y);
    const signature = chirikovSignature(point.x, point.y, k, Math.min(256, iterations));
    readout.textContent = [
      `θ ${signed(point.x, 4)}`,
      `p ${signed(point.y, 4)}`,
      `C ${signature.coherence.toFixed(3)}`,
    ].join(' · ');
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
    resize: draw,
    dismiss: () => menuUi?.setOpen(false),
    pickPoint() { return false; },
    syncBudget: syncBudgetReadout,
  };
}

export const chirikovPresentation: MapPresentationFactory = {
  compositor: chirikovCompositor,
  mount: mountChirikovPresentation,
};
