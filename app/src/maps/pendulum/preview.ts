import { theme } from '../../theme';
import { createTrajectory, type Trajectory } from '../../wasm/core';
import type { MapParams, PointVisualizer } from '../types';

function replayLength(point: { x: number; y: number }, params: MapParams): number {
  const traj = createTrajectory(point.x, point.y);
  const dt = params.DT;
  while (!traj.done) traj.step(params, dt);
  return traj.steps;
}

function drawDownAxis(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
): void {
  ctx.save();
  ctx.strokeStyle = theme().previewAxis;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + len);
  ctx.stroke();
  ctx.restore();
}

/** Bitmap pixel of the white pivot — same origin the rods hang from. */
export function pendulumPivot(width: number, height: number): { x: number; y: number } {
  return { x: width / 2, y: height / 2 + 8 };
}

function drawPose(
  ctx: CanvasRenderingContext2D,
  th1: number,
  th2: number,
  params: MapParams,
): void {
  const pal = theme();
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  const L1 = params.L1;
  const L2 = params.L2;
  const total = Math.max(L1 + L2, 1e-6);
  const scale = (Math.min(width, height) * 0.4) / total;
  const { x: x0, y: y0 } = pendulumPivot(width, height);
  const x1 = x0 + Math.sin(th1) * L1 * scale;
  const y1 = y0 + Math.cos(th1) * L1 * scale;
  const x2 = x1 + Math.sin(th2) * L2 * scale;
  const y2 = y1 + Math.cos(th2) * L2 * scale;

  const axisLen = Math.min(L1, L2) * scale * 0.65;
  drawDownAxis(ctx, x0, y0, axisLen);
  drawDownAxis(ctx, x1, y1, axisLen * 0.85);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = pal.th1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = pal.th2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.fillStyle = pal.th1;
  dot(ctx, x1, y1, 6);
  ctx.fillStyle = pal.th2;
  dot(ctx, x2, y2, 6);
  ctx.fillStyle = pal.pivot;
  dot(ctx, x0, y0, 4);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export const pendulumPreview: PointVisualizer = {
  draw(ctx, point, params) {
    drawPose(ctx, point.x, point.y, params);
  },
  anchor(canvas) {
    return pendulumPivot(canvas.width, canvas.height);
  },
  createState(point) {
    return createTrajectory(point.x, point.y);
  },
  step(state, params, dt) {
    const traj = state as Trajectory;
    traj.step(params, dt);
    return traj;
  },
  drawState(ctx, state, params) {
    const traj = state as Trajectory;
    drawPose(ctx, traj.th1, traj.th2, params);
  },
  replayDt(params) {
    return params.DT;
  },
  replayDone(state) {
    return (state as Trajectory).done;
  },
  replaySteps(state) {
    return (state as Trajectory).steps;
  },
  replayLength,
};
