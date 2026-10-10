import { MANDELBROT_ESCAPE_SQUARED } from './constants';

/** Zero means bounded at the iteration limit; positive samples are smooth escape times. */
export function escapeTime(
  real: number, imag: number, maxIter: number,
  morph: number, juliaReal: number, juliaImag: number,
): number {
  if (morph === 0) {
    // Exact interior tests for the main cardioid and period-two bulb.
    const y2 = imag * imag;
    const x = real - 0.25;
    const q = x * x + y2;
    if (q * (q + x) <= 0.25 * y2 || (real + 1) ** 2 + y2 <= 0.0625) return 0;
  }
  const cr = (1 - morph) * real + morph * juliaReal;
  const ci = (1 - morph) * imag + morph * juliaImag;
  let zr = morph * real;
  let zi = morph * imag;
  // The same quadratic iteration connects the parameter and dynamical planes.
  for (let n = 0; n < maxIter; n++) {
    const nextReal = zr * zr - zi * zi + cr;
    zi = 2 * zr * zi + ci;
    zr = nextReal;
    const r2 = zr * zr + zi * zi;
    if (r2 > MANDELBROT_ESCAPE_SQUARED) {
      return Math.max(Number.EPSILON, n + 2 - Math.log2(0.5 * Math.log(r2)));
    }
  }
  return 0;
}
