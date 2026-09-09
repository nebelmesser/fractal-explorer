import type { GpuContext } from './device';
import type { MapDefinition, MapParams, ViewRect } from '../maps/types';
import { viewSpanX, viewSpanY } from '../maps/types';
import {
  LOD_CACHE_TILES, LOD_COARSE_GAP, LOD_CPU_GPU_PX, LOD_CPU_MIN_PX,
  LOD_CPU_EXPOSURE_MS, LOD_CPU_INITIAL_RES, LOD_CPU_PARALLEL,
  LOD_CPU_REFINE_FACTOR, LOD_CPU_RINGS,
  LOD_CPU_SLICE_MS, LOD_CPU_SPARSE_MAX_PX, LOD_CPU_SPARSE_START_PX,
  LOD_CPU_STEP, LOD_CPU_TILE_PX, LOD_CPU_VOID_FADE_START_PX,
  LOD_CPU_VOID_MAP_OPACITY,
  LOD_EXPOSURE_HIGH, LOD_EXPOSURE_LOW,
  LOD_EXPOSURE_TAU_MS, LOD_MAX_LEVEL, LOD_MAX_LEVEL_F64, LOD_PREFETCH_PAD, LOD_TILE_PX,
} from '../constants';
import { f32Ulp, f64Ulp } from './precision';
import reduceWgsl from './reduce.wgsl?raw';
import histogramWgsl from './histogram.wgsl?raw';
import tileBlitWgsl from './tile_blit.wgsl?raw';

