import { PRECISE_TILE_CACHE_BYTES, PRECISE_COMPOSE_MS, PRECISE_EXPOSURE_GRID, LOD_CPU_GPU_PX, LOD_EXPOSURE_LOW, LOD_EXPOSURE_HIGH, MEDIAN_MAX, MIN_VIEW_SPAN_F64, PRECISE_TILE_PX } from '../constants';
import type { GpuContext } from '../gpu/device';
import { f32Ulp, f64Ulp } from '../gpu/precision';
import { copyView, viewSpanX, viewSpanY, viewsEqual, type MapDefinition, type MapParams, type PrecisionSession, type ViewRect } from '../maps/types';
import { approximateView, coordinateToNumber, exactCenter } from './coordinates';
import { precisionCells, precisionTileQueue, type PrecisionCell } from './precision-tiles';
import { fixedCompositorExposure, type MapCompositor } from './compositor';

type Frame = { id: string; view: ViewRect; width: number; height: number; key: string; backend: 'gpu' | 'cpu'; samples: Float32Array; image?: HTMLCanvasElement; tone?: string };
type Display = { view: ViewRect; width: number; height: number; key: string; invert: boolean; median: number; cells: PrecisionCell[] };
type Job = { abort: AbortController; view: ViewRect; key: string; prefetch: boolean; done?: Promise<void> };
const keyFor = (params: MapParams): string => JSON.stringify(params);
const aborted = (): DOMException => new DOMException('Render superseded', 'AbortError');

/** Exact-origin tile cache. Map-owned sessions supply the numerical method. */
export class PrecisionRenderer {
  private frames = new Map<string, Frame>();
  private nextCompose = 0;
  private display: Display | null = null;
  private job: Job | null = null;
  private normalPipeline?: GPUComputePipeline;
  private deepPipeline?: GPUComputePipeline;
  private constructor(private gpu: GpuContext | null, private canvas: HTMLCanvasElement, private map: MapDefinition, private compositor: MapCompositor) {}

  static async create(gpu: GpuContext | null, canvas: HTMLCanvasElement, map: MapDefinition, compositor: MapCompositor): Promise<PrecisionRenderer> {
    const renderer = new PrecisionRenderer(gpu, canvas, map, compositor);
    if (gpu) {
      try {
        renderer.normalPipeline = await gpu.device.createComputePipelineAsync({ layout: 'auto', compute: { module: gpu.device.createShaderModule({ code: map.gpu.computeWgsl }), entryPoint: map.gpu.entryPoint } });
        renderer.deepPipeline = await gpu.device.createComputePipelineAsync({ layout: 'auto', compute: { module: gpu.device.createShaderModule({ code: map.precision!.gpu.computeWgsl }), entryPoint: map.precision!.gpu.entryPoint } });
      } catch (error) {
        console.warn('Precision compute unavailable; using CPU workers.', error);
        renderer.gpu = null;
      }
    }
    return renderer;
  }
  get usesGpu(): boolean { return this.gpu !== null; }
  setCanvas(canvas: HTMLCanvasElement): void { this.canvas = canvas; }
  invalidateParams(_params: MapParams): void { this.cancel(); }
  private cancel(): void {
    this.job?.abort.abort();
    this.job = null;
    this.map.cpu.cancelPending?.();
  }

