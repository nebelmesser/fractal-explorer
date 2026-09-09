import {
  PENDULUM_DT,
  PENDULUM_FRICTION,
  PENDULUM_G,
  PENDULUM_L1,
  PENDULUM_L2,
  PENDULUM_M1,
  PENDULUM_M2,
  PENDULUM_MIN_ITER,
  PENDULUM_MAX_ITER,
  PENDULUM_TILE_HALF,
  PENDULUM_VIEW_HALF,
} from './constants';
import {
  normPixelRect,
  type GpuKernel,
  type MapDefinition,
  type MapParams,
  type PostUniforms,
  type ViewRect,
} from '../types';
import computeWgsl from './pendulum.wgsl?raw';
import { fillPendulumTile, pendulumCpuConcurrency } from './cpu';

/** Pack the 80-byte uniform block shared by the compute and postprocess shaders. */
export function packPendulumUniforms(
  view: ViewRect,
  width: number,
  height: number,
  params: MapParams,
  post: PostUniforms,
): ArrayBuffer {
  // Five vec4s: view, phys, step, size (u32), extra (u32) — 80 bytes, 16-aligned.
  const buf = new ArrayBuffer(80);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  f32[0] = view.xMin;
  f32[1] = view.xMax;
  f32[2] = view.yMin;
  f32[3] = view.yMax;
  f32[4] = params.L1;
  f32[5] = params.L2;
  f32[6] = params.M1;
  f32[7] = params.M2;
  f32[8] = params.G;
  f32[9] = params.DT;
  f32[10] = params.F ?? 0;
  f32[11] = 0;
  u32[12] = Math.max(PENDULUM_MIN_ITER, Math.round(params.MAX_ITERATIONS ?? PENDULUM_MIN_ITER));
  u32[13] = width;
  u32[14] = height;
  u32[15] = post.invert ? 1 : 0;
  u32[16] = Math.max(0, Math.round(post.median));
  const norm = normPixelRect(view, post.normView ?? view, width, height);
  // extra.yz: 16-bit pairs (x0,y0) and (x1,y1). Sides stay well below 65535.
  u32[17] = (norm.y0 << 16) | norm.x0;
  u32[18] = (norm.y1 << 16) | norm.x1;
  u32[19] = Math.max(1, Math.round(post.histogramWeight ?? 1));
  return buf;
}

const gpu: GpuKernel = {
  computeWgsl,
  entryPoint: 'simulate',
  uniformBytes: 80,
  packUniforms: packPendulumUniforms,
};

export const pendulumMap: MapDefinition = {
  id: 'pendulum',
  title: 'Double pendulum',
  preferencesKey: 'fractal-explorer',
  defaultView: {
    xMin: -PENDULUM_VIEW_HALF,
    xMax: PENDULUM_VIEW_HALF,
    yMin: -PENDULUM_VIEW_HALF,
    yMax: PENDULUM_VIEW_HALF,
  },
  navigation: {
    xCenter: { min: -PENDULUM_TILE_HALF, max: PENDULUM_TILE_HALF },
    yPeriod: { period: PENDULUM_TILE_HALF * 2, center: 0 },
  },
  workBudget: {
    param: 'MAX_ITERATIONS',
    min: PENDULUM_MIN_ITER,
    max: PENDULUM_MAX_ITER,
    step: 50,
  },
  params: [
    { key: 'L1', label: 'param.L1', kind: 'float', min: 0.2, max: 3, step: 0.01, default: PENDULUM_L1, tone: 'th1', section: 'primary' },
    { key: 'M1', label: 'param.M1', kind: 'float', min: 0.2, max: 5, step: 0.01, default: PENDULUM_M1, tone: 'th1', section: 'primary', thumbArea: true },
    { key: 'L2', label: 'param.L2', kind: 'float', min: 0.2, max: 3, step: 0.01, default: PENDULUM_L2, tone: 'th2', section: 'primary' },
    { key: 'M2', label: 'param.M2', kind: 'float', min: 0.2, max: 5, step: 0.01, default: PENDULUM_M2, tone: 'th2', section: 'primary', thumbArea: true },
    { key: 'G', label: 'param.G', kind: 'float', min: 0.5, max: 25, step: 0.01, default: PENDULUM_G },
    { key: 'F', label: 'param.F', kind: 'float', min: 0, max: 0.5, step: 0.01, default: PENDULUM_FRICTION },
    { key: 'DT', label: 'param.DT', kind: 'float', min: 0.01, max: 0.5, step: 0.01, default: PENDULUM_DT, invert: true },
  ],
  gpu,
  cpu: { fillTile: fillPendulumTile, concurrency: pendulumCpuConcurrency() },
};
