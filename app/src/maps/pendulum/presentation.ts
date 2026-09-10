import type { MapParams, ViewRect } from '../types';
import type {
  MapPresentation,
  MapPresentationFactory,
  PresentationHost,
} from '../../viewer/presentation';
import { bindMenu, syncBudgetReadout, type MenuBinding } from '../../viewer/menu';
import { viewsEqual, copyView, viewCenter, viewSpanX, viewSpanY } from '../types';
import { drawMapAxes } from './axes';
import {
  bindProbeHud,
  buildProbeSteps,
  chromeRects,
  currentProbeStep,
  defaultProbeHud,
  emptyProbeSteps,
  gridLayout,
  originHitsChrome,
  overlayPxPerLen,
  overlaySightScale,
  probeOrigins as layoutOrigins,
  probePxPerLen,
  probeSpacing,
} from './probes';
import {
  drawOverlayFly,
  drawOverlayPendulum,
  drawOverlayPendulumField,
  flyOnOverlay,
  startFly,
  stepFly,
  type FlyState,
} from './preview';
import { bindSegmentPads } from './pads';
import { PendulumLesson } from './lesson';
import { createRestPose, createTrajectory, initMapCore, type Trajectory } from './trajectory';
import {
  PROBE_ALPHA,
  PROBE_CROSS_PX,
  PROBE_FLY_TIME,
  PROBE_MAX_STEPS,
  PROBE_PIVOT_R,
  PROBE_PLAY_FPS,
  PROBE_PX_PER_LEN,
  PROBE_SIGHT_ALPHA,
  PROBE_SNAP_DEG,
  SPARSE_GRID_CELL_PX,
  START_GRID_CELL_PX,
  START_REVEAL_FAST_ITEM_MS,
  START_REVEAL_FAST_RAD,
  START_REVEAL_FAST_ROW_MS,
  START_REVEAL_PAUSE_MS,
  START_REVEAL_ROW_RAD,
  START_REVEAL_SLOW_ITEM_MS,
  START_REVEAL_SLOW_RAD,
  START_REVEAL_SLOW_ROW_MS,
  PENDULUM_HANG_MS,
  PROBE_GRID_MAX,
  PROBE_KERNEL_CHUNK,
  DRAGON_FONT_START_PX,
  DRAGON_OPACITY,
  DRAGON_PARALLAX,
  DRAGON_SCALE_PER_OCTAVE,
  DRAGON_SCALE_START_PX,
  DRAGON_TILE_X_PX,
  DRAGON_TILE_Y_PX,
} from './constants';

function requireElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Double-pendulum presentation is missing #${id}`);
  return element as unknown as T;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeDragonStamp(): SVGGElement {
  const stamp = document.createElementNS(SVG_NS, 'g');
  const top = document.createElementNS(SVG_NS, 'text');
  top.textContent = 'HIC SUNT';
  top.setAttribute('y', '-0.55em');
  const bottom = document.createElementNS(SVG_NS, 'text');
  bottom.textContent = 'DRACONES';
  bottom.setAttribute('y', '0.7em');
  stamp.append(top, bottom);
  return stamp;
}

