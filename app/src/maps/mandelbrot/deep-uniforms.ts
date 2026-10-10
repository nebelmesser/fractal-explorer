import { coordinateToNumber, exactCenter, type CoordinateOrigin } from '../../viewer/coordinates';
import { viewSpanX, viewSpanY, type ViewRect, type MapParams } from '../types';
import { MANDELBROT_DEFAULT_ITER } from './constants';

export function packPerturbationUniforms(tile: ViewRect, width: number, height: number, center: CoordinateOrigin, orbitLength: number, params: MapParams): ArrayBuffer {
  const buffer = new ArrayBuffer(64), f = new Float32Array(buffer), i = new Int32Array(buffer), u = new Uint32Array(buffer);
  const tc = exactCenter(tile), sx = viewSpanX(tile), sy = viewSpanY(tile);
  const dx = coordinateToNumber(tc.x - center.x), dy = coordinateToNumber(tc.y - center.y);
  const exponent = Math.floor(Math.log2(Math.max(sx, sy, Math.abs(dx), Math.abs(dy))));
  const scale = 2 ** exponent;
  const values = [dx / scale, dy / scale, sx / scale, sy / scale];
  for (let n = 0; n < values.length; n++) { f[n] = values[n]; f[n + 4] = values[n] - f[n]; }
  i[8] = exponent; u[9] = Math.round(params.MAX_ITERATIONS ?? MANDELBROT_DEFAULT_ITER); u[10] = width; u[11] = height;
  u[12] = orbitLength; f[13] = params.MORPH ?? 0; f[14] = (params.MORPH ?? 0) - f[13];
  return buffer;
}
