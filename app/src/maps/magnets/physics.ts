import {
  MAGNET_CAPTURE_FLOOR,
  MAGNET_CAPTURE_PAD,
  MAGNET_CLOSE_RADIUS,
  MAGNET_MAX_STEP,
  MAGNET_OVERLAY_MAX_POINTS,
  MAGNET_OVERLAY_SEG,
  MAGNET_R,
  MAGNET_SETTLE_HOLD,
  MAGNET_SETTLE_SPEED,
  MAGNET_SUBSTEP_MAX,
  type MagnetPoint,
} from './constants';
import type { MapParams } from '../types';

export type MagnetsPhys = {
  K: number;
  G: number;
  F: number;
  H: number;
  R: number;
  DT: number;
  maxIter: number;
};

export type MagnetsPoint = MagnetPoint;
export type MagnetsDwell = [number, number, number];

const f32 = Math.fround;
const SQRT3_2_F32 = f32(0.8660254037844386);
const SINGULAR_F32 = f32(1e-12);

/** Use the same f32 inputs and intermediate rounding as the WGSL map kernel. */
function f32MagnetPositions(radius: number): MagnetsPoint[] {
  const r = f32(Math.max(f32(1e-6), radius));
  const s = f32(r * SQRT3_2_F32);
  return [
    { x: 0, y: f32(-r) },
    { x: f32(-s), y: f32(r * f32(0.5)) },
    { x: s, y: f32(r * f32(0.5)) },
  ];
}

export function magnetsFromParams(params: MapParams): MagnetsPhys {
  return {
    K: f32(params.K),
    G: f32(params.G),
    F: f32(params.F),
    H: f32(params.H),
    R: f32(params.R ?? MAGNET_R),
    DT: f32(params.DT),
    maxIter: Math.max(1, Math.round(params.MAX_ITERATIONS ?? 1)),
  };
}

export function captureDist(phys: MagnetsPhys): number {
  return f32(Math.max(f32(MAGNET_CAPTURE_FLOOR), f32(f32(MAGNET_CAPTURE_PAD) * phys.R) + phys.H));
}

function accel(
  x: number,
  y: number,
  vx: number,
  vy: number,
  phys: MagnetsPhys,
): { ax: number; ay: number } {
  let ax = f32(f32(-phys.G * x) - f32(phys.F * vx));
  let ay = f32(f32(-phys.G * y) - f32(phys.F * vy));
  const h2 = f32(phys.H * phys.H);
  for (const magnet of f32MagnetPositions(phys.R)) {
    const dx = f32(magnet.x - x);
    const dy = f32(magnet.y - y);
    const xy2 = f32(f32(dx * dx) + f32(dy * dy));
    const r2 = f32(xy2 + h2);
    const r3 = f32(r2 * f32(Math.sqrt(r2)));
    const scale = f32(phys.K / Math.max(r3, SINGULAR_F32));
    ax = f32(ax + f32(dx * scale));
    ay = f32(ay + f32(dy * scale));
  }
  return { ax, ay };
}

function substepCount(x: number, y: number, vx: number, vy: number, dt: number): number {
  const p2 = f32(f32(x * x) + f32(y * y));
  const close2 = f32(f32(MAGNET_CLOSE_RADIUS) * f32(MAGNET_CLOSE_RADIUS));
  if (p2 > close2) return 1;
  const speed = f32(Math.sqrt(f32(f32(vx * vx) + f32(vy * vy))));
  const hop = f32(speed * dt);
  const maxStep = f32(MAGNET_MAX_STEP);
  if (hop <= maxStep) return 1;
  return Math.min(MAGNET_SUBSTEP_MAX, 1 + Math.floor(f32(hop / maxStep)));
}

function isCaptured(x: number, y: number, vx: number, vy: number, phys: MagnetsPhys): boolean {
  const settle = f32(MAGNET_SETTLE_SPEED);
  const settle2 = f32(settle * settle);
  if (f32(f32(vx * vx) + f32(vy * vy)) >= settle2) return false;
  const cap = captureDist(phys);
  const cap2 = f32(cap * cap);
  for (const magnet of f32MagnetPositions(phys.R)) {
    const dx = f32(magnet.x - x);
    const dy = f32(magnet.y - y);
    if (f32(f32(dx * dx) + f32(dy * dy)) < cap2) return true;
  }
  return false;
}

