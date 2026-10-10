import { PRECISE_COORDINATE_BITS } from '../../constants';
import { coordinateFromNumber, coordinateToNumber, exactCenter, type CoordinateOrigin } from '../../viewer/coordinates';
import { viewSpanX, viewSpanY, type MapParams, type ViewRect } from '../types';
import { CYCLE_ATTRACTION_MARGIN, CYCLE_FIXED_TOLERANCE_BITS, CYCLE_MAX_PERIOD, CYCLE_WARMUP, ORBIT_PATH_LIMIT, DEEP_CPU_GLITCH_RATIO, DEEP_GUARD_BITS, DEEP_MIN_BITS, JULIA_IMAG, JULIA_REAL, MANDELBROT_DEFAULT_ITER, MANDELBROT_ESCAPE_SQUARED } from './constants';

import { analyticCycle, analyticInterior, cyclePeriod, cycleSample, type OrbitTrace } from './cycles';

type Complex = { r: number; i: number; e: number };
export type Reference = {
  center: CoordinateOrigin; bits: number; iterations: number; morph: number; jr: number; ji: number;
  orbit: Float64Array;
  ordinary?: Float64Array;
};
const zero = (): Complex => ({ r: 0, i: 0, e: 0 });
function normalized(r: number, i: number, e = 0): Complex {
  const m = Math.max(Math.abs(r), Math.abs(i));
  if (!m) return zero();
  const shift = Math.floor(Math.log2(m));
  // Divide in two steps when a subnormal mantissa cannot be inverted.
  const scale = 2 ** Math.max(-1022, shift);
  const extra = 2 ** (shift - Math.max(-1022, shift));
  return { r: r / scale / extra, i: i / scale / extra, e: e + shift };
}
function add(a: Complex, b: Complex): Complex {
  if (a.r === 0 && a.i === 0) return b;
  if (b.r === 0 && b.i === 0) return a;
  const e = Math.max(a.e, b.e);
  return normalized(a.r * 2 ** (a.e - e) + b.r * 2 ** (b.e - e), a.i * 2 ** (a.e - e) + b.i * 2 ** (b.e - e), e);
}
function mul(a: Complex, b: Complex): Complex {
  return normalized(a.r * b.r - a.i * b.i, a.r * b.i + a.i * b.r, a.e + b.e);
}
function logMagnitude(z: Complex): number {
  return z.r || z.i ? z.e + Math.log2(Math.hypot(z.r, z.i)) : -Infinity;
}
function logSum(a: number, b: number): number {
  const high = Math.max(a, b);
  return high === -Infinity ? high : high + Math.log2(1 + 2 ** (-Math.abs(a - b)));
}
function fromFixed(r: bigint, i: bigint, bits: number): Complex {
  const ar = r < 0n ? -r : r, ai = i < 0n ? -i : i;
  const max = ar > ai ? ar : ai;
  if (!max) return zero();
  const shift = Math.max(0, max.toString(2).length - 53);
  return normalized(Number(r >> BigInt(shift)), Number(i >> BigInt(shift)), shift - bits);
}
function fixed(value: number, bits: number): bigint {
  return coordinateFromNumber(value) >> BigInt(PRECISE_COORDINATE_BITS - bits);
}
function parameters(reference: Reference, point: CoordinateOrigin): { cr: bigint; ci: bigint; zr: bigint; zi: bigint } {
  const b = BigInt(reference.bits), shift = BigInt(PRECISE_COORDINATE_BITS - reference.bits);
  const r = point.x >> shift, i = -point.y >> shift;
  const t = fixed(reference.morph, reference.bits), one = 1n << b;
  return {
    cr: ((one - t) * r + t * fixed(reference.jr, reference.bits)) >> b,
    ci: ((one - t) * i + t * fixed(reference.ji, reference.bits)) >> b,
    zr: (t * r) >> b, zi: (t * i) >> b,
  };
}

