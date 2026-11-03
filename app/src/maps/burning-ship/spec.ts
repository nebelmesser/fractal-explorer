import { normPixelRect, type MapDefinition, type MapParams, type TileUniforms, type ViewRect } from '../types';
import {
  SHIP_VIEW, SHIP_WORLD, SHIP_MIN_ITER, SHIP_MAX_ITER, SHIP_DEFAULT_ITER,
  SHIP_ITER_STEP, SHIP_HANDOFF_PX, SHIP_ESCAPE_SQUARED, SHIP_SAMPLE_FLOOR,
} from './constants';
import { cancelBurningShipCpu, fillBurningShipTile, shipCpuConcurrency } from './cpu';
import computeWgsl from './burning-ship.wgsl?raw';

export function packShipUniforms(
  view: ViewRect, width: number, height: number, params: MapParams, tile: TileUniforms,
): ArrayBuffer {
  const buffer = new ArrayBuffer(80);
  const f32 = new Float32Array(buffer);
  const u32 = new Uint32Array(buffer);
  f32.set([view.xMin, view.xMax, view.yMin, view.yMax]);
  f32.set([SHIP_ESCAPE_SQUARED, SHIP_SAMPLE_FLOOR], 4);
  u32[12] = Math.max(SHIP_MIN_ITER, Math.round(params.MAX_ITERATIONS ?? SHIP_DEFAULT_ITER));
  u32[13] = width;
  u32[14] = height;
  const norm = normPixelRect(view, tile.normView ?? view, width, height);
  u32[17] = (norm.y0 << 16) | norm.x0;
  u32[18] = (norm.y1 << 16) | norm.x1;
  u32[19] = 1;
  return buffer;
}

export const shipMap: MapDefinition = {
  id: 'burning-ship',
  title: 'Burning Ship',
  defaultView: SHIP_VIEW,
  worldView: SHIP_WORLD,
  settledResolution: { gpu: 'device', cpu: 'device' },
  workBudget: { param: 'MAX_ITERATIONS', min: SHIP_MIN_ITER, max: SHIP_MAX_ITER, step: SHIP_ITER_STEP, adaptive: false },
  params: [{
    key: 'MAX_ITERATIONS', label: 'param.burning_ship.iterations', kind: 'int',
    min: SHIP_MIN_ITER, max: SHIP_MAX_ITER, step: SHIP_ITER_STEP,
    default: SHIP_DEFAULT_ITER, scale: 'log', section: 'primary',
  }],
  gpu: { computeWgsl, entryPoint: 'simulate', uniformBytes: 80, tileSize: 128, dispatchBatch: 1, packUniforms: packShipUniforms },
  cpu: {
    fillTile: fillBurningShipTile, cancelPending: cancelBurningShipCpu,
    concurrency: shipCpuConcurrency(), handoffPx: SHIP_HANDOFF_PX,
  },
};
