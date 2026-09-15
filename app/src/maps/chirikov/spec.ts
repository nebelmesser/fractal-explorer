import {
  CHIRIKOV_DEFAULT_ITER,
  CHIRIKOV_HALF_TURN,
  CHIRIKOV_ITER_STEP,
  CHIRIKOV_K_DEFAULT,
  CHIRIKOV_K_MAX,
  CHIRIKOV_K_MIN,
  CHIRIKOV_K_STEP,
  CHIRIKOV_MAX_ITER,
  CHIRIKOV_MIN_ITER,
  CHIRIKOV_TAU,
} from './constants';
import {
  normPixelRect,
  type GpuKernel,
  type MapDefinition,
  type MapParams,
  type TileUniforms,
  type ViewRect,
} from '../types';
import computeWgsl from './chirikov.wgsl?raw';
import { cancelChirikovCpu, chirikovCpuConcurrency, fillChirikovTile } from './cpu';

export function packChirikovUniforms(
  view: ViewRect,
  width: number,
  height: number,
  params: MapParams,
  tile: TileUniforms,
): ArrayBuffer {
  const buf = new ArrayBuffer(80);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  f32[0] = view.xMin;
  f32[1] = view.xMax;
  f32[2] = view.yMin;
  f32[3] = view.yMax;
  f32[4] = params.K ?? CHIRIKOV_K_DEFAULT;
  u32[12] = Math.max(CHIRIKOV_MIN_ITER, Math.round(
    params.MAX_ITERATIONS ?? CHIRIKOV_DEFAULT_ITER,
  ));
  u32[13] = width;
  u32[14] = height;
  u32[15] = 0;
  u32[16] = 0;
  const norm = normPixelRect(view, tile.normView ?? view, width, height);
  u32[17] = (norm.y0 << 16) | norm.x0;
  u32[18] = (norm.y1 << 16) | norm.x1;
  u32[19] = 1;
  return buf;
}

const gpu: GpuKernel = {
  computeWgsl,
  entryPoint: 'simulate',
  uniformBytes: 80,
  tileSize: 128,
  dispatchBatch: 1,
  packUniforms: packChirikovUniforms,
};

export const chirikovMap: MapDefinition = {
  id: 'chirikov',
  title: 'Chirikov–Taylor map',
  settledResolution: 'device',
  settledResolutionIdleMs: 0,
  defaultView: {
    xMin: -CHIRIKOV_HALF_TURN,
    xMax: CHIRIKOV_HALF_TURN,
    yMin: -CHIRIKOV_HALF_TURN,
    yMax: CHIRIKOV_HALF_TURN,
  },
  navigation: {
    xPeriod: { period: CHIRIKOV_TAU, center: 0 },
    yPeriod: { period: CHIRIKOV_TAU, center: 0 },
  },
  workBudget: {
    param: 'MAX_ITERATIONS',
    min: CHIRIKOV_MIN_ITER,
    max: CHIRIKOV_MAX_ITER,
    step: CHIRIKOV_ITER_STEP,
    adaptive: false,
  },
  params: [
    {
      key: 'K', label: 'K', kind: 'float',
      min: CHIRIKOV_K_MIN, max: CHIRIKOV_K_MAX, step: CHIRIKOV_K_STEP,
      default: CHIRIKOV_K_DEFAULT, digits: 3, section: 'primary',
    },
    {
      key: 'MAX_ITERATIONS', label: 'N', kind: 'int',
      min: CHIRIKOV_MIN_ITER, max: CHIRIKOV_MAX_ITER, step: CHIRIKOV_ITER_STEP,
      default: CHIRIKOV_DEFAULT_ITER, section: 'primary',
    },
  ],
  gpu,
  cpu: {
    fillTile: fillChirikovTile,
    cancelPending: cancelChirikovCpu,
    concurrency: chirikovCpuConcurrency(),
    handoffPx: 0.5,
  },
};