export function orbitReference(view: ViewRect, params: MapParams): Reference {
  const bits = Math.max(DEEP_MIN_BITS, Math.ceil(-Math.log2(Math.min(viewSpanX(view), viewSpanY(view)))) + DEEP_GUARD_BITS);
  return { center: exactCenter(view), bits, iterations: Math.round(params.MAX_ITERATIONS ?? MANDELBROT_DEFAULT_ITER), morph: params.MORPH ?? 0, jr: params.JULIA_REAL ?? JULIA_REAL, ji: params.JULIA_IMAG ?? JULIA_IMAG, orbit: new Float64Array(0) };
}

export function makeReference(view: ViewRect, params: MapParams): Reference {
  const reference = orbitReference(view, params), bits = reference.bits;
  const { cr, ci, ...initial } = parameters(reference, reference.center);
  let { zr, zi } = initial;
  const values: number[] = [];
  const b = BigInt(bits), escape = BigInt(MANDELBROT_ESCAPE_SQUARED) << (2n * b);
  for (let n = 0; n <= reference.iterations; n++) {
    const z = fromFixed(zr, zi, bits);
    values.push(z.r, z.i, z.e, 0);
    if (n > 0 && zr * zr + zi * zi > escape) break;
    const next = ((zr * zr - zi * zi) >> b) + cr;
    zi = ((2n * zr * zi) >> b) + ci; zr = next;
  }
  reference.orbit = new Float64Array(values);
  return reference;
}

function orbitAt(reference: Reference, index: number): Complex {
  const a = reference.orbit, p = index * 4;
  return { r: a[p], i: a[p + 1], e: a[p + 2] };
}

/** Trace a single exact point independently of the map's tile computation. */
export function traceExactOrbit(point: CoordinateOrigin, reference: Reference): OrbitTrace {
  const trace: OrbitTrace = { path: [], cycle: [], sample: 0, steps: 0 };
  directOrbitSample(point,reference,trace);
  return trace;
}

/** Direct fixed-point orbit is the independent, slower repair path. */
export function directEscape(point: CoordinateOrigin, reference: Reference): number {
  const { cr, ci, ...initial } = parameters(reference, point);
  let { zr, zi } = initial;
  const b = BigInt(reference.bits), escape = BigInt(MANDELBROT_ESCAPE_SQUARED) << (2n*b);
  for (let n = 0; n < reference.iterations; n++) {
    const next = ((zr*zr-zi*zi) >> b)+cr;
    zi = ((2n*zr*zi) >> b)+ci; zr = next;
    if (zr*zr+zi*zi > escape) {
      const logAbs = logMagnitude(fromFixed(zr,zi,reference.bits))*Math.LN2;
      return Math.max(Number.EPSILON,n+2-Math.log2(logAbs));
    }
  }
  return 0;
}

