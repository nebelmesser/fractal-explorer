import { CYCLE_ATTRACTION_MARGIN, CYCLE_EPS_F32, CYCLE_EPS_F64, CYCLE_MAX_PERIOD, CYCLE_STRENGTH_SCALE, CYCLE_WARMUP, MANDELBROT_ESCAPE_SQUARED, ORBIT_PATH_LIMIT } from './constants';

export type ComplexPoint = { r: number; i: number };
export type OrbitTrace = { path: ComplexPoint[]; cycle: ComplexPoint[]; sample: number; steps: number };
export const cyclePeriod = (sample: number): number => Number.isFinite(sample) && sample <= -2 ? Math.floor(-sample) - 1 : 0;
export const cycleSample = (period: number, multiplier: number): number => -(period + 1 + CYCLE_STRENGTH_SCALE * Math.max(0, Math.min(1, 1 - multiplier)));

/** Strict interior tests leave neutral boundaries unclassified. */
export function analyticInterior(r: number, i: number): number {
  const x = r - .25, y2 = i * i, q = x * x + y2;
  if (q * (q + x) < .25 * y2) {
    const ar = 1 - 4 * r, ai = -4 * i, size = Math.hypot(ar, ai);
    const sr = Math.sqrt(Math.max(0, (size + ar) / 2));
    const si = Math.sign(ai) * Math.sqrt(Math.max(0, (size - ar) / 2));
    const multiplier = Math.hypot(1 - sr, si);
    if (multiplier < 1 - CYCLE_ATTRACTION_MARGIN) return cycleSample(1, multiplier);
  }
  const multiplier = 4 * Math.hypot(r + 1, i);
  return multiplier < 1 - CYCLE_ATTRACTION_MARGIN ? cycleSample(2, multiplier) : 0;
}

export function verifyCycle(start: ComplexPoint, c: ComplexPoint, period: number, epsilon: number, round: (x: number) => number = x => x): number {
  let r = start.r, i = start.i, dr = 1, di = 0, residual = 0;
  for (let n = 0; n < period * 2; n++) {
    if (n < period) {
      const d = 2 * (r * dr - i * di);
      di = 2 * (r * di + i * dr); dr = d;
    }
    const next = round(round(round(r * r) - round(i * i)) + c.r);
    i = round(round(round(2 * r) * i) + c.i); r = next;
    if (r * r + i * i > MANDELBROT_ESCAPE_SQUARED) return 0;
    if (n+1 < period && period%(n+1) === 0 && Math.hypot(r-start.r,i-start.i) <= epsilon*(1+Math.hypot(r,i))) return 0;
    if ((n + 1) % period === 0) residual = Math.max(residual, Math.hypot(r-start.r,i-start.i)/(1+Math.hypot(r,i)));
  }
  const multiplier = Math.hypot(dr, di);
  return multiplier < 1 - CYCLE_ATTRACTION_MARGIN && residual <= epsilon*(1-multiplier)**2 ? cycleSample(period, multiplier) : 0;
}

/** Brent checkpoints propose a period; closure and a contracting multiplier verify it. */
export function orbitSample(real: number, imag: number, maxIter: number, morph: number, jr: number, ji: number, f32 = false, trace?: OrbitTrace): number {
  const round = f32 ? Math.fround : (v: number) => v;
  real = round(real); imag = round(imag); morph = round(morph); jr = round(jr); ji = round(ji);
  const analytic = morph === 0 ? analyticInterior(real, imag) : 0;
  if (analytic && !trace) return analytic;
  const cr = round(round(round(1 - morph) * real) + round(morph * jr));
  const ci = round(round(round(1 - morph) * imag) + round(morph * ji));
  let r = round(morph * real), i = round(morph * imag), checkpointR = r, checkpointI = i, power = 1, period = 0;
  const epsilon = f32 ? CYCLE_EPS_F32 : CYCLE_EPS_F64;
  if (trace) trace.path.push({ r, i });
  let result = 0;
  for (let n = 0; n < maxIter; n++) {
    const next = round(round(round(r * r) - round(i * i)) + cr);
    i = round(round(round(2 * r) * i) + ci); r = next;
    if (trace) {
      trace.steps = n + 1;
      if (trace.path.length < ORBIT_PATH_LIMIT) trace.path.push({ r, i });
    }
    const size = r * r + i * i;
    if (size > MANDELBROT_ESCAPE_SQUARED) { result = Math.max(Number.EPSILON, n + 2 - Math.log2(.5 * Math.log(size))); break; }
    if (n+1 === CYCLE_WARMUP) { checkpointR = r; checkpointI = i; period = 0; power = 1; continue; }
    period++;
    if (n >= CYCLE_WARMUP && period <= CYCLE_MAX_PERIOD && Math.hypot(r - checkpointR, i - checkpointI) < epsilon * (1 + Math.hypot(r, i))) {
      for (let divisor = 1; divisor <= period; divisor++) {
        if (period % divisor === 0) result = verifyCycle({ r, i }, { r: cr, i: ci }, divisor, epsilon, round);
        if (result) break;
      }
      if (result) break;
    }
    if (period === power) { checkpointR = r; checkpointI = i; period = 0; power *= 2; }
  }
  if (result <= 0 && analytic) result = analytic;
  if (trace) {
    trace.sample = result;
    const count = cyclePeriod(result);
    if (analytic) {
      trace.cycle = analyticCycle({ r: cr, i: ci }, count);
      return result;
    }
    for (let k = 0; k < count; k++) {
      trace.cycle.push({ r, i });
      const next = round(round(round(r * r) - round(i * i)) + cr);
      i = round(round(round(2 * r) * i) + ci); r = next;
    }
  }
  return result;
}

export function traceOrbit(real: number, imag: number, maxIter: number, morph: number, jr: number, ji: number, f32: boolean): OrbitTrace {
  const trace: OrbitTrace = { path: [], cycle: [], sample: 0, steps: 0 };
  orbitSample(real, imag, maxIter, morph, jr, ji, f32, trace);
  return trace;
}

/** Attracting fixed point or the two roots of z²+z+c+1 = 0. */
export function analyticCycle(c: ComplexPoint, period: number): ComplexPoint[] {
  const ar = (period === 1 ? 1 : -3) - 4*c.r, ai = -4*c.i, size = Math.hypot(ar,ai);
  const r = Math.sqrt(Math.max(0,(size+ar)/2));
  const i = (ai < 0 ? -1 : 1)*Math.sqrt(Math.max(0,(size-ar)/2));
  return period === 1 ? [{ r: (1-r)/2, i: -i/2 }] : [{ r: (-1+r)/2, i: i/2 }, { r: (-1-r)/2, i: -i/2 }];
}
