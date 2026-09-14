import type { MapPresentation, MapPresentationFactory, PresentationHost } from '../../viewer/presentation';
import { bindMenu, syncBudgetReadout, type MenuBinding } from '../../viewer/menu';
import { viewSpanX, viewSpanY, type ViewRect } from '../types';
import { drawMagnetsAxes } from './axes';
import { magnetsCompositor } from './compositor';
import { MAGNET_BOB_R, MAGNET_MARKER_R, MAGNET_RGB, magnetPositions } from './constants';
import { magnetsFromParams, traceCapture, type MagnetsPoint } from './physics';

function requireElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Magnetic-pendulum presentation is missing #${id}`);
  return element as unknown as T;
}

function physicsToScreen(view: ViewRect, point: MagnetsPoint, width: number, height: number): MagnetsPoint {
  return {
    x: (point.x - view.xMin) / viewSpanX(view) * width,
    y: (point.y - view.yMin) / viewSpanY(view) * height,
  };
}

function clientToPhysics(host: PresentationHost, clientX: number, clientY: number): MagnetsPoint {
  return host.clientToWorld(clientX, clientY);
}

const MAGNET_FILL = MAGNET_RGB;
const MAGNET_PATH = '#fff';
const MAGNET_PATH_EDGE = '#000';

function mountMagnetsPresentation(host: PresentationHost): MapPresentation {
  const axes = requireElement<HTMLCanvasElement>('map-axes');
  const overlay = requireElement<HTMLCanvasElement>('probe-overlay');
  const xScale = requireElement<HTMLElement>('map-scale-x');
  const yScale = requireElement<HTMLElement>('map-scale-y');
  overlay.getContext('2d', { alpha: true, desynchronized: true });

  let hover: MagnetsPoint | null = null;
  let drawFrame = 0;
  let menuUi: MenuBinding | null = null;

  function resizeOverlay(): { width: number; height: number } {
    const width = overlay.clientWidth;
    const height = overlay.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(width * dpr);
    const ph = Math.round(height * dpr);
    if (overlay.width !== pw || overlay.height !== ph) {
      overlay.width = pw;
      overlay.height = ph;
    }
    return { width, height };
  }

  function paintDisk(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    fill: string,
  ): void {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }

  function drawOverlay(): void {
    const { width, height } = resizeOverlay();
    const ctx = overlay.getContext('2d');
    if (!ctx || width < 8 || height < 8) return;
    const dpr = overlay.width / Math.max(width, 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const view = host.getView();
    const phys = magnetsFromParams(host.params);

    const magnets = magnetPositions(phys.R);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    magnets.forEach((magnet, i) => {
      const p = physicsToScreen(view, magnet, width, height);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();

    if (hover) {
      const trace = traceCapture(hover.x, hover.y, phys);
      ctx.beginPath();
      trace.path.forEach((point, i) => {
        const p = physicsToScreen(view, point, width, height);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.strokeStyle = MAGNET_PATH_EDGE;
      ctx.lineWidth = 3.25;
      ctx.stroke();
      ctx.strokeStyle = MAGNET_PATH;
      ctx.lineWidth = 1.7;
      ctx.stroke();
      const bob = physicsToScreen(view, hover, width, height);
      paintDisk(ctx, bob.x, bob.y, MAGNET_BOB_R, MAGNET_FILL[trace.magnet] ?? MAGNET_FILL[0]);
    }

    const pivot = physicsToScreen(view, { x: 0, y: 0 }, width, height);
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    for (let i = 0; i < magnets.length; i++) {
      const p = physicsToScreen(view, magnets[i], width, height);
      paintDisk(ctx, p.x, p.y, MAGNET_MARKER_R, MAGNET_FILL[i]);
    }
  }

  function drawNow(): void {
    drawFrame = 0;
    drawMagnetsAxes(axes, host.getView(), xScale, yScale);
    drawOverlay();
  }

  function draw(): void {
    if (drawFrame) return;
    drawFrame = requestAnimationFrame(drawNow);
  }

  function onPointer(event: PointerEvent): void {
    if (event.buttons !== 0) {
      hover = null;
      draw();
      return;
    }
    hover = host.snapToRenderedPixel(clientToPhysics(host, event.clientX, event.clientY));
    draw();
  }

  host.clip.addEventListener('pointermove', onPointer);
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

export const magnetsPresentation: MapPresentationFactory = {
  compositor: magnetsCompositor,
  mount: mountMagnetsPresentation,
};
