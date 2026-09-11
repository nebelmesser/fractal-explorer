import {
  PROBE_GRID_BOB_R,
  PROBE_GRID_ROD_PX,
  PROBE_LARGE_BOB_PER_LEN,
  PROBE_LARGE_ROD_PER_LEN,
  PROBE_OUTLINE_PX,
} from './constants';
import { theme } from './theme';
import { createTrajectory } from './trajectory';
import type { MapParams } from '../types';

export type OverlayStyle = {
  large: boolean;
  pxPerLen: number;
  alpha: number;
  color?: string;
};

export type OverlaySight = {
  x: number;
  y: number;
  alpha: number;
  crossHalf: number;
  pivotR: number;
};

export function overlayRodWidth(style: OverlayStyle): number {
  if (style.large) return Math.max(3.2, style.pxPerLen * PROBE_LARGE_ROD_PER_LEN);
  return PROBE_GRID_ROD_PX;
}

export function overlayBobRadius(mass: number, style: OverlayStyle): number {
  const k = Math.sqrt(Math.max(mass, 0));
  if (style.large) {
    return Math.max(5, style.pxPerLen * PROBE_LARGE_BOB_PER_LEN * k);
  }
  return Math.max(3.2, PROBE_GRID_BOB_R * k);
}

type OverlayRod = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  width: number;
};

type OverlayBob = { x: number; y: number; r: number; color: string };

function trimRod(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  trim0: number,
  trim1: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return null;
  const ux = dx / len;
  const uy = dy / len;
  const a = Math.min(Math.max(0, trim0), len * 0.45);
  const b = Math.min(Math.max(0, trim1), len * 0.45);
  if (a + b >= len) return null;
  return { x0: x0 + ux * a, y0: y0 + uy * a, x1: x1 - ux * b, y1: y1 - uy * b };
}

let figureLayer: HTMLCanvasElement | null = null;
let figureLayerCtx: CanvasRenderingContext2D | null = null;

function figureBounds(
  rods: OverlayRod[],
  bobs: OverlayBob[],
  sight?: OverlaySight,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number, r: number): void => {
    minX = Math.min(minX, x - r);
    minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r);
    maxY = Math.max(maxY, y + r);
  };
  const pad = PROBE_OUTLINE_PX + 2;
  for (const rod of rods) {
    const r = rod.width / 2 + pad;
    include(rod.x0, rod.y0, r);
    include(rod.x1, rod.y1, r);
  }
  for (const bob of bobs) include(bob.x, bob.y, bob.r + pad);
  if (sight) include(sight.x, sight.y, sight.crossHalf + 4);
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function layerContext(cssW: number, cssH: number, dpr: number): CanvasRenderingContext2D {
  const w = Math.max(1, Math.ceil(cssW * dpr));
  const h = Math.max(1, Math.ceil(cssH * dpr));
  if (!figureLayer || !figureLayerCtx) {
    figureLayer = document.createElement('canvas');
    figureLayerCtx = figureLayer.getContext('2d');
    if (!figureLayerCtx) throw new Error('overlay layer');
  }
  if (figureLayer.width < w || figureLayer.height < h) {
    figureLayer.width = w;
    figureLayer.height = h;
  } else {
    figureLayerCtx.setTransform(1, 0, 0, 1, 0, 0);
    figureLayerCtx.clearRect(0, 0, w, h);
  }
  figureLayerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return figureLayerCtx;
}

function strokeRods(ctx: CanvasRenderingContext2D, rods: OverlayRod[], extra: number): void {
  for (const rod of rods) {
    ctx.lineWidth = rod.width + extra;
    ctx.beginPath();
    ctx.moveTo(rod.x0, rod.y0);
    ctx.lineTo(rod.x1, rod.y1);
    ctx.stroke();
  }
}

