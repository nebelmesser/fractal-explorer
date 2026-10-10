import type { MapParams } from '../types';
import { coordinateToNumber, preciseView, type CoordinateOrigin } from '../../viewer/coordinates';
import { JULIA_IMAG, JULIA_REAL, MANDELBROT_DEFAULT_ITER, ORBIT_EXACT_SPAN } from './constants';
import { traceOrbit, type OrbitTrace } from './cycles';
import { traceExactOrbit, orbitReference } from './deep-math';

export type OrbitJob = { point: CoordinateOrigin; span: number; params: MapParams; f32: boolean };
export function calculateOrbit(job: OrbitJob): OrbitTrace {
  if (job.span < ORBIT_EXACT_SPAN) {
    return traceExactOrbit(job.point, orbitReference(preciseView(job.point, job.span, job.span), job.params));
  }
  return traceOrbit(coordinateToNumber(job.point.x), -coordinateToNumber(job.point.y),
    Math.round(job.params.MAX_ITERATIONS ?? MANDELBROT_DEFAULT_ITER), job.params.MORPH ?? 0,
    job.params.JULIA_REAL ?? JULIA_REAL, job.params.JULIA_IMAG ?? JULIA_IMAG, job.f32);
}
