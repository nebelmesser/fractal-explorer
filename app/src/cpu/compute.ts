import {
  LOD_CACHE_TILES,
  LOD_CPU_EXPOSURE_FRAME_MS,
  LOD_CPU_INITIAL_RES,
  LOD_CPU_MIN_PX,
  LOD_CPU_SPARSE_MAX_PX,
  LOD_CPU_SPARSE_START_PX,
  LOD_CPU_TILE_PX,
  LOD_CPU_VOID_FADE_START_PX,
  LOD_CPU_VOID_MAP_OPACITY,
  LOD_EXPOSURE_HIGH,
  LOD_EXPOSURE_LOW,
  LOD_EXPOSURE_TAU_MS,
  LOD_MAX_LEVEL,
  LOD_MAX_LEVEL_F64,
} from '../constants';
import { f64Ulp } from '../gpu/precision';
import { mapToneCss, mapToneRgb } from '../mapTone';
import type { MapDefinition, MapParams, ViewRect } from '../maps/types';
import { viewSpanX, viewSpanY } from '../maps/types';

type Exposure = { lo: number; hi: number };
type Cell = {
  key: string;
  level: number;
  ix: number;
  iy: number;
  canonicalIx: number;
  canonicalIy: number;
  sourceView: ViewRect;
  drawView: ViewRect;
};
type Request = {
  view: ViewRect;
  params: MapParams;
  width: number;
  height: number;
  invert: boolean;
  median: number;
  moving: boolean;
  level: number;
  generation: number;
  passive?: boolean;
};
type Tile = {
  key: string;
  generation: number;
  level: number;
  ix: number;
  iy: number;
  view: ViewRect;
  counts: Float32Array;
  width: number;
  height: number;
  used: number;
  toneKey?: string;
  toneCanvas?: HTMLCanvasElement;
  gray?: Uint8Array;
  filterKey?: number;
  filteredLog?: Float32Array;
};
type Draw = { tile: Tile; drawView: ViewRect };

/** Canvas 2D fallback backed entirely by the map's f64 worker kernel. */
export class CpuMapRenderer {
  private readonly tiles = new Map<string, Tile>();
  private readonly inflight = new Map<string, number>();
  private generation = 0;
  private paramsKey = '';
  private useCounter = 0;
  private latest: Request | null = null;
  private refining = false;
  private exposure: Exposure | null = null;
  private exposureTarget: Exposure | null = null;
  private exposureAt = performance.now();
  private exposureTimer = 0;
  private readonly cpuLevelCap: number;
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;

  private constructor(canvas: HTMLCanvasElement, private readonly map: MapDefinition) {
    if (!map.cpu) throw new Error('This map has no CPU kernel');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.canvas = canvas;
    this.context = context;
    this.cpuLevelCap = this.preciseCpuLevelCap();
  }

  static create(canvas: HTMLCanvasElement, map: MapDefinition): CpuMapRenderer {
    return new CpuMapRenderer(canvas, map);
  }

  async render(
    view: ViewRect,
    params: MapParams,
    width: number,
    height: number,
    invert: boolean,
    median: number,
    _normView: ViewRect = view,
  ): Promise<number> {
    const started = performance.now();
    const request = this.makeRequest(view, params, width, height, invert, median, false);
    this.configureCanvas(request.width, request.height);
    this.updateExposure(request);
    this.compose(request);
    const hasCurrentTiles = this.visibleTiles(request).some(({ tile }) => tile.level === request.level);
    if (!this.exposure) {
      // One representative tile over the whole FOV gives us a correct first
      // histogram while the worker pool starts the center-first visible tiles.
      // Start the striped probe first so it occupies the pool briefly, then let
      // the center-first tile batch use all workers with no long probe queued.
      const [measured] = await Promise.all([
        this.measureViewExposure(request),
        hasCurrentTiles ? Promise.resolve(false) : this.computeBatch(request),
      ]);
      if (this.requestIsLive(request)) {
        if (measured) this.setExposure(measured, true);
        this.compose(request);
      }
    } else if (!hasCurrentTiles) {
      await this.computeBatch(request);
      if (this.requestIsLive(request)) {
        this.updateExposure(request);
        this.compose(request);
      }
    }
    this.scheduleRefine();
    return performance.now() - started;
  }

  present(
    view: ViewRect,
    params: MapParams,
    width: number,
    height: number,
    invert: boolean,
    median: number,
    moving = true,
    passive = false,
  ): void {
    const previous = this.latest;
    if (moving && !passive && previous && !previous.moving) {
      this.map.cpu?.cancelPending?.();
    }
    const request = this.makeRequest(view, params, width, height, invert, median, moving, passive, !passive);
    this.configureCanvas(request.width, request.height);
    if (!passive) this.updateExposure(request);
    this.compose(request);
    if (!moving && !passive) this.scheduleRefine();
  }

