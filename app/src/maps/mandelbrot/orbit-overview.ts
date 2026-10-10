import type { MapParams, ViewRect } from '../types';
import { MANDELBROT_DEFAULT_ITER, JULIA_REAL, JULIA_IMAG } from './constants';
import { escapeTime } from './physics';

export function sampleOverview(view: ViewRect, width: number, height: number, params: MapParams): Float32Array {
  const samples = new Float32Array(width*height);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const r = view.xMin+(x+.5)/width*(view.xMax-view.xMin);
    const i = -(view.yMin+(y+.5)/height*(view.yMax-view.yMin));
    samples[y*width+x] = escapeTime(r,i,params.MAX_ITERATIONS ?? MANDELBROT_DEFAULT_ITER,
      params.MORPH ?? 0,params.JULIA_REAL ?? JULIA_REAL,params.JULIA_IMAG ?? JULIA_IMAG);
  }
  return samples;
}