/** Exact trajectory and cycle detection for the overlay worker only. */
function directOrbitSample(point: CoordinateOrigin, reference: Reference, trace: OrbitTrace): number {
  const { cr, ci, ...initial } = parameters(reference, point);
  let { zr, zi } = initial;
  const b = BigInt(reference.bits), escape = BigInt(MANDELBROT_ESCAPE_SQUARED) << (2n * b);
  const ordinary = (r: bigint, i: bigint) => {
    const z = fromFixed(r, i, reference.bits), scale = 2 ** z.e;
    return { r: z.r * scale, i: z.i * scale };
  };
  const c = ordinary(cr, ci);
  const analytic = reference.morph === 0 ? analyticInterior(c.r, c.i) : 0;
  const tolerance = 1n << BigInt(Math.max(0, reference.bits - CYCLE_FIXED_TOLERANCE_BITS));
  const close = (r: bigint, i: bigint) => r*r + i*i <= tolerance*tolerance;
  let checkpointR = zr, checkpointI = zi, power = 1, period = 0, result = 0;
  if (trace) trace.path.push(ordinary(zr, zi));
  for (let n = 0; n < reference.iterations; n++) {
    const next = ((zr * zr - zi * zi) >> b) + cr;
    zi = ((2n * zr * zi) >> b) + ci; zr = next;
    if (trace) {
      trace.steps = n + 1;
      if (trace.path.length < ORBIT_PATH_LIMIT) trace.path.push(ordinary(zr, zi));
    }
    if (zr * zr + zi * zi > escape) {
      const logAbs = logMagnitude(fromFixed(zr, zi, reference.bits)) * Math.LN2;
      result = Math.max(Number.EPSILON, n + 2 - Math.log2(logAbs)); break;
    }
    if (n+1 === CYCLE_WARMUP) { checkpointR = zr; checkpointI = zi; period = 0; power = 1; continue; }
    period++;
    if (n >= CYCLE_WARMUP && period <= CYCLE_MAX_PERIOD && close(zr-checkpointR, zi-checkpointI)) {
      let r = zr, i = zi, dr = 1, di = 0, valid = true;
      for (let k = 0; k < period*2; k++) {
        if (k < period) {
          const z = ordinary(r,i), d = 2*(z.r*dr-z.i*di);
          di = 2*(z.r*di+z.i*dr); dr = d;
        }
        const next = ((r*r-i*i) >> b)+cr;
        i = ((2n*r*i) >> b)+ci; r = next;
        if (k+1 < period && period%(k+1) === 0 && close(r-zr,i-zi)) { valid = false; break; }
        if (r*r+i*i > escape || ((k+1)%period === 0 && !close(r-zr,i-zi))) { valid = false; break; }
      }
      const multiplier = Math.hypot(dr,di);
      if (valid && multiplier < 1-CYCLE_ATTRACTION_MARGIN) { result = cycleSample(period,multiplier); break; }
    }
    if (period === power) { checkpointR = zr; checkpointI = zi; period = 0; power *= 2; }
  }
  if (result <= 0 && analytic) result = analytic;
  if (trace) {
    trace.sample = result;
    const count = cyclePeriod(result);
    if (analytic) trace.cycle = analyticCycle(c, count);
    else for (let k = 0; k < count; k++) {
      trace.cycle.push(ordinary(zr,zi));
      const next = ((zr*zr-zi*zi) >> b)+cr;
      zi = ((2n*zr*zi) >> b)+ci; zr = next;
    }
  }
  return result;
}

/** Mantissa/exponent arithmetic prevents tiny perturbations underflowing. */
function perturbEscapeExtended(dx: number, dy: number, reference: Reference): number {
  const p = normalized(dx, -dy);
  const dc = mul(p, normalized(1 - reference.morph, 0));
  let delta = mul(p, normalized(reference.morph, 0)), m = 0;
  const initial = orbitAt(reference, 0);
  const dcSize = logMagnitude(dc);
  let errorLog = -Infinity;
  for (let n = 0; n < reference.iterations; n++) {
    const z = orbitAt(reference, m);
    const zs = logMagnitude(z), ds = logMagnitude(delta);
    const propagated = errorLog + 1 + logSum(zs, ds);
    const rounding = Math.max(zs + ds + 1, ds * 2, dcSize) - 47;
    errorLog = logSum(propagated, rounding);
    delta = add(add(mul({ ...z, e: z.e + 1 }, delta), mul(delta, delta)), dc);
    m++;
    const next = orbitAt(reference, m);
    const actual = add(next, delta);
    const size = logMagnitude(actual), baseSize = logMagnitude(next);
    if (Math.max(errorLog, baseSize - 50) > size - 30) return -1;
    if (size > 4) return Math.max(Number.EPSILON, n + 2 - Math.log2(size * Math.LN2));
    if (size < baseSize + Math.log2(DEEP_CPU_GLITCH_RATIO)) return -1;
    if (size < logMagnitude(delta) || m + 1 >= reference.orbit.length / 4) {
      delta = add(actual, { r: -initial.r, i: -initial.i, e: initial.e }); m = 0;
      errorLog = logSum(errorLog, baseSize - 49);
    }
  }
  return 0;
}