function addDwell(
  dwell: MagnetsDwell,
  x: number,
  y: number,
  dt: number,
  phys: MagnetsPhys,
): void {
  const eps = f32(Math.max(f32(phys.H * phys.H), f32(1e-4)));
  const magnets = f32MagnetPositions(phys.R);
  const w: MagnetsDwell = [0, 0, 0];
  for (let i = 0; i < magnets.length; i++) {
    const dx = f32(magnets[i].x - x);
    const dy = f32(magnets[i].y - y);
    const d2 = f32(f32(f32(dx * dx) + f32(dy * dy)) + eps);
    w[i] = f32(1 / d2);
  }
  const floor = f32(Math.min(w[0], w[1], w[2]));
  for (let i = 0; i < dwell.length; i++) {
    dwell[i] = f32(dwell[i] + f32(dt * f32(w[i] - floor)));
  }
}

export function nearestMagnet(x: number, y: number, radius = MAGNET_R): number {
  const magnets = f32MagnetPositions(f32(radius));
  const px = f32(x);
  const py = f32(y);
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < magnets.length; i++) {
    const dx = f32(magnets[i].x - px);
    const dy = f32(magnets[i].y - py);
    const d = f32(f32(dx * dx) + f32(dy * dy));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function runUntilCapture(
  x0: number,
  y0: number,
  phys: MagnetsPhys,
  onStep?: (x: number, y: number) => void,
): { x: number; y: number; dwell: MagnetsDwell } {
  let x = f32(x0);
  let y = f32(y0);
  let vx = 0;
  let vy = 0;
  let hold = 0;
  const dwell: MagnetsDwell = [0, 0, 0];
  for (let i = 0; i < phys.maxIter; i++) {
    const n = substepCount(x, y, vx, vy, phys.DT);
    const h = f32(phys.DT / f32(n));
    for (let s = 0; s < n; s++) {
      const { ax, ay } = accel(x, y, vx, vy, phys);
      vx = f32(vx + f32(ax * h));
      vy = f32(vy + f32(ay * h));
      x = f32(x + f32(vx * h));
      y = f32(y + f32(vy * h));
      addDwell(dwell, x, y, h, phys);
    }
    onStep?.(x, y);
    if (isCaptured(x, y, vx, vy, phys)) {
      hold += 1;
      if (hold >= MAGNET_SETTLE_HOLD) break;
    } else {
      hold = 0;
    }
  }
  return { x, y, dwell };
}

/** Semi-implicit Euler with near-magnet substeps, matching magnets.wgsl. */
export function captureMagnet(x0: number, y0: number, phys: MagnetsPhys): number {
  const end = runUntilCapture(x0, y0, phys);
  if (f32(f32(end.dwell[0] + end.dwell[1]) + end.dwell[2]) <= SINGULAR_F32) {
    return nearestMagnet(end.x, end.y, phys.R);
  }
  if (end.dwell[1] > end.dwell[0] && end.dwell[1] >= end.dwell[2]) return 1;
  if (end.dwell[2] > end.dwell[0] && end.dwell[2] >= end.dwell[1]) return 2;
  return 0;
}

export function traceCapture(
  x0: number,
  y0: number,
  phys: MagnetsPhys,
): { magnet: number; dwell: MagnetsDwell; path: MagnetsPoint[] } {
  const path: MagnetsPoint[] = [{ x: f32(x0), y: f32(y0) }];
  let last = path[0];
  const end = runUntilCapture(x0, y0, phys, (x, y) => {
    const dx = x - last.x;
    const dy = y - last.y;
    if (dx * dx + dy * dy < MAGNET_OVERLAY_SEG * MAGNET_OVERLAY_SEG) return;
    if (path.length < MAGNET_OVERLAY_MAX_POINTS) {
      last = { x, y };
      path.push(last);
    } else {
      last = { x, y };
      path[path.length - 1] = last;
    }
  });
  const tail = path[path.length - 1];
  if (!tail || tail.x !== end.x || tail.y !== end.y) path.push({ x: end.x, y: end.y });
  const magnet = nearestMagnet(end.x, end.y, phys.R);
  return { magnet, dwell: end.dwell, path };
}