type Targets = { canvas: HTMLCanvasElement; context: GPUCanvasContext; configuredW: number; configuredH: number };
type Exposure = { lo: number; hi: number };
type Tile = {
  key: string; generation: number; level: number; ix: number; iy: number; view: ViewRect;
  uniform: GPUBuffer; raw: GPUBuffer; minmax: GPUBuffer; counts: Float32Array;
  width: number; height: number; lo: number; hi: number; used: number; cpuRes?: number;
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
  private cpuTail: Promise<void> = Promise.resolve();
  private exposure: Exposure | null = null;
  private exposureTarget: Exposure | null = null;
  private exposureAnchor: Exposure | null = null;
  private exposureAt = performance.now();
  private exposureRaf = 0;
  private exposureQueued = false;
  private lastExposureUpdate = 0;
  private lastExposureSignature = '';
  private awaitingFirstFrame = true;
  private readonly canvasPx = new WeakMap<HTMLCanvasElement, { w: number; h: number }>();
  private readonly drawBuffers: GPUBuffer[] = [];
  private readonly histogramUniforms: GPUBuffer[] = [];
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
  private readonly cpuLevelCap: number;
  private cpuWave = 0;
  private cpuWaveView: ViewRect | null = null;

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
    this.cpuLevelCap = this.preciseCpuLevelCap();
    const device = gpu.device;
    this.exposureBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.histogramBuffer = device.createBuffer({ size: 1024, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.histogramRead = device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }

  static async create(
    gpu: GpuContext,
    canvas: HTMLCanvasElement,
    map: MapDefinition,
  ): Promise<GpuMapRenderer> {
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
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
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
    const progressiveCpu = this.cpuView(request);
    if (progressiveCpu) {
      // The last moving presentation already has this exact camera view. Keep
      // its cached tiles and exposure unchanged when the gesture settles;
      // recomputing the histogram here made the release frame flash before CPU
      // refinement even started. Infinity also keeps the outer synchronous
      // frame-budget controller from invalidating progressive work.
      this.compose(request);
      this.scheduleRefine();
      return Number.POSITIVE_INFINITY;
    }
    const coarse = Math.max(0, request.level - this.levelStep(request));
    await this.enqueue(async () => {
      if (request.generation !== this.generation) return;
      await this.ensureCells(request, [0, coarse], 0);
      await this.updateExposure(request);
      this.compose(request);
      await this.ensureCells(request, [request.level], this.cpuView(request) ? 0 : LOD_PREFETCH_PAD);
      await this.updateExposure(request);
      this.compose(request);
    });
    this.scheduleRefine();
    return performance.now() - t0;
  }

  present(view: ViewRect, params: MapParams, width: number, height: number, invert: boolean, median: number, moving = true): void {
    const request = this.makeRequest(view, params, width, height, invert, median, moving);
    this.compose(request);
    this.scheduleDynamicExposure(request);
    // Long simulation dispatches can starve the compositor on integrated GPUs.
    // Cached LODs move at display rate; refinement resumes on the settled frame.
    if (!moving) this.scheduleRefine();
  }

  prefetch(view: ViewRect, params: MapParams, width: number, height: number): Promise<void> {
    const request = this.makeRequest(view, params, width, height, false, 1, true, false);
    if (this.cpuView(request)) return Promise.resolve();
    const coarse = Math.max(0, request.level - LOD_COARSE_GAP);
    return this.enqueue(async () => {
      if (request.generation === this.generation) {
        // One center-first coarse tile is useful lookahead without occupying the
        // GPU for the duration of a visible gesture.
        await this.ensureCells(request, [0, coarse], LOD_PREFETCH_PAD, 1);
      }
    });
  }

  /** True when this view is filled by the map's f64 CPU kernel. */
  samplesF64(view: ViewRect, width: number, height: number): boolean {
    return this.viewUsesCpu(view, width, height);
  }

  precisionGrid(view: ViewRect, width: number, height: number): {
    spacing: number; spacingPx: number; sampleSpacing: number; sampleSpacingPx: number;
    pixelPx: number; sparse: boolean;
    floor: boolean; voidMix: number; mapOpacity: number;
  } | null {
    if (!this.viewUsesCpu(view, width, height)) return null;
    const spacing = this.tileSpan(this.cpuLevelCap) / Math.max(1, LOD_CPU_TILE_PX - 1);
    const pixelX = spacing / Math.max(Number.MIN_VALUE, viewSpanX(view) / Math.max(width, 1));
    const pixelY = spacing / Math.max(Number.MIN_VALUE, viewSpanY(view) / Math.max(height, 1));
    const cssScaleX = (this.target.canvas.clientWidth || width) / Math.max(width, 1);
    const cssScaleY = (this.target.canvas.clientHeight || height) / Math.max(height, 1);
    const spacingPx = Math.min(pixelX * cssScaleX, pixelY * cssScaleY);
    // Overlay probes must sit on the samples the compositor actually draws.
    // Coarse CPU tiles (16×16) have a 4× wider pitch than the frozen 64-grid.
    const tile = this.tileAt((view.xMin + view.xMax) / 2, (view.yMin + view.yMax) / 2);
    const sampleSpacing = tile
      ? Math.min(
        viewSpanX(tile.view) / Math.max(tile.width - 1, 1),
        viewSpanY(tile.view) / Math.max(tile.height - 1, 1),
      )
      : spacing;
    const samplePixelX = sampleSpacing / Math.max(Number.MIN_VALUE, viewSpanX(view) / Math.max(width, 1));
    const samplePixelY = sampleSpacing / Math.max(Number.MIN_VALUE, viewSpanY(view) / Math.max(height, 1));
    const sampleSpacingPx = Math.min(samplePixelX * cssScaleX, samplePixelY * cssScaleY);
    const atPrecisionFloor = this.levelFor(view, width, height) === this.cpuLevelCap;
    const sparse = atPrecisionFloor && spacingPx > LOD_CPU_SPARSE_START_PX;
    const voidMix = atPrecisionFloor
      ? smoothstep(LOD_CPU_VOID_FADE_START_PX, LOD_CPU_SPARSE_START_PX, spacingPx)
      : 0;
    // The grid separates immediately after 4 px, while the square itself grows
    // only with sqrt(zoom): 4 px at the threshold, 8 px at a 16 px pitch, and
    // no more than 16 px once the samples are far apart.
    const pixelPx = sparse
      ? Math.min(LOD_CPU_SPARSE_MAX_PX, Math.sqrt(LOD_CPU_SPARSE_START_PX * spacingPx))
      : spacingPx;
    return {
      spacing,
      spacingPx,
      sampleSpacing,
      sampleSpacingPx,
      pixelPx,
      sparse,
      floor: atPrecisionFloor,
      voidMix,
      mapOpacity: 1 - (1 - LOD_CPU_VOID_MAP_OPACITY) * voidMix,
    };
  }

  snapWorld(point: { x: number; y: number }): { x: number; y: number } {
    const tile = this.tileAt(point.x, point.y);
    if (!tile) return this.atPrecisionFloor() ? this.snapPrecision(point) : point;
    const cy = this.canonicalY(point.y);
    const ix = clampSample(Math.round(((point.x - tile.view.xMin) / viewSpanX(tile.view)) * (tile.width - 1)), tile.width);
    const iy = clampSample(Math.round(((cy - tile.view.yMin) / viewSpanY(tile.view)) * (tile.height - 1)), tile.height);
    return {
      x: tile.view.xMin + (ix / Math.max(tile.width - 1, 1)) * viewSpanX(tile.view),
      y: point.y + tile.view.yMin + (iy / Math.max(tile.height - 1, 1)) * viewSpanY(tile.view) - cy,
    };
  }

  /** Nearest sample on the deepest distinct f64 grid, independent of loaded tiles. */
  snapPrecision(point: { x: number; y: number }): { x: number; y: number } {
    const span = this.tileSpan(this.cpuLevelCap);
    const samples = Math.max(1, LOD_CPU_TILE_PX - 1);
    const cy = this.canonicalY(point.y);
    const xMin = this.xOrigin() + Math.floor((point.x - this.xOrigin()) / span) * span;
    const yMin = this.yOrigin() + Math.floor((cy - this.yOrigin()) / span) * span;
    const ix = clampSample(Math.round(((point.x - xMin) / span) * samples), LOD_CPU_TILE_PX);
    const iy = clampSample(Math.round(((cy - yMin) / span) * samples), LOD_CPU_TILE_PX);
    return {
      x: xMin + (ix / samples) * span,
      y: point.y + yMin + (iy / samples) * span - cy,
    };
  }

  /**
   * World centers of the sample squares the compositor is drawing.
   * `targetCellPx <= 0` keeps every sample; otherwise the grid is thinned toward that CSS pitch.
   * `maxCount <= 0` disables the safety cap.
   */
  renderedSampleGrid(
    view: ViewRect,
    width: number,
    height: number,
    targetCellPx: number,
    maxCount: number,
  ): { x: number; y: number }[] {
    if (!this.latest) return [];
    const request: PresentRequest = {
      ...this.latest,
      view: { ...view },
      width,
      height,
      level: this.levelFor(view, width, height),
      moving: false,
    };
    const visible = this.visibleTiles(request);
    const finest = visible.filter((draw) => draw.tile.level === request.level);
    const draws = finest.length ? finest : visible;
    const cssW = this.target.canvas.clientWidth || width;
    const cssH = this.target.canvas.clientHeight || height;
    const sx = Math.max(viewSpanX(view), Number.MIN_VALUE);
    const sy = Math.max(viewSpanY(view), Number.MIN_VALUE);
    const cx = (view.xMin + view.xMax) / 2;
    const cy = (view.yMin + view.yMax) / 2;
    const collect = (stride: number): { x: number; y: number }[] => {
      const seen = new Set<string>();
      const out: { x: number; y: number }[] = [];
      const push = (x: number, y: number): void => {
        if (x < view.xMin || x > view.xMax || y < view.yMin || y > view.yMax) return;
        // Number#toString is a round-trippable representation of the exact
        // binary64 value. Fixed significant digits merge adjacent deep-zoom
        // samples whenever the absolute coordinate is much larger than their
        // spacing.
        const key = `${x}\t${y}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ x, y });
      };
      if (!draws.length) {
        const spacing = this.tileSpan(this.cpuLevelCap) / Math.max(1, LOD_CPU_TILE_PX - 1);
        const origin = this.snapPrecision({ x: cx, y: cy });
        const step = stride * spacing;
        const x0 = origin.x - Math.floor((origin.x - view.xMin) / step) * step;
        const y0 = origin.y - Math.floor((origin.y - view.yMin) / step) * step;
        for (let y = y0; y <= view.yMax + step * 1e-9; y += step) {
          for (let x = x0; x <= view.xMax + step * 1e-9; x += step) push(x, y);
        }
        return out;
      }
      for (const { tile, drawView } of draws) {
        const nx = Math.max(1, tile.width - 1);
        const ny = Math.max(1, tile.height - 1);
        const icx = Math.round(((cx - drawView.xMin) / Math.max(viewSpanX(drawView), Number.MIN_VALUE)) * nx);
        const icy = Math.round(((cy - drawView.yMin) / Math.max(viewSpanY(drawView), Number.MIN_VALUE)) * ny);
        const x0 = ((icx % stride) + stride) % stride;
        const y0 = ((icy % stride) + stride) % stride;
        for (let iy = y0; iy < tile.height; iy += stride) {
          for (let ix = x0; ix < tile.width; ix += stride) {
            push(
              drawView.xMin + (ix / nx) * viewSpanX(drawView),
              drawView.yMin + (iy / ny) * viewSpanY(drawView),
            );
          }
        }
      }
      return out;
    };
    let stride = 1;
    if (targetCellPx > 0) {
      if (draws.length) {
        const { tile, drawView } = draws[draws.length - 1];
        const pitchPx = Math.min(
          (viewSpanX(drawView) / Math.max(tile.width - 1, 1)) / (sx / cssW),
          (viewSpanY(drawView) / Math.max(tile.height - 1, 1)) / (sy / cssH),
        );
        stride = Math.max(1, Math.round(targetCellPx / Math.max(pitchPx, 1e-9)));
      } else {
        const spacing = this.tileSpan(this.cpuLevelCap) / Math.max(1, LOD_CPU_TILE_PX - 1);
        const pitchPx = Math.min(spacing / (sx / cssW), spacing / (sy / cssH));
        stride = Math.max(1, Math.round(targetCellPx / Math.max(pitchPx, 1e-9)));
      }
    }
    let points = collect(stride);
    while (maxCount > 0 && points.length > maxCount && stride < 1e6) {
      stride += 1;
      points = collect(stride);
    }
    points.sort((a, b) => a.y - b.y || a.x - b.x);
    return points;
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

  /** CPU tiles must not wait on histogram mapAsync / GPU compute. */
  private enqueueCpu(fn: () => Promise<void>): Promise<void> {
    const run = this.cpuTail.then(fn, fn);
    this.cpuTail = run.catch(() => undefined);
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
    this.tiles.clear();
    // Parameter changes replace map values and exposure as one atomic frame.
    // No tonal interpolation is carried across incompatible simulations.
    this.exposure = null;
    this.exposureTarget = null;
    this.exposureAnchor = null;
    this.awaitingFirstFrame = true;
    this.cpuWave = 0;
    this.cpuWaveView = null;
    this.lastExposureSignature = '';
    void this.gpuTail.then(async () => {
      await this.gpu.device.queue.onSubmittedWorkDone();
      for (const tile of retired) this.destroyTile(tile);
    });
  }

  private baseSpan(): number { return Math.min(viewSpanX(this.map.defaultView), viewSpanY(this.map.defaultView)); }
  private maxLevel(): number { return this.map.cpu ? this.cpuLevelCap : LOD_MAX_LEVEL; }
  private preciseCpuLevelCap(): number {
    if (!this.map.cpu) return LOD_MAX_LEVEL;
    const p = this.map.navigation;
    const coordinateLimit = Math.max(
      Math.abs(this.map.defaultView.xMin), Math.abs(this.map.defaultView.xMax),
      Math.abs(this.map.defaultView.yMin), Math.abs(this.map.defaultView.yMax),
      Math.abs(p?.xCenter?.min ?? 0), Math.abs(p?.xCenter?.max ?? 0),
      Math.abs((p?.yPeriod?.center ?? 0) - (p?.yPeriod?.period ?? 0) / 2),
      Math.abs((p?.yPeriod?.center ?? 0) + (p?.yPeriod?.period ?? 0) / 2),
    );
    // Freeze the deepest tile grid while all 64 sample coordinates are still
    // distinct throughout the navigable domain. Further zoom flies through
    // this fixed grid instead of manufacturing duplicate f64 coordinates.
    const minTileSpan = f64Ulp(coordinateLimit) * 2 * (LOD_CPU_TILE_PX - 1);
    const exact = Math.floor(Math.log2(this.baseSpan() / Math.max(Number.MIN_VALUE, minTileSpan)));
    return Math.max(LOD_MAX_LEVEL, Math.min(LOD_MAX_LEVEL_F64, exact));
  }
  private tileSpan(level: number): number { return this.baseSpan() / (2 ** level); }
  private levelFor(view: ViewRect, width: number, height: number): number {
    const worldPerPixel = Math.max(viewSpanX(view) / width, viewSpanY(view) / height);
    const gpuExact = Math.log2(this.baseSpan() / Math.max(Number.MIN_VALUE, LOD_TILE_PX * worldPerPixel));
    const gpuLevel = Math.max(0, Math.min(LOD_MAX_LEVEL, Math.round(gpuExact)));
    if (!this.viewUsesCpu(view, width, height)) return gpuLevel;
    const cpuExact = Math.log2(this.baseSpan() / Math.max(Number.MIN_VALUE, LOD_CPU_TILE_PX * worldPerPixel));
    return Math.max(0, Math.min(this.maxLevel(), Math.round(cpuExact)));
  }
  private levelStep(request: PresentRequest): number {
    return this.cpuView(request) ? LOD_CPU_STEP : LOD_COARSE_GAP;
  }
  private cpuView(request: PresentRequest): boolean {
    return this.viewUsesCpu(request.view, request.width, request.height);
  }
  private cpuSparse(request: PresentRequest): boolean {
    return this.precisionGrid(request.view, request.width, request.height)?.sparse === true;
  }
  private atPrecisionFloor(): boolean {
    if (!this.latest) return false;
    return this.levelFor(this.latest.view, this.latest.width, this.latest.height) === this.cpuLevelCap;
  }
  /** True when one f32 sample already covers more than `LOD_CPU_GPU_PX` map pixels. */
  private viewUsesCpu(view: ViewRect, width: number, height: number): boolean {
    return this.gpuPixelCoarse(view, width, height);
  }
  private tileUsesCpu(view: ViewRect): boolean {
    return this.gpuPixelCoarse(view, LOD_TILE_PX, LOD_TILE_PX);
  }
  private gpuPixelCoarse(view: ViewRect, width: number, height: number): boolean {
    if (!this.map.cpu) return false;
    const pixel = Math.max(
      viewSpanX(view) / Math.max(width - 1, 1),
      viewSpanY(view) / Math.max(height - 1, 1),
    );
    const ulp = Math.max(f32Ulp(view.xMin), f32Ulp(view.xMax), f32Ulp(view.yMin), f32Ulp(view.yMax));
    return ulp > LOD_CPU_GPU_PX * pixel;
  }
  private cellScreenPx(cell: Cell, request: PresentRequest): number {
    const sx = viewSpanX(request.view) / Math.max(request.width, 1);
    const sy = viewSpanY(request.view) / Math.max(request.height, 1);
    return Math.min(viewSpanX(cell.drawView) / sx, viewSpanY(cell.drawView) / sy);
  }
  private cellOnScreen(cell: Cell, view: ViewRect): boolean {
    return cell.drawView.xMin < view.xMax && cell.drawView.xMax > view.xMin
      && cell.drawView.yMin < view.yMax && cell.drawView.yMax > view.yMin;
  }
  private cpuCellWanted(cell: Cell, request: PresentRequest): boolean {
    return this.cellOnScreen(cell, request.view) && this.cellScreenPx(cell, request) >= LOD_CPU_MIN_PX;
  }
  private cpuParallel(): number {
    return Math.max(1, this.map.cpu?.concurrency ?? LOD_CPU_PARALLEL);
  }
  private cpuWaveMax(): number {
    const stages = Math.ceil(
      Math.log(LOD_CPU_TILE_PX / LOD_CPU_INITIAL_RES) / Math.log(LOD_CPU_REFINE_FACTOR),
    );
    return Math.max(0, stages + LOD_CPU_RINGS - 2);
  }
  private cpuLevels(request: PresentRequest): number[] {
    // The GPU tile underneath is the coarse preview. CPU work belongs only to
    // the current pixel-density level; computing ancestor CPU tiles spends most
    // of its samples outside the live FOV and then covers them immediately.
    return [request.level];
  }
  /** Screen-space distance from the live view center to the cell center. */
  private cpuScreenDist(cell: Cell, request: PresentRequest): number {
    const vx = viewSpanX(request.view); const vy = viewSpanY(request.view);
    const cx = (request.view.xMin + request.view.xMax) / 2;
    const cy = (request.view.yMin + request.view.yMax) / 2;
    const px = ((cell.drawView.xMin + cell.drawView.xMax) / 2 - cx) / Math.max(vx, 1e-30) * request.width;
    const py = ((cell.drawView.yMin + cell.drawView.yMax) / 2 - cy) / Math.max(vy, 1e-30) * request.height;
    return Math.hypot(px, py);
  }
  /** Reset fovea only when the camera actually moved; float jitter must not stall the pool. */
  private syncCpuFovea(request: PresentRequest): void {
    const prev = this.cpuWaveView;
    if (prev) {
      const vx = Math.max(viewSpanX(request.view), 1e-30);
      const vy = Math.max(viewSpanY(request.view), 1e-30);
      const dx = (((request.view.xMin + request.view.xMax) - (prev.xMin + prev.xMax)) / 2) / vx * request.width;
      const dy = (((request.view.yMin + request.view.yMax) - (prev.yMin + prev.yMax)) / 2) / vy * request.height;
      const span = Math.abs(vx - viewSpanX(prev)) / vx;
      if (Math.hypot(dx, dy) < 8 && span < 0.03) return;
    }
    this.cpuWave = 0;
    this.cpuWaveView = { ...request.view };
  }
  private cpuRing(cell: Cell, request: PresentRequest): number {
    const radius = Math.min(request.width, request.height) / 2;
    const t = Math.min(1, this.cpuScreenDist(cell, request) / Math.max(radius, 1));
    return Math.min(LOD_CPU_RINGS - 1, Math.floor(t * LOD_CPU_RINGS));
  }
  private cpuCap(cell: Cell, request: PresentRequest, wave = this.cpuWave): number {
    // Start every tile at the density of the f32 preview. The innermost ring is
    // allowed to reach 64×64 immediately; later waves move that detail outward.
    const steps = Math.max(0, wave - this.cpuRing(cell, request) + 1);
    const maxSteps = Math.ceil(
      Math.log(LOD_CPU_TILE_PX / LOD_CPU_INITIAL_RES) / Math.log(LOD_CPU_REFINE_FACTOR),
    );
    return Math.min(
      LOD_CPU_TILE_PX,
      LOD_CPU_INITIAL_RES * LOD_CPU_REFINE_FACTOR ** Math.min(maxSteps, steps),
    );
  }
  private cpuNeedsWork(cell: Cell, request: PresentRequest): boolean {
    const cap = this.cpuCap(cell, request);
    if (cap <= 0) return false;
    return (this.tiles.get(cell.key)?.cpuRes ?? 0) < cap;
  }
  /** Match the best cached parent density so a new LOD never looks coarser. */
  private cpuInheritedRes(cell: Cell): number {
    const cx = (cell.sourceView.xMin + cell.sourceView.xMax) / 2;
    const cy = (cell.sourceView.yMin + cell.sourceView.yMax) / 2;
    for (let level = cell.level - 1; level >= Math.max(0, cell.level - 8); level--) {
      const span = this.tileSpan(level);
      const ix = Math.floor((cx - this.xOrigin()) / span);
      const iy = Math.floor((cy - this.yOrigin()) / span);
      const parent = this.tiles.get(`${this.generation}:${level}:${ix}:${this.canonicalIy(iy, level)}`);
      if (!parent?.cpuRes) continue;
      const inherited = parent.cpuRes / (2 ** (cell.level - level));
      let resolution = LOD_CPU_INITIAL_RES;
      while (resolution < inherited && resolution < LOD_CPU_TILE_PX) {
        resolution *= LOD_CPU_REFINE_FACTOR;
      }
      return Math.min(LOD_CPU_TILE_PX, resolution);
    }
    return LOD_CPU_INITIAL_RES;
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

  private async ensureCells(request: PresentRequest, levels: number[], pad: number, limit = Number.POSITIVE_INFINITY): Promise<void> {
    const unique = new Map<string, Cell>();
    for (const level of [...new Set(levels)].sort((a, b) => a - b)) {
      for (const cell of this.cells(request.view, level, pad)) {
        if (this.tiles.has(cell.key)) continue;
        if (this.tileUsesCpu(cell.sourceView)) continue;
        unique.set(cell.key, cell);
      }
    }
    const cx = (request.view.xMin + request.view.xMax) / 2; const cy = (request.view.yMin + request.view.yMax) / 2;
    const cells = [...unique.values()]
      .sort((a, b) => a.level - b.level || distance(a.drawView, cx, cy) - distance(b.drawView, cx, cy))
      .slice(0, limit);
    for (let i = 0; i < cells.length; i += 6) {
      if (request.generation !== this.generation) return;
      await this.computeGpu(cells.slice(i, i + 6).filter((cell) => !this.tiles.has(cell.key)), request);
      if (this.latest?.generation === request.generation) {
        if (this.awaitingFirstFrame) continue;
        if (!this.exposure || performance.now() - this.lastExposureUpdate >= 120) {
          await this.updateExposure(this.latest);
        }
        this.compose(this.latest);
      }
    }
    this.evict();
  }

  /** Keep workers busy for a slice, then return so the compositor can paint. */
  private async refineCpu(): Promise<boolean> {
    const t0 = performance.now();
    let any = false;
    while (performance.now() - t0 < LOD_CPU_SLICE_MS) {
      const live = this.latest;
      if (!live || live.moving || live.generation !== this.generation || !this.cpuView(live)) break;
      this.syncCpuFovea(live);
      const parallel = this.cpuParallel();
      let jobs = this.nextCpuJobs(live, parallel);
      while (!jobs.length && this.cpuWave < this.cpuWaveMax() && this.cpuHasFoveaSlack(live)) {
        this.cpuWave += 1;
        jobs = this.nextCpuJobs(live, parallel);
      }
      if (!jobs.length) break;
      await Promise.all(jobs.map((job) => this.computeCpu(job.cell, live, job.nextRes)));
      any = true;
    }
    return any;
  }

  private nextCpuJobs(request: PresentRequest, limit: number): { cell: Cell; nextRes: number }[] {
    const jobs: { cell: Cell; nextRes: number; dist: number }[] = [];
    for (const level of this.cpuLevels(request)) {
      for (const cell of this.cells(request.view, level, 0)) {
        if (!this.tileUsesCpu(cell.sourceView) || !this.cpuCellWanted(cell, request)) continue;
        const cap = this.cpuCap(cell, request);
        const have = this.tiles.get(cell.key)?.cpuRes ?? 0;
        if (cap <= 0 || have >= cap) continue;
        jobs.push({
          cell,
          nextRes: have > 0
            ? Math.min(cap, have * LOD_CPU_REFINE_FACTOR)
            : Math.max(LOD_CPU_INITIAL_RES, this.cpuInheritedRes(cell)),
          dist: this.cpuScreenDist(cell, request),
        });
      }
    }
    jobs.sort((a, b) => a.dist - b.dist);
    return jobs.slice(0, Math.max(1, limit)).map(({ cell, nextRes }) => ({ cell, nextRes }));
  }

  private cpuHasFoveaSlack(request: PresentRequest): boolean {
    for (const level of this.cpuLevels(request)) {
      for (const cell of this.cells(request.view, level, 0)) {
        if (!this.tileUsesCpu(cell.sourceView) || !this.cpuCellWanted(cell, request)) continue;
        if (this.cpuCap(cell, request, this.cpuWave + 1) > this.cpuCap(cell, request)) return true;
      }
    }
    return false;
  }

  private allocTileBuffers(cell: Cell, request: PresentRequest): {
    cell: Cell; uniform: GPUBuffer; raw: GPUBuffer; minmax: GPUBuffer; width: number; height: number;
  };
  private allocTileBuffers(cell: Cell, request: PresentRequest, width: number, height: number): {
    cell: Cell; uniform: GPUBuffer; raw: GPUBuffer; minmax: GPUBuffer; width: number; height: number;
  };
  private allocTileBuffers(cell: Cell, request: PresentRequest, width = LOD_TILE_PX, height = LOD_TILE_PX): {
    cell: Cell; uniform: GPUBuffer; raw: GPUBuffer; minmax: GPUBuffer; width: number; height: number;
  } {
    const { device } = this.gpu;
    const uniform = device.createBuffer({ size: this.map.gpu.uniformBytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const raw = device.createBuffer({
      size: width * height * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const minmax = device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    device.queue.writeBuffer(uniform, 0, this.map.gpu.packUniforms(
      cell.sourceView, width, height, request.params,
      { invert: false, median: 1, normView: cell.sourceView },
    ));
    return { cell, uniform, raw, minmax, width, height };
  }

  private commitTile(
    cell: Cell,
    request: PresentRequest,
    buffers: { uniform: GPUBuffer; raw: GPUBuffer; minmax: GPUBuffer; width: number; height: number },
    counts: Float32Array,
    lo: number,
    hi: number,
    cpuRes?: number,
  ): void {
    if (request.generation !== this.generation) {
      buffers.uniform.destroy(); buffers.raw.destroy(); buffers.minmax.destroy();
      return;
    }
    const previous = this.tiles.get(cell.key);
    this.tiles.set(cell.key, {
      key: cell.key, generation: request.generation, level: cell.level,
      ix: cell.ix, iy: cell.canonicalIy, view: cell.sourceView,
      uniform: buffers.uniform, raw: buffers.raw, minmax: buffers.minmax, counts,
      width: buffers.width, height: buffers.height, lo, hi, used: ++this.useCounter,
      cpuRes,
    });
    if (previous && previous.raw !== buffers.raw) this.destroyTile(previous);
  }

  private async computeGpu(cells: Cell[], request: PresentRequest): Promise<void> {
    const { device } = this.gpu;
    const fresh = cells.map((cell) => {
      const buffers = this.allocTileBuffers(cell, request);
      const read = device.createBuffer({ size: 256 + LOD_TILE_PX * LOD_TILE_PX * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      return { ...buffers, read };
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
      this.commitTile(item.cell, request, item, counts, lo, hi);
    }));
  }

  private async computeCpu(cell: Cell, request: PresentRequest, nextRes: number): Promise<void> {
    const cpu = this.map.cpu;
    if (!cpu) return;
    const live = this.latest;
    if (!live || live.generation !== request.generation) return;
    if (!this.cpuCellWanted(cell, live)) return;
    const existing = this.tiles.get(cell.key);
    if (existing && (existing.cpuRes ?? 0) >= nextRes) return;
    const buffers = this.allocTileBuffers(cell, request, nextRes, nextRes);
    let samples: Float32Array;
    try {
      samples = await cpu.fillTile(
        nextRes <= 1 ? {
          xMin: (cell.sourceView.xMin + cell.sourceView.xMax) / 2,
          xMax: (cell.sourceView.xMin + cell.sourceView.xMax) / 2,
          yMin: (cell.sourceView.yMin + cell.sourceView.yMax) / 2,
          yMax: (cell.sourceView.yMin + cell.sourceView.yMax) / 2,
        } : cell.sourceView,
        nextRes,
        nextRes,
        request.params,
      );
    } catch (error) {
      buffers.uniform.destroy(); buffers.raw.destroy(); buffers.minmax.destroy();
      throw error;
    }
    const latest = this.latest;
    if (!latest || latest.generation !== request.generation || !this.cellOnScreen(cell, latest.view)) {
      buffers.uniform.destroy(); buffers.raw.destroy(); buffers.minmax.destroy();
      return;
    }
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < samples.length; i++) {
      const value = samples[i];
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
    if (!(lo <= hi)) { lo = 0; hi = 1; }
    this.gpu.device.queue.writeBuffer(
      buffers.raw, 0, samples.buffer, samples.byteOffset, samples.byteLength,
    );
    this.commitTile(cell, request, buffers, samples, lo, hi, nextRes);
  }

  private visibleTiles(request: PresentRequest): Array<{ tile: Tile; drawView: ViewRect }> {
    const found = new Map<string, { tile: Tile; drawView: ViewRect }>();
    // In the precision void, gaps must reveal the black/dragon layer rather than
    // a magnified lower-LOD map, so only the frozen f64 grid is composited.
    const firstLevel = this.cpuSparse(request) ? request.level : 0;
    for (let level = firstLevel; level <= request.level; level++) {
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
    // Keep the previous canvas contents until the new parameter generation has
    // both map values and a matching histogram. This makes replacement atomic.
    if (!this.exposure && !this.exposureTarget) return;
    this.configureCanvas(request.width, request.height);
    const draws = this.visibleTiles(request); this.advanceExposure();
    const exposure = this.exposure ?? this.exposureTarget ?? { lo: 0, hi: 1 }; this.lastScale = exposure;
    const exposureData = new ArrayBuffer(32); const f32 = new Float32Array(exposureData); const u32 = new Uint32Array(exposureData);
    f32[0] = exposure.lo; f32[1] = Math.max(exposure.lo + 1e-6, exposure.hi);
    f32[2] = request.invert ? 1 : 0; f32[3] = request.moving ? 1 : 0;
    u32[4] = Math.max(1, Math.min(5, Math.round(request.median)));
    this.gpu.device.queue.writeBuffer(this.exposureBuffer, 0, exposureData);
    while (this.drawBuffers.length < draws.length) {
      this.drawBuffers.push(this.gpu.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    }
    const sx = viewSpanX(request.view); const sy = viewSpanY(request.view);
    const grid = this.precisionGrid(request.view, request.width, request.height);
    const sparse = grid?.sparse === true;
    const sparseW = (grid?.pixelPx ?? LOD_CPU_SPARSE_MAX_PX) * request.width
      / Math.max(this.target.canvas.clientWidth || request.width, 1);
    const sparseH = (grid?.pixelPx ?? LOD_CPU_SPARSE_MAX_PX) * request.height
      / Math.max(this.target.canvas.clientHeight || request.height, 1);
    for (let i = 0; i < draws.length; i++) {
      const draw = draws[i].drawView;
      const tile = draws[i].tile;
      const drawData = new ArrayBuffer(48);
      const drawF32 = new Float32Array(drawData); const drawU32 = new Uint32Array(drawData);
      drawF32[0] = ((draw.xMin - request.view.xMin) / sx) * 2 - 1;
      drawF32[1] = ((draw.xMax - request.view.xMin) / sx) * 2 - 1;
      drawF32[2] = 1 - ((draw.yMin - request.view.yMin) / sy) * 2;
      drawF32[3] = 1 - ((draw.yMax - request.view.yMin) / sy) * 2;
      drawU32[4] = tile.width; drawU32[5] = tile.height;
      const screenW = Math.abs(viewSpanX(draw) / sx * request.width);
      const screenH = Math.abs(viewSpanY(draw) / sy * request.height);
      const sampleW = tile.width > 1 ? screenW / (tile.width - 1) : screenW;
      const sampleH = tile.height > 1 ? screenH / (tile.height - 1) : screenH;
      drawF32[8] = sparse ? Math.min(1, sparseW / Math.max(sampleW, 1e-9)) : 1;
      drawF32[9] = sparse ? Math.min(1, sparseH / Math.max(sampleH, 1e-9)) : 1;
      drawF32[10] = sparse ? 1 : 0;
      drawF32[11] = grid?.mapOpacity ?? 1;
      this.gpu.device.queue.writeBuffer(this.drawBuffers[i], 0, drawData);
    }
    const encoder = this.gpu.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: this.target.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
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
    if (draws.length) {
      this.target.canvas.dataset.ready = '1';
      this.awaitingFirstFrame = false;
    }
    this.lastError = null;
  }

  private async updateExposure(request: PresentRequest): Promise<void> {
    if (request.generation !== this.generation) return;
    const candidates = this.visibleTiles(request);
    if (!candidates.length) return;
    const exposureLevel = Math.max(...candidates.map((item) => item.tile.level));
    const visible = candidates.filter((item) => item.tile.level === exposureLevel);
    const { device } = this.gpu; const encoder = device.createCommandEncoder(); encoder.clearBuffer(this.histogramBuffer);
    while (this.histogramUniforms.length < visible.length) {
      this.histogramUniforms.push(device.createBuffer({
        size: this.map.gpu.uniformBytes,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }));
    }
    for (let i = 0; i < visible.length; i++) {
      const { tile, drawView } = visible[i];
      const clipped = {
        xMin: Math.max(request.view.xMin, drawView.xMin),
        xMax: Math.min(request.view.xMax, drawView.xMax),
        yMin: Math.max(request.view.yMin, drawView.yMin),
        yMax: Math.min(request.view.yMax, drawView.yMax),
      };
      const dy = tile.view.yMin - drawView.yMin;
      const normView = {
        xMin: clipped.xMin, xMax: clipped.xMax,
        yMin: clipped.yMin + dy, yMax: clipped.yMax + dy,
      };
      device.queue.writeBuffer(this.histogramUniforms[i], 0, this.map.gpu.packUniforms(
        tile.view, tile.width, tile.height, request.params,
        { invert: false, median: 1, normView },
      ));
      const pass = encoder.beginComputePass(); pass.setPipeline(this.histogramPipeline);
      pass.setBindGroup(0, this.bind(this.histogramLayout, [
        { binding: 0, resource: { buffer: this.histogramUniforms[i] } }, { binding: 1, resource: { buffer: tile.raw } },
        { binding: 2, resource: { buffer: this.histogramBuffer } },
      ]));
      pass.dispatchWorkgroups(Math.ceil(tile.width * tile.height / 256)); pass.end();
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
    const measured = { lo: lowBin / 256 * maxLog, hi: (highBin + 1) / 256 * maxLog };
    if (measured.hi <= measured.lo) measured.hi = measured.lo + maxLog / 256;
    // Adapt only when the selected region still contains enough of the global
    // tonal range. A uniformly dark region stays dark instead of being expanded
    // into a misleading full-brightness image.
    if (!this.exposureAnchor) this.exposureAnchor = { ...measured };
    const anchor = this.exposureAnchor;
    const span = Math.max(1e-6, anchor.hi - anchor.lo);
    const localTop = (measured.hi - anchor.lo) / span;
    const adapt = smoothstep(0.42, 0.78, localTop) * 0.72;
    this.exposureTarget = {
      lo: anchor.lo + (measured.lo - anchor.lo) * adapt,
      hi: anchor.hi + (measured.hi - anchor.hi) * adapt,
    };
    if (!this.exposure) this.exposure = { ...this.exposureTarget };
    this.exposureAt = performance.now(); this.lastExposureUpdate = this.exposureAt;
    if (this.cpuView(request)) {
      // CPU refinement already composes after each completed worker batch. A
      // 60 fps exposure tween would multiply draw calls while workers are busy.
      this.exposure = { ...this.exposureTarget };
    } else {
      this.scheduleExposureFrames();
    }
  }

  /** Re-estimate exposure while the camera moves, without re-running the map. */
  private scheduleDynamicExposure(request: PresentRequest): void {
    const interval = this.cpuView(request) ? LOD_CPU_EXPOSURE_MS : 120;
    if (this.exposureQueued || performance.now() - this.lastExposureUpdate < interval) return;
    const candidates = this.visibleTiles(request);
    const exposureLevel = candidates.length
      ? Math.max(...candidates.map((item) => item.tile.level))
      : -1;
    const signature = candidates
      .filter((item) => item.tile.level === exposureLevel)
      .map((item) => item.tile.key)
      .sort()
      .join('|') + `@${[
        request.view.xMin, request.view.xMax, request.view.yMin, request.view.yMax,
      ].map((value) => value.toPrecision(5)).join(':')}`;
    if (!signature || signature === this.lastExposureSignature) return;
    this.lastExposureSignature = signature;
    this.exposureQueued = true;
    void this.enqueue(async () => {
      try {
        const latest = this.latest;
        if (latest?.generation === this.generation) {
          await this.updateExposure(latest);
          this.compose(latest);
        }
      } finally {
        this.exposureQueued = false;
      }
    });
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
    const run = async (): Promise<void> => {
      try {
        while (this.latest) {
          const request = this.latest; if (request.generation !== this.generation) break;
          const pad = this.cpuView(request) ? 0 : LOD_PREFETCH_PAD;
          const levels = this.cpuView(request)
            ? [request.level]
            : [0, Math.max(0, request.level - this.levelStep(request)), request.level];
          if (!this.hasMissingWanted(request, levels, pad)) break;
          if (this.cpuView(request)) {
            const progressed = await this.refineCpu();
            if (this.latest?.generation === this.generation) {
              if (!this.exposure || performance.now() - this.lastExposureUpdate >= LOD_CPU_EXPOSURE_MS) {
                await this.updateExposure(this.latest);
              }
              this.compose(this.latest);
              this.evict();
            }
            if (!progressed) break;
            continue;
          }
          await this.ensureCells(request, levels, pad);
          await this.updateExposure(request);
          if (this.latest === request) this.compose(request);
        }
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error); console.error(error);
      } finally {
        this.refining = false;
        const latest = this.latest;
        if (latest && !latest.moving) {
          const pad = this.cpuView(latest) ? 0 : LOD_PREFETCH_PAD;
          if (this.hasMissingWanted(latest, [latest.level], pad)) this.scheduleRefine();
        }
      }
    };
    if (this.latest && this.cpuView(this.latest)) void this.enqueueCpu(run);
    else void this.enqueue(run);
  }

  private hasMissingWanted(request: PresentRequest, levels: number[], pad: number): boolean {
    for (const level of [...new Set(levels)]) {
      for (const cell of this.cells(request.view, level, pad)) {
        if (this.tileUsesCpu(cell.sourceView)) {
          if (this.cpuCellWanted(cell, request) && this.cpuNeedsWork(cell, request)) return true;
          continue;
        }
        if (!this.tiles.has(cell.key)) return true;
      }
    }
    return this.cpuView(request) && this.cpuHasFoveaSlack(request);
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
    const ix = clampSample(Math.round(((x - tile.view.xMin) / viewSpanX(tile.view)) * (tile.width - 1)), tile.width);
    const iy = clampSample(Math.round(((cy - tile.view.yMin) / viewSpanY(tile.view)) * (tile.height - 1)), tile.height);
    const value = tile.counts[iy * tile.width + ix]; return Number.isFinite(value) ? value : null;
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
    context.configure({ device: this.gpu.device, format: this.gpu.format, alphaMode: 'premultiplied' });
    this.target.configuredW = width; this.target.configuredH = height; this.canvasPx.set(canvas, { w: width, h: height });
  }
}

function clampSample(value: number, size: number): number { return Math.max(0, Math.min(size - 1, value)); }
function distance(view: ViewRect, x: number, y: number): number { return Math.hypot((view.xMin + view.xMax) / 2 - x, (view.yMin + view.yMax) / 2 - y); }
function percentileBin(bins: Uint32Array, target: number): number {
  let sum = 0; for (let i = 0; i < bins.length; i++) { sum += bins[i]; if (sum >= target) return i; } return bins.length - 1;
}
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-9, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
async function assertShader(mod: GPUShaderModule, label: string): Promise<void> {
  const info = await mod.getCompilationInfo(); const bad = info.messages.filter((message) => message.type === 'error');
  if (bad.length) throw new Error(`${label}: ${bad.map((message) => `${message.lineNum}: ${message.message}`).join('; ')}`);
}
