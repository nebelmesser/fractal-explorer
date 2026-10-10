import { mandelbrotPrecision } from './precision';
import { normPixelRect, type MapDefinition, type MapParams, type TileUniforms, type ViewRect } from '../types';
import {
  JULIA_IMAG, JULIA_PARAM_LIMIT, JULIA_PARAM_STEP, JULIA_REAL,
  MANDELBROT_DEFAULT_ITER, MANDELBROT_ESCAPE_SQUARED, MANDELBROT_HANDOFF_PX,
  MANDELBROT_ITER_STEP, MANDELBROT_MAX_ITER, MANDELBROT_MIN_ITER,
  MANDELBROT_VIEW, MANDELBROT_WORLD, MORPH_STEP,
} from './constants';
import { cancelMandelbrotCpu, fillMandelbrotTile, mandelbrotCpuConcurrency } from './cpu';
import computeWgsl from './mandelbrot.wgsl?raw';

export function packMandelbrotUniforms(
  view: ViewRect, width: number, height: number, params: MapParams, tile: TileUniforms,
): ArrayBuffer {
  const buffer = new ArrayBuffer(80);
  const f32 = new Float32Array(buffer);
  const u32 = new Uint32Array(buffer);
  f32.set([view.xMin, view.xMax, view.yMin, view.yMax]);
  f32.set([params.MORPH ?? 0, params.JULIA_REAL ?? JULIA_REAL, params.JULIA_IMAG ?? JULIA_IMAG, MANDELBROT_ESCAPE_SQUARED], 4);
  u32[12] = Math.max(MANDELBROT_MIN_ITER, Math.round(params.MAX_ITERATIONS ?? MANDELBROT_DEFAULT_ITER));
  u32[13] = width;
  u32[14] = height;
  const norm = normPixelRect(view, tile.normView ?? view, width, height);
  u32[17] = (norm.y0 << 16) | norm.x0;
  u32[18] = (norm.y1 << 16) | norm.x1;
  u32[19] = 1;
  return buffer;
}

export const mandelbrotMap: MapDefinition = {
  id: 'mandelbrot',
  precision: mandelbrotPrecision,
  title: 'Mandelbrot & Julia',
  settledResolution: { gpu: 'device', cpu: 'device' },
  defaultView: MANDELBROT_VIEW,
  worldView: MANDELBROT_WORLD,
  workBudget: {
    param: 'MAX_ITERATIONS', min: MANDELBROT_MIN_ITER, max: MANDELBROT_MAX_ITER,
    step: MANDELBROT_ITER_STEP, adaptive: false,
  },
  params: [
    {
      key: 'MORPH', label: 'param.mandelbrot.morph', kind: 'float',
      min: 0, max: 1, step: MORPH_STEP, default: 0, digits: 3, section: 'primary',
    },
    {
      key: 'JULIA_REAL', label: 'param.mandelbrot.real', kind: 'float',
      min: -JULIA_PARAM_LIMIT, max: JULIA_PARAM_LIMIT, step: JULIA_PARAM_STEP,
      default: JULIA_REAL, digits: 3, section: 'primary',
    },
    {
      key: 'JULIA_IMAG', label: 'param.mandelbrot.imag', kind: 'float',
      min: -JULIA_PARAM_LIMIT, max: JULIA_PARAM_LIMIT, step: JULIA_PARAM_STEP,
      default: JULIA_IMAG, digits: 3, section: 'primary',
    },
    {
      key: 'MAX_ITERATIONS', label: 'param.mandelbrot.iterations', kind: 'int',
      min: MANDELBROT_MIN_ITER, max: MANDELBROT_MAX_ITER, step: MANDELBROT_ITER_STEP,
      default: MANDELBROT_DEFAULT_ITER, scale: 'log', section: 'secondary',
    },
  ],
  gpu: {
    computeWgsl, entryPoint: 'simulate', uniformBytes: 80,
    tileSize: 128, dispatchBatch: 1, packUniforms: packMandelbrotUniforms,
  },
  cpu: {
    fillTile: fillMandelbrotTile, cancelPending: cancelMandelbrotCpu,
    concurrency: mandelbrotCpuConcurrency(), handoffPx: MANDELBROT_HANDOFF_PX,
  },
};
