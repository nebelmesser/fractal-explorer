import {
  PENDULUM_DT,
  PENDULUM_G,
  PENDULUM_L1,
  PENDULUM_L2,
  PENDULUM_M1,
  PENDULUM_M2,
  PENDULUM_MIN_ITER,
  VIEW_HALF,
} from '../../constants';
import {
  normPixelRect,
  type GpuKernel,
  type MapDefinition,
  type MapParams,
  type PostUniforms,
  type ViewRect,
} from '../types';
import computeWgsl from './pendulum.wgsl?raw';
import { pendulumPreview } from './preview';

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
  f32[10] = 0;
  f32[11] = 0;
  u32[12] = Math.max(PENDULUM_MIN_ITER, Math.round(params.MAX_ITERATIONS ?? PENDULUM_MIN_ITER));
  u32[13] = width;
  u32[14] = height;
  u32[15] = post.invert ? 1 : 0;
  u32[16] = Math.max(0, Math.round(post.median));
  const norm = normPixelRect(view, post.normView ?? view, width, height);
  // extra.yz: 16-bit pairs (x0,y0) and (x1,y1). Sizes stay ≤ 4096.
  u32[17] = (norm.y0 << 16) | norm.x0;
  u32[18] = (norm.y1 << 16) | norm.x1;
  u32[19] = 0;
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
  defaultView: {
    xMin: -VIEW_HALF,
    xMax: VIEW_HALF,
    yMin: -VIEW_HALF,
    yMax: VIEW_HALF,
  },
  params: [
    { key: 'L1', label: 'L1', kind: 'float', min: 0.2, max: 3, step: 0.01, default: PENDULUM_L1 },
    { key: 'L2', label: 'L2', kind: 'float', min: 0.2, max: 3, step: 0.01, default: PENDULUM_L2 },
    { key: 'M1', label: 'M1', kind: 'float', min: 0.2, max: 5, step: 0.01, default: PENDULUM_M1 },
    { key: 'M2', label: 'M2', kind: 'float', min: 0.2, max: 5, step: 0.01, default: PENDULUM_M2 },
    { key: 'G', label: 'G', kind: 'float', min: 0.5, max: 25, step: 0.01, default: PENDULUM_G },
    { key: 'DT', label: 'DT', kind: 'float', min: 0.01, max: 0.5, step: 0.01, default: PENDULUM_DT },
  ],
  gpu,
  pointView: pendulumPreview,
};
