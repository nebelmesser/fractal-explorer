import { PROBE_BOB_R } from '../../constants';
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

/** Semi-transparent pose with the pivot at `origin` (CSS pixels). */
export function drawOverlayPendulum(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  th1: number,
  th2: number,
  params: MapParams,
  pxPerLen: number,
  alpha: number,
): void {
  const pal = theme();
  const L1 = params.L1;
  const L2 = params.L2;
  const scale = pxPerLen;
  const x0 = origin.x;
  const y0 = origin.y;
  const x1 = x0 + Math.sin(th1) * L1 * scale;
  const y1 = y0 + Math.cos(th1) * L1 * scale;
  const x2 = x1 + Math.sin(th2) * L2 * scale;
  const y2 = y1 + Math.cos(th2) * L2 * scale;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.5;
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
  dot(ctx, x1, y1, PROBE_BOB_R * Math.sqrt(Math.max(params.M1, 0)));
  ctx.fillStyle = pal.th2;
  dot(ctx, x2, y2, PROBE_BOB_R * Math.sqrt(Math.max(params.M2, 0)));
  ctx.restore();
}

/** Overlay-only flight after the pin releases. Map kernel stays constrained. */
export type FlyState = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  vx1: number;
  vy1: number;
  vx2: number;
  vy2: number;
  th1: number;
  w1: number;
};

export function startFly(
  th1: number,
  th2: number,
  w1: number,
  w2: number,
  L1: number,
  L2: number,
): FlyState {
  const s1 = Math.sin(th1);
  const c1 = Math.cos(th1);
  const s2 = Math.sin(th2);
  const c2 = Math.cos(th2);
  const x1 = s1 * L1;
  const y1 = c1 * L1;
  const x2 = x1 + s2 * L2;
  const y2 = y1 + c2 * L2;
  const vx1 = w1 * c1 * L1;
  const vy1 = -w1 * s1 * L1;
  return {
    x1,
    y1,
    x2,
    y2,
    vx1,
    vy1,
    vx2: vx1 + w2 * c2 * L2,
    vy2: vy1 - w2 * s2 * L2,
    th1,
    w1,
  };
}

export function stepFly(fly: FlyState, params: MapParams, dt: number): void {
  const F = params.F ?? 0;
  const L2 = params.L2;
  const m1 = Math.max(params.M1, 1e-6);
  const m2 = Math.max(params.M2, 1e-6);
  fly.vy1 += params.G * dt;
  fly.vy2 += params.G * dt;
  fly.vx1 -= F * fly.vx1 * dt;
  fly.vy1 -= F * fly.vy1 * dt;
  fly.vx2 -= F * fly.vx2 * dt;
  fly.vy2 -= F * fly.vy2 * dt;
  fly.x1 += fly.vx1 * dt;
  fly.y1 += fly.vy1 * dt;
  fly.x2 += fly.vx2 * dt;
  fly.y2 += fly.vy2 * dt;
  const dx = fly.x2 - fly.x1;
  const dy = fly.y2 - fly.y1;
  const dist = Math.hypot(dx, dy);
  if (dist > 1e-9) {
    const nx = dx / dist;
    const ny = dy / dist;
    const err = dist - L2;
    const w1 = 1 / m1;
    const w2 = 1 / m2;
    const ws = w1 + w2;
    fly.x1 += nx * err * (w1 / ws);
    fly.y1 += ny * err * (w1 / ws);
    fly.x2 -= nx * err * (w2 / ws);
    fly.y2 -= ny * err * (w2 / ws);
    const vn = (fly.vx2 - fly.vx1) * nx + (fly.vy2 - fly.vy1) * ny;
    fly.vx1 += nx * vn * (w1 / ws);
    fly.vy1 += ny * vn * (w1 / ws);
    fly.vx2 -= nx * vn * (w2 / ws);
    fly.vy2 -= ny * vn * (w2 / ws);
  }
  fly.th1 += fly.w1 * dt;
}

export function flyOffscreen(fly: FlyState, limit: number): boolean {
  return Math.max(Math.hypot(fly.x1, fly.y1), Math.hypot(fly.x2, fly.y2)) > limit;
}

export function drawOverlayFly(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  fly: FlyState,
  params: MapParams,
  pxPerLen: number,
  alpha: number,
): void {
  const pal = theme();
  const scale = pxPerLen;
  const L1 = params.L1;
  const tipX = origin.x + (fly.x1 - Math.sin(fly.th1) * L1) * scale;
  const tipY = origin.y + (fly.y1 - Math.cos(fly.th1) * L1) * scale;
  const x1 = origin.x + fly.x1 * scale;
  const y1 = origin.y + fly.y1 * scale;
  const x2 = origin.x + fly.x2 * scale;
  const y2 = origin.y + fly.y2 * scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = pal.th1;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = pal.th2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.fillStyle = pal.th1;
  dot(ctx, x1, y1, PROBE_BOB_R * Math.sqrt(Math.max(params.M1, 0)));
  ctx.fillStyle = pal.th2;
  dot(ctx, x2, y2, PROBE_BOB_R * Math.sqrt(Math.max(params.M2, 0)));
  ctx.restore();
}

/** Targeting crosshair: dark halo + light core so it reads on any map gray. */
export function drawProbeCross(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  half: number,
): void {
  const gap = Math.min(2, half * 0.28);
  const stroke = (color: string, width: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(origin.x - half, origin.y);
    ctx.lineTo(origin.x - gap, origin.y);
    ctx.moveTo(origin.x + gap, origin.y);
    ctx.lineTo(origin.x + half, origin.y);
    ctx.moveTo(origin.x, origin.y - half);
    ctx.lineTo(origin.x, origin.y - gap);
    ctx.moveTo(origin.x, origin.y + gap);
    ctx.lineTo(origin.x, origin.y + half);
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = 'butt';
  stroke('rgba(0, 0, 0, 0.92)', 3.4);
  stroke('rgba(255, 255, 255, 0.96)', 1.2);
  ctx.restore();
}

/** Shared hang point, drawn below the two sights. */
export function drawProbePivot(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  radius: number,
): void {
  ctx.save();
  ctx.fillStyle = theme().pivot;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
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