  /** CPU fallback never spends work outside the live field of view. */
  prefetch(_view: ViewRect, _params: MapParams, _width: number, _height: number): Promise<void> {
    return Promise.resolve();
  }

  samplesF64(_view: ViewRect, _width: number, _height: number): boolean {
    return true;
  }

  precisionGrid(view: ViewRect, width: number, height: number): {
    spacing: number;
    spacingPx: number;
    sampleSpacing: number;
    sampleSpacingPx: number;
    pixelPx: number;
    sparse: boolean;
    floor: boolean;
    voidMix: number;
    mapOpacity: number;
  } {
    const spacing = this.tileSpan(this.cpuLevelCap) / LOD_CPU_TILE_PX;
    const cssScaleX = (this.canvas.clientWidth || width) / Math.max(width, 1);
    const cssScaleY = (this.canvas.clientHeight || height) / Math.max(height, 1);
    const pixelX = spacing / Math.max(Number.MIN_VALUE, viewSpanX(view) / Math.max(width, 1));
    const pixelY = spacing / Math.max(Number.MIN_VALUE, viewSpanY(view) / Math.max(height, 1));
    const spacingPx = Math.min(pixelX * cssScaleX, pixelY * cssScaleY);
    const tile = this.tileAt((view.xMin + view.xMax) / 2, (view.yMin + view.yMax) / 2);
    const sampleSpacing = tile
      ? Math.min(viewSpanX(tile.view) / tile.width, viewSpanY(tile.view) / tile.height)
      : spacing;
    const samplePixelX = sampleSpacing / Math.max(Number.MIN_VALUE, viewSpanX(view) / Math.max(width, 1));
    const samplePixelY = sampleSpacing / Math.max(Number.MIN_VALUE, viewSpanY(view) / Math.max(height, 1));
    const sampleSpacingPx = Math.min(samplePixelX * cssScaleX, samplePixelY * cssScaleY);
    const floor = this.levelFor(view, width, height) === this.cpuLevelCap;
    const sparse = floor && spacingPx > LOD_CPU_SPARSE_START_PX;
    const voidMix = floor
      ? smoothstep(LOD_CPU_VOID_FADE_START_PX, LOD_CPU_SPARSE_START_PX, spacingPx)
      : 0;
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
      floor,
      voidMix,
      mapOpacity: 1 - (1 - LOD_CPU_VOID_MAP_OPACITY) * voidMix,
    };
  }

  snapWorld(point: { x: number; y: number }): { x: number; y: number } {
    const tile = this.tileAt(point.x, point.y);
    if (!tile) return this.atPrecisionFloor() ? this.snapPrecision(point) : point;
    const cx = this.canonicalX(point.x);
    const cy = this.canonicalY(point.y);
    const ix = clampSample(Math.floor(((cx - tile.view.xMin) / viewSpanX(tile.view)) * tile.width), tile.width);
    const iy = clampSample(Math.floor(((cy - tile.view.yMin) / viewSpanY(tile.view)) * tile.height), tile.height);
    return {
      x: point.x + tile.view.xMin + ((ix + 0.5) / tile.width) * viewSpanX(tile.view) - cx,
      y: point.y + tile.view.yMin + ((iy + 0.5) / tile.height) * viewSpanY(tile.view) - cy,
    };
  }

  renderedPixelNeighbors(point: { x: number; y: number }): {
    left: { x: number; y: number };
    right: { x: number; y: number };
  } {
    const snapped = this.snapWorld(point);
    const tile = this.tileAt(point.x, point.y);
    const step = tile
      ? viewSpanX(tile.view) / tile.width
      : this.atPrecisionFloor()
        ? this.tileSpan(this.cpuLevelCap) / LOD_CPU_TILE_PX
        : this.latest
          ? viewSpanX(this.latest.view) / Math.max(1, this.latest.width)
          : this.baseSpan() / LOD_CPU_TILE_PX;
    const epsilon = Math.max(step * 1e-6, Math.max(1, Math.abs(point.x)) * Number.EPSILON * 2);
    if (Math.abs(snapped.x - point.x) <= epsilon) {
      return {
        left: { x: snapped.x - step, y: snapped.y },
        right: { x: snapped.x + step, y: snapped.y },
      };
    }
    return snapped.x < point.x
      ? {
          left: { x: snapped.x, y: snapped.y },
          right: { x: snapped.x + step, y: snapped.y },
        }
      : {
          left: { x: snapped.x - step, y: snapped.y },
          right: { x: snapped.x, y: snapped.y },
        };
  }

  snapPrecision(point: { x: number; y: number }): { x: number; y: number } {
    const span = this.tileSpan(this.cpuLevelCap);
    const cx = this.canonicalX(point.x);
    const cy = this.canonicalY(point.y);
    const xMin = this.xOrigin() + Math.floor((cx - this.xOrigin()) / span) * span;
    const yMin = this.yOrigin() + Math.floor((cy - this.yOrigin()) / span) * span;
    const ix = clampSample(Math.floor(((cx - xMin) / span) * LOD_CPU_TILE_PX), LOD_CPU_TILE_PX);
    const iy = clampSample(Math.floor(((cy - yMin) / span) * LOD_CPU_TILE_PX), LOD_CPU_TILE_PX);
    return {
      x: point.x + xMin + ((ix + 0.5) / LOD_CPU_TILE_PX) * span - cx,
      y: point.y + yMin + ((iy + 0.5) / LOD_CPU_TILE_PX) * span - cy,
    };
  }

  renderedSampleGrid(
    view: ViewRect,
    width: number,
    height: number,
    targetCellPx: number,
    maxCount: number,
  ): { x: number; y: number }[] {
    const request: Request = {
      ...(this.latest ?? {
        params: {}, invert: false, median: 1, generation: this.generation,
      }),
      view: { ...view },
      width,
      height,
      level: this.levelFor(view, width, height),
      moving: false,
    };
    const visible = this.visibleTiles(request);
    const finest = visible.filter(({ tile }) => tile.level === request.level);
    const draws = finest.length ? finest : visible;
    const cssW = this.canvas.clientWidth || width;
    const cssH = this.canvas.clientHeight || height;
    const sx = Math.max(viewSpanX(view), Number.MIN_VALUE);
    const sy = Math.max(viewSpanY(view), Number.MIN_VALUE);
    const cx = (view.xMin + view.xMax) / 2;
    const cy = (view.yMin + view.yMax) / 2;
    const collect = (stride: number): { x: number; y: number }[] => {
      const seen = new Set<string>();
      const out: { x: number; y: number }[] = [];
      const push = (x: number, y: number): void => {
        if (x < view.xMin || x > view.xMax || y < view.yMin || y > view.yMax) return;
        const key = `${x}\t${y}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ x, y });
      };
      if (!draws.length) {
        const spacing = this.tileSpan(this.cpuLevelCap) / LOD_CPU_TILE_PX;
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
        const icx = Math.floor(((cx - drawView.xMin) / Math.max(viewSpanX(drawView), Number.MIN_VALUE)) * tile.width);
        const icy = Math.floor(((cy - drawView.yMin) / Math.max(viewSpanY(drawView), Number.MIN_VALUE)) * tile.height);
        const x0 = ((icx % stride) + stride) % stride;
        const y0 = ((icy % stride) + stride) % stride;
        for (let iy = y0; iy < tile.height; iy += stride) {
          for (let ix = x0; ix < tile.width; ix += stride) {
            push(
              drawView.xMin + ((ix + 0.5) / tile.width) * viewSpanX(drawView),
              drawView.yMin + ((iy + 0.5) / tile.height) * viewSpanY(drawView),
            );
          }
        }
      }
      return out;
    };
    let stride = 1;
    if (targetCellPx > 0) {
      const pitchPx = draws.length
        ? Math.min(
          viewSpanX(draws[draws.length - 1].drawView) / draws[draws.length - 1].tile.width / (sx / cssW),
          viewSpanY(draws[draws.length - 1].drawView) / draws[draws.length - 1].tile.height / (sy / cssH),
        )
        : Math.min(
          this.tileSpan(this.cpuLevelCap) / LOD_CPU_TILE_PX / (sx / cssW),
          this.tileSpan(this.cpuLevelCap) / LOD_CPU_TILE_PX / (sy / cssH),
        );
      stride = Math.max(1, Math.round(targetCellPx / Math.max(pitchPx, 1e-9)));
    }
    let points = collect(stride);
    while (maxCount > 0 && points.length > maxCount && stride < 1e6) {
      stride += 1;
      points = collect(stride);
    }
    points.sort((a, b) => a.y - b.y || a.x - b.x);
    return points;
  }

  setCanvas(canvas: HTMLCanvasElement): void {
    if (canvas === this.canvas) return;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.canvas = canvas;
    this.context = context;
  }

  private makeRequest(
    view: ViewRect,
    params: MapParams,
    width: number,
    height: number,
    invert: boolean,
    median: number,
    moving: boolean,
    passive = false,
    updateLatest = true,
  ): Request {
    this.ensureParams(params);
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const request = {
      view: { ...view }, params: { ...params }, width: w, height: h, invert, median, moving,
      level: this.levelFor(view, w, h), generation: this.generation, passive,
    };
    if (updateLatest) this.latest = request;
    return request;
  }

  private requestIsLive(request: Request): boolean {
    return request.generation === this.generation && this.latest === request;
  }

  private ensureParams(params: MapParams): void {
    const key = Object.keys(params).sort().map((name) => `${name}:${Number(params[name]).toPrecision(9)}`).join('|');
    if (key === this.paramsKey) return;
    this.map.cpu?.cancelPending?.();
    this.paramsKey = key;
    this.generation += 1;
    this.tiles.clear();
    this.exposure = null;
    this.exposureTarget = null;
    if (this.exposureTimer) window.clearTimeout(this.exposureTimer);
    this.exposureTimer = 0;
    this.exposureAt = performance.now();
  }

  private baseSpan(): number {
    return Math.min(viewSpanX(this.map.defaultView), viewSpanY(this.map.defaultView));
  }

  private tileSpan(level: number): number {
    return this.baseSpan() / (2 ** level);
  }

  private preciseCpuLevelCap(): number {
    const p = this.map.navigation;
    const coordinateLimit = Math.max(
      Math.abs(this.map.defaultView.xMin), Math.abs(this.map.defaultView.xMax),
      Math.abs(this.map.defaultView.yMin), Math.abs(this.map.defaultView.yMax),
      Math.abs(p?.xCenter?.min ?? 0), Math.abs(p?.xCenter?.max ?? 0),
      Math.abs((p?.xPeriod?.center ?? 0) - (p?.xPeriod?.period ?? 0) / 2),
      Math.abs((p?.xPeriod?.center ?? 0) + (p?.xPeriod?.period ?? 0) / 2),
      Math.abs((p?.yPeriod?.center ?? 0) - (p?.yPeriod?.period ?? 0) / 2),
      Math.abs((p?.yPeriod?.center ?? 0) + (p?.yPeriod?.period ?? 0) / 2),
    );
    const minTileSpan = f64Ulp(coordinateLimit) * 2 * LOD_CPU_TILE_PX;
    const exact = Math.floor(Math.log2(this.baseSpan() / Math.max(Number.MIN_VALUE, minTileSpan)));
    return Math.max(LOD_MAX_LEVEL, Math.min(LOD_MAX_LEVEL_F64, exact));
  }

  private levelFor(view: ViewRect, width: number, height: number): number {
    const worldPerPixel = Math.max(viewSpanX(view) / width, viewSpanY(view) / height);
    const exact = Math.log2(this.baseSpan() / Math.max(Number.MIN_VALUE, LOD_CPU_TILE_PX * worldPerPixel));
    return Math.max(0, Math.min(this.cpuLevelCap, Math.round(exact)));
  }

  private xOrigin(): number {
    const period = this.map.navigation?.xPeriod;
    return period ? period.center - period.period / 2 : this.map.defaultView.xMin;
  }

  private yOrigin(): number {
    const period = this.map.navigation?.yPeriod;
    return period ? period.center - period.period / 2 : this.map.defaultView.yMin;
  }

  private canonicalY(y: number): number {
    const period = this.map.navigation?.yPeriod;
    if (!period) return y;
    const origin = this.yOrigin();
    return origin + ((y - origin) % period.period + period.period) % period.period;
  }

  private canonicalX(x: number): number {
    const period = this.map.navigation?.xPeriod;
    if (!period) return x;
    const origin = this.xOrigin();
    return origin + ((x - origin) % period.period + period.period) % period.period;
  }

  private canonicalIx(ix: number, level: number): number {
    const period = this.map.navigation?.xPeriod;
    if (!period) return ix;
    const count = Math.max(1, Math.round(period.period / this.tileSpan(level)));
    return ((ix % count) + count) % count;
  }

  private canonicalIy(iy: number, level: number): number {
    const period = this.map.navigation?.yPeriod;
    if (!period) return iy;
    const count = Math.max(1, Math.round(period.period / this.tileSpan(level)));
    return ((iy % count) + count) % count;
  }

  private cells(view: ViewRect, level: number): Cell[] {
    const span = this.tileSpan(level);
    const x0 = Math.floor((view.xMin - this.xOrigin()) / span);
    const x1 = Math.floor((view.xMax - this.xOrigin() - span * 1e-9) / span);
    const y0 = Math.floor((view.yMin - this.yOrigin()) / span);
    const y1 = Math.floor((view.yMax - this.yOrigin() - span * 1e-9) / span);
    const cells: Cell[] = [];
    for (let iy = y0; iy <= y1; iy++) {
      const rawYMin = this.yOrigin() + iy * span;
      const rawYMax = rawYMin + span;
      const canonicalIy = this.canonicalIy(iy, level);
      for (let ix = x0; ix <= x1; ix++) {
        const rawXMin = this.xOrigin() + ix * span;
        const rawXMax = rawXMin + span;
        const canonicalIx = this.canonicalIx(ix, level);
        const sourceView = {
          xMin: this.xOrigin() + canonicalIx * span,
          xMax: this.xOrigin() + (canonicalIx + 1) * span,
          yMin: this.yOrigin() + canonicalIy * span,
          yMax: this.yOrigin() + (canonicalIy + 1) * span,
        };
        cells.push({
          key: `${this.generation}:${level}:${canonicalIx}:${canonicalIy}`,
          level,
          ix,
          iy,
          canonicalIx,
          canonicalIy,
          sourceView,
          drawView: {
            xMin: rawXMin,
            xMax: rawXMax,
            yMin: rawYMin,
            yMax: rawYMax,
          },
        });
      }
    }
    return cells;
  }

  private cellWanted(cell: Cell, request: Request): boolean {
    const sx = viewSpanX(request.view) / Math.max(request.width, 1);
    const sy = viewSpanY(request.view) / Math.max(request.height, 1);
    return cell.drawView.xMin < request.view.xMax && cell.drawView.xMax > request.view.xMin
      && cell.drawView.yMin < request.view.yMax && cell.drawView.yMax > request.view.yMin
      && Math.min(viewSpanX(cell.drawView) / sx, viewSpanY(cell.drawView) / sy) >= LOD_CPU_MIN_PX;
  }

  private keyWanted(cell: Cell, request: Request): boolean {
    return this.cells(request.view, cell.level)
      .some((visible) => visible.key === cell.key && this.cellWanted(visible, request));
  }

  private nextJobs(request: Request): Array<{ cell: Cell; resolution: number }> {
    const cx = (request.view.xMin + request.view.xMax) / 2;
    const cy = (request.view.yMin + request.view.yMax) / 2;
    const unique = new Map<string, Cell>();
    for (const cell of this.cells(request.view, request.level)) {
      if (!this.cellWanted(cell, request)) continue;
      const old = unique.get(cell.key);
      if (!old || distance(cell.drawView, cx, cy) < distance(old.drawView, cx, cy)) {
        unique.set(cell.key, cell);
      }
    }
    const cells = [...unique.values()];
    cells.sort((a, b) => distance(a.drawView, cx, cy) - distance(b.drawView, cx, cy));
    const missing = cells.filter((cell) => !this.tiles.has(cell.key));
    if (missing.length) {
      return missing
        .filter((cell) => !this.inflight.has(cell.key))
        .map((cell) => ({ cell, resolution: this.inheritedResolution(cell) }));
    }
    return cells
      .filter((cell) => this.tiles.get(cell.key)!.width < LOD_CPU_TILE_PX && !this.inflight.has(cell.key))
      .map((cell) => ({ cell, resolution: LOD_CPU_TILE_PX }));
  }

  /** Preserve the visible parent sample density when zoom crosses a CPU LOD. */
  private inheritedResolution(cell: Cell): number {
    const cx = (cell.sourceView.xMin + cell.sourceView.xMax) / 2;
    const cy = (cell.sourceView.yMin + cell.sourceView.yMax) / 2;
    for (let level = cell.level - 1; level >= Math.max(0, cell.level - 8); level--) {
      const span = this.tileSpan(level);
      const ix = Math.floor((cx - this.xOrigin()) / span);
      const iy = Math.floor((cy - this.yOrigin()) / span);
      const parent = this.tiles.get(`${this.generation}:${level}:${this.canonicalIx(ix, level)}:${this.canonicalIy(iy, level)}`);
      if (!parent) continue;
      const inherited = parent.width / (2 ** (cell.level - level));
      let resolution = LOD_CPU_INITIAL_RES;
      while (resolution < inherited && resolution < LOD_CPU_TILE_PX) resolution *= 2;
      return Math.min(LOD_CPU_TILE_PX, resolution);
    }
    return LOD_CPU_INITIAL_RES;
  }

  private async computeBatch(request: Request): Promise<boolean> {
    const cpu = this.map.cpu;
    if (!cpu) return false;
    const limit = Math.max(1, cpu.concurrency ?? 1);
    const jobs = this.nextJobs(request).slice(0, limit);
    if (!jobs.length) return false;
    for (const job of jobs) this.inflight.set(job.cell.key, job.resolution);
    await Promise.all(jobs.map(async ({ cell, resolution }) => {
      try {
        const counts = await cpu.fillTile(cell.sourceView, resolution, resolution, request.params);
        const latest = this.latest;
        if (!latest || latest.generation !== request.generation || !this.keyWanted(cell, latest)) return;
        this.tiles.set(cell.key, {
          key: cell.key,
          generation: request.generation,
          level: cell.level,
          ix: cell.canonicalIx,
          iy: cell.canonicalIy,
          view: cell.sourceView,
          counts,
          width: resolution,
          height: resolution,
          used: ++this.useCounter,
        });
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'AbortError') throw error;
      } finally {
        if (this.inflight.get(cell.key) === resolution) this.inflight.delete(cell.key);
      }
    }));
    return true;
  }

  private scheduleRefine(): void {
    if (this.refining) return;
    this.refining = true;
    void (async () => {
      try {
        while (this.latest && !this.latest.moving) {
          const request = this.latest;
          const progressed = await this.computeBatch(request);
          if (!progressed) break;
          if (this.latest?.generation !== request.generation) continue;
          this.updateExposure(this.latest);
          this.compose(this.latest);
          this.evict();
        }
      } catch (error) {
        console.error('CPU map renderer:', error);
      } finally {
        this.refining = false;
        const latest = this.latest;
        if (latest && !latest.moving && this.nextJobs(latest).length) this.scheduleRefine();
      }
    })();
  }

  private visibleTiles(request: Request): Draw[] {
    const found: Draw[] = [];
    const firstLevel = this.precisionGrid(request.view, request.width, request.height).sparse
      ? request.level
      : 0;
    const lastLevel = request.level;
    for (let level = firstLevel; level <= lastLevel; level++) {
      for (const cell of this.cells(request.view, level)) {
        const tile = this.tiles.get(cell.key);
        if (!tile) continue;
        tile.used = ++this.useCounter;
        found.push({ tile, drawView: cell.drawView });
      }
    }
    found.sort((a, b) => a.tile.level - b.tile.level);
    return found;
  }

  private updateExposure(request: Request): void {
    const draws = this.visibleTiles(request);
    if (!draws.length) return;
    const bins = new Uint32Array(256);
    const maxIterations = Math.max(1, request.params[this.map.workBudget.param] ?? this.map.workBudget.min);
    const maxLog = Math.log1p(maxIterations);
    const sampleW = Math.max(1, Math.min(LOD_CPU_TILE_PX, request.width));
    const sampleH = Math.max(1, Math.min(LOD_CPU_TILE_PX, request.height));
    const spanX = viewSpanX(request.view);
    const spanY = viewSpanY(request.view);
    let total = 0;
    for (let sy = 0; sy < sampleH; sy++) {
      const worldY = request.view.yMin + (sy + 0.5) / sampleH * spanY;
      for (let sx = 0; sx < sampleW; sx++) {
        const worldX = request.view.xMin + (sx + 0.5) / sampleW * spanX;
        const draw = topDrawAt(draws, worldX, worldY);
        if (!draw) continue;
        const ix = clampSample(Math.floor((worldX - draw.drawView.xMin) / viewSpanX(draw.drawView) * draw.tile.width), draw.tile.width);
        const iy = clampSample(Math.floor((worldY - draw.drawView.yMin) / viewSpanY(draw.drawView) * draw.tile.height), draw.tile.height);
        const value = Math.max(0, draw.tile.counts[iy * draw.tile.width + ix]);
        const bin = Math.min(255, Math.floor(Math.log1p(value) / maxLog * 256));
        bins[bin] += 1;
        total += 1;
      }
    }
    if (!total) return;
    this.setExposure(exposureFromBins(bins, total, maxLog), !this.exposure);
  }

  /** Estimate the initial exposure from the whole FOV before showing its center tile. */
  private async measureViewExposure(request: Request): Promise<Exposure | null> {
    const cpu = this.map.cpu;
    if (!cpu || request.generation !== this.generation) return null;
    const size = LOD_CPU_TILE_PX;
    const stripCount = Math.max(1, Math.min(size, cpu.concurrency ?? 1));
    const spanY = viewSpanY(request.view);
    const strips = await Promise.all(Array.from({ length: stripCount }, (_, strip) => {
      const row0 = Math.floor(strip * size / stripCount);
      const row1 = Math.floor((strip + 1) * size / stripCount);
      return cpu.fillTile({
        xMin: request.view.xMin,
        xMax: request.view.xMax,
        yMin: request.view.yMin + row0 / size * spanY,
        yMax: request.view.yMin + row1 / size * spanY,
      }, size, row1 - row0, request.params);
    }));
    if (request.generation !== this.generation || this.latest?.generation !== request.generation) return null;
    const bins = new Uint32Array(256);
    const maxIterations = Math.max(1, request.params[this.map.workBudget.param] ?? this.map.workBudget.min);
    const maxLog = Math.log1p(maxIterations);
    let total = 0;
    for (const counts of strips) {
      total += counts.length;
      for (const count of counts) {
        const bin = Math.min(255, Math.floor(Math.log1p(Math.max(0, count)) / maxLog * 256));
        bins[bin] += 1;
      }
    }
    return exposureFromBins(bins, total, maxLog);
  }

  private setExposure(measured: Exposure, immediate = false): void {
    this.advanceExposure();
    this.exposureTarget = { ...measured };
    if (immediate || !this.exposure) {
      this.exposure = { ...this.exposureTarget };
      this.exposureAt = performance.now();
      return;
    }
    this.scheduleExposureFrames();
  }

  private advanceExposure(): void {
    if (!this.exposureTarget) return;
    if (!this.exposure) {
      this.exposure = { ...this.exposureTarget };
      this.exposureAt = performance.now();
      return;
    }
    const now = performance.now();
    const alpha = 1 - Math.exp(-(now - this.exposureAt) / LOD_EXPOSURE_TAU_MS);
    this.exposure.lo += (this.exposureTarget.lo - this.exposure.lo) * alpha;
    this.exposure.hi += (this.exposureTarget.hi - this.exposure.hi) * alpha;
    this.exposureAt = now;
  }

  private scheduleExposureFrames(): void {
    if (this.exposureTimer) return;
    this.exposureTimer = window.setTimeout(() => {
      this.exposureTimer = 0;
      const request = this.latest;
      if (!request || !this.exposure || !this.exposureTarget) return;
      if (request.moving) {
        this.scheduleExposureFrames();
        return;
      }
      this.compose(request);
      const delta = Math.max(
        Math.abs(this.exposure.lo - this.exposureTarget.lo),
        Math.abs(this.exposure.hi - this.exposureTarget.hi),
      );
      if (delta < 1e-3) {
        this.exposure = { ...this.exposureTarget };
        this.compose(request);
      } else {
        this.scheduleExposureFrames();
      }
    }, LOD_CPU_EXPOSURE_FRAME_MS);
  }

  private toneTile(tile: Tile, request: Request): Tile {
    const exposure = this.exposure;
    if (!exposure) return tile;
    const median = Math.max(1, Math.min(5, Math.round(request.median)));
    const toneKey = `${exposure.lo}:${exposure.hi}:${request.invert ? 1 : 0}:${median}`;
    if (tile.toneKey === toneKey && tile.toneCanvas && tile.gray) return tile;
    const canvas = tile.toneCanvas ?? document.createElement('canvas');
    if (canvas.width !== tile.width || canvas.height !== tile.height) {
      canvas.width = tile.width;
      canvas.height = tile.height;
    }
    const context = canvas.getContext('2d');
    if (!context) return tile;
    const image = context.createImageData(tile.width, tile.height);
    const gray = new Uint8Array(tile.width * tile.height);
    if (tile.filterKey !== median || !tile.filteredLog) {
      const filtered = new Float32Array(tile.width * tile.height);
      if (median <= 1) {
        for (let i = 0; i < filtered.length; i++) filtered[i] = Math.log1p(tile.counts[i]);
      } else {
        const samples: number[] = [];
        const radius = Math.floor(median / 2);
        for (let y = 0; y < tile.height; y++) {
          for (let x = 0; x < tile.width; x++) {
            samples.length = 0;
            for (let dy = -radius; dy <= radius; dy++) {
              const sy = clampSample(y + dy, tile.height);
              for (let dx = -radius; dx <= radius; dx++) {
                const sx = clampSample(x + dx, tile.width);
                samples.push(Math.log1p(tile.counts[sy * tile.width + sx]));
              }
            }
            samples.sort((a, b) => a - b);
            filtered[y * tile.width + x] = samples[Math.floor(samples.length / 2)];
          }
        }
      }
      tile.filterKey = median;
      tile.filteredLog = filtered;
      tile.toneKey = undefined;
    }
    for (let y = 0; y < tile.height; y++) {
      for (let x = 0; x < tile.width; x++) {
        const index = y * tile.width + x;
        const value = tile.filteredLog[index];
        let mapped = (value - exposure.lo) / Math.max(1e-9, exposure.hi - exposure.lo);
        mapped = Math.max(0, Math.min(1, mapped));
        if (request.invert) mapped = 1 - mapped;
        const shade = Math.round(mapped * 255);
        gray[index] = shade;
        const [r, g, b] = mapToneRgb(mapped);
        image.data[index * 4] = Math.round(r * 255);
        image.data[index * 4 + 1] = Math.round(g * 255);
        image.data[index * 4 + 2] = Math.round(b * 255);
        image.data[index * 4 + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    tile.toneKey = toneKey;
    tile.toneCanvas = canvas;
    tile.gray = gray;
    return tile;
  }

  private compose(request: Request): void {
    if (request.generation !== this.generation || !this.exposure) return;
    if (!request.passive && this.latest !== request) return;
    this.advanceExposure();
    const draws = this.visibleTiles(request);
    const context = this.context;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, request.width, request.height);
    context.imageSmoothingEnabled = false;
    const sx = viewSpanX(request.view);
    const sy = viewSpanY(request.view);
    const grid = this.precisionGrid(request.view, request.width, request.height);
    if (grid.sparse) {
      const paths: Array<Path2D | undefined> = new Array(256);
      const squareW = grid.pixelPx * request.width / Math.max(this.canvas.clientWidth || request.width, 1);
      const squareH = grid.pixelPx * request.height / Math.max(this.canvas.clientHeight || request.height, 1);
      for (const { tile: rawTile, drawView } of draws) {
        const tile = this.toneTile(rawTile, request);
        if (!tile.gray) continue;
        for (let y = 0; y < tile.height; y++) {
          const worldY = drawView.yMin + ((y + 0.5) / tile.height) * viewSpanY(drawView);
          const py = (worldY - request.view.yMin) / sy * request.height;
          for (let x = 0; x < tile.width; x++) {
            const worldX = drawView.xMin + ((x + 0.5) / tile.width) * viewSpanX(drawView);
            const px = (worldX - request.view.xMin) / sx * request.width;
            const shade = tile.gray[y * tile.width + x];
            const path = paths[shade] ?? new Path2D();
            path.rect(px - squareW / 2, py - squareH / 2, squareW, squareH);
            paths[shade] = path;
          }
        }
      }
      context.globalAlpha = grid.mapOpacity;
      for (let shade = 0; shade < paths.length; shade++) {
        const path = paths[shade];
        if (!path) continue;
        context.fillStyle = mapToneCss(shade / 255);
        context.fill(path);
      }
    } else {
      context.globalAlpha = grid.mapOpacity;
      for (const { tile: rawTile, drawView } of draws) {
        const tile = this.toneTile(rawTile, request);
        if (!tile.toneCanvas) continue;
        const left = (drawView.xMin - request.view.xMin) / sx * request.width;
        const top = (drawView.yMin - request.view.yMin) / sy * request.height;
        const width = viewSpanX(drawView) / sx * request.width;
        const height = viewSpanY(drawView) / sy * request.height;
        context.drawImage(tile.toneCanvas, left, top, width, height);
      }
    }
    context.restore();
    if (draws.length) this.canvas.dataset.ready = '1';
  }

  private configureCanvas(width: number, height: number): void {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.context = context;
  }

  private tileAt(x: number, y: number): Tile | null {
    if (!this.latest) return null;
    for (let level = this.latest.level; level >= 0; level--) {
      const span = this.tileSpan(level);
      const ix = Math.floor((this.canonicalX(x) - this.xOrigin()) / span);
      const iy = Math.floor((this.canonicalY(y) - this.yOrigin()) / span);
      const tile = this.tiles.get(`${this.generation}:${level}:${this.canonicalIx(ix, level)}:${this.canonicalIy(iy, level)}`);
      if (tile) return tile;
    }
    return null;
  }

  private atPrecisionFloor(): boolean {
    return Boolean(this.latest && this.latest.level === this.cpuLevelCap);
  }

  private evict(): void {
    if (this.tiles.size <= LOD_CACHE_TILES) return;
    const latest = this.latest;
    const candidates = [...this.tiles.values()]
      .filter((tile) => tile.level !== 0 && (!latest || !this.keyWanted({
        key: tile.key,
        level: tile.level,
        ix: tile.ix,
        iy: tile.iy,
        canonicalIx: tile.ix,
        canonicalIy: tile.iy,
        sourceView: tile.view,
        drawView: tile.view,
      }, latest)))
      .sort((a, b) => a.used - b.used);
    while (this.tiles.size > LOD_CACHE_TILES && candidates.length) {
      this.tiles.delete(candidates.shift()!.key);
    }
  }
}

function clampSample(value: number, size: number): number {
  return Math.max(0, Math.min(size - 1, value));
}

function distance(view: ViewRect, x: number, y: number): number {
  return Math.hypot((view.xMin + view.xMax) / 2 - x, (view.yMin + view.yMax) / 2 - y);
}

function topDrawAt(draws: Draw[], x: number, y: number): Draw | null {
  for (let i = draws.length - 1; i >= 0; i--) {
    const draw = draws[i];
    if (x >= draw.drawView.xMin && x < draw.drawView.xMax
      && y >= draw.drawView.yMin && y < draw.drawView.yMax) return draw;
  }
  return null;
}

function percentileBin(bins: Uint32Array, target: number): number {
  let sum = 0;
  for (let i = 0; i < bins.length; i++) {
    sum += bins[i];
    if (sum >= target) return i;
  }
  return bins.length - 1;
}

function exposureFromBins(bins: Uint32Array, total: number, maxLog: number): Exposure {
  const lowBin = percentileBin(bins, total * LOD_EXPOSURE_LOW);
  const highBin = percentileBin(bins, total * LOD_EXPOSURE_HIGH);
  const low = lowBin / 256 * maxLog;
  const hi = (highBin + 1) / 256 * maxLog;
  return {
    lo: low,
    hi: Math.max(hi, low + maxLog / 256),
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-9, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