  async render(view: ViewRect, params: MapParams, width: number, height: number, invert: boolean, median: number, _normView = view): Promise<number> {
    const start = performance.now();
    this.present(view, params, width, height, invert, median, false);
    const key = keyFor(params);
    if (this.complete(precisionCells(view, width, height), key)) return 0;
    this.cancel();
    const job: Job = { abort: new AbortController(), view: copyView(view), key, prefetch: false };
    this.job = job;
    job.done = this.compute(job, { ...params }, width, height);
    try { await job.done; }
    catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) throw error; }
    finally { if (this.job === job) this.job = null; job.abort.abort(); }
    return performance.now() - start;
  }

  present(view: ViewRect, params: MapParams, width: number, height: number, invert: boolean, median: number, moving = true, _passive = false): void {
    this.display = { view: copyView(view), key: keyFor(params), width, height, invert, median, cells: precisionCells(view, width, height) };
    if (moving && this.job && !this.job.prefetch && !viewsEqual(this.job.view, view, 0)) this.cancel();
    this.compose();
  }

  async prefetch(view: ViewRect, params: MapParams, width: number, height: number): Promise<void> {
    const key = keyFor(params);
    if (this.job) {
      if (this.job.key === key && viewsEqual(this.job.view, view, 0)) {
        try { await this.job.done; } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) throw error; }
        return;
      }
      this.cancel();
    }
    if (this.complete(precisionCells(view, width, height), key)) return;
    const job: Job = { abort: new AbortController(), view: copyView(view), key, prefetch: true };
    this.job = job;
    job.done = this.compute(job, { ...params }, width, height);
    try { await job.done; }
    catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) console.warn('Coverage prefetch failed', error); }
    finally { if (this.job === job) this.job = null; job.abort.abort(); }
  }

  private async compute(job: Job, params: MapParams, width: number, height: number): Promise<void> {
    const signal = job.abort.signal;
    const cells = precisionCells(job.view, width, height);
    const deep = Math.min(viewSpanX(job.view), viewSpanY(job.view)) < this.map.precision!.threshold
      && cells.some(cell => this.coordinatesTooCoarse(cell.view, PRECISE_TILE_PX, PRECISE_TILE_PX, f64Ulp));
    const session = deep ? await this.map.precision!.begin(job.view, params, signal) : null;
    if (signal.aborted) throw aborted();
    let storage: GPUBuffer | undefined;
    if (this.gpu && session?.gpu) {
      storage = this.gpu.device.createBuffer({ size: session.gpu.storage.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.gpu.device.queue.writeBuffer(storage, 0, session.gpu.storage as Float32Array<ArrayBuffer>);
    }
    const wanted = new Set(cells.map(cell => this.tileKey(job.key, cell.id)));
    const started = performance.now();
    try {
      for (const { cell, size } of precisionTileQueue(cells, id => this.resolution(job.key, id))) {
        if (signal.aborted) throw aborted();
        const backend = this.gpu && (session?.gpu || (!session && !this.coordinatesTooCoarse(cell.view, size, size, f32Ulp))) ? 'gpu' : 'cpu';
        const data = await this.computeTile(cell.view, size, params, session, signal, backend, storage);
        if (signal.aborted) throw aborted();
        const id = this.tileKey(job.key, cell.id);
        // A completed tile survives cancelled gestures and is reused by the next view.
        this.frames.delete(id);
        this.frames.set(id, { id: cell.id, view: cell.view, width: size, height: size, samples: data, key: job.key, backend });
        this.evict(wanted);
        if (performance.now() >= this.nextCompose) {
          this.compose();
          this.nextCompose = performance.now() + PRECISE_COMPOSE_MS;
        }
      }
      this.compose();
      this.canvas.dataset.frameMs = String(Math.round(performance.now() - started));
    } finally { storage?.destroy(); }
  }

  private tileKey(key: string, id: string): string { return `${key}/${id}`; }
  private resolution(key: string, id: string): number { return this.frames.get(this.tileKey(key, id))?.width ?? 0; }
  private complete(cells: PrecisionCell[], key: string): boolean {
    return cells.every(cell => this.resolution(key, cell.id) >= PRECISE_TILE_PX);
  }

  private evict(wanted: Set<string>): void {
    let bytes = 0;
    for (const frame of this.frames.values()) bytes += frame.width * frame.height * 8;
    // Never evict the live FOV or the landing currently being prepared. The byte
    // budget limits history; a large active viewport can temporarily exceed it.
    const visible = new Set(this.display?.cells.map(cell => this.tileKey(this.display!.key, cell.id)));
    for (const [id, frame] of this.frames) {
      if (bytes <= PRECISE_TILE_CACHE_BYTES) break;
      if (wanted.has(id) || visible.has(id)) continue;
      this.frames.delete(id);
      bytes -= frame.width * frame.height * 8;
    }
  }

  private coordinatesTooCoarse(view: ViewRect, width: number, height: number, ulp: (value: number) => number): boolean {
    const absolute = approximateView(view);
    const error = Math.max(ulp(absolute.xMin), ulp(absolute.xMax), ulp(absolute.yMin), ulp(absolute.yMax));
    const pitch = Math.max(viewSpanX(view) / width, viewSpanY(view) / height);
    return error > (this.map.cpu.handoffPx ?? LOD_CPU_GPU_PX) * pitch;
  }

  private async computeTile(tile: ViewRect, size: number, params: MapParams, session: PrecisionSession | null, signal: AbortSignal, backend: 'gpu' | 'cpu', storage?: GPUBuffer): Promise<Float32Array> {
    if (backend === 'cpu') {
      return session ? session.fillTile(tile, size, size, signal) : this.map.cpu.fillTile(approximateView(tile), size, size, params);
    }
    let data = await this.gpuTile(tile, size, size, params, session, storage);
    let refined = session;
    while (refined?.refineTile && refined.needsRefinement?.(data)) {
      if (signal.aborted) throw aborted();
      const next = await refined.refineTile(data, tile, size, size, signal);
      if (!next?.gpu) break;
      const buffer = this.gpu!.device.createBuffer({ size: next.gpu.storage.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      try {
        this.gpu!.device.queue.writeBuffer(buffer, 0, next.gpu.storage as Float32Array<ArrayBuffer>);
        const corrected = await this.gpuTile(tile, size, size, params, next, buffer);
        data = refined.mergeRefinement?.(data, corrected) ?? corrected;
      } finally { buffer.destroy(); }
      refined = next;
    }
    if (refined?.repairTile) data = await refined.repairTile(data, tile, size, size, signal);
    return data;
  }

  private async gpuTile(view: ViewRect, width: number, height: number, params: MapParams, session: PrecisionSession | null, storage?: GPUBuffer): Promise<Float32Array> {
    const device = this.gpu!.device;
    const pipeline = session ? this.deepPipeline! : this.normalPipeline!;
    const packed = session ? session.gpu!.packUniforms(view, width, height) : this.map.gpu.packUniforms(approximateView(view), width, height, params, {});
    const uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const output = device.createBuffer({ size: width * height * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const read = device.createBuffer({ size: width * height * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    try {
      device.queue.writeBuffer(uniform, 0, packed);
      const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: output } }];
      if (storage) entries.push({ binding: 2, resource: { buffer: storage } });
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8)); pass.end();
      encoder.copyBufferToBuffer(output, 0, read, 0, width * height * 4);
      device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      return new Float32Array(read.getMappedRange().slice(0));
    } finally { read.destroy(); output.destroy(); uniform.destroy(); }
  }

  private compose(): void {
    const d = this.display;
    if (!d) return;
    // Old generations fill gaps while new tiles arrive; current samples always
    // draw last. Within a generation the finest cached density wins.
    const frames = [...this.frames.values()].sort((a, b) => Number(a.key === d.key) - Number(b.key === d.key)
      || Math.log(viewSpanX(b.view) / b.width) - Math.log(viewSpanX(a.view) / a.width));
    const pixelated = Math.min(viewSpanX(d.view), viewSpanY(d.view)) < MIN_VIEW_SPAN_F64;
    this.canvas.dataset.sampling = pixelated ? 'pixelated' : 'smooth';
    const target = exactCenter(d.view);
    const draws = frames.map(frame => {
      const origin = exactCenter(frame.view);
      const sx = viewSpanX(d.view), sy = viewSpanY(d.view);
      const dx = coordinateToNumber(origin.x - target.x) / sx;
      const dy = coordinateToNumber(origin.y - target.y) / sy;
      const w = viewSpanX(frame.view) / sx * d.width, h = viewSpanY(frame.view) / sy * d.height;
      const x = (0.5 + dx) * d.width - w / 2, y = (0.5 + dy) * d.height - h / 2;
      return { frame, x, y, w, h };
    }).filter(({ x, y, w, h }) => Number.isFinite(x + y + w + h) && w >= 1 && h >= 1 && x < d.width && y < d.height && x + w > 0 && y + h > 0);
    const complete = d.cells.filter(cell => this.resolution(d.key, cell.id) >= PRECISE_TILE_PX).length;
    this.canvas.dataset.complete = complete === d.cells.length ? '1' : '0';
    this.canvas.dataset.tilesComplete = String(complete);
    this.canvas.dataset.tilesTotal = String(d.cells.length);
    this.canvas.dataset.queuedTiles = String(d.cells.length - complete);
    this.canvas.dataset.refinement = 'center-out';
    // A camera jump can have no usable cached coverage. Retain the previous
    // complete canvas until the first new coverage arrives.
    if (!draws.length) return;
    const context = this.canvas.getContext('2d', { alpha: false });
    if (!context) return;
    if (this.canvas.width !== d.width) this.canvas.width = d.width;
    if (this.canvas.height !== d.height) this.canvas.height = d.height;
    context.fillStyle = 'black'; context.fillRect(0, 0, d.width, d.height);
    context.imageSmoothingEnabled = !pixelated;
    context.imageSmoothingQuality = 'high';
    const exposure = this.visibleExposure(d, draws.map(draw => draw.frame));
    for (const { frame, x, y, w, h } of draws) {
      const tone = `${d.invert}:${d.median}:${exposure.lo}:${exposure.hi}`;
      if (!frame.image || frame.tone !== tone) {
        frame.image = document.createElement('canvas'); frame.image.width = frame.width; frame.image.height = frame.height;
        const image = new ImageData(frame.width, frame.height);
        for (let i = 0; i < frame.samples.length; i++) {
          let sample = frame.samples[i];
          const radius = Math.min(Math.floor(MEDIAN_MAX / 2), Math.max(0, Math.floor(d.median / 2)));
          if (radius) {
            const neighbors: number[] = [], px = i % frame.width, py = Math.floor(i / frame.width);
            for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
              const x = Math.max(0, Math.min(frame.width - 1, px + ox)), y = Math.max(0, Math.min(frame.height - 1, py + oy));
              neighbors.push(frame.samples[y * frame.width + x]);
            }
            neighbors.sort((a, b) => a - b); sample = neighbors[Math.floor(neighbors.length / 2)];
          }
          const rgb = this.compositor.colorize(sample, Math.max(0, Math.min(1, (Math.log1p(Math.max(0, sample)) - exposure.lo) / (exposure.hi - exposure.lo))), d.invert, exposure);
          image.data[i * 4] = Math.round(rgb[0] * 255); image.data[i * 4 + 1] = Math.round(rgb[1] * 255); image.data[i * 4 + 2] = Math.round(rgb[2] * 255); image.data[i * 4 + 3] = 255;
        }
        frame.image.getContext('2d')!.putImageData(image, 0, 0); frame.tone = tone;
      }
      // Crop before drawing to avoid huge destination rectangles at extreme zoom.
      const left = Math.max(0, x), top = Math.max(0, y), right = Math.min(d.width, x + w), bottom = Math.min(d.height, y + h);
      this.canvas.dataset.ready = '1';
      this.canvas.dataset.sampleWidth = String(frame.width);
      this.canvas.dataset.sampleHeight = String(frame.height);
      this.canvas.dataset.sampleSpan = String(Math.min(viewSpanX(frame.view), viewSpanY(frame.view)));
      this.canvas.dataset.backend = frame.backend;
      // Shared integer edges prevent Canvas antialiasing each adjacent tile
      // against the black background and leaving a visible seam between them.
      const x0 = Math.round(left), y0 = Math.round(top), x1 = Math.round(right), y1 = Math.round(bottom);
      context.drawImage(frame.image, (left - x) / w * frame.width, (top - y) / h * frame.height, (right - left) / w * frame.width, (bottom - top) / h * frame.height, x0, y0, x1 - x0, y1 - y0);
    }
  }

  private visibleExposure(display: Display, frames: Frame[]): { lo: number; hi: number } {
    const fixed = fixedCompositorExposure(this.compositor);
    if (fixed) return fixed;
    const samples: number[] = [], center = exactCenter(display.view);
    const candidates = frames.map(frame => {
      const origin = exactCenter(frame.view);
      return { frame, dx: coordinateToNumber(center.x - origin.x), dy: coordinateToNumber(center.y - origin.y) };
    }).reverse();
    for (let y = 0; y < PRECISE_EXPOSURE_GRID; y++) for (let x = 0; x < PRECISE_EXPOSURE_GRID; x++) {
      const px = ((x + 0.5) / PRECISE_EXPOSURE_GRID - 0.5) * viewSpanX(display.view);
      const py = ((y + 0.5) / PRECISE_EXPOSURE_GRID - 0.5) * viewSpanY(display.view);
      for (const { frame, dx, dy } of candidates) {
        const ix = Math.floor(((px + dx) / viewSpanX(frame.view) + 0.5) * frame.width);
        const iy = Math.floor(((py + dy) / viewSpanY(frame.view) + 0.5) * frame.height);
        if (ix < 0 || ix >= frame.width || iy < 0 || iy >= frame.height) continue;
        const value = Math.log1p(Math.max(0, frame.samples[iy * frame.width + ix]));
        if (Number.isFinite(value)) samples.push(value);
        break;
      }
    }
    samples.sort((a, b) => a - b);
    const lo = samples[Math.floor((samples.length - 1) * LOD_EXPOSURE_LOW)] ?? 0;
    const hi = samples[Math.floor((samples.length - 1) * LOD_EXPOSURE_HIGH)] ?? 1;
    return { lo, hi: Math.max(lo + 1e-6, hi) };
  }

  samplesF64(view: ViewRect, width: number, height: number): boolean { return !this.gpu || this.coordinatesTooCoarse(view, width, height, f32Ulp); }
  precisionGrid(_view: ViewRect, _width: number, _height: number): null { return null; }
  snapWorld<T extends { x: number; y: number }>(point: T): T { return point; }
  snapPrecision<T extends { x: number; y: number }>(point: T): T { return point; }
  renderedPixelNeighbors(point: { x: number; y: number }): { left: typeof point; right: typeof point } {
    const pitch = this.display ? viewSpanX(this.display.view) / this.display.width : 0;
    return { left: { x: point.x - pitch, y: point.y }, right: { x: point.x + pitch, y: point.y } };
  }
  renderedSampleGrid(_view: ViewRect, _width: number, _height: number, _targetCellPx: number, _maxCount: number): Array<{ x: number; y: number }> { return []; }
}
