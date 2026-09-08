import type { GpuContext } from './device';
import type { MapDefinition, MapParams, ViewRect } from '../maps/types';
import { viewSpanX, viewSpanY } from '../maps/types';
import {
  LOD_CACHE_TILES, LOD_COARSE_GAP, LOD_EXPOSURE_HIGH, LOD_EXPOSURE_LOW,
  LOD_EXPOSURE_TAU_MS, LOD_MAX_LEVEL, LOD_PREFETCH_PAD, LOD_TILE_PX,
} from '../constants';
import reduceWgsl from './reduce.wgsl?raw';
import histogramWgsl from './histogram.wgsl?raw';
import tileBlitWgsl from './tile_blit.wgsl?raw';

type Targets = { canvas: HTMLCanvasElement; context: GPUCanvasContext; configuredW: number; configuredH: number };
type Exposure = { lo: number; hi: number };
type Tile = {
  key: string; generation: number; level: number; ix: number; iy: number; view: ViewRect;
  uniform: GPUBuffer; raw: GPUBuffer; minmax: GPUBuffer; counts: Float32Array;
  lo: number; hi: number; used: number;
};
type Cell = {
  key: string; level: number; ix: number; iy: number; canonicalIy: number;
  sourceView: ViewRect; drawView: ViewRect;
};
type PresentRequest = {
  view: ViewRect; params: MapParams; width: number; height: number; invert: boolean;
  median: number; moving: boolean; level: number; generation: number;
};

/**
 * Map-agnostic world LOD renderer. Tiles retain raw f32 values, so moving the
 * camera and changing the shared exposure never invalidates computed points.
 */
export class GpuMapRenderer {
  lastError: string | null = null;
  lastScale: Exposure | null = null;
  private readonly tiles = new Map<string, Tile>();
  private generation = 0;
  private paramsKey = '';
  private useCounter = 0;
  private target: Targets;
  private latest: PresentRequest | null = null;
  private refining = false;
  private gpuTail: Promise<void> = Promise.resolve();
  private exposure: Exposure | null = null;
  private exposureTarget: Exposure | null = null;
  private exposureAt = performance.now();
  private exposureRaf = 0;
  private readonly canvasPx = new WeakMap<HTMLCanvasElement, { w: number; h: number }>();
  private readonly drawBuffers: GPUBuffer[] = [];
  private readonly computeLayout: GPUBindGroupLayout;
  private readonly reduceLayout: GPUBindGroupLayout;
  private readonly histogramLayout: GPUBindGroupLayout;
  private readonly composeLayout: GPUBindGroupLayout;
  private readonly computePipeline: GPUComputePipeline;
  private readonly reducePipeline: GPUComputePipeline;
  private readonly histogramPipeline: GPUComputePipeline;
  private readonly composePipeline: GPURenderPipeline;
  private readonly exposureBuffer: GPUBuffer;
  private readonly histogramBuffer: GPUBuffer;
  private readonly histogramRead: GPUBuffer;

