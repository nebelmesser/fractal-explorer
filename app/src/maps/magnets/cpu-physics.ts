import {
  MAGNET_CAPTURE_FLOOR,
  MAGNET_CAPTURE_PAD,
  MAGNET_CLOSE_RADIUS,
  MAGNET_MAX_STEP,
  MAGNET_SETTLE_HOLD,
  MAGNET_SETTLE_SPEED,
  MAGNET_SUBSTEP_MAX,
  magnetPositions,
  type MagnetPoint,
} from './constants';

export type MagnetsCpuInput = {
  K: number;
  G: number;
  F: number;
  H: number;
  R: number;
  DT: number;
  maxIter: number;
};

export type MagnetsCpuPhys = MagnetsCpuInput & {
  magnets: MagnetPoint[];
  height2: number;
  captureRadius2: number;
};

type Dwell = [number, number, number];

const SINGULAR = 1e-12;

export function prepareMagnetsCpuPhys(input: MagnetsCpuInput): MagnetsCpuPhys {
  const captureRadius = Math.max(
    MAGNET_CAPTURE_FLOOR,
    MAGNET_CAPTURE_PAD * input.R + input.H,
  );
  return {
    ...input,
    magnets: magnetPositions(input.R),
    height2: input.H * input.H,
    captureRadius2: captureRadius * captureRadius,
  };
}

function accel(
  x: number,
  y: number,
  vx: number,
  vy: number,
  phys: MagnetsCpuPhys,
): { ax: number; ay: number } {
  let ax = -phys.G * x - phys.F * vx;
  let ay = -phys.G * y - phys.F * vy;
  for (const magnet of phys.magnets) {
    const dx = magnet.x - x;
    const dy = magnet.y - y;
    const r2 = dx * dx + dy * dy + phys.height2;
    const scale = phys.K / Math.max(r2 * Math.sqrt(r2), SINGULAR);
    ax += dx * scale;
    ay += dy * scale;
  }
  return { ax, ay };
}

function substepCount(x: number, y: number, vx: number, vy: number, dt: number): number {
  if (x * x + y * y > MAGNET_CLOSE_RADIUS * MAGNET_CLOSE_RADIUS) return 1;
  const hop = Math.hypot(vx, vy) * dt;
  if (hop <= MAGNET_MAX_STEP) return 1;
  return Math.min(MAGNET_SUBSTEP_MAX, 1 + Math.floor(hop / MAGNET_MAX_STEP));
}

function isCaptured(
  x: number,
  y: number,
  vx: number,
  vy: number,
  phys: MagnetsCpuPhys,
): boolean {
  if (vx * vx + vy * vy >= MAGNET_SETTLE_SPEED * MAGNET_SETTLE_SPEED) return false;
  return phys.magnets.some((magnet) => {
    const dx = magnet.x - x;
    const dy = magnet.y - y;
    return dx * dx + dy * dy < phys.captureRadius2;
  });
}

function addDwell(dwell: Dwell, x: number, y: number, dt: number, phys: MagnetsCpuPhys): void {
  const eps = Math.max(phys.height2, 1e-4);
  const dx0 = phys.magnets[0].x - x;
  const dy0 = phys.magnets[0].y - y;
  const dx1 = phys.magnets[1].x - x;
  const dy1 = phys.magnets[1].y - y;
  const dx2 = phys.magnets[2].x - x;
  const dy2 = phys.magnets[2].y - y;
  const w0 = 1 / (dx0 * dx0 + dy0 * dy0 + eps);
  const w1 = 1 / (dx1 * dx1 + dy1 * dy1 + eps);
  const w2 = 1 / (dx2 * dx2 + dy2 * dy2 + eps);
  const floor = Math.min(w0, w1, w2);
  dwell[0] += dt * (w0 - floor);
  dwell[1] += dt * (w1 - floor);
  dwell[2] += dt * (w2 - floor);
}

function nearestMagnetF64(x: number, y: number, magnets: MagnetPoint[]): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < magnets.length; i++) {
    const dx = magnets[i].x - x;
    const dy = magnets[i].y - y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function quantizeWeight(value: number): number {
  return Math.max(0, Math.min(1023, Math.round(value * 1023)));
}

/**
 * Run the magnetic-pendulum map in f64 and return the same packed semantic
 * dwell sample as the WGSL kernel.
 */
export function packedMagnetsDwellF64(
  x0: number,
  y0: number,
  phys: MagnetsCpuPhys,
): number {
  let x = x0;
  let y = y0;
  let vx = 0;
  let vy = 0;
  let hold = 0;
  const dwell: Dwell = [0, 0, 0];

  for (let i = 0; i < phys.maxIter; i++) {
    const steps = substepCount(x, y, vx, vy, phys.DT);
    const dt = phys.DT / steps;
    for (let step = 0; step < steps; step++) {
      const acceleration = accel(x, y, vx, vy, phys);
      vx += acceleration.ax * dt;
      vy += acceleration.ay * dt;
      x += vx * dt;
      y += vy * dt;
      addDwell(dwell, x, y, dt, phys);
    }
    if (isCaptured(x, y, vx, vy, phys)) {
      hold += 1;
      if (hold >= MAGNET_SETTLE_HOLD) break;
    } else {
      hold = 0;
    }
  }

  const sum = dwell[0] + dwell[1] + dwell[2];
  if (sum <= SINGULAR) {
    dwell[0] = 0;
    dwell[1] = 0;
    dwell[2] = 0;
    dwell[nearestMagnetF64(x, y, phys.magnets)] = 1;
  } else {
    dwell[0] /= sum;
    dwell[1] /= sum;
    dwell[2] /= sum;
  }

  const m0 = quantizeWeight(dwell[0]);
  const m1 = quantizeWeight(dwell[1]);
  const m2 = quantizeWeight(dwell[2]);
  return (m0 | (m1 << 10) | (m2 << 20)) >>> 0;
}
