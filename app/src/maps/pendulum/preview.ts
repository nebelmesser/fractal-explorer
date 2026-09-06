import { theme } from '../../theme';
import { createTrajectory, type Trajectory } from '../../wasm/core';
import type { MapParams, PointVisualizer } from '../types';

function replayLength(point: { x: number; y: number }, params: MapParams): number {
  const traj = createTrajectory(point.x, point.y);
  const dt = params.DT;
  while (!traj.done) traj.step(params, dt);
  return traj.steps;
}

/** Principal angle so the wedge matches the visible rod, not a winding count. */
function wrapPi(theta: number): number {
  let a = theta % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Same (sin, cos) as the rods: θ = 0 hangs down, +θ goes right. */
function drawAnglePie(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  theta: number,
  color: string,
): void {
  const pal = theme();
  const a = wrapPi(theta);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = pal.pieTrack;
  ctx.fill();
  ctx.strokeStyle = pal.previewAxis;
  ctx.lineWidth = 1;
  ctx.stroke();

  const steps = Math.max(6, Math.round(Math.abs(a) / 0.07));
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy + r);
  for (let i = 1; i <= steps; i++) {
    const t = a * (i / steps);
    ctx.lineTo(cx + Math.sin(t) * r, cy + Math.cos(t) * r);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.88;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy + r);
  ctx.strokeStyle = pal.pieZero;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(a) * r, cy + Math.cos(a) * r);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

const PIE_PAD = 6;
const PIE_R = 8;
const PIE_GAP = 6;

function drawAngleRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  theta: number,
  color: string,
): void {
  drawAnglePie(ctx, x + PIE_R, y, PIE_R, theta, color);
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

function previewCssSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  return {
    width: Math.max(1, canvas.clientWidth),
    height: Math.max(1, canvas.clientHeight),
  };
}

function drawPose(
  ctx: CanvasRenderingContext2D,
  th1: number,
  th2: number,
  params: MapParams,
  start: { th1: number; th2: number },
  _digits: number,
): void {
  const pal = theme();
  const { width, height } = previewCssSize(ctx.canvas);
  const sx = ctx.canvas.width / width;
  const sy = ctx.canvas.height / height;
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
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

  const pieY0 = PIE_PAD + PIE_R;
  const pieY1 = pieY0 + PIE_R * 2 + PIE_GAP;
  drawAngleRow(ctx, PIE_PAD, pieY0, start.th1, pal.th1);
  drawAngleRow(ctx, PIE_PAD, pieY1, start.th2, pal.th2);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export const pendulumPreview: PointVisualizer = {
  draw(ctx, point, params, degDigits = 1) {
    drawPose(ctx, point.x, point.y, params, { th1: point.x, th2: point.y }, degDigits);
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
  drawState(ctx, state, params, degDigits = 1) {
    const traj = state as Trajectory;
    drawPose(ctx, traj.th1, traj.th2, params, { th1: traj.startTh1, th2: traj.startTh2 }, degDigits);
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