  private constructor(
    private readonly gpu: GpuContext,
    private readonly map: MapDefinition,
    canvas: HTMLCanvasElement,
    p: {
      computeLayout: GPUBindGroupLayout; reduceLayout: GPUBindGroupLayout;
      histogramLayout: GPUBindGroupLayout; composeLayout: GPUBindGroupLayout;
      compute: GPUComputePipeline; reduce: GPUComputePipeline;
      histogram: GPUComputePipeline; compose: GPURenderPipeline;
    },
  ) {
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Canvas has no WebGPU context');
    this.target = { canvas, context, configuredW: 0, configuredH: 0 };
    this.computeLayout = p.computeLayout; this.reduceLayout = p.reduceLayout;
    this.histogramLayout = p.histogramLayout; this.composeLayout = p.composeLayout;
    this.computePipeline = p.compute; this.reducePipeline = p.reduce;
    this.histogramPipeline = p.histogram; this.composePipeline = p.compose;
    const device = gpu.device;
    this.exposureBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.histogramBuffer = device.createBuffer({ size: 1024, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.histogramRead = device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }

  static async create(gpu: GpuContext, canvas: HTMLCanvasElement, map: MapDefinition): Promise<GpuMapRenderer> {
    const device = gpu.device;
    const computeLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ] });
    const reduceLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ] });
    const histogramLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ] });
    const composeLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ] });
    const computeMod = device.createShaderModule({ code: map.gpu.computeWgsl });
    const reduceMod = device.createShaderModule({ code: reduceWgsl });
    const histogramMod = device.createShaderModule({ code: histogramWgsl });
    const composeMod = device.createShaderModule({ code: tileBlitWgsl });
    await Promise.all([
      assertShader(computeMod, 'compute'), assertShader(reduceMod, 'reduce'),
      assertShader(histogramMod, 'histogram'), assertShader(composeMod, 'tile compositor'),
    ]);
    const compute = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
      compute: { module: computeMod, entryPoint: map.gpu.entryPoint },
    });
    const reduce = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [reduceLayout] }),
      compute: { module: reduceMod, entryPoint: 'reduce_minmax' },
    });
    const histogram = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [histogramLayout] }),
      compute: { module: histogramMod, entryPoint: 'histogram' },
    });
    const compose = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [composeLayout] }),
      vertex: { module: composeMod, entryPoint: 'tile_vs' },
      fragment: { module: composeMod, entryPoint: 'tile_fs', targets: [{ format: gpu.format }] },
    });
    return new GpuMapRenderer(gpu, map, canvas, {
      computeLayout, reduceLayout, histogramLayout, composeLayout, compute, reduce, histogram, compose,
    });
  }

  async render(view: ViewRect, params: MapParams, width: number, height: number, invert: boolean, median: number, _normView: ViewRect = view): Promise<number> {
    const t0 = performance.now();
    const request = this.makeRequest(view, params, width, height, invert, median, false);
    const coarse = Math.max(0, request.level - LOD_COARSE_GAP);
    await this.enqueue(async () => {
      if (request.generation !== this.generation) return;
      await this.ensureCells(request, [0, coarse], 0);
      await this.updateExposure(request);
      this.compose(request);
      await this.ensureCells(request, [request.level], LOD_PREFETCH_PAD);
      await this.updateExposure(request);
      this.compose(request);
    });
    this.scheduleRefine();
    return performance.now() - t0;
  }

  present(view: ViewRect, params: MapParams, width: number, height: number, invert: boolean, median: number, moving = true): void {
    const request = this.makeRequest(view, params, width, height, invert, median, moving);
    this.compose(request);
    this.scheduleRefine();
  }

  prefetch(view: ViewRect, params: MapParams, width: number, height: number): Promise<void> {
    const request = this.makeRequest(view, params, width, height, false, 1, true, false);
    const coarse = Math.max(0, request.level - LOD_COARSE_GAP);
    return this.enqueue(async () => {
      if (request.generation === this.generation) await this.ensureCells(request, [0, coarse, request.level], LOD_PREFETCH_PAD);
    });
  }

  snapWorld(point: { x: number; y: number }): { x: number; y: number } {
    const tile = this.tileAt(point.x, point.y);
    if (!tile) return point;
    const cy = this.canonicalY(point.y);
    const ix = clampIndex(Math.round(((point.x - tile.view.xMin) / viewSpanX(tile.view)) * (LOD_TILE_PX - 1)));
    const iy = clampIndex(Math.round(((cy - tile.view.yMin) / viewSpanY(tile.view)) * (LOD_TILE_PX - 1)));
    return {
      x: tile.view.xMin + (ix / (LOD_TILE_PX - 1)) * viewSpanX(tile.view),
      y: point.y + tile.view.yMin + (iy / (LOD_TILE_PX - 1)) * viewSpanY(tile.view) - cy,
    };
  }

  mapSize(): { width: number; height: number } | null {
    return this.latest ? { width: this.latest.width, height: this.latest.height } : null;
  }

  mapTexel(nx: number, ny: number): { ix: number; iy: number; width: number; height: number } | null {
    if (!this.latest) return null;
    const width = Math.max(2, this.latest.width); const height = Math.max(2, this.latest.height);
    return { ix: Math.round(nx * (width - 1)), iy: Math.round(ny * (height - 1)), width, height };
  }

  mapSteps(nx: number, ny: number): number | null {
    if (!this.latest) return null;
    return this.stepsAt(
      this.latest.view.xMin + nx * viewSpanX(this.latest.view),
      this.latest.view.yMin + ny * viewSpanY(this.latest.view),
    );
  }

  grayForSteps(steps: number, invert: boolean): number | null {
    if (!this.exposure) return null;
    let value = (Math.log1p(Math.max(0, steps)) - this.exposure.lo) / Math.max(1e-9, this.exposure.hi - this.exposure.lo);
    value = Math.max(0, Math.min(1, value));
    return (invert ? 1 - value : value) * 255;
  }

  async sampleGray(nx: number, ny: number): Promise<number | null> {
    const steps = this.mapSteps(nx, ny);
    return steps === null ? null : this.grayForSteps(steps, this.latest?.invert ?? false);
  }

  setCanvas(canvas: HTMLCanvasElement): void {
    if (this.target.canvas === canvas) return;
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Canvas has no WebGPU context');
    const previous = this.canvasPx.get(canvas);
    this.target = { canvas, context, configuredW: previous?.w ?? 0, configuredH: previous?.h ?? 0 };
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    const run = this.gpuTail.then(fn, fn);
    this.gpuTail = run.catch(() => undefined);
    return run;
  }

  private makeRequest(view: ViewRect, params: MapParams, width: number, height: number, invert: boolean, median: number, moving: boolean, display = true): PresentRequest {
    this.ensureParams(params);
    const w = Math.max(1, Math.round(width)); const h = Math.max(1, Math.round(height));
    const request = { view: { ...view }, params: { ...params }, width: w, height: h, invert, median, moving, level: this.levelFor(view, w, h), generation: this.generation };
    if (display) this.latest = request;
    return request;
  }

  private ensureParams(params: MapParams): void {
    const key = Object.keys(params).sort().map((name) => `${name}:${Number(params[name]).toPrecision(9)}`).join('|');
    if (key === this.paramsKey) return;
    this.paramsKey = key; this.generation += 1;
    const retired = [...this.tiles.values()];
    this.tiles.clear(); this.exposure = null; this.exposureTarget = null;
    void this.gpuTail.then(async () => {
      await this.gpu.device.queue.onSubmittedWorkDone();
      for (const tile of retired) this.destroyTile(tile);
    });
  }

  private baseSpan(): number { return Math.min(viewSpanX(this.map.defaultView), viewSpanY(this.map.defaultView)); }
  private tileSpan(level: number): number { return this.baseSpan() / (2 ** level); }
  private levelFor(view: ViewRect, width: number, height: number): number {
    const worldPerPixel = Math.max(viewSpanX(view) / width, viewSpanY(view) / height);
    const exact = Math.log2(this.baseSpan() / Math.max(1e-12, LOD_TILE_PX * worldPerPixel));
    return Math.max(0, Math.min(LOD_MAX_LEVEL, Math.round(exact)));
  }
  private xOrigin(): number { return this.map.defaultView.xMin; }
  private yOrigin(): number {
    const p = this.map.navigation?.yPeriod;
    return p ? p.center - p.period / 2 : this.map.defaultView.yMin;
  }
  private canonicalY(y: number): number {
    const p = this.map.navigation?.yPeriod;
    if (!p) return y;
    const origin = this.yOrigin();
    return origin + ((y - origin) % p.period + p.period) % p.period;
  }
  private canonicalIy(iy: number, level: number): number {
    const p = this.map.navigation?.yPeriod;
    if (!p) return iy;
    const count = Math.max(1, Math.round(p.period / this.tileSpan(level)));
    return ((iy % count) + count) % count;
  }

  private cells(view: ViewRect, level: number, pad: number): Cell[] {
    const span = this.tileSpan(level);
    const xMin = view.xMin - viewSpanX(view) * pad; const xMax = view.xMax + viewSpanX(view) * pad;
    const yMin = view.yMin - viewSpanY(view) * pad; const yMax = view.yMax + viewSpanY(view) * pad;
    const x0 = Math.floor((xMin - this.xOrigin()) / span); const x1 = Math.floor((xMax - this.xOrigin() - span * 1e-9) / span);
    const y0 = Math.floor((yMin - this.yOrigin()) / span); const y1 = Math.floor((yMax - this.yOrigin() - span * 1e-9) / span);
    const out: Cell[] = [];
    for (let iy = y0; iy <= y1; iy++) {
      const canonicalIy = this.canonicalIy(iy, level);
      for (let ix = x0; ix <= x1; ix++) {
        const sourceView = {
          xMin: this.xOrigin() + ix * span, xMax: this.xOrigin() + (ix + 1) * span,
          yMin: this.yOrigin() + canonicalIy * span, yMax: this.yOrigin() + (canonicalIy + 1) * span,
        };
        out.push({
          key: `${this.generation}:${level}:${ix}:${canonicalIy}`, level, ix, iy, canonicalIy, sourceView,
          drawView: { xMin: sourceView.xMin, xMax: sourceView.xMax, yMin: this.yOrigin() + iy * span, yMax: this.yOrigin() + (iy + 1) * span },
        });
      }
    }
    return out;
  }

  private async ensureCells(request: PresentRequest, levels: number[], pad: number): Promise<void> {
    const unique = new Map<string, Cell>();
    for (const level of [...new Set(levels)].sort((a, b) => a - b)) {
      for (const cell of this.cells(request.view, level, pad)) if (!this.tiles.has(cell.key)) unique.set(cell.key, cell);
    }
    const cx = (request.view.xMin + request.view.xMax) / 2; const cy = (request.view.yMin + request.view.yMax) / 2;
    const cells = [...unique.values()].sort((a, b) => a.level - b.level || distance(a.drawView, cx, cy) - distance(b.drawView, cx, cy));
    for (let i = 0; i < cells.length; i += 6) {
      if (request.generation !== this.generation) return;
      await this.computeBatch(cells.slice(i, i + 6), request);
      if (this.latest?.generation === request.generation) this.compose(this.latest);
    }
    this.evict();
  }

  private async computeBatch(cells: Cell[], request: PresentRequest): Promise<void> {
    const { device } = this.gpu;
    const fresh = cells.filter((cell) => !this.tiles.has(cell.key)).map((cell) => {
      const uniform = device.createBuffer({ size: this.map.gpu.uniformBytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const raw = device.createBuffer({ size: LOD_TILE_PX * LOD_TILE_PX * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const minmax = device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const read = device.createBuffer({ size: 256 + LOD_TILE_PX * LOD_TILE_PX * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      device.queue.writeBuffer(uniform, 0, this.map.gpu.packUniforms(cell.sourceView, LOD_TILE_PX, LOD_TILE_PX, request.params, { invert: false, median: 1, normView: cell.sourceView }));
      return { cell, uniform, raw, minmax, read };
    });
    if (!fresh.length) return;
    const encoder = device.createCommandEncoder();
    for (const item of fresh) {
      const compute = encoder.beginComputePass();
      compute.setPipeline(this.computePipeline);
      compute.setBindGroup(0, this.bind(this.computeLayout, [
        { binding: 0, resource: { buffer: item.uniform } }, { binding: 1, resource: { buffer: item.raw } },
      ]));
      compute.dispatchWorkgroups(LOD_TILE_PX / 8, LOD_TILE_PX / 8); compute.end();
      const reduce = encoder.beginComputePass();
      reduce.setPipeline(this.reducePipeline);
      reduce.setBindGroup(0, this.bind(this.reduceLayout, [
        { binding: 0, resource: { buffer: item.uniform } }, { binding: 1, resource: { buffer: item.raw } },
        { binding: 2, resource: { buffer: item.minmax } },
      ]));
      reduce.dispatchWorkgroups(1); reduce.end();
      encoder.copyBufferToBuffer(item.minmax, 0, item.read, 0, 8);
      encoder.copyBufferToBuffer(item.raw, 0, item.read, 256, LOD_TILE_PX * LOD_TILE_PX * 4);
    }
    device.pushErrorScope('validation'); device.pushErrorScope('internal');
    device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    const internal = await device.popErrorScope(); const validation = await device.popErrorScope();
    if (internal ?? validation) throw new Error((internal ?? validation)!.message);
    await Promise.all(fresh.map(async (item) => {
      await item.read.mapAsync(GPUMapMode.READ);
      const bytes = item.read.getMappedRange(); const [lo, hi] = new Float32Array(bytes.slice(0, 8));
      const counts = new Float32Array(LOD_TILE_PX * LOD_TILE_PX);
      counts.set(new Float32Array(bytes, 256, counts.length));
      item.read.unmap(); item.read.destroy();
      if (request.generation !== this.generation) {
        item.uniform.destroy(); item.raw.destroy(); item.minmax.destroy(); return;
      }
      this.tiles.set(item.cell.key, {
        key: item.cell.key, generation: request.generation, level: item.cell.level,
        ix: item.cell.ix, iy: item.cell.canonicalIy, view: item.cell.sourceView,
        uniform: item.uniform, raw: item.raw, minmax: item.minmax, counts, lo, hi, used: ++this.useCounter,
      });
    }));
  }

  private visibleTiles(request: PresentRequest): Array<{ tile: Tile; drawView: ViewRect }> {
    const found = new Map<string, { tile: Tile; drawView: ViewRect }>();
    for (let level = 0; level <= request.level; level++) {
      for (const cell of this.cells(request.view, level, 0)) {
        const tile = this.tiles.get(cell.key); if (!tile) continue;
        tile.used = ++this.useCounter;
        found.set(`${level}:${cell.ix}:${cell.iy}`, { tile, drawView: cell.drawView });
      }
    }
    return [...found.values()].sort((a, b) => a.tile.level - b.tile.level);
  }

  private compose(request: PresentRequest): void {
    if (request.generation !== this.generation) return;
    this.configureCanvas(request.width, request.height);
    const draws = this.visibleTiles(request); this.advanceExposure();
    const exposure = this.exposure ?? this.exposureTarget ?? { lo: 0, hi: 1 }; this.lastScale = exposure;
    const exposureData = new ArrayBuffer(32); const f32 = new Float32Array(exposureData); const u32 = new Uint32Array(exposureData);
    f32[0] = exposure.lo; f32[1] = Math.max(exposure.lo + 1e-6, exposure.hi);
    f32[2] = request.invert ? 1 : 0; f32[3] = request.moving ? 1 : 0;
    u32[4] = Math.max(1, Math.min(5, Math.round(request.median))); u32[5] = LOD_TILE_PX; u32[6] = LOD_TILE_PX;
    this.gpu.device.queue.writeBuffer(this.exposureBuffer, 0, exposureData);
    while (this.drawBuffers.length < draws.length) {
      this.drawBuffers.push(this.gpu.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    }
    const sx = viewSpanX(request.view); const sy = viewSpanY(request.view);
    for (let i = 0; i < draws.length; i++) {
      const draw = draws[i].drawView;
      this.gpu.device.queue.writeBuffer(this.drawBuffers[i], 0, new Float32Array([
        ((draw.xMin - request.view.xMin) / sx) * 2 - 1, ((draw.xMax - request.view.xMin) / sx) * 2 - 1,
        1 - ((draw.yMin - request.view.yMin) / sy) * 2, 1 - ((draw.yMax - request.view.yMin) / sy) * 2,
      ]));
    }
    const encoder = this.gpu.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: this.target.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    }] });
    pass.setPipeline(this.composePipeline);
    for (let i = 0; i < draws.length; i++) {
      pass.setBindGroup(0, this.bind(this.composeLayout, [
        { binding: 0, resource: { buffer: draws[i].tile.raw } }, { binding: 1, resource: { buffer: this.exposureBuffer } },
        { binding: 2, resource: { buffer: this.drawBuffers[i] } },
      ]));
      pass.draw(6);
    }
    pass.end(); this.gpu.device.queue.submit([encoder.finish()]);
    if (draws.length) this.target.canvas.dataset.ready = '1'; this.lastError = null;
  }

  private async updateExposure(request: PresentRequest): Promise<void> {
    if (request.generation !== this.generation) return;
    const all = this.visibleTiles(request).filter((item) => item.tile.level === request.level).map((item) => item.tile);
    const tiles = [...new Map(all.map((tile) => [tile.key, tile])).values()];
    if (!tiles.length) return;
    const { device } = this.gpu; const encoder = device.createCommandEncoder(); encoder.clearBuffer(this.histogramBuffer);
    for (const tile of tiles) {
      const pass = encoder.beginComputePass(); pass.setPipeline(this.histogramPipeline);
      pass.setBindGroup(0, this.bind(this.histogramLayout, [
        { binding: 0, resource: { buffer: tile.uniform } }, { binding: 1, resource: { buffer: tile.raw } },
        { binding: 2, resource: { buffer: this.histogramBuffer } },
      ]));
      pass.dispatchWorkgroups(LOD_TILE_PX * LOD_TILE_PX / 256); pass.end();
    }
    encoder.copyBufferToBuffer(this.histogramBuffer, 0, this.histogramRead, 0, 1024);
    device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    await this.histogramRead.mapAsync(GPUMapMode.READ);
    const bins = new Uint32Array(this.histogramRead.getMappedRange().slice(0)); this.histogramRead.unmap();
    let total = 0; for (const count of bins) total += count; if (!total) return;
    const lowBin = percentileBin(bins, total * LOD_EXPOSURE_LOW);
    const highBin = percentileBin(bins, total * LOD_EXPOSURE_HIGH);
    const maxIterations = Math.max(1, request.params[this.map.workBudget.param] ?? this.map.workBudget.min);
    const maxLog = Math.log1p(maxIterations);
    this.exposureTarget = { lo: lowBin / 256 * maxLog, hi: (highBin + 1) / 256 * maxLog };
    if (this.exposureTarget.hi <= this.exposureTarget.lo) this.exposureTarget.hi = this.exposureTarget.lo + maxLog / 256;
    if (!this.exposure) this.exposure = { ...this.exposureTarget };
    this.exposureAt = performance.now(); this.scheduleExposureFrames();
  }

  private advanceExposure(): void {
    if (!this.exposureTarget) return;
    if (!this.exposure) { this.exposure = { ...this.exposureTarget }; this.exposureAt = performance.now(); return; }
    const now = performance.now(); const alpha = 1 - Math.exp(-(now - this.exposureAt) / LOD_EXPOSURE_TAU_MS);
    this.exposure.lo += (this.exposureTarget.lo - this.exposure.lo) * alpha;
    this.exposure.hi += (this.exposureTarget.hi - this.exposure.hi) * alpha; this.exposureAt = now;
  }

  private scheduleExposureFrames(): void {
    if (this.exposureRaf) return;
    const step = (): void => {
      this.exposureRaf = 0;
      if (!this.latest || !this.exposure || !this.exposureTarget) return;
      const delta = Math.max(Math.abs(this.exposure.lo - this.exposureTarget.lo), Math.abs(this.exposure.hi - this.exposureTarget.hi));
      if (delta < 1e-3) { this.exposure = { ...this.exposureTarget }; this.compose(this.latest); return; }
      this.compose(this.latest); this.exposureRaf = requestAnimationFrame(step);
    };
    this.exposureRaf = requestAnimationFrame(step);
  }

  private scheduleRefine(): void {
    if (this.refining) return; this.refining = true;
    void this.enqueue(async () => {
      try {
        while (this.latest) {
          const request = this.latest; if (request.generation !== this.generation) continue;
          const levels = [0, Math.max(0, request.level - LOD_COARSE_GAP), request.level];
          const missing = levels.some((level) => this.cells(request.view, level, LOD_PREFETCH_PAD).some((cell) => !this.tiles.has(cell.key)));
          if (!missing) break;
          await this.ensureCells(request, levels, LOD_PREFETCH_PAD); await this.updateExposure(request);
          if (this.latest === request) this.compose(request);
        }
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error); console.error(error);
      } finally {
        this.refining = false;
        if (this.latest && this.cells(this.latest.view, this.latest.level, LOD_PREFETCH_PAD).some((cell) => !this.tiles.has(cell.key))) this.scheduleRefine();
      }
    });
  }

  private tileAt(x: number, y: number): Tile | null {
    if (!this.latest) return null;
    for (let level = this.latest.level; level >= 0; level--) {
      const span = this.tileSpan(level); const ix = Math.floor((x - this.xOrigin()) / span);
      const iy = Math.floor((this.canonicalY(y) - this.yOrigin()) / span);
      const tile = this.tiles.get(`${this.generation}:${level}:${ix}:${this.canonicalIy(iy, level)}`);
      if (tile) return tile;
    }
    return null;
  }

  private stepsAt(x: number, y: number): number | null {
    const tile = this.tileAt(x, y); if (!tile) return null; const cy = this.canonicalY(y);
    const ix = clampIndex(Math.round(((x - tile.view.xMin) / viewSpanX(tile.view)) * (LOD_TILE_PX - 1)));
    const iy = clampIndex(Math.round(((cy - tile.view.yMin) / viewSpanY(tile.view)) * (LOD_TILE_PX - 1)));
    const value = tile.counts[iy * LOD_TILE_PX + ix]; return Number.isFinite(value) ? value : null;
  }

  private evict(): void {
    if (this.tiles.size <= LOD_CACHE_TILES) return;
    const keep = new Set<string>();
    if (this.latest) for (let level = 0; level <= this.latest.level; level++) for (const cell of this.cells(this.latest.view, level, LOD_PREFETCH_PAD)) keep.add(cell.key);
    const candidates = [...this.tiles.values()].filter((tile) => !keep.has(tile.key)).sort((a, b) => a.used - b.used);
    while (this.tiles.size > LOD_CACHE_TILES && candidates.length) {
      const tile = candidates.shift()!; this.tiles.delete(tile.key); this.destroyTile(tile);
    }
  }

  private destroyTile(tile: Tile): void { tile.uniform.destroy(); tile.raw.destroy(); tile.minmax.destroy(); }
  private bind(layout: GPUBindGroupLayout, entries: GPUBindGroupEntry[]): GPUBindGroup { return this.gpu.device.createBindGroup({ layout, entries }); }
  private configureCanvas(width: number, height: number): void {
    const { canvas, context } = this.target;
    if (this.target.configuredW === width && this.target.configuredH === height && canvas.width === width && canvas.height === height) return;
    canvas.width = width; canvas.height = height;
    context.configure({ device: this.gpu.device, format: this.gpu.format, alphaMode: 'opaque' });
    this.target.configuredW = width; this.target.configuredH = height; this.canvasPx.set(canvas, { w: width, h: height });
  }
}

function clampIndex(value: number): number { return Math.max(0, Math.min(LOD_TILE_PX - 1, value)); }
function distance(view: ViewRect, x: number, y: number): number { return Math.hypot((view.xMin + view.xMax) / 2 - x, (view.yMin + view.yMax) / 2 - y); }
function percentileBin(bins: Uint32Array, target: number): number {
  let sum = 0; for (let i = 0; i < bins.length; i++) { sum += bins[i]; if (sum >= target) return i; } return bins.length - 1;
}
async function assertShader(mod: GPUShaderModule, label: string): Promise<void> {
  const info = await mod.getCompilationInfo(); const bad = info.messages.filter((message) => message.type === 'error');
  if (bad.length) throw new Error(`${label}: ${bad.map((message) => `${message.lineNum}: ${message.message}`).join('; ')}`);
}
