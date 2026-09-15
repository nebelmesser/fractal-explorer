import {
  LYAPUNOV_DERIVATIVE_EPSILON,
  LYAPUNOV_DEFAULT_ITER,
  LYAPUNOV_ENCODE_OFFSET,
  LYAPUNOV_ITER_STEP,
  LYAPUNOV_MAX_ITER,
  LYAPUNOV_MIN_ITER,
  LYAPUNOV_PARAM_MAX,
  LYAPUNOV_PARAM_MIN,
  LYAPUNOV_RHYTHM_DEFAULT,
  LYAPUNOV_RHYTHMS,
  LYAPUNOV_SEED,
  LYAPUNOV_TRANSIENT,
} from './constants';
import {
  normPixelRect,
  type GpuKernel,
  type MapDefinition,
  type MapParams,
  type TileUniforms,
  type ViewRect,
} from '../types';
import computeWgsl from './lyapunov.wgsl?raw';
import { cancelLyapunovCpu, fillLyapunovTile, lyapunovCpuConcurrency } from './cpu';

export function packLyapunovUniforms(
  view: ViewRect,
  width: number,
  height: number,
  params: MapParams,
  tile: TileUniforms,
): ArrayBuffer {
  const requested = Math.max(
    LYAPUNOV_MIN_ITER,
    Math.round(params.MAX_ITERATIONS ?? LYAPUNOV_MIN_ITER),
  );
  const buf = new ArrayBuffer(80);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  f32[0] = view.xMin;
  f32[1] = view.xMax;
  f32[2] = view.yMin;
  f32[3] = view.yMax;
  f32[4] = params.SEED ?? LYAPUNOV_SEED;
  f32[5] = LYAPUNOV_DERIVATIVE_EPSILON;
  f32[6] = LYAPUNOV_TRANSIENT;
  f32[7] = LYAPUNOV_ENCODE_OFFSET;
  u32[12] = requested;
  u32[13] = width;
  u32[14] = height;
  u32[15] = Math.max(0, Math.min(
    LYAPUNOV_RHYTHMS.length - 1,
    Math.round(params.RHYTHM ?? LYAPUNOV_RHYTHM_DEFAULT),
  ));
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
  packUniforms: packLyapunovUniforms,
};

export const lyapunovMap: MapDefinition = {
  id: 'lyapunov',
  title: 'Lyapunov fractal',
  settledResolution: { gpu: 'device', cpu: 'device' },
  defaultView: {
    xMin: LYAPUNOV_PARAM_MIN,
    xMax: LYAPUNOV_PARAM_MAX,
    yMin: LYAPUNOV_PARAM_MIN,
    yMax: LYAPUNOV_PARAM_MAX,
  },
  workBudget: {
    param: 'MAX_ITERATIONS',
    min: LYAPUNOV_MIN_ITER,
    max: LYAPUNOV_MAX_ITER,
    step: LYAPUNOV_ITER_STEP,
    adaptive: false,
  },
  params: [
    {
      key: 'RHYTHM', label: 'param.lyapunov.rhythm', kind: 'int',
      min: 0, max: LYAPUNOV_RHYTHMS.length - 1, step: 1,
      default: LYAPUNOV_RHYTHM_DEFAULT, choices: LYAPUNOV_RHYTHMS,
      section: 'primary',
    },
    {
      key: 'MAX_ITERATIONS', label: 'param.lyapunov.accuracy', kind: 'int',
      min: LYAPUNOV_MIN_ITER, max: LYAPUNOV_MAX_ITER, step: LYAPUNOV_ITER_STEP,
      default: LYAPUNOV_DEFAULT_ITER, section: 'primary',
    },
    {
      key: 'SEED', label: 'param.lyapunov.seed', kind: 'float',
      min: 0.05, max: 0.95, step: 0.01,
      default: LYAPUNOV_SEED, digits: 2, section: 'primary',
    },
  ],
  gpu,
  cpu: {
    fillTile: fillLyapunovTile,
    cancelPending: cancelLyapunovCpu,
    concurrency: lyapunovCpuConcurrency(),
  },
};
