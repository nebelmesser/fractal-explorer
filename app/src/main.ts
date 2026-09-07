import './style.css';
import {
  BUTTON_ZOOM_FACTOR,
  MEDIAN_DEFAULT,
  MIN_COMPUTE_PX,
  OVERSCAN_PAD,
  OVERSCAN_RELOAD,
  PARAM_LIVE_MS,
  PROBE_AUTOSTART_MS,
  PROBE_ALPHA,
  PROBE_CROSS_PX,
  PROBE_SIGHT_ALPHA,
  PROBE_SIGHT_FLY_ALPHA,
  PROBE_MAX_STEPS,
  PROBE_PLAY_FPS,
  PROBE_PIVOT_R,
  PROBE_SNAP_DEG,
  PROBE_FLY_TIME,
  SMOOTH_ZOOM_MS,
  TARGET_FRAME_MS,
  VIEW_DEBOUNCE_MS,
} from './constants';
import { requestGpu } from './gpu/device';
import { GpuMapRenderer } from './gpu/compute';
import { defaultMap } from './maps/catalog';
import {
  copyView,
  defaultParams,
  lerpParams,
  padViewWith,
  unionView,
  viewsEqual,
  viewSpanX,
  viewSpanY,
  type MapParams,
  type ViewRect,
} from './maps/types';
import { createTrajectory, initMapCore, type Trajectory } from './wasm/core';
import { computeSize, cssShortPx, fitMapDisplay, maxBudgetPx, nextWorkBudget, preferredIters, scaleSize, snapComputePx } from './viewer/budget';
import { bindMapInput } from './viewer/input';
import { bindMenu, syncBudgetReadout, type ExplorerControls } from './viewer/menu';
import {
  bindProbeHud,
  buildProbeSteps,
  chromeRects,
  currentProbeStep,
  defaultProbeHud,
  originHitsChrome,
  overlayPxPerLen,
  overlaySightScale,
  probeOrigins as layoutOrigins,
  probeSpacing,
} from './viewer/probes';
import { drawMapAxes } from './viewer/axes';
import { bindPrefs, consumeResetQuery, loadPrefs, markPrefsDirty } from './viewer/prefs';
import {
  drawOverlayFly,
  drawOverlayPendulum,
  drawProbeCross,
  drawProbePivot,
  flyOnOverlay,
  startFly,
  stepFly,
  type FlyState,
} from './maps/pendulum/preview';
import {
  alignViewY,
  atDefaultView,
  canZoomIn,
  canZoomOut,
  easeInOutCubic,
  fitViewAspect,
  foldViewY,
  isUnzoom,
  lerpViewShortY,
  nextUnzoomCover,
  tiledInset,
  viewCenter,
  worldFromDisplay,
  wrapPointToCover,
  zoomAbout,
} from './viewer/view';

const mapDef = defaultMap();

