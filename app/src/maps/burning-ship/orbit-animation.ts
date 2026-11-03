import { ORBIT_REPEAT_PX, ORBIT_TRAIL_DOTS } from './constants';
import type { ComplexPoint, ShipTrace } from './orbit';

export type OrbitProjection = (point: ComplexPoint) => ComplexPoint;

/** Match the Mandelbrot overlay: keep one visible turn of a repeated cycle. */
export function visibleOrbitPath(orbit: ShipTrace, project: OrbitProjection): ComplexPoint[] {
  const path = orbit.path, period = orbit.cycle.length;
  if (period) for (let n = period; n + period <= path.length; n++) {
    let repeats = true;
    for (let k = 0; k < period; k++) {
      const a = project(path[n + k]), b = project(path[n - period + k]);
      if (Math.hypot(a.r - b.r, a.i - b.i) > ORBIT_REPEAT_PX) { repeats = false; break; }
    }
    if (repeats) return path.slice(0, n + 1);
  }
  return path;
}

/** Cycle after the transient; an escaping or unknown orbit holds its last point. */
export function orbitTrail(step: number, pathLength: number, period: number): { index: number; opacity: number }[] {
  const dots: { index: number; opacity: number }[] = [];
  for (let trail = ORBIT_TRAIL_DOTS - 1; trail >= 0; trail--) {
    const n = step - trail;
    if (n < 0) continue;
    const index = n < pathLength ? n : period ? pathLength - period + (n - pathLength) % period : pathLength - 1;
    if (index >= 0 && index < pathLength) dots.push({ index, opacity: 1 - trail / ORBIT_TRAIL_DOTS });
  }
  return dots;
}

export function orbitFade(elapsed: number, duration: number): number {
  const unit = Math.max(0, Math.min(1, elapsed / duration));
  return unit * unit * (3 - 2 * unit);
}