function mountPendulumPresentation(host: PresentationHost): MapPresentation {
  const axes = requireElement<HTMLCanvasElement>('map-axes');
  const overlay = requireElement<HTMLCanvasElement>('probe-overlay');
  const mapVoid = requireElement<SVGSVGElement>('map-void');
  const dragonLayerEl = mapVoid.querySelector('.map-void-labels');
  if (!(dragonLayerEl instanceof SVGGElement)) throw new Error('Double-pendulum presentation is missing dragon labels');
  const dragonLayer = dragonLayerEl;
  const xScale = requireElement<HTMLElement>('map-scale-x');
  const yScale = requireElement<HTMLElement>('map-scale-y');
  const params = host.params;
  const dragonStamps: SVGGElement[] = [];
  let dragonAnchor: { x: number; y: number; spanX: number; spanY: number } | null = null;
  const probeHud = defaultProbeHud();
  const singleHud = new URLSearchParams(window.location.search).get('single') === '1';
  let probes: Trajectory[] | null = null;
  let flies: (FlyState | 'gone' | null)[] = [];
  let playing = false;
  let probeView: ViewRect | null = null;
  let pinToMap = false;
  let pixelGrid = false;
  let pinnedWorlds: { x: number; y: number }[] | null = null;
  let pinnedOrigins: { x: number; y: number }[] | null = null;
  let pinPxPerLen = PROBE_PX_PER_LEN;
  let kernelFrom = 0;
  let originView: ViewRect | null = null;
  let originBoxW = 0;
  let originBoxH = 0;
  let hangWatchAt = 0;
  let hangEmitted = false;
  let playAcc = 0;
  let playLast = 0;
  let drawFrame = 0;
  let intro = false;
  let revealCount = 0;
  let revealNextAt = 0;
  let revealPauseUntil = 0;
  let revealStep = START_REVEAL_SLOW_ITEM_MS;
  let revealStride = 1;
  let gridCols = 1;
  let hudUi: ReturnType<typeof bindProbeHud> | null = null;
  let pads: ReturnType<typeof bindSegmentPads> | null = null;
  let menuUi: MenuBinding | null = null;
  const RAD2DEG = 180 / Math.PI;
  let lastZoomDeg: number | null = null;
  let simOrigin = 0;
  let lastSimSec = 0;
  let simCount = 0;
  let paramsDirty = false;

  if (host.signals) {
    const emit = host.signals.emit;
    host.signals.emit = (name) => {
      if (name === 'param-change') paramsDirty = true;
      else if (name === 'params-reset') {
        paramsDirty = false;
        pads?.sync();
      } else if (name === 'menu-open') {
        pads?.sync();
      }
      emit(name);
    };
  }

  function shortSpanDeg(): number {
    const view = host.getView();
    return Math.min(viewSpanX(view), viewSpanY(view)) * RAD2DEG;
  }

  function syncZoomDeg(): void {
    const next = shortSpanDeg();
    if (!Number.isFinite(next)) return;
    if (lastZoomDeg !== null && next === lastZoomDeg) return;
    lastZoomDeg = next;
    host.signals?.set('zoom_deg', next);
  }

  function markSimRunning(now: number): void {
    if (!simOrigin) {
      simOrigin = now;
      lastSimSec = 0;
    }
    host.signals?.set('simulation_running', true);
  }

  function emitSimSecs(now: number): void {
    if (!playing || !simOrigin) return;
    const sec = Math.max(0, Math.floor((now - simOrigin) / 1000));
    if (sec <= lastSimSec) return;
    const until = Math.min(sec, lastSimSec + 120);
    for (let n = lastSimSec + 1; n <= until; n++) {
      host.signals?.set('simulation_sec', n);
    }
    lastSimSec = until;
  }

  type PresentationFrame = {
    origins: { x: number; y: number }[];
    worlds: { x: number; y: number }[];
  };

  function worldToOverlay(world: { x: number; y: number }, box: DOMRectReadOnly): { x: number; y: number } {
    const view = host.getView();
    const map = host.clip.querySelector('canvas.map-view.is-front');
    const layer = map instanceof HTMLCanvasElement ? map.getBoundingClientRect() : box;
    const sx = viewSpanX(view);
    const sy = viewSpanY(view);
    return {
      x: (sx > 0 ? ((world.x - view.xMin) / sx) * layer.width : 0) + (layer.left - box.left),
      y: (sy > 0 ? ((world.y - view.yMin) / sy) * layer.height : 0) + (layer.top - box.top),
    };
  }

  function origins(box = host.clip.getBoundingClientRect()): { x: number; y: number }[] {
    const mode = currentProbeStep(probeHud).mode;
    const points = layoutOrigins(box.width, box.height, mode, probeSpacing(probeHud));
    if (mode === 'grid') return points;
    const blocked = chromeRects(host.clip);
    const hitR = PROBE_CROSS_PX * overlaySightScale(mode) + 6;
    return points.filter((origin) => !originHitsChrome(origin, blocked, hitR));
  }

  function overlayOrigins(box: DOMRectReadOnly): { x: number; y: number }[] {
    if (!pinnedWorlds) return [];
    const view = host.getView();
    if (
      pinnedOrigins
      && originView
      && viewsEqual(view, originView)
      && originBoxW === box.width
      && originBoxH === box.height
      && pinnedOrigins.length === pinnedWorlds.length
    ) {
      return pinnedOrigins;
    }
    pinnedOrigins = pinnedWorlds.map((world) => worldToOverlay(world, box));
    originView = copyView(view);
    originBoxW = box.width;
    originBoxH = box.height;
    return pinnedOrigins;
  }

  function sampleFrame(): PresentationFrame {
    const box = host.clip.getBoundingClientRect();
    if (pinToMap && pinnedWorlds) {
      return {
        origins: overlayOrigins(box),
        worlds: pinnedWorlds,
      };
    }
    if (!singleHud) return { origins: [], worlds: [] };
    const nextOrigins = origins(box);
    const nextWorlds = nextOrigins.map((origin) => snapProbeWorld(
      host.clientToWorld(box.left + origin.x, box.top + origin.y),
    ));
    if (probes && (
      (probeView && !viewsEqual(host.getView(), probeView))
      || probes.length !== nextWorlds.length
    )) resetMapSimulation();
    return { origins: nextOrigins, worlds: nextWorlds };
  }

  function overlayPrecise(): boolean {
    return host.samplesF64?.() === true;
  }

  function snapProbeWorld(point: { x: number; y: number }): { x: number; y: number } {
    return host.snapToRenderedPixel(point);
  }

  function armPrecisionGrid(box: DOMRectReadOnly): boolean {
    const grid = host.precisionGrid?.();
    if (!grid || !(grid.floor || grid.sparse || grid.voidMix > 0)) return false;
    const sparseGrid = grid.sparse || grid.voidMix > 0;
    const worlds = host.renderedSampleGrid?.(
      sparseGrid ? SPARSE_GRID_CELL_PX : START_GRID_CELL_PX,
      sparseGrid ? 0 : PROBE_GRID_MAX,
    ) ?? [];
    if (!worlds.length) return false;
    resetMapSimulation();
    pinToMap = true;
    pixelGrid = sparseGrid;
    const xs = new Set(worlds.map((point) => point.x.toPrecision(12)));
    gridCols = Math.max(1, xs.size);
    const view = host.getView();
    const pitch = grid.sampleSpacing > 0 ? grid.sampleSpacing : grid.spacing;
    const pitchPx = grid.sampleSpacingPx > 0 ? grid.sampleSpacingPx : grid.spacingPx;
    const cellPx = sparseGrid
      ? START_GRID_CELL_PX
      : Math.min(
        (Math.max(1, Math.round(START_GRID_CELL_PX / Math.max(pitchPx, 1e-9))) * pitch
          / Math.max(viewSpanX(view), Number.MIN_VALUE)) * box.width,
        (Math.max(1, Math.round(START_GRID_CELL_PX / Math.max(pitchPx, 1e-9))) * pitch
          / Math.max(viewSpanY(view), Number.MIN_VALUE)) * box.height,
      );
    pinPxPerLen = probePxPerLen(cellPx, params);
    pinnedWorlds = worlds;
    pinnedOrigins = null;
    originView = null;
    probes = pinnedWorlds.map((point) => createRestPose(point.x, point.y));
    flies = pinnedWorlds.map(() => null);
    kernelFrom = 0;
    playing = false;
    playAcc = 0;
    hangWatchAt = 0;
    hangEmitted = false;
    hudUi?.syncPlay(false);
    return true;
  }

  function resetMapSimulation(): void {
    probes = null;
    flies = [];
    playing = false;
    intro = false;
    revealCount = 0;
    revealNextAt = 0;
    revealPauseUntil = 0;
    revealStride = 1;
    gridCols = 1;
    hudUi?.syncPlay(false);
    hudUi?.syncDrop(false);
    probeView = null;
    pinToMap = false;
    pixelGrid = false;
    pinnedWorlds = null;
    pinnedOrigins = null;
    originView = null;
    kernelFrom = 0;
    hangWatchAt = 0;
    hangEmitted = false;
    playAcc = 0;
    simOrigin = 0;
    lastSimSec = 0;
    host.signals?.set('simulation_sec', 0);
    host.signals?.set('simulation_running', false);
  }

  function placeOverlayProbes(): boolean {
    resetMapSimulation();
    const next = sampleFrame().worlds;
    if (!next.length) return false;
    probes = next.map((point) => createTrajectory(point.x, point.y, overlayPrecise()));
    flies = next.map(() => null);
    probeView = copyView(host.getView());
    playAcc = 0;
    hangWatchAt = 0;
    hangEmitted = false;
    return true;
  }

  function armSingle(): void {
    if (!placeOverlayProbes()) return;
    playing = false;
    hudUi?.syncPlay(false);
  }

  function armPinnedGrid(): void {
    const box = host.clip.getBoundingClientRect();
    if (armPrecisionGrid(box)) return;
    const layout = gridLayout(box.width, box.height, START_GRID_CELL_PX);
    const points = layoutOrigins(box.width, box.height, 'grid', START_GRID_CELL_PX);
    if (!points.length) return;
    resetMapSimulation();
    pinToMap = true;
    pixelGrid = false;
    gridCols = layout.cols;
    pinPxPerLen = probePxPerLen(Math.min(layout.cellW, layout.cellH), params);
    pinnedWorlds = points.map((origin) => snapProbeWorld(
      host.clientToWorld(box.left + origin.x, box.top + origin.y),
    ));
    pinnedOrigins = null;
    originView = null;
    probes = pinnedWorlds.map((point) => createRestPose(point.x, point.y));
    flies = pinnedWorlds.map(() => null);
    kernelFrom = 0;
    playing = false;
    playAcc = 0;
    hangWatchAt = 0;
    hangEmitted = false;
    hudUi?.syncPlay(false);
  }

  function mix(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  function unitFromDelta(dTheta: number, lo: number, hi: number): number {
    const x = Math.log(Math.max(dTheta, lo));
    const a = Math.log(lo);
    const b = Math.log(hi);
    if (!(b > a)) return 1;
    return Math.min(1, Math.max(0, (x - a) / (b - a)));
  }

  function neighborAngleDelta(): number {
    if (pinnedWorlds && pinnedWorlds.length >= 2) {
      const a = pinnedWorlds[0];
      const b = pinnedWorlds[1];
      return Math.max(1e-9, Math.hypot(b.x - a.x, b.y - a.y));
    }
    const view = host.getView();
    const cols = Math.max(1, gridCols);
    const rows = Math.max(1, probes ? Math.ceil(probes.length / cols) : 1);
    return Math.max(1e-9, Math.hypot(viewSpanX(view) / cols, viewSpanY(view) / rows));
  }

  function revealPlan(dTheta: number, cols: number): { stepMs: number; stride: number } {
    const strideCols = Math.max(1, cols);
    if (dTheta <= START_REVEAL_ROW_RAD) {
      const t = unitFromDelta(dTheta, START_REVEAL_FAST_RAD, START_REVEAL_ROW_RAD);
      return {
        stride: strideCols,
        stepMs: mix(START_REVEAL_FAST_ROW_MS, START_REVEAL_SLOW_ROW_MS, t),
      };
    }
    const t = unitFromDelta(dTheta, START_REVEAL_ROW_RAD, START_REVEAL_SLOW_RAD);
    return {
      stride: 1,
      stepMs: mix(START_REVEAL_FAST_ITEM_MS, START_REVEAL_SLOW_ITEM_MS, t),
    };
  }

  function startIntro(): void {
    if (!probes) return;
    intro = true;
    playing = false;
    kernelFrom = 0;
    playAcc = 0;
    hangWatchAt = 0;
    hangEmitted = false;
    hudUi?.syncPlay(false);
    if (pixelGrid) {
      revealStep = 0;
      revealStride = probes.length;
      revealCount = probes.length;
      revealNextAt = 0;
      revealPauseUntil = 0;
      syncDrop();
      return;
    }
    const plan = revealPlan(neighborAngleDelta(), gridCols);
    revealStep = plan.stepMs;
    revealStride = plan.stride;
    revealCount = Math.min(probes.length, revealStride);
    revealNextAt = 0;
    revealPauseUntil = 0;
    syncDrop();
  }

  function shownCount(): number {
    if (!probes) return 0;
    return Math.min(probes.length, revealCount);
  }

  function hangingCount(): number {
    if (!probes) return 0;
    const n = shownCount();
    let count = 0;
    for (let i = 0; i < n; i++) if (!flies[i]) count += 1;
    return count;
  }

  function syncDrop(): void {
    hudUi?.syncDrop(hangingCount() > 0);
  }

  function dropAll(): void {
    if (!probes) return;
    const shown = shownCount();
    let any = false;
    for (let i = 0; i < probes.length; i++) {
      if (i >= shown) {
        flies[i] = 'gone';
        continue;
      }
      if (flies[i]) continue;
      const trajectory = probes[i];
      flies[i] = startFly(
        trajectory.th1,
        trajectory.th2,
        trajectory.w1,
        trajectory.w2,
        params.L1,
        params.L2,
      );
      any = true;
    }
    intro = false;
    revealCount = probes.length;
    if (any) host.signals?.emit('probe-detach');
    playing = true;
    markSimRunning(performance.now());
    playAcc = 0;
    playLast = 0;
    hangWatchAt = 0;
    hudUi?.syncPlay(true);
    syncDrop();
    draw();
  }

  function bindKernelChunk(count: number): void {
    if (!probes || !pinnedWorlds) return;
    const precise = overlayPrecise();
    const end = Math.min(probes.length, kernelFrom + Math.max(0, count));
    for (let i = kernelFrom; i < end; i++) {
      probes[i] = createTrajectory(pinnedWorlds[i].x, pinnedWorlds[i].y, precise);
    }
    kernelFrom = end;
  }

  function beginPhysics(now: number): void {
    if (!probes) return;
    bindKernelChunk(probes.length);
    intro = false;
    revealCount = probes.length;
    playing = true;
    markSimRunning(now);
    playAcc = 0;
    playLast = now;
    hangWatchAt = 0;
    hangEmitted = false;
    hudUi?.syncPlay(true);
    syncDrop();
  }

  function stepReveal(now: number): boolean {
    if (!intro || !probes) return false;
    if (pixelGrid) {
      if (kernelFrom < probes.length) bindKernelChunk(PROBE_KERNEL_CHUNK);
      if (!revealPauseUntil) revealPauseUntil = now + START_REVEAL_PAUSE_MS;
      if (kernelFrom < probes.length || now < revealPauseUntil) return false;
      beginPhysics(now);
      return true;
    }
    if (revealCount < probes.length) {
      if (!revealNextAt) {
        revealNextAt = now + revealStep;
        return false;
      }
      if (now < revealNextAt) return false;
      while (revealCount < probes.length && now >= revealNextAt) {
        revealCount = Math.min(probes.length, revealCount + revealStride);
        if (revealCount >= probes.length) {
          revealPauseUntil = now + START_REVEAL_PAUSE_MS;
          break;
        }
        revealNextAt += revealStep;
      }
      syncDrop();
      return true;
    }
    if (kernelFrom < probes.length) bindKernelChunk(PROBE_KERNEL_CHUNK);
    if (!revealPauseUntil) {
      revealPauseUntil = now + START_REVEAL_PAUSE_MS;
      return false;
    }
    if (now < revealPauseUntil || kernelFrom < probes.length) return false;
    beginPhysics(now);
    return true;
  }

  function watchHang(now: number, detached: boolean): void {
    if (hangEmitted || !probes || probes.length === 0) return;
    if (hangingCount() * 2 < probes.length) {
      if (!hangWatchAt || detached) hangWatchAt = now;
      if (now - hangWatchAt >= PENDULUM_HANG_MS) {
        hangEmitted = true;
        host.signals?.emit('pendulum-hang');
      }
    } else {
      hangWatchAt = 0;
    }
  }

  function noteActivity(): void {
    if (lesson.active) lesson.syncWithView();
  }

  function drawPendulums(frame: PresentationFrame): void {
    const { origins: nextOrigins, worlds: nextWorlds } = frame;
    const width = overlay.clientWidth;
    const height = overlay.clientHeight;
    if (width < 8 || height < 8) return;
    const mode = pinToMap ? 'grid' : currentProbeStep(probeHud).mode;
    const large = mode === 'one' || mode === 'two';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (overlay.width !== pixelWidth || overlay.height !== pixelHeight) {
      overlay.width = pixelWidth;
      overlay.height = pixelHeight;
    }
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const style = {
      large,
      pxPerLen: pinToMap
        ? pinPxPerLen
        : overlayPxPerLen(mode, width, height, probeSpacing(probeHud), params),
      alpha: large ? PROBE_ALPHA : 1,
    };
    const last = probes ? shownCount() : nextOrigins.length;
    if (pinToMap && !large && pixelGrid && last > 0) {
      const hangingTh1: number[] = [];
      const hangingTh2: number[] = [];
      const hangingOrigins: { x: number; y: number }[] = [];
      for (let i = 0; i < last; i++) {
        if (flies[i]) continue;
        hangingOrigins.push(nextOrigins[i]);
        hangingTh1.push(probes ? probes[i].th1 : nextWorlds[i].x);
        hangingTh2.push(probes ? probes[i].th2 : nextWorlds[i].y);
      }
      drawOverlayPendulumField(
        ctx,
        hangingOrigins,
        hangingTh1,
        hangingTh2,
        params,
        style,
        hangingOrigins.length,
        width,
        height,
      );
      for (let i = 0; i < last; i++) {
        const fly = flies[i];
        if (!fly || fly === 'gone') continue;
        drawOverlayFly(ctx, nextOrigins[i], fly, params, style);
      }
      return;
    }
    const crossHalf = PROBE_CROSS_PX * overlaySightScale(mode);
    const drawPad = 160;
    for (let i = 0; i < last; i++) {
      const origin = nextOrigins[i];
      if (
        pinToMap
        && (origin.x < -drawPad || origin.y < -drawPad || origin.x > width + drawPad || origin.y > height + drawPad)
      ) continue;
      const fly = flies[i];
      if (fly === 'gone') continue;
      const sight = {
        x: origin.x,
        y: origin.y,
        alpha: PROBE_SIGHT_ALPHA,
        crossHalf,
        pivotR: PROBE_PIVOT_R,
      };
      if (fly) {
        drawOverlayFly(ctx, origin, fly, params, style);
      } else {
        const th1 = probes ? probes[i].th1 : nextWorlds[i].x;
        const th2 = probes ? probes[i].th2 : nextWorlds[i].y;
        drawOverlayPendulum(ctx, origin, th1, th2, params, style, sight);
      }
    }
  }

  function syncVoid(): void {
    const grid = host.precisionGrid?.();
    const visible = (grid?.voidMix ?? 0) > 0;
    mapVoid.style.opacity = visible ? '1' : '0';
    if (!visible) {
      dragonAnchor = null;
      for (const stamp of dragonStamps) stamp.setAttribute('visibility', 'hidden');
      return;
    }
    const box = host.clip.getBoundingClientRect();
    const width = Math.max(1, box.width);
    const height = Math.max(1, box.height);
    const view = host.getView();
    const center = {
      x: (view.xMin + view.xMax) / 2,
      y: (view.yMin + view.yMax) / 2,
    };
    if (!dragonAnchor) {
      dragonAnchor = {
        ...center,
        spanX: viewSpanX(view),
        spanY: viewSpanY(view),
      };
    }
    // The foreground squares stop growing at 16 px, but their pitch keeps
    // increasing. Drive the distant plane from that uncapped pitch so its
    // perspective never freezes, using slow logarithmic growth to keep it far.
    const dragonPitch = Math.max(DRAGON_SCALE_START_PX, grid?.spacingPx ?? DRAGON_SCALE_START_PX);
    const dragonScale = 1
      + Math.log2(dragonPitch / DRAGON_SCALE_START_PX) * DRAGON_SCALE_PER_OCTAVE;
    let dy = dragonAnchor.y - center.y;
    const period = host.navigation.yPeriod?.period;
    if (period && period > 0) dy -= period * Math.round(dy / period);
    const offsetX = ((dragonAnchor.x - center.x) / Math.max(dragonAnchor.spanX, Number.MIN_VALUE))
      * width * dragonScale * DRAGON_PARALLAX;
    const offsetY = (dy / Math.max(dragonAnchor.spanY, Number.MIN_VALUE))
      * height * dragonScale * DRAGON_PARALLAX;
    const tileX = DRAGON_TILE_X_PX * dragonScale;
    const tileY = DRAGON_TILE_Y_PX * dragonScale;
    // Keep an actual label origin anchored in map space instead of accumulating
    // or wrapping a screen-space phase. Integer row/column indices therefore
    // retain their identity while panning and while the pattern scales.
    const originX = width / 2 + offsetX;
    const originY = height / 2 + offsetY;
    mapVoid.setAttribute('viewBox', `0 0 ${width} ${height}`);
    dragonLayer.removeAttribute('transform');
    const fontPx = DRAGON_FONT_START_PX * dragonScale;
    let n = 0;
    const row0 = Math.floor(-originY / tileY) - 1;
    const row1 = Math.ceil((height - originY) / tileY) + 1;
    for (let row = row0; row <= row1; row++) {
      const y = originY + row * tileY;
      const stagger = (row & 1) * tileX * 0.5;
      const col0 = Math.floor((-originX - stagger) / tileX) - 1;
      const col1 = Math.ceil((width - originX - stagger) / tileX) + 1;
      for (let col = col0; col <= col1; col++) {
        const x = originX + col * tileX + stagger;
        let stamp = dragonStamps[n];
        if (!stamp) {
          stamp = makeDragonStamp();
          dragonStamps.push(stamp);
          dragonLayer.appendChild(stamp);
        }
        stamp.setAttribute('transform', `translate(${x} ${y}) rotate(-24)`);
        stamp.setAttribute('font-size', String(fontPx));
        stamp.setAttribute('opacity', String(DRAGON_OPACITY * (grid?.voidMix ?? 0)));
        stamp.setAttribute('visibility', 'visible');
        n += 1;
      }
    }
    for (let i = n; i < dragonStamps.length; i++) {
      dragonStamps[i].setAttribute('visibility', 'hidden');
    }
  }

  function drawNow(): void {
    drawFrame = 0;
    syncVoid();
    if (lesson.active) {
      lesson.syncWithView();
      drawMapAxes(axes, host.getView(), xScale, yScale, host.navigation, { points: [] });
      lesson.draw();
      return;
    }
    const frame = sampleFrame();
    const { origins: nextOrigins, worlds: nextWorlds } = frame;
    const last = probes ? shownCount() : nextOrigins.length;
    drawMapAxes(axes, host.getView(), xScale, yScale, host.navigation, {
      points: pixelGrid
        ? []
        : nextOrigins.slice(0, last).flatMap((origin, i) => (
          flies[i] === 'gone'
            ? []
            : [{
              x: origin.x,
              y: origin.y,
              xRad: nextWorlds[i].x,
              yRad: nextWorlds[i].y,
            }]
        )),
      probesOnly: pinToMap || (!singleHud && currentProbeStep(probeHud).mode === 'grid'),
    });
    drawPendulums(frame);
  }

  /** Pointer events may arrive faster than the display refresh rate. Coalesce all
   * presentation work so axis DOM and pendulum canvases render at most once per frame. */
  function draw(): void {
    syncZoomDeg();
    if (drawFrame) return;
    drawFrame = requestAnimationFrame(drawNow);
  }

  function flyStillHere(
    fly: FlyState,
    origin: { x: number; y: number } | undefined,
    scale: number,
    width: number,
    height: number,
  ): boolean {
    if (pinToMap) return Math.hypot(fly.x2, fly.y2) < 80;
    if (!origin) return false;
    return flyOnOverlay(fly, origin, scale, width, height);
  }

  function step(now: number): boolean {
    if (!playing || !probes) return false;
    if (!pinToMap && probeView && !viewsEqual(host.getView(), probeView)) {
      resetMapSimulation();
      return true;
    }
    const dt = params.DT;
    if (!(dt > 0)) return false;
    const frame = 1 / PROBE_PLAY_FPS;
    playAcc += Math.min(0.1, Math.max(0, (now - playLast) / 1000));
    playLast = now;
    if (playAcc < frame) return false;
    const playParams: MapParams = { ...params, MAX_ITERATIONS: PROBE_MAX_STEPS };
    const snapRad = PROBE_SNAP_DEG * Math.PI / 180;
    const flyDt = dt * PROBE_FLY_TIME;
    const box = host.clip.getBoundingClientRect();
    const nextOrigins = pinToMap && pinnedWorlds
      ? overlayOrigins(box)
      : origins(box);
    const width = overlay.clientWidth;
    const height = overlay.clientHeight;
    const scale = pinToMap
      ? pinPxPerLen
      : overlayPxPerLen(
        currentProbeStep(probeHud).mode,
        width,
        height,
        probeSpacing(probeHud),
        params,
      );
    while (playAcc >= frame) {
      let detached = false;
      for (let i = 0; i < probes.length; i++) {
        if (i >= revealCount) continue;
        const live = flies[i];
        if (live === 'gone') continue;
        if (live) {
          stepFly(live, playParams, flyDt);
          if (!flyStillHere(live, nextOrigins[i], scale, width, height)) flies[i] = 'gone';
          continue;
        }
        const trajectory = probes[i];
        const prevTh1 = trajectory.th1;
        const prevTh2 = trajectory.th2;
        const prevW1 = trajectory.w1;
        const prevW2 = trajectory.w2;
        trajectory.step(playParams, dt);
        if (Math.abs(trajectory.th1 - prevTh1) >= snapRad) {
          flies[i] = startFly(prevTh1, prevTh2, prevW1, prevW2, playParams.L1, playParams.L2);
          detached = true;
          host.signals?.emit('probe-detach');
        }
      }
      playAcc -= frame;
      watchHang(now, detached);
      syncDrop();
      const hanging = probes.some((trajectory, i) => (
        i < revealCount && !flies[i] && !trajectory.done
      ));
      const flying = flies.some((fly) => fly && fly !== 'gone');
      if (!hanging && !flying) {
        playing = false;
        hudUi?.syncPlay(false);
        host.signals?.set('simulation_running', false);
        host.signals?.emit('probe-end');
        if (singleHud) resetMapSimulation();
        else syncDrop();
        break;
      }
    }
    return true;
  }

  function tick(now: number): void {
    if (lesson.active) {
      lesson.tick(now);
      return;
    }
    syncVoid();
    emitSimSecs(now);
    if (intro) {
      if (stepReveal(now)) draw();
      return;
    }
    if (playing) {
      if (step(now)) draw();
      return;
    }
    if (!hangEmitted && hangWatchAt) watchHang(now, false);
  }

  const lesson = new PendulumLesson(host, overlay, draw, (running) => {
    hudUi?.syncPlay(running);
  });

  const mapMode = requireElement<HTMLButtonElement>('mode-map');
  const pendulumMode = requireElement<HTMLButtonElement>('mode-pendulum');

  function syncModeButtons(pendulum: boolean): void {
    mapMode.classList.toggle('is-active', !pendulum);
    pendulumMode.classList.toggle('is-active', pendulum);
    mapMode.setAttribute('aria-selected', String(!pendulum));
    pendulumMode.setAttribute('aria-selected', String(pendulum));
  }

  function setMode(pendulum: boolean): void {
    if (lesson.active === pendulum) return;
    resetMapSimulation();
    if (pendulum) {
      lesson.enter(viewCenter(host.getView()));
    } else {
      lesson.leave();
    }
    pads?.sync();
    hudUi?.setLessonMode(pendulum);
    syncModeButtons(pendulum);
    draw();
  }

  mapMode.addEventListener('click', () => setMode(false));
  pendulumMode.addEventListener('click', () => setMode(true));
  syncModeButtons(false);

  hudUi = bindProbeHud(probeHud, () => {
    resetMapSimulation();
    draw();
  }, () => {
    if (lesson.active) {
      lesson.toggle();
      return;
    }
    if (singleHud) armSingle();
    else armPinnedGrid();
    startIntro();
    if (!probes) return;
    simCount += 1;
    const run = simCount === 1 ? 'first' : (paramsDirty ? 'changed' : 'repeat');
    host.signals?.set('simulation_count', simCount);
    host.signals?.set('simulation_run', run);
    host.signals?.emit('simulation-start');
    paramsDirty = false;
    draw();
  }, () => {
    dropAll();
  });
  menuUi = bindMenu(
    host.map,
    host.controls,
    host.onParamsChange,
    host.resetTransition,
    host.signals,
  );
  pads = bindSegmentPads(host);

  return {
    draw,
    tick,
    reset() {
      if (lesson.active) {
        lesson.paramsChanged();
        return;
      }
      resetMapSimulation();
    },
    noteActivity,
    resize() {
      if (lesson.active) {
        lesson.resize();
        return;
      }
      hudUi?.setSteps(singleHud ? emptyProbeSteps() : buildProbeSteps(host.clip), true);
      draw();
    },
    dismiss: () => menuUi?.setOpen(false),
    pickPoint() {
      return false;
    },
    syncBudget: syncBudgetReadout,
  };
}

export const pendulumPresentation: MapPresentationFactory = {
  init: initMapCore,
  mount: mountPendulumPresentation,
};