/** WebGPU presents a frame later than CSS. Wait until the hidden canvas has pixels. */
function waitForPresent(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function boot(): Promise<void> {
  const gpuMissing = document.getElementById('gpu-missing');
  const mapCanvas = document.getElementById('map') as HTMLCanvasElement;
  const mapBack = document.getElementById('map-back') as HTMLCanvasElement;
  const mapClip = document.getElementById('map-clip');
  const stage = document.getElementById('stage');
  const sidebar = document.getElementById('sidebar');
  const axesCanvas = document.getElementById('map-axes') as HTMLCanvasElement | null;
  const overlayCanvas = document.getElementById('probe-overlay') as HTMLCanvasElement | null;
  const scaleX = document.getElementById('map-scale-x');
  const scaleY = document.getElementById('map-scale-y');
  const shiftEl = document.getElementById('map-shift');
  const zoomOutEl = document.getElementById('zoom-out') as HTMLButtonElement | null;
  const zoomInEl = document.getElementById('zoom-in') as HTMLButtonElement | null;
  const zoomResetEl = document.getElementById('zoom-reset') as HTMLButtonElement | null;
  if (!mapCanvas || !mapBack || !mapClip || !stage || !sidebar || !axesCanvas || !overlayCanvas || !scaleX || !scaleY || !shiftEl || !zoomInEl || !zoomOutEl || !zoomResetEl) {
    throw new Error('Explorer DOM is incomplete');
  }
  const zoomIn = zoomInEl;
  const zoomOut = zoomOutEl;
  const zoomReset = zoomResetEl;
  const xScale = scaleX;
  const yScale = scaleY;
  const mapShift = shiftEl;
  const clip = mapClip;
  const overlay = overlayCanvas;
  const axes = axesCanvas;

  const gpu = await requestGpu();
  if (!gpu) {
    if (gpuMissing) gpuMissing.hidden = false;
    return;
  }
  const gpuOk = gpu;

  await initMapCore();

  consumeResetQuery();
  const saved = loadPrefs();
  const params: MapParams = { ...defaultParams(mapDef), ...saved?.params };
  params.MAX_ITERATIONS = preferredIters(saved?.targetFrameMs ?? TARGET_FRAME_MS);
  let display = fitMapDisplay(stage);
  let world = worldFromDisplay(display.width, display.height);
  let view: ViewRect = copyView(world);
  let computedView = copyView(view);
  const history: ViewRect[] = [copyView(view)];
  let settledPx = snapComputePx(Math.min(display.width, display.height));
  let animating = false;
  const probeHud = defaultProbeHud();
  let probes: Trajectory[] | null = null;
  let flies: (FlyState | 'gone' | null)[] = [];
  let probePlaying = false;
  let probeHudUi: { syncPlay(playing: boolean): void; setSteps(steps: ReturnType<typeof buildProbeSteps>): void } | null = null;
  let probeView: ViewRect | null = null;
  let probePlayAcc = 0;
  let probePlayLast = 0;
  let stopCoast = (): void => {};
  let rendering = false;
  let wantRefine = true;
  let wantHalo = false;
  let renderGen = 0;
  let lastRefineMs = Infinity;
  let lastParamMapMs = Infinity;
  let paramDragging = false;
  let renderingLive = false;
  let zoomToken = 0;
  let autoStartTimer = 0;
  let lastRenderSize = { width: 0, height: 0 };
  let lastOverscanPad = 0;
  let lastUnitSpan = { x: 0, y: 0 };
  let parkedCover: ViewRect | null = null;
  let gestureActive = false;
  let resetFromView: ViewRect | null = null;
  let resetParamFrom: MapParams | null = null;
  let resetParamTo: MapParams | null = null;
  let resetEase = 0;
  let unzoomTarget: ViewRect | null = null;
  let lastCoverParams: MapParams | null = null;
  let forcedView: ViewRect | null = null;
  let forcedUnit: ViewRect | null = null;
  let forcedParams: MapParams | null = null;
  let forcedWaiters: Array<() => void> = [];

  const controls: ExplorerControls = {
    params,
    invert: saved?.invert ?? false,
    median: MEDIAN_DEFAULT,
    targetFrameMs: saved?.targetFrameMs ?? TARGET_FRAME_MS,
  };

  let frontCanvas = mapCanvas;
  let backCanvas = mapBack;
  let renderer: GpuMapRenderer;
  try {
    renderer = await GpuMapRenderer.create(gpuOk, backCanvas, mapDef);
  } catch (error) {
    if (gpuMissing) {
      gpuMissing.hidden = false;
      gpuMissing.textContent = error instanceof Error ? error.message : String(error);
    }
    console.error(error);
    return;
  }
  bindPrefs(() => {
    const stored = { ...params };
    delete stored.MAX_ITERATIONS;
    return {
      params: stored,
      invert: controls.invert,
      median: controls.median,
      targetFrameMs: controls.targetFrameMs,
      lastComputePx: settledPx,
    };
  });

  let viewTimer = 0;

  function syncZoomBar(): void {
    zoomIn.disabled = !canZoomIn(view);
    zoomOut.disabled = !canZoomOut(view, world);
    zoomReset.disabled = !canZoomOut(view, world) && atDefaultView(view, world);
  }

  function scaleDrift(): number {
    if (!(lastUnitSpan.x > 0 && lastUnitSpan.y > 0)) return 0;
    return Math.max(
      Math.abs(viewSpanX(view) / lastUnitSpan.x - 1),
      Math.abs(viewSpanY(view) / lastUnitSpan.y - 1),
    );
  }

  function coverageInset(): number {
    return tiledInset(view, computedView);
  }

  function applyBudget(): void {
    if (!Number.isFinite(lastRefineMs)) {
      params.MAX_ITERATIONS = preferredIters(controls.targetFrameMs);
      syncBudgetReadout(controls.targetFrameMs, params.MAX_ITERATIONS);
      return;
    }
    const capPx = maxBudgetPx(display);
    const next = nextWorkBudget(
      { shortPx: settledPx, iters: params.MAX_ITERATIONS },
      lastRefineMs,
      controls.targetFrameMs,
      display,
      capPx,
    );
    settledPx = Math.min(capPx, next.shortPx);
    params.MAX_ITERATIONS = next.iters;
    syncBudgetReadout(controls.targetFrameMs, params.MAX_ITERATIONS);
  }

  function requestVisible(): void {
    wantHalo = false;
    wantRefine = true;
    renderGen += 1;
  }

  function scheduleView(opts: { immediate?: boolean; navigating?: boolean; coasting?: boolean }): void {
    window.clearTimeout(viewTimer);
    applyShift();
    drawChrome();
    syncZoomBar();
    if (opts.coasting || opts.navigating) {
      // Gesture is still moving: only CSS-shift (and a parked halo). Never start a
      // budgeted pass here — that is what made desktop pan hitch.
      if (coverageInset() < 0) promoteParked();
      if (isUnzoom(computedView, view)) {
        unzoomTarget = copyView(world);
        void prefetchUnzoom(world);
      }
      return;
    }
    if (opts.immediate) {
      requestVisible();
      return;
    }
    const zoomed = scaleDrift() > 0.04;
    const inset = coverageInset();
    if (zoomed) {
      viewTimer = window.setTimeout(() => requestVisible(), VIEW_DEBOUNCE_MS);
      return;
    }
    if (inset < 0) {
      if (promoteParked()) return;
      requestVisible();
      return;
    }
    if (inset < OVERSCAN_RELOAD && !parkedCover && !forcedView) {
      wantHalo = true;
    }
  }

  function paramPreviewPx(): number {
    const cap = Math.min(settledPx, cssShortPx(display));
    const ms = Number.isFinite(lastParamMapMs) ? lastParamMapMs : lastRefineMs;
    if (!(ms > PARAM_LIVE_MS)) return cap;
    const scale = Math.sqrt(PARAM_LIVE_MS / ms);
    return snapComputePx(Math.max(MIN_COMPUTE_PX, cap * scale));
  }

  function scheduleParams(phase: 'live' | 'reset' | 'settle' = 'settle'): void {
    resetProbes();
    drawChrome();
    bumpAutoStart();
    if (phase === 'live' || phase === 'reset') {
      paramDragging = true;
      wantHalo = false;
      wantRefine = true;
      if (rendering && !renderingLive) renderGen += 1;
      return;
    }
    paramDragging = false;
    applyBudget();
    requestVisible();
  }

  function swapMapCanvases(): void {
    mapShift.appendChild(backCanvas);
    backCanvas.classList.remove('map-pending');
    backCanvas.classList.add('is-front');
    backCanvas.setAttribute('aria-label', 'Map');
    backCanvas.removeAttribute('aria-hidden');
    frontCanvas.classList.remove('is-front');
    frontCanvas.classList.add('map-pending');
    frontCanvas.removeAttribute('aria-label');
    frontCanvas.setAttribute('aria-hidden', 'true');
    clip.appendChild(frontCanvas);
    const prevCanvas = frontCanvas;
    frontCanvas = backCanvas;
    backCanvas = prevCanvas;
  }

  function promoteParked(force = false): boolean {
    if (!parkedCover) return false;
    if (tiledInset(view, parkedCover) < 0) return false;
    if (!force && coverageInset() >= 0) return false;
    computedView = parkedCover;
    lastOverscanPad = OVERSCAN_PAD;
    parkedCover = null;
    swapMapCanvases();
    applyShift();
    drawChrome();
    return true;
  }

  function applyShift(): void {
    const cover = alignViewY(computedView, view);
    const sx = viewSpanX(cover) / viewSpanX(view);
    const sy = viewSpanY(cover) / viewSpanY(view);
    const cc = viewCenter(cover);
    const nc = viewCenter(view);
    const box = clip.getBoundingClientRect();
    const dx = ((cc.x - nc.x) / viewSpanX(view)) * box.width;
    const dy = ((cc.y - nc.y) / viewSpanY(view)) * box.height;
    mapShift.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  }

  function drawChrome(): void {
    const origins = probeOrigins();
    const worlds = syncProbeWorlds();
    drawMapAxes(axes, view, xScale, yScale, {
      points: origins.map((origin, i) => ({
        x: origin.x,
        y: origin.y,
        xRad: worlds[i].x,
        yRad: worlds[i].y,
      })),
      probesOnly: currentProbeStep(probeHud).mode === 'grid',
    });
    drawProbes(origins, worlds);
  }

  function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const box = clip.getBoundingClientRect();
    return {
      x: view.xMin + ((clientX - box.left) / box.width) * viewSpanX(view),
      y: view.yMin + ((clientY - box.top) / box.height) * viewSpanY(view),
    };
  }

  function snapWorld(p: { x: number; y: number }): { x: number; y: number } {
    const q = wrapPointToCover(p, computedView);
    const nx = (q.x - computedView.xMin) / viewSpanX(computedView);
    const ny = (q.y - computedView.yMin) / viewSpanY(computedView);
    const texel = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 ? renderer.mapTexel(nx, ny) : null;
    if (!texel) return p;
    const xDen = Math.max(texel.width - 1, 1);
    const yDen = Math.max(texel.height - 1, 1);
    const sx = computedView.xMin + (viewSpanX(computedView) * texel.ix) / xDen;
    const sy = computedView.yMin + (viewSpanY(computedView) * texel.iy) / yDen;
    return { x: sx, y: p.y + (sy - q.y) };
  }

  function probeOrigins(): { x: number; y: number }[] {
    const box = clip.getBoundingClientRect();
    const blocked = chromeRects(clip);
    const mode = currentProbeStep(probeHud).mode;
    const hitR = PROBE_CROSS_PX * overlaySightScale(mode) + 6;
    return layoutOrigins(box.width, box.height, mode, probeSpacing(probeHud))
      .filter((origin) => !originHitsChrome(origin, blocked, hitR));
  }

  function probeWorlds(): { x: number; y: number }[] {
    const box = clip.getBoundingClientRect();
    return probeOrigins().map((origin) => (
      snapWorld(clientToWorld(box.left + origin.x, box.top + origin.y))
    ));
  }

  function playParams(): MapParams {
    return { ...params, MAX_ITERATIONS: PROBE_MAX_STEPS };
  }

  function probeDt(): number {
    return params.DT;
  }

  function cancelAutoStart(): void {
    window.clearTimeout(autoStartTimer);
    autoStartTimer = 0;
  }

  function bumpAutoStart(): void {
    cancelAutoStart();
    if (currentProbeStep(probeHud).count <= 0) return;
    autoStartTimer = window.setTimeout(() => {
      autoStartTimer = 0;
      launchProbes();
      drawProbes();
    }, PROBE_AUTOSTART_MS);
  }

  function resetProbes(): void {
    probes = null;
    flies = [];
    probePlaying = false;
    probeHudUi?.syncPlay(false);
    probeView = null;
    probePlayAcc = 0;
  }

  function syncProbeWorlds(): { x: number; y: number }[] {
    const worlds = probeWorlds();
    if (probes && (
      (probeView && !viewsEqual(view, probeView))
      || probes.length !== worlds.length
    )) {
      resetProbes();
    }
    return worlds;
  }

  function launchProbes(): void {
    cancelAutoStart();
    const worlds = probeWorlds();
    if (!worlds.length) return;
    probes = worlds.map((point) => createTrajectory(point.x, point.y));
    flies = worlds.map(() => null);
    probeView = copyView(view);
    probePlaying = true;
    probePlayAcc = 0;
    probePlayLast = performance.now();
    probeHudUi?.syncPlay(true);
  }

  function stepProbes(now: number): void {
    syncProbeWorlds();
    if (!probePlaying || !probes) return;
    const dt = probeDt();
    if (!(dt > 0)) return;
    const frame = 1 / PROBE_PLAY_FPS;
    probePlayAcc += Math.min(0.1, Math.max(0, (now - probePlayLast) / 1000));
    probePlayLast = now;
    const next = playParams();
    const snapRad = PROBE_SNAP_DEG * Math.PI / 180;
    const flyDt = dt * PROBE_FLY_TIME;
    const origins = probeOrigins();
    const ow = overlay.clientWidth;
    const oh = overlay.clientHeight;
    const scale = overlayPxPerLen(
      currentProbeStep(probeHud).mode,
      ow,
      oh,
      probeSpacing(probeHud),
      params,
    );
    while (probePlayAcc >= frame) {
      for (let i = 0; i < probes.length; i++) {
        const live = flies[i];
        if (live === 'gone') continue;
        if (live) {
          stepFly(live, next, flyDt);
          const origin = origins[i];
          if (!origin || !flyOnOverlay(live, origin, scale, ow, oh)) flies[i] = 'gone';
          continue;
        }
        const traj = probes[i];
        const prevTh1 = traj.th1;
        const prevTh2 = traj.th2;
        const prevW1 = traj.w1;
        const prevW2 = traj.w2;
        traj.step(next, dt);
        if (Math.abs(traj.th1 - prevTh1) >= snapRad) {
          flies[i] = startFly(prevTh1, prevTh2, prevW1, prevW2, next.L1, next.L2);
        }
      }
      probePlayAcc -= frame;
      const hanging = probes.some((traj, i) => !flies[i] && !traj.done);
      const flying = flies.some((fly) => fly && fly !== 'gone');
      if (!hanging && !flying) {
        probePlaying = false;
        probeHudUi?.syncPlay(false);
        break;
      }
    }
  }

  function drawProbes(
    origins = probeOrigins(),
    worlds = syncProbeWorlds(),
  ): void {
    const w = overlay.clientWidth;
    const h = overlay.clientHeight;
    if (w < 8 || h < 8) return;
    const mode = currentProbeStep(probeHud).mode;
    const large = mode === 'one' || mode === 'two';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (overlay.width !== pw || overlay.height !== ph) {
      overlay.width = pw;
      overlay.height = ph;
    }
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const style = {
      large,
      pxPerLen: overlayPxPerLen(mode, w, h, probeSpacing(probeHud), params),
      alpha: large ? PROBE_ALPHA : 1,
    };
    const crossHalf = PROBE_CROSS_PX * overlaySightScale(mode);
    for (let i = 0; i < origins.length; i++) {
      const origin = origins[i];
      const fly = flies[i];
      const sight = {
        x: origin.x,
        y: origin.y,
        alpha: fly ? PROBE_SIGHT_FLY_ALPHA : PROBE_SIGHT_ALPHA,
        crossHalf,
        pivotR: PROBE_PIVOT_R,
      };
      if (fly === 'gone') {
        drawProbePivot(ctx, origin, PROBE_PIVOT_R, sight.alpha);
        drawProbeCross(ctx, origin, crossHalf, sight.alpha);
      } else if (fly) {
        drawOverlayFly(ctx, origin, fly, params, style, sight);
      } else {
        const th1 = probes ? probes[i].th1 : worlds[i].x;
        const th2 = probes ? probes[i].th2 : worlds[i].y;
        drawOverlayPendulum(ctx, origin, th1, th2, params, style, sight);
      }
    }
  }

  function cancelAnim(): void {
    zoomToken += 1;
    animating = false;
  }

  function notifyForcedDone(): void {
    const waiters = forcedWaiters;
    forcedWaiters = [];
    forcedView = null;
    forcedUnit = null;
    forcedParams = null;
    for (const wait of waiters) wait();
  }

  function cancelPrefetch(): void {
    if (forcedView || forcedWaiters.length) renderGen += 1;
    notifyForcedDone();
  }

  function cancelZoomAnim(): void {
    cancelAnim();
    cancelPrefetch();
    unzoomTarget = null;
  }

  function computeForced(target: ViewRect, from?: ViewRect, lookParams?: MapParams): Promise<void> {
    return new Promise((resolve) => {
      forcedWaiters.push(resolve);
      const landing = foldViewY(target);
      forcedView = from
        ? unionView(alignViewY(foldViewY(from), landing), landing)
        : landing;
      forcedUnit = unzoomTarget ? foldViewY(view) : landing;
      forcedParams = lookParams ?? null;
      wantRefine = false;
      wantHalo = true;
      renderGen += 1;
    });
  }

  function waitForced(): Promise<void> {
    if (!forcedView) return Promise.resolve();
    return new Promise((resolve) => {
      forcedWaiters.push(resolve);
    });
  }

  function paramsClose(a: MapParams, b: MapParams): boolean {
    for (const spec of mapDef.params) {
      const da = Math.abs((a[spec.key] ?? 0) - (b[spec.key] ?? 0));
      const scale = Math.max(Math.abs(spec.default), spec.step, 1e-6);
      if (da > Math.max(spec.step * 2, scale * 0.08)) return false;
    }
    return true;
  }

  function lookaheadParams(cover: ViewRect): MapParams | undefined {
    if (!resetParamFrom || !resetParamTo) return undefined;
    if (!resetFromView || !isUnzoom(resetFromView, world)) {
      return lerpParams(mapDef.params, resetParamFrom, resetParamTo, Math.min(1, resetEase + 0.35));
    }
    const s0 = Math.max(viewSpanX(resetFromView), viewSpanY(resetFromView));
    const s1 = Math.max(viewSpanX(world), viewSpanY(world));
    const sc = Math.max(viewSpanX(cover), viewSpanY(cover));
    const e = s1 > s0 * 1.001 ? Math.min(1, Math.max(0, (sc - s0) / (s1 - s0))) : 1;
    return lerpParams(mapDef.params, resetParamFrom, resetParamTo, e);
  }

  function widestCover(): ViewRect {
    if (!parkedCover) return computedView;
    const a = viewSpanX(computedView) * viewSpanY(computedView);
    const b = viewSpanX(parkedCover) * viewSpanY(parkedCover);
    return b > a ? parkedCover : computedView;
  }

  function prefetchUnzoom(target: ViewRect): Promise<void> {
    const landing = foldViewY(target);
    const have = widestCover();
    const next = nextUnzoomCover(have, landing);
    const look = lookaheadParams(next);
    const haveAligned = alignViewY(foldViewY(have), landing);
    const spatialDone = tiledInset(landing, haveAligned) >= 0;
    const need = spatialDone ? landing : next;
    if (forcedView && tiledInset(need, forcedView) >= -0.02) return waitForced();
    if (spatialDone) {
      if (!look || (lastCoverParams && paramsClose(look, lastCoverParams))) {
        return Promise.resolve();
      }
      if (rendering && !forcedView) return Promise.resolve();
      return computeForced(landing, undefined, look);
    }
    return computeForced(next, undefined, look);
  }

  function resetToWorld(): void {
    if (atDefaultView(view, world)) {
      if (!viewsEqual(view, world)) {
        view = copyView(world);
        applyShift();
        drawChrome();
        syncZoomBar();
      }
      return;
    }
    const folded = foldViewY(view);
    if (!viewsEqual(folded, view)) {
      view = folded;
      applyShift();
    }
    applyView(copyView(world), { pushHistory: true, animate: true });
  }

  function resetHomeBegin(): void {
    stopCoast();
    cancelAnim();
    cancelPrefetch();
    gestureActive = false;
    const folded = foldViewY(view);
    if (!viewsEqual(folded, view)) {
      view = folded;
      applyShift();
    }
    if (!atDefaultView(view, world)) history.push(copyView(view));
    resetFromView = copyView(view);
    resetParamFrom = { ...params };
    resetParamTo = { ...defaultParams(mapDef), MAX_ITERATIONS: params.MAX_ITERATIONS };
    resetEase = 0;
    lastCoverParams = null;
    unzoomTarget = copyView(world);
    resetProbes();
    markPrefsDirty();
    void prefetchUnzoom(unzoomTarget);
  }

  function resetHomeTick(eased: number): void {
    resetEase = eased;
    if (resetFromView) {
      const desired = eased >= 1
        ? copyView(world)
        : lerpViewShortY(resetFromView, world, eased);
      const cover = widestCover();
      if (tiledInset(desired, cover) >= 0) view = desired;
      if (coverageInset() < 0) promoteParked();
    }
    applyShift();
    drawChrome();
    syncZoomBar();
    if (unzoomTarget) void prefetchUnzoom(unzoomTarget);
  }

  function resetHomeEnd(): void {
    view = copyView(world);
    resetFromView = null;
    resetParamFrom = null;
    resetParamTo = null;
    resetEase = 1;
    unzoomTarget = null;
    applyShift();
    drawChrome();
    syncZoomBar();
  }

  function resetHomeCancel(): void {
    if (!resetFromView && !resetParamFrom) return;
    resetFromView = null;
    resetParamFrom = null;
    resetParamTo = null;
    unzoomTarget = null;
    cancelPrefetch();
  }

  function animateViewTo(target: ViewRect, then: () => void): void {
    const from = copyView(view);
    const token = zoomToken;
    let origin = performance.now();
    let last = origin;
    let held = 0;
    animating = true;
    const step = (now: number): void => {
      if (token !== zoomToken) return;
      const dt = Math.max(0, now - last);
      last = now;
      const u = Math.min(1, (now - origin) / SMOOTH_ZOOM_MS);
      const desired = lerpViewShortY(from, target, easeInOutCubic(u));
      if (unzoomTarget) {
        if (coverageInset() < 0) promoteParked();
        const cover = widestCover();
        if (tiledInset(desired, cover) < 0 && held < SMOOTH_ZOOM_MS) {
          origin += dt;
          held += dt;
          void prefetchUnzoom(unzoomTarget);
          applyShift();
          drawChrome();
          syncZoomBar();
          requestAnimationFrame(step);
          return;
        }
        held = 0;
        void prefetchUnzoom(unzoomTarget);
      } else if (coverageInset() < 0) {
        promoteParked();
      }
      view = desired;
      applyShift();
      drawChrome();
      syncZoomBar();
      bumpAutoStart();
      if (u < 1) {
        requestAnimationFrame(step);
        return;
      }
      view = copyView(target);
      animating = false;
      then();
    };
    requestAnimationFrame(step);
  }

  function startUnzoom(next: ViewRect, then: () => void): void {
    const landing = foldViewY(next);
    const token = zoomToken;
    unzoomTarget = landing;
    const grown = lerpViewShortY(view, landing, 0.05);
    const have = widestCover();
    const begin = (): void => {
      if (token !== zoomToken) return;
      promoteParked();
      animateViewTo(next, then);
    };
    if (tiledInset(grown, have) >= 0) {
      void prefetchUnzoom(landing);
      begin();
      return;
    }
    void prefetchUnzoom(landing).then(begin);
  }

  function applyView(next: ViewRect, opts?: { pushHistory?: boolean; animate?: boolean; immediate?: boolean; navigating?: boolean; coasting?: boolean; keepPrefetch?: boolean }): void {
    bumpAutoStart();
    if (opts?.navigating || opts?.coasting) gestureActive = true;
    if (!opts?.coasting) stopCoast();
    if (opts?.animate) cancelAnim();
    if (!opts?.coasting && !opts?.keepPrefetch) cancelPrefetch();
    if (opts?.pushHistory && !viewsEqual(next, view)) history.push(copyView(view));
    markPrefsDirty();
    if (opts?.animate) {
      const landing = foldViewY(next);
      if (isUnzoom(view, landing)) {
        startUnzoom(next, () => {
          unzoomTarget = null;
          promoteParked(true);
          scheduleView({ immediate: true });
        });
        return;
      }
      unzoomTarget = null;
      void computeForced(landing, view);
      animateViewTo(next, () => {
        promoteParked(true);
        scheduleView({ immediate: true });
      });
      return;
    }
    view = next;
    scheduleView({
      immediate: opts?.immediate,
      navigating: opts?.navigating,
      coasting: opts?.coasting,
    });
  }

  bindMenu(mapDef, controls, scheduleParams, {
    begin: resetHomeBegin,
    tick: resetHomeTick,
    end: resetHomeEnd,
    cancel: resetHomeCancel,
    isAway: () => !atDefaultView(view, world),
  });
  probeHudUi = bindProbeHud(probeHud, () => {
    resetProbes();
    drawChrome();
    bumpAutoStart();
  }, () => {
    launchProbes();
    drawProbes();
  });

  stopCoast = bindMapInput(clip, {
    getView: () => view,
    getWorld: () => world,
    setView(next, opts) {
      applyView(next, opts);
    },
    popHistory() {
      if (history.length <= 1) return;
      stopCoast();
      cancelZoomAnim();
      history.pop();
      view = copyView(history[history.length - 1]);
      markPrefsDirty();
      scheduleView({ immediate: true });
      bumpAutoStart();
    },
    pickPoint() {
      return false;
    },
    prefetchView(target) {
      if (animating) return;
      if (isUnzoom(view, target)) {
        unzoomTarget = foldViewY(target);
        void prefetchUnzoom(unzoomTarget);
        return;
      }
      const landing = foldViewY(target);
      if (forcedView && tiledInset(landing, forcedView) > 0.05) return;
      if (parkedCover && tiledInset(landing, parkedCover) > 0.05) return;
      if (!forcedView && !parkedCover && tiledInset(landing, computedView) > OVERSCAN_RELOAD * 0.5) return;
      void computeForced(target, view);
    },
    interrupt() {
      cancelZoomAnim();
    },
    settleView() {
      gestureActive = false;
      unzoomTarget = null;
      promoteParked(true);
      scheduleView({ immediate: true });
    },
  }).stopCoast;

  function buttonZoom(factor: number): void {
    const c = viewCenter(view);
    applyView(zoomAbout(view, c.x, c.y, factor, world), { pushHistory: true, animate: true });
  }

  zoomOut.addEventListener('click', () => buttonZoom(1 / BUTTON_ZOOM_FACTOR));
  zoomIn.addEventListener('click', () => buttonZoom(BUTTON_ZOOM_FACTOR));
  zoomReset.addEventListener('click', () => {
    resetToWorld();
  });
  syncZoomBar();

  const layout = (): void => {
    stopCoast();
    const next = fitMapDisplay(stage);
    const resized = next.width !== display.width || next.height !== display.height;
    display = next;
    const atWorld = !canZoomOut(view, world);
    world = worldFromDisplay(display.width, display.height);
    view = atWorld
      ? copyView(world)
      : fitViewAspect(view, display.width, display.height, world);
    for (let i = 0; i < history.length; i++) {
      history[i] = fitViewAspect(history[i], display.width, display.height, world);
    }
    if (atWorld) history[0] = copyView(world);
    if (resized) requestVisible();
    applyShift();
    probeHudUi?.setSteps(buildProbeSteps(clip));
    drawChrome();
    syncZoomBar();
    if (resized) bumpAutoStart();
  };
  layout();
  const ro = new ResizeObserver(layout);
  ro.observe(stage);

  async function renderOnce(): Promise<void> {
    if (rendering) return;
    if (animating && !forcedView) return;
    if (!wantRefine && !wantHalo) return;
    const forced = forcedView ? copyView(forcedView) : null;
    const passParams = forcedParams ?? params;
    const live = paramDragging && !forced;
    const unzoomPass = Boolean(forced && unzoomTarget);
    const padded = !live && !unzoomPass && (wantHalo || Boolean(forced));
    const gen = renderGen;
    rendering = true;
    renderingLive = live;
    wantRefine = false;
    wantHalo = false;
    if (!live && !unzoomPass) parkedCover = null;
    try {
      const vis = computeSize(display, live ? paramPreviewPx() : settledPx);
      const haloBase = computeSize(display, cssShortPx(display));
      const pad = padded ? OVERSCAN_PAD : 0;
      const unit = foldViewY(forcedUnit ?? view);
      const source = foldViewY(forced ?? view);
      const renderView = pad > 0 ? padViewWith(source, pad, unit) : copyView(source);
      const foldedVis = foldViewY(view);
      const normView = {
        xMin: Math.max(renderView.xMin, foldedVis.xMin),
        xMax: Math.min(renderView.xMax, foldedVis.xMax),
        yMin: Math.max(renderView.yMin, foldedVis.yMin),
        yMax: Math.min(renderView.yMax, foldedVis.yMax),
      };
      const normOk = normView.xMax > normView.xMin && normView.yMax > normView.yMin;
      const rx = viewSpanX(renderView) / Math.max(viewSpanX(unit), 1e-12);
      const ry = viewSpanY(renderView) / Math.max(viewSpanY(unit), 1e-12);
      const size = scaleSize(padded || unzoomPass ? haloBase : vis, Math.max(1, rx, ry));
      renderer.setCanvas(backCanvas);
      const ms = await renderer.render(
        renderView,
        passParams,
        size.width,
        size.height,
        controls.invert,
        controls.median,
        unzoomPass || !normOk ? renderView : normView,
      );
      if (gen !== renderGen) return;
      if (live) lastParamMapMs = ms;
      else lastRefineMs = ms;
      await waitForPresent();
      if (gen !== renderGen) return;
      const visCovers = lastOverscanPad === 0
        && frontCanvas.dataset.ready === '1'
        && tiledInset(view, computedView) >= 0;
      const newCovers = tiledInset(view, renderView) >= 0;
      if (padded && newCovers && (visCovers || gestureActive) && !unzoomTarget) {
        parkedCover = renderView;
        lastRenderSize = size;
        if (forced) {
          lastCoverParams = passParams;
          notifyForcedDone();
        }
      } else {
        swapMapCanvases();
        computedView = renderView;
        if (unzoomPass) parkedCover = null;
        lastRenderSize = size;
        lastOverscanPad = pad;
        lastUnitSpan = { x: viewSpanX(unit), y: viewSpanY(unit) };
        if (forced) {
          lastCoverParams = passParams;
          notifyForcedDone();
        } else if (!padded && !live) {
          const prevPx = settledPx;
          const prevIters = params.MAX_ITERATIONS;
          applyBudget();
          markPrefsDirty();
          if (
            (settledPx > prevPx || params.MAX_ITERATIONS > prevIters)
            && lastRefineMs < controls.targetFrameMs * 0.85
          ) {
            wantRefine = true;
          } else {
            wantHalo = true;
          }
        }
      }
      applyShift();
      syncZoomBar();
      drawChrome();
      if (forced && unzoomTarget) void prefetchUnzoom(unzoomTarget);
    } catch (error) {
      if (forced) notifyForcedDone();
      console.error(error);
      const hint = document.getElementById('gpu-missing');
      if (hint && frontCanvas.dataset.ready !== '1') {
        hint.hidden = false;
        hint.textContent = error instanceof Error ? error.message : String(error);
      }
    } finally {
      rendering = false;
      renderingLive = false;
    }
  }

  function tick(now: number): void {
    if ((wantRefine || wantHalo) && !rendering) {
      void renderOnce();
    }
    if (probePlaying) {
      const worlds = syncProbeWorlds();
      stepProbes(now);
      drawProbes(probeOrigins(), worlds);
    }
    requestAnimationFrame(tick);
  }

  drawChrome();
  bumpAutoStart();
  requestAnimationFrame(tick);
}

void boot();