function fillDisks(ctx: CanvasRenderingContext2D, bobs: OverlayBob[], extra: number): void {
  for (const bob of bobs) {
    ctx.beginPath();
    ctx.arc(bob.x, bob.y, bob.r + extra, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Grid: draw on the overlay. Rods stay trimmed; bobs paint over joints. No offscreen. */
function drawOverlayFigureFast(
  ctx: CanvasRenderingContext2D,
  rods: OverlayRod[],
  bobs: OverlayBob[],
  alpha: number,
  sight?: OverlaySight,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  for (const rod of rods) {
    ctx.strokeStyle = rod.color;
    ctx.lineWidth = rod.width;
    ctx.beginPath();
    ctx.moveTo(rod.x0, rod.y0);
    ctx.lineTo(rod.x1, rod.y1);
    ctx.stroke();
  }
  if (sight) {
    ctx.globalAlpha = 1;
    drawProbePivot(ctx, { x: sight.x, y: sight.y }, sight.pivotR, sight.alpha);
    drawProbeCross(ctx, { x: sight.x, y: sight.y }, sight.crossHalf, sight.alpha);
  }
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  for (const bob of bobs) {
    ctx.fillStyle = bob.color;
    ctx.beginPath();
    ctx.arc(bob.x, bob.y, bob.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawOverlayFigure(
  ctx: CanvasRenderingContext2D,
  rods: OverlayRod[],
  bobs: OverlayBob[],
  alpha: number,
  large: boolean,
  sight?: OverlaySight,
): void {
  if (!large) {
    drawOverlayFigureFast(ctx, rods, bobs, alpha, sight);
    return;
  }
  const bounds = figureBounds(rods, bobs, sight);
  const destDpr = ctx.getTransform().a || 1;
  const layerDpr = destDpr;
  const layer = layerContext(bounds.w, bounds.h, layerDpr);
  const pal = theme();
  layer.save();
  layer.translate(-bounds.x, -bounds.y);
  layer.lineCap = 'round';
  layer.lineJoin = 'round';

  const ring = PROBE_OUTLINE_PX * 2;
  layer.globalAlpha = 1;
  layer.strokeStyle = pal.figureOutline;
  layer.fillStyle = pal.figureOutline;
  strokeRods(layer, rods, ring);
  fillDisks(layer, bobs, PROBE_OUTLINE_PX);
  layer.globalCompositeOperation = 'destination-out';
  strokeRods(layer, rods, 0);
  fillDisks(layer, bobs, 0);

  layer.globalCompositeOperation = 'source-over';
  layer.globalAlpha = Math.max(0, Math.min(1, alpha));
  for (const rod of rods) {
    layer.strokeStyle = rod.color;
    layer.lineWidth = rod.width;
    layer.beginPath();
    layer.moveTo(rod.x0, rod.y0);
    layer.lineTo(rod.x1, rod.y1);
    layer.stroke();
  }
  if (sight) {
    layer.globalAlpha = 1;
    drawProbePivot(layer, { x: sight.x, y: sight.y }, sight.pivotR, sight.alpha);
    drawProbeCross(layer, { x: sight.x, y: sight.y }, sight.crossHalf, sight.alpha);
  }

  layer.globalCompositeOperation = 'destination-out';
  layer.globalAlpha = 1;
  fillDisks(layer, bobs, 0);
  layer.globalCompositeOperation = 'source-over';
  layer.globalAlpha = Math.max(0, Math.min(1, alpha));
  for (const bob of bobs) {
    layer.fillStyle = bob.color;
    layer.beginPath();
    layer.arc(bob.x, bob.y, bob.r, 0, Math.PI * 2);
    layer.fill();
  }
  layer.restore();

  ctx.drawImage(
    figureLayer!,
    0,
    0,
    bounds.w * layerDpr,
    bounds.h * layerDpr,
    bounds.x,
    bounds.y,
    bounds.w,
    bounds.h,
  );
}

function overlayParts(
  params: MapParams,
  style: OverlayStyle,
  rodsIn: { x0: number; y0: number; x1: number; y1: number }[],
  bobPts: { x: number; y: number }[],
): { rods: OverlayRod[]; bobs: OverlayBob[] } {
  const pal = theme();
  const width = overlayRodWidth(style);
  const r1 = overlayBobRadius(params.M1, style);
  const r2 = overlayBobRadius(params.M2, style);
  const radii = [r1, r2];
  const rods: OverlayRod[] = [];
  const colors = style.color ? [style.color, style.color] : [pal.th1, pal.th2];
  for (let i = 0; i < rodsIn.length; i++) {
    const rod = rodsIn[i];
    const trim0 = i === 0 ? 0 : radii[i - 1];
    const trim1 = radii[Math.min(i, radii.length - 1)];
    const cut = trimRod(rod.x0, rod.y0, rod.x1, rod.y1, trim0, trim1);
    if (cut) rods.push({ ...cut, color: colors[i], width });
  }
  return {
    rods,
    bobs: [
      { x: bobPts[0].x, y: bobPts[0].y, r: r1, color: colors[0] },
      { x: bobPts[1].x, y: bobPts[1].y, r: r2, color: colors[1] },
    ],
  };
}

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
  style: OverlayStyle,
  sight?: OverlaySight,
): void {
  const scale = style.pxPerLen;
  const x0 = origin.x;
  const y0 = origin.y;
  const x1 = x0 + Math.sin(th1) * params.L1 * scale;
  const y1 = y0 + Math.cos(th1) * params.L1 * scale;
  const x2 = x1 + Math.sin(th2) * params.L2 * scale;
  const y2 = y1 + Math.cos(th2) * params.L2 * scale;
  const { rods, bobs } = overlayParts(
    params,
    style,
    [
      { x0, y0, x1, y1 },
      { x0: x1, y0: y1, x1: x2, y1: y2 },
    ],
    [{ x: x1, y: y1 }, { x: x2, y: y2 }],
  );
  drawOverlayFigure(ctx, rods, bobs, style.alpha, style.large, sight);
}

let fieldLive = new Uint8Array(0);
let fieldX1 = new Float64Array(0);
let fieldY1 = new Float64Array(0);
let fieldX2 = new Float64Array(0);
let fieldY2 = new Float64Array(0);

function fieldScratch(n: number): void {
  if (fieldLive.length >= n) return;
  const cap = Math.max(n, fieldLive.length * 2);
  fieldLive = new Uint8Array(cap);
  fieldX1 = new Float64Array(cap);
  fieldY1 = new Float64Array(cap);
  fieldX2 = new Float64Array(cap);
  fieldY2 = new Float64Array(cap);
}

/**
 * Many map-tied probes: two path batches instead of a figure per pendulum.
 * Skip bobs past a few hundred — the rods already read at Start-grid size.
 */
export function drawOverlayPendulumField(
  ctx: CanvasRenderingContext2D,
  origins: { x: number; y: number }[],
  th1: number[],
  th2: number[],
  params: MapParams,
  style: OverlayStyle,
  last: number,
  width: number,
  height: number,
): void {
  const pal = theme();
  const scale = style.pxPerLen;
  const len1 = params.L1 * scale;
  const len2 = params.L2 * scale;
  const pad = 160 + len1 + len2;
  fieldScratch(last);
  const live = fieldLive;
  const x1s = fieldX1;
  const y1s = fieldY1;
  const x2s = fieldX2;
  const y2s = fieldY2;
  for (let i = 0; i < last; i++) {
    const origin = origins[i];
    if (
      origin.x < -pad || origin.y < -pad || origin.x > width + pad || origin.y > height + pad
    ) {
      live[i] = 0;
      continue;
    }
    live[i] = 1;
    const ax = origin.x + Math.sin(th1[i]) * len1;
    const ay = origin.y + Math.cos(th1[i]) * len1;
    x1s[i] = ax;
    y1s[i] = ay;
    x2s[i] = ax + Math.sin(th2[i]) * len2;
    y2s[i] = ay + Math.cos(th2[i]) * len2;
  }
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, style.alpha));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = overlayRodWidth(style);
  ctx.strokeStyle = pal.th1;
  ctx.beginPath();
  for (let i = 0; i < last; i++) {
    if (!live[i]) continue;
    ctx.moveTo(origins[i].x, origins[i].y);
    ctx.lineTo(x1s[i], y1s[i]);
  }
  ctx.stroke();
  ctx.strokeStyle = pal.th2;
  ctx.beginPath();
  for (let i = 0; i < last; i++) {
    if (!live[i]) continue;
    ctx.moveTo(x1s[i], y1s[i]);
    ctx.lineTo(x2s[i], y2s[i]);
  }
  ctx.stroke();
  if (last <= 1200) {
    const r1 = overlayBobRadius(params.M1, style);
    const r2 = overlayBobRadius(params.M2, style);
    ctx.fillStyle = pal.th1;
    for (let i = 0; i < last; i++) {
      if (!live[i]) continue;
      ctx.beginPath();
      ctx.arc(x1s[i], y1s[i], r1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = pal.th2;
    for (let i = 0; i < last; i++) {
      if (!live[i]) continue;
      ctx.beginPath();
      ctx.arc(x2s[i], y2s[i], r2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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

export function flyOnOverlay(
  fly: FlyState,
  origin: { x: number; y: number },
  scale: number,
  width: number,
  height: number,
): boolean {
  const pad = 64;
  const vis = (x: number, y: number): boolean => (
    x >= -pad && x <= width + pad && y >= -pad && y <= height + pad
  );
  return vis(origin.x + fly.x1 * scale, origin.y + fly.y1 * scale)
    || vis(origin.x + fly.x2 * scale, origin.y + fly.y2 * scale);
}

export function drawOverlayFly(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  fly: FlyState,
  params: MapParams,
  style: OverlayStyle,
  sight?: OverlaySight,
): void {
  const scale = style.pxPerLen;
  const tipX = origin.x + (fly.x1 - Math.sin(fly.th1) * params.L1) * scale;
  const tipY = origin.y + (fly.y1 - Math.cos(fly.th1) * params.L1) * scale;
  const x1 = origin.x + fly.x1 * scale;
  const y1 = origin.y + fly.y1 * scale;
  const x2 = origin.x + fly.x2 * scale;
  const y2 = origin.y + fly.y2 * scale;
  const { rods, bobs } = overlayParts(
    params,
    style,
    [
      { x0: tipX, y0: tipY, x1, y1 },
      { x0: x1, y0: y1, x1: x2, y1: y2 },
    ],
    [{ x: x1, y: y1 }, { x: x2, y: y2 }],
  );
  drawOverlayFigure(ctx, rods, bobs, style.alpha, false, sight);
}

/** Targeting crosshair: dark halo + light core so it reads on any map gray. */
export function drawProbeCross(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  half: number,
  alpha = 1,
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
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.lineCap = 'butt';
  const pal = theme();
  stroke(pal.reticleOutline, 3.4);
  stroke(pal.reticleCore, 1.2);
  ctx.restore();
}

/** One hanging segment: same rod/bob ratios as the on-map pendulum. */
export function drawOverlaySegment(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  tip: { x: number; y: number },
  mass: number,
  color: string,
  style: OverlayStyle,
): void {
  const r = overlayBobRadius(mass, style);
  const width = overlayRodWidth(style);
  const cut = trimRod(origin.x, origin.y, tip.x, tip.y, 0, r);
  const rods: OverlayRod[] = cut ? [{ ...cut, color, width }] : [];
  const bobs: OverlayBob[] = [{ x: tip.x, y: tip.y, r, color }];
  drawOverlayFigure(ctx, rods, bobs, style.alpha, style.large);
}

/** Hang point at the reticle. */
export function drawProbePivot(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  radius: number,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  const pal = theme();
  ctx.fillStyle = pal.pivot;
  ctx.strokeStyle = pal.pivotOutline;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
