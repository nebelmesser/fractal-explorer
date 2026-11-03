import { SHIP_ESCAPE_SQUARED, SHIP_SAMPLE_FLOOR } from './constants';

/** A zero sample means no escape within the requested iteration budget. */
export function shipEscapeTime(real: number, imag: number, maxIter: number): number {
  let x = 0;
  let y = 0;
  for (let n = 0; n < maxIter; n++) {
    const nextX = x * x - y * y + real;
    y = 2 * Math.abs(x * y) + imag;
    x = nextX;
    const radiusSquared = x * x + y * y;
    if (radiusSquared > SHIP_ESCAPE_SQUARED) {
      return Math.max(SHIP_SAMPLE_FLOOR, n + 2 - Math.log2(0.5 * Math.log(radiusSquared)));
    }
  }
  return 0;
}
