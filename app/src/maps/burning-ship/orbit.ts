import {
  SHIP_ESCAPE_SQUARED, SHIP_SAMPLE_FLOOR, ORBIT_PATH_LIMIT,
  ORBIT_REPEAT_WARMUP,
} from './constants';

export type ComplexPoint = { r: number; i: number };
export type ShipStep = { folded: ComplexPoint; squared: ComplexPoint; next: ComplexPoint };
export type ShipTrace = {
  parameter: ComplexPoint;
  path: ComplexPoint[];
  cycle: ComplexPoint[];
  construction: ShipStep[];
  steps: number;
  escaped: boolean;
  sample: number;
  f32: boolean;
  truncated: boolean;
};

/** Keep each intermediate value so the presentation can explain the actual kernel step. */
export function shipStep(z: ComplexPoint, c: ComplexPoint, f32: boolean): ShipStep {
  const q = f32 ? Math.fround : (value: number): number => value;
  const folded = { r: Math.abs(z.r), i: Math.abs(z.i) };
  const squared = { r: q(q(z.r * z.r) - q(z.i * z.i)), i: q(2 * Math.abs(q(z.r * z.i))) };
  return { folded, squared, next: { r: q(squared.r + c.r), i: q(squared.i + c.i) } };
}

export function traceShip(real: number, imag: number, maxIter: number, f32: boolean): ShipTrace {
  const q = f32 ? Math.fround : (value: number): number => value;
  const parameter = { r: q(real), i: q(imag) };
  const path: ComplexPoint[] = [{ r: 0, i: 0 }];
  let cycle: ComplexPoint[] = [];
  const construction: ShipStep[] = [];
  let z = path[0], store = true;
  const count = Math.max(1, Math.round(maxIter));
  for (let n = 0; n < count; n++) {
    const step = shipStep(z, parameter, f32);
    z = step.next;
    if (store && path.length < ORBIT_PATH_LIMIT) {
      construction.push(step);
      path.push(z);
      // Stop drawing repeated turns; continue the full numerical escape test.
      if (n >= ORBIT_REPEAT_WARMUP) {
        for (let k = path.length - 2; k >= 0; k--) {
          if (path[k].r !== z.r || path[k].i !== z.i) continue;
          cycle = path.slice(k, -1); store = false; break;
        }
      }
    }
    const radiusSquared = q(q(z.r * z.r) + q(z.i * z.i));
    if (radiusSquared > SHIP_ESCAPE_SQUARED) {
      return { parameter, path, cycle, construction, steps: n + 1, escaped: true, f32, truncated: store && n + 1 > construction.length,
        sample: Math.max(SHIP_SAMPLE_FLOOR, n + 2 - Math.log2(0.5 * Math.log(radiusSquared))) };
    }
  }
  return { parameter, path, cycle, construction, steps: count, escaped: false, sample: 0, f32, truncated: store && count > construction.length };
}