/** Fast f64 recurrence with a separately scaled perturbation and error estimate. */
export function perturbEscape(dx: number, dy: number, reference: Reference): number {
  if (!reference.ordinary) {
    reference.ordinary = new Float64Array(reference.orbit.length / 2);
    for (let n = 0; n < reference.orbit.length / 4; n++) {
      const scale = 2 ** reference.orbit[n * 4 + 2];
      reference.ordinary[n * 2] = reference.orbit[n * 4] * scale;
      reference.ordinary[n * 2 + 1] = reference.orbit[n * 4 + 1] * scale;
    }
  }
  const orbit = reference.ordinary;
  let scale = Math.max(Math.abs(dx), Math.abs(dy));
  if (!scale) scale = 1;
  let dr = reference.morph * dx / scale, di = -reference.morph * dy / scale;
  const cr = (1 - reference.morph) * dx, ci = -(1 - reference.morph) * dy;
  let dcr = cr / scale, dci = ci / scale, error = 0, m = 0;
  for (let n = 0; n < reference.iterations; n++) {
    const zr = orbit[m * 2], zi = orbit[m * 2 + 1];
    const deltaSize = Math.hypot(dr, di), baseSize = Math.hypot(zr, zi);
    error = 2 * (baseSize + deltaSize * scale) * error
      + (2 * baseSize * deltaSize + scale * deltaSize * deltaSize + Math.hypot(dcr, dci)) * 2 ** -47;
    const r = 2 * (zr * dr - zi * di) + scale * (dr * dr - di * di) + dcr;
    di = 2 * (zr * di + zi * dr) + scale * 2 * dr * di + dci; dr = r;
    m++;
    const nr = orbit[m * 2], ni = orbit[m * 2 + 1];
    const ar = nr + dr * scale, ai = ni + di * scale;
    const actualSize = Math.hypot(ar, ai), nextSize = Math.hypot(nr, ni);
    if (Math.max(error * scale, nextSize * 2 ** -50) > actualSize * 2 ** -30) return -1;
    if (actualSize > 16) return Math.max(Number.EPSILON, n + 2 - Math.log2(Math.log(actualSize)));
    if (actualSize < nextSize * DEEP_CPU_GLITCH_RATIO) return -1;
    if (actualSize < Math.hypot(dr, di) * scale || m + 1 >= orbit.length / 2) {
      error = error * scale + nextSize * 2 ** -49;
      dr = ar - orbit[0]; di = ai - orbit[1]; scale = 1; dcr = cr; dci = ci; m = 0;
    }
    const magnitude = Math.max(Math.abs(dr), Math.abs(di));
    if (magnitude > 2 ** 128 || (magnitude > 0 && magnitude < 2 ** -128)) {
      const factor = 2 ** Math.floor(Math.log2(magnitude));
      scale *= factor; dr /= factor; di /= factor; error /= factor;
      dcr = cr / scale; dci = ci / scale;
      if (!(scale > 0) || !Number.isFinite(dcr + dci + dr + di)) return perturbEscapeExtended(dx, dy, reference);
    }
  }
  return 0;
}

export function fillDeepTile(reference: Reference, view: ViewRect, width: number, height: number, existing?: Float32Array): Float32Array {
  const samples = existing ?? new Float32Array(width * height);
  const center = exactCenter(view), sx = viewSpanX(view), sy = viewSpanY(view);
  const dx = coordinateToNumber(center.x - reference.center.x), dy = coordinateToNumber(center.y - reference.center.y);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (existing && samples[index] >= 0 && Number.isFinite(samples[index])) continue;
    const px = (x + 0.5) / width - 0.5, py = (y + 0.5) / height - 0.5;
    let value = perturbEscape(dx + px * sx, dy + py * sy, reference);
    if (value < 0 || !Number.isFinite(value)) value = directEscape({ x: center.x + coordinateFromNumber(px * sx), y: center.y + coordinateFromNumber(py * sy) }, reference);
    samples[index] = value;
  }
  return samples;
}
