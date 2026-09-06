import { theme } from '../theme';
import { copyView, type ViewRect } from '../maps/types';

/** Draw the current viewport as a rectangle on the overview (2D overlay). */
export function drawOverviewFrame(
  overlay: HTMLCanvasElement,
  world: ViewRect,
  current: ViewRect,
): void {
  const ctx = overlay.getContext('2d');
  if (!ctx) return;
  const w = overlay.width;
  const h = overlay.height;
  ctx.clearRect(0, 0, w, h);
  const x = ((current.xMin - world.xMin) / (world.xMax - world.xMin)) * w;
  const y = ((current.yMin - world.yMin) / (world.yMax - world.yMin)) * h;
  const rw = ((current.xMax - current.xMin) / (world.xMax - world.xMin)) * w;
  const rh = ((current.yMax - current.yMin) / (world.yMax - world.yMin)) * h;
  ctx.strokeStyle = theme().zoomFrame;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(rw, 2), Math.max(rh, 2));
}

export { copyView };
