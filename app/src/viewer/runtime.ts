import {
  BUTTON_ZOOM_FACTOR,
  MEDIAN_DEFAULT,
  MIN_COMPUTE_PX,
  MAX_OVERSCAN_PX,
  OVERSCAN_PAD,
  OVERSCAN_RELOAD,
  PARAM_LIVE_MS,
  SMOOTH_ZOOM_MS,
  TARGET_FRAME_MS,
  VIEW_DEBOUNCE_MS,
} from '../constants';
import { requestGpu } from '../gpu/device';
import { GpuMapRenderer } from '../gpu/compute';
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
  type MapDefinition,
} from '../maps/types';
import { computeSize, cssShortPx, densityPreservingPad, fitMapDisplay, maxBudgetPx, nextWorkBudget, preferredWork, scaleSize, snapComputePx } from './budget';
import { bindMapInput } from './input';
import { bindPrefs, consumeResetQuery, loadPrefs, markPrefsDirty } from './prefs';
import {
  emptyPresentation,
  type MapPresentation,
  type MapPresentationFactory,
  type ViewerControls,
} from './presentation';
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
} from './view';

/** WebGPU presents a frame later than CSS. Wait until the hidden canvas has pixels. */
function waitForPresent(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

export async function bootViewer(
  mapDef: MapDefinition,
  presentationFactory?: MapPresentationFactory,
): Promise<void> {
  const gpuMissing = document.getElementById('gpu-missing');
  const mapCanvas = document.getElementById('map') as HTMLCanvasElement;
  const mapBack = document.getElementById('map-back') as HTMLCanvasElement;
  const mapClip = document.getElementById('map-clip');
  const stage = document.getElementById('stage');
  const shiftEl = document.getElementById('map-shift');
  const zoomOutEl = document.getElementById('zoom-out') as HTMLButtonElement | null;
  const zoomInEl = document.getElementById('zoom-in') as HTMLButtonElement | null;
  const zoomResetEl = document.getElementById('zoom-reset') as HTMLButtonElement | null;
  if (!mapCanvas || !mapBack || !mapClip || !stage || !shiftEl || !zoomInEl || !zoomOutEl || !zoomResetEl) {
    throw new Error('Explorer DOM is incomplete');
  }
  const zoomIn = zoomInEl;
  const zoomOut = zoomOutEl;
  const zoomReset = zoomResetEl;
  const mapShift = shiftEl;
  const clip = mapClip;
  const navigation = mapDef.navigation ?? {};

  const gpu = await requestGpu();
  if (!gpu) {
    if (gpuMissing) gpuMissing.hidden = false;
    return;
  }
  const gpuOk = gpu;

  await presentationFactory?.init?.();

  const preferencesKey = mapDef.preferencesKey ?? `fractal-explorer:${mapDef.id}`;
  consumeResetQuery(preferencesKey);
  const saved = loadPrefs(preferencesKey);
  const params: MapParams = { ...defaultParams(mapDef), ...saved?.params };
  params[mapDef.workBudget.param] = preferredWork(saved?.targetFrameMs ?? TARGET_FRAME_MS, mapDef.workBudget);
  let display = fitMapDisplay(stage);
  let world = worldFromDisplay(display.width, display.height, mapDef.defaultView);
  let view: ViewRect = copyView(world);
  let computedView = copyView(view);
  const history: ViewRect[] = [copyView(view)];
  let settledPx = snapComputePx(Math.min(display.width, display.height));
  let animating = false;
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
  let lastOverscanPad = 0;
  let lastUnitSpan = { x: 0, y: 0 };
  let parkedCover: ViewRect | null = null;
  let parkedPad = 0;
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
  let viewFrame = 0;
  let pendingMotion: { coasting: boolean } | null = null;

  const controls: ViewerControls = {
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
  const presentation: MapPresentation = presentationFactory?.mount({
    clip,
    map: mapDef,
    params,
    navigation,
    controls,
    onParamsChange: scheduleParams,
    resetTransition: {
      begin: resetHomeBegin,
      tick: resetHomeTick,
      end: resetHomeEnd,
      cancel: resetHomeCancel,
      isAway: () => !atDefaultView(view, world, navigation),
    },
    getView: () => view,
    clientToWorld,
    snapToRenderedPixel: snapWorld,
  }) ?? emptyPresentation;
  bindPrefs(preferencesKey, () => {
    const stored = { ...params };
    delete stored[mapDef.workBudget.param];
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
    zoomReset.disabled = !canZoomOut(view, world) && atDefaultView(view, world, navigation);
  }

  function scaleDrift(): number {
    if (!(lastUnitSpan.x > 0 && lastUnitSpan.y > 0)) return 0;
    return Math.max(
      Math.abs(viewSpanX(view) / lastUnitSpan.x - 1),
      Math.abs(viewSpanY(view) / lastUnitSpan.y - 1),
    );
  }

  function coverageInset(): number {
    return tiledInset(view, computedView, navigation);
  }

  function applyBudget(): void {
    if (!Number.isFinite(lastRefineMs)) {
      params[mapDef.workBudget.param] = preferredWork(controls.targetFrameMs, mapDef.workBudget);
      presentation.syncBudget(controls.targetFrameMs, params[mapDef.workBudget.param]);
      return;
    }
    const capPx = maxBudgetPx(display);
    const next = nextWorkBudget(
      { shortPx: settledPx, work: params[mapDef.workBudget.param] },
      lastRefineMs,
      controls.targetFrameMs,
      display,
      mapDef.workBudget,
      capPx,
    );
    settledPx = Math.min(capPx, next.shortPx);
    params[mapDef.workBudget.param] = next.work;
    presentation.syncBudget(controls.targetFrameMs, next.work);
  }

  function requestVisible(): void {
    wantHalo = false;
    wantRefine = true;
    renderGen += 1;
  }

  function presentMotion(coasting: boolean): void {
    applyShift();
    drawChrome();
    syncZoomBar();
    // Gesture is still moving: only CSS-shift (and a parked halo). Never start a
    // budgeted pass here — that is what made desktop pan hitch.
    if (coverageInset() < 0) promoteParked();
    if (isUnzoom(computedView, view)) {
      unzoomTarget = copyView(world);
      void prefetchUnzoom(world);
    }
    if (!coasting) gestureActive = true;
  }

  function scheduleView(opts: { immediate?: boolean; navigating?: boolean; coasting?: boolean }): void {
    window.clearTimeout(viewTimer);
    if (opts.coasting || opts.navigating) {
      // Pointer events can outpace the display. Keep the newest logical view, but
      // touch layout, CSS, controls, and overlays only once per animation frame.
      pendingMotion = { coasting: Boolean(opts.coasting) };
      if (!viewFrame) {
        viewFrame = requestAnimationFrame(() => {
          viewFrame = 0;
          const motion = pendingMotion;
          pendingMotion = null;
          if (motion) presentMotion(motion.coasting);
        });
      }
      return;
    }
    if (viewFrame) cancelAnimationFrame(viewFrame);
    viewFrame = 0;
    pendingMotion = null;
    applyShift();
    drawChrome();
    syncZoomBar();
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
    presentation.reset();
    drawChrome();
    presentation.noteActivity();
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
    if (tiledInset(view, parkedCover, navigation) < 0) return false;
    if (!force && coverageInset() >= 0) return false;
    computedView = parkedCover;
    lastOverscanPad = parkedPad;
    parkedCover = null;
    parkedPad = 0;
    swapMapCanvases();
    applyShift();
    drawChrome();
    return true;
  }

  function applyShift(): void {
    const cover = alignViewY(computedView, view, navigation);
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
    presentation.draw();
  }

  function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const box = clip.getBoundingClientRect();
    return {
      x: view.xMin + ((clientX - box.left) / box.width) * viewSpanX(view),
      y: view.yMin + ((clientY - box.top) / box.height) * viewSpanY(view),
    };
  }

  function snapWorld(p: { x: number; y: number }): { x: number; y: number } {
    const q = wrapPointToCover(p, computedView, navigation);
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
      const landing = foldViewY(target, navigation);
      forcedView = from
        ? unionView(alignViewY(foldViewY(from, navigation), landing, navigation), landing)
        : landing;
      forcedUnit = unzoomTarget ? foldViewY(view, navigation) : landing;
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
    const landing = foldViewY(target, navigation);
    const have = widestCover();
    const next = nextUnzoomCover(have, landing, navigation);
    const look = lookaheadParams(next);
    const haveAligned = alignViewY(foldViewY(have, navigation), landing, navigation);
    const spatialDone = tiledInset(landing, haveAligned, navigation) >= 0;
    const need = spatialDone ? landing : next;
    if (forcedView && tiledInset(need, forcedView, navigation) >= -0.02) return waitForced();
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
    if (atDefaultView(view, world, navigation)) {
      if (!viewsEqual(view, world)) {
        view = copyView(world);
        applyShift();
        drawChrome();
        syncZoomBar();
      }
      return;
    }
    const folded = foldViewY(view, navigation);
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
    const folded = foldViewY(view, navigation);
    if (!viewsEqual(folded, view)) {
      view = folded;
      applyShift();
    }
    if (!atDefaultView(view, world, navigation)) history.push(copyView(view));
    resetFromView = copyView(view);
    resetParamFrom = { ...params };
    resetParamTo = {
      ...defaultParams(mapDef),
      [mapDef.workBudget.param]: params[mapDef.workBudget.param],
    };
    resetEase = 0;
    lastCoverParams = null;
    unzoomTarget = copyView(world);
    presentation.reset();
    markPrefsDirty();
    void prefetchUnzoom(unzoomTarget);
  }

  function resetHomeTick(eased: number): void {
    resetEase = eased;
    if (resetFromView) {
      const desired = eased >= 1
        ? copyView(world)
        : lerpViewShortY(resetFromView, world, eased, navigation);
      const cover = widestCover();
      if (tiledInset(desired, cover, navigation) >= 0) view = desired;
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
      const desired = lerpViewShortY(from, target, easeInOutCubic(u), navigation);
      if (unzoomTarget) {
        if (coverageInset() < 0) promoteParked();
        const cover = widestCover();
        if (tiledInset(desired, cover, navigation) < 0 && held < SMOOTH_ZOOM_MS) {
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
      presentation.noteActivity();
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
    const landing = foldViewY(next, navigation);
    const token = zoomToken;
    unzoomTarget = landing;
    const grown = lerpViewShortY(view, landing, 0.05, navigation);
    const have = widestCover();
    const begin = (): void => {
      if (token !== zoomToken) return;
      promoteParked();
      animateViewTo(next, then);
    };
    if (tiledInset(grown, have, navigation) >= 0) {
      void prefetchUnzoom(landing);
      begin();
      return;
    }
    void prefetchUnzoom(landing).then(begin);
  }

  function applyView(next: ViewRect, opts?: { pushHistory?: boolean; animate?: boolean; immediate?: boolean; navigating?: boolean; coasting?: boolean; keepPrefetch?: boolean }): void {
    presentation.noteActivity();
    if (opts?.navigating || opts?.coasting) gestureActive = true;
    if (!opts?.coasting) stopCoast();
    if (opts?.animate) cancelAnim();
    if (!opts?.coasting && !opts?.keepPrefetch) cancelPrefetch();
    if (opts?.pushHistory && !viewsEqual(next, view)) history.push(copyView(view));
    markPrefsDirty();
    if (opts?.animate) {
      const landing = foldViewY(next, navigation);
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

  stopCoast = bindMapInput(clip, {
    getView: () => view,
    getWorld: () => world,
    getNavigation: () => navigation,
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
      presentation.noteActivity();
    },
    pickPoint(x, y, clientX, clientY) {
      return presentation.pickPoint(x, y, clientX, clientY);
    },
    prefetchView(target) {
      if (animating) return;
      if (isUnzoom(view, target)) {
        unzoomTarget = foldViewY(target, navigation);
        void prefetchUnzoom(unzoomTarget);
        return;
      }
      const landing = foldViewY(target, navigation);
      if (forcedView && tiledInset(landing, forcedView, navigation) > 0.05) return;
      if (parkedCover && tiledInset(landing, parkedCover, navigation) > 0.05) return;
      if (!forcedView && !parkedCover && tiledInset(landing, computedView, navigation) > OVERSCAN_RELOAD * 0.5) return;
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
    dismissUi() {
      presentation.dismiss();
    },
  }).stopCoast;

  function buttonZoom(factor: number): void {
    const c = viewCenter(view);
    applyView(zoomAbout(view, c.x, c.y, factor, world, navigation), { pushHistory: true, animate: true });
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
    world = worldFromDisplay(display.width, display.height, mapDef.defaultView);
    view = atWorld
      ? copyView(world)
      : fitViewAspect(view, display.width, display.height, world, navigation);
    for (let i = 0; i < history.length; i++) {
      history[i] = fitViewAspect(history[i], display.width, display.height, world, navigation);
    }
    if (atWorld) history[0] = copyView(world);
    if (resized) requestVisible();
    applyShift();
    presentation.resize();
    syncZoomBar();
    if (resized) presentation.noteActivity();
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
    if (!live && !unzoomPass) {
      parkedCover = null;
      parkedPad = 0;
    }
    try {
      const vis = computeSize(display, live ? paramPreviewPx() : settledPx);
      const haloBase = computeSize(display, cssShortPx(display));
      const textureLimit = Math.min(MAX_OVERSCAN_PX, gpuOk.device.limits.maxTextureDimension2D);
      // A halo is useful only if promoting it does not make the visible map
      // coarser. On very large displays, reduce its width before its density.
      const pad = padded ? densityPreservingPad(vis, OVERSCAN_PAD, textureLimit) : 0;
      const unit = foldViewY(forcedUnit ?? view, navigation);
      const source = foldViewY(forced ?? view, navigation);
      const renderView = pad > 0 ? padViewWith(source, pad, unit) : copyView(source);
      const foldedVis = foldViewY(view, navigation);
      const normView = {
        xMin: Math.max(renderView.xMin, foldedVis.xMin),
        xMax: Math.min(renderView.xMax, foldedVis.xMax),
        yMin: Math.max(renderView.yMin, foldedVis.yMin),
        yMax: Math.min(renderView.yMax, foldedVis.yMax),
      };
      const normOk = normView.xMax > normView.xMin && normView.yMax > normView.yMin;
      const rx = viewSpanX(renderView) / Math.max(viewSpanX(unit), 1e-12);
      const ry = viewSpanY(renderView) / Math.max(viewSpanY(unit), 1e-12);
      const size = scaleSize(padded ? vis : unzoomPass ? haloBase : vis, Math.max(1, rx, ry), textureLimit);
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
        && tiledInset(view, computedView, navigation) >= 0;
      const newCovers = tiledInset(view, renderView, navigation) >= 0;
      if (padded && newCovers && (visCovers || gestureActive) && !unzoomTarget) {
        parkedCover = renderView;
        parkedPad = pad;
        if (forced) {
          lastCoverParams = passParams;
          notifyForcedDone();
        }
      } else {
        swapMapCanvases();
        computedView = renderView;
        if (unzoomPass) {
          parkedCover = null;
          parkedPad = 0;
        }
        lastOverscanPad = pad;
        lastUnitSpan = { x: viewSpanX(unit), y: viewSpanY(unit) };
        if (forced) {
          lastCoverParams = passParams;
          notifyForcedDone();
        } else if (!padded && !live) {
          const prevPx = settledPx;
          const prevWork = params[mapDef.workBudget.param];
          applyBudget();
          markPrefsDirty();
          if (
            (settledPx > prevPx || params[mapDef.workBudget.param] > prevWork)
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
    presentation.tick(now);
    requestAnimationFrame(tick);
  }

  drawChrome();
  presentation.noteActivity();
  requestAnimationFrame(tick);
}
