import {
  MAGNET_DT,
  MAGNET_F,
  MAGNET_G,
  MAGNET_H,
  MAGNET_K,
  MAGNET_MAX_ITER,
  MAGNET_MIN_ITER,
  MAGNET_R,
  MAGNET_R_MAX,
  MAGNET_R_MIN,
  MAGNET_SETTLE_SPEED,
  MAGNET_VIEW_HALF,
} from './constants';
import {
  normPixelRect,
  type GpuKernel,
  type MapDefinition,
  type MapParams,
  type TileUniforms,
  type ViewRect,
} from '../types';
import computeWgsl from './magnets.wgsl?raw';
import { cancelMagnetsCpu, fillMagnetsTile, magnetsCpuConcurrency } from './cpu';

export function packMagnetsUniforms(
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
  f32[4] = params.K;
  f32[5] = params.G;
  f32[6] = params.F;
  f32[7] = params.H;
  f32[8] = params.DT;
  f32[9] = MAGNET_SETTLE_SPEED * MAGNET_SETTLE_SPEED;
  f32[10] = params.R ?? MAGNET_R;
  f32[11] = 0;
  u32[12] = Math.max(MAGNET_MIN_ITER, Math.round(params.MAX_ITERATIONS ?? MAGNET_MIN_ITER));
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
  packUniforms: packMagnetsUniforms,
};

export const magnetsMap: MapDefinition = {
  id: 'magnets',
  title: 'Magnetic pendulum',
  settledResolution: { gpu: 'device', cpu: 'adaptive' },
  defaultView: {
    xMin: -MAGNET_VIEW_HALF,
    xMax: MAGNET_VIEW_HALF,
    yMin: -MAGNET_VIEW_HALF,
    yMax: MAGNET_VIEW_HALF,
  },
  workBudget: {
    param: 'MAX_ITERATIONS',
    min: MAGNET_MIN_ITER,
    max: MAGNET_MAX_ITER,
    step: 50,
  },
  params: [
    { key: 'R', label: 'param.R', kind: 'float', min: MAGNET_R_MIN, max: MAGNET_R_MAX, step: 0.01, default: MAGNET_R },
    { key: 'K', label: 'param.K', kind: 'float', min: 0.1, max: 3, step: 0.01, default: MAGNET_K },
    { key: 'G', label: 'param.G', kind: 'float', min: 0.05, max: 2, step: 0.01, default: MAGNET_G },
    { key: 'F', label: 'param.F', kind: 'float', min: 0, max: 0.8, step: 0.01, default: MAGNET_F },
    { key: 'H', label: 'param.H', kind: 'float', min: 0.08, max: 0.8, step: 0.01, default: MAGNET_H },
    { key: 'DT', label: 'param.DT', kind: 'float', min: 0.005, max: 0.05, step: 0.001, default: MAGNET_DT, invert: true, digits: 3 },
  ],
  gpu,
  cpu: {
    fillTile: fillMagnetsTile,
    cancelPending: cancelMagnetsCpu,
    concurrency: magnetsCpuConcurrency(),
  },
};
