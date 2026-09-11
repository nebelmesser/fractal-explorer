import { onUiChange, t } from '../i18n';
import {
  BUTTON_ZOOM_FACTOR,
  MEDIAN_DEFAULT,
  MIN_COMPUTE_PX,
  MIN_VIEW_SPAN,
  MIN_VIEW_SPAN_F64,
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
import { CpuMapRenderer } from '../cpu/compute';
import {
  copyView,
  defaultParams,
  lerpParams,
  padViewWith,
  unionView,
  viewAround,
  viewsEqual,
  viewSpanX,
  viewSpanY,
  type MapParams,
  type ViewRect,
  type MapDefinition,
} from '../maps/types';
import { computeSize, cssShortPx, densityPreservingPad, fitMapDisplay, maxBudgetPx, nextWorkBudget, preferredWork, scaleSize, snapComputePx } from './budget';
import { bindMapInput, type ViewOpts } from './input';
import { bindPrefs, consumeResetQuery, loadPrefs, markPrefsDirty } from './prefs';
import {
  emptyPresentation,
  type MapPresentation,
  type MapPresentationFactory,
  type ViewerControls,
  type ViewerSignals,
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
  zoomAbout,
  shortSpan,
} from './view';

/** WebGPU presents a frame later than CSS. Wait until the hidden canvas has pixels. */
function waitForPresent(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function sameView(a: ViewRect, b: ViewRect): boolean {
  return a.xMin === b.xMin && a.xMax === b.xMax
    && a.yMin === b.yMin && a.yMax === b.yMax;
}

const VIEW_QUERY_KEYS = ['x', 'y', 'span'] as const;

/** Read an exact map camera from a shareable URL. Values are radians. */
function viewFromQuery(
  world: ViewRect,
  width: number,
  height: number,
  navigation: MapDefinition['navigation'],
  minSpan: number,
): ViewRect | null {
  const query = new URLSearchParams(location.search);
  const rawX = query.get('x');
  const rawY = query.get('y');
  const rawSpan = query.get('span');
  if (rawX === null || rawY === null || rawSpan === null) return null;
  const x = Number(rawX);
  const y = Number(rawY);
  const span = Number(rawSpan);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(span) || !(span > 0)) return null;
  const clamped = Math.min(shortSpan(world), Math.max(minSpan, span));
  return fitViewAspect(viewAround(x, y, clamped, clamped), width, height, world, navigation ?? {});
}

/** Keep the live camera in the URL without adding a history entry per frame. */
function replaceViewQuery(view: ViewRect): void {
  const url = new URL(location.href);
  const center = viewCenter(view);
  const values = [center.x, center.y, shortSpan(view)];
  let changed = false;
  for (let i = 0; i < VIEW_QUERY_KEYS.length; i++) {
    const value = String(values[i]);
    if (url.searchParams.get(VIEW_QUERY_KEYS[i]) === value) continue;
    url.searchParams.set(VIEW_QUERY_KEYS[i], value);
    changed = true;
  }
  if (changed) history.replaceState(history.state, '', url);
}

export async function bootViewer(
  mapDef: MapDefinition,
  presentationFactory?: MapPresentationFactory,
  signals?: ViewerSignals,
): Promise<void> {
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
  if (!gpu && !mapDef.cpu) {
    console.error('No GPU and no CPU map path');
    return;
  }
  const minSpan = mapDef.cpu ? MIN_VIEW_SPAN_F64 : MIN_VIEW_SPAN;

  await presentationFactory?.init?.();

  const preferencesKey = mapDef.preferencesKey ?? `fractal-explorer:${mapDef.id}`;
  consumeResetQuery(preferencesKey);
  const saved = loadPrefs(preferencesKey);
  const params: MapParams = { ...defaultParams(mapDef), ...saved?.params };
  params[mapDef.workBudget.param] = preferredWork(saved?.targetFrameMs ?? TARGET_FRAME_MS, mapDef.workBudget);
  let display = fitMapDisplay(stage);
  let world = worldFromDisplay(display.width, display.height, mapDef.defaultView);
  let view: ViewRect = viewFromQuery(
    world,
    display.width,
    display.height,
    navigation,
    minSpan,
  ) ?? copyView(world);
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
  let parameterRenderPending = false;
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
  let viewQueryTimer = 0;
  let pendingMotion: { coasting: boolean } | null = null;

  const controls: ViewerControls = {
    params,
    invert: saved?.invert ?? false,
    median: MEDIAN_DEFAULT,
    targetFrameMs: saved?.targetFrameMs ?? TARGET_FRAME_MS,
  };

  let frontCanvas = mapCanvas;
  let backCanvas = mapBack;
  frontCanvas.setAttribute('aria-label', t('map'));
  onUiChange(() => {
    frontCanvas.setAttribute('aria-label', t('map'));
  });
  let renderer: GpuMapRenderer | CpuMapRenderer;
  if (gpu) {
    try {
      renderer = await GpuMapRenderer.create(gpu, backCanvas, mapDef);
    } catch (error) {
      console.error(error);
      if (!mapDef.cpu) {
        console.error(error);
        return;
      }
      // A failed WebGPU context locks that canvas to its original context
      // type. Replace the unused back buffer before switching to Canvas 2D.
      const replacement = backCanvas.cloneNode(false) as HTMLCanvasElement;
      backCanvas.replaceWith(replacement);
      backCanvas = replacement;
      renderer = CpuMapRenderer.create(frontCanvas, mapDef);
    }
  } else {
    renderer = CpuMapRenderer.create(backCanvas, mapDef);
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
      instant: resetHomeInstant,
      cancel: resetHomeCancel,
      isAway: () => !atDefaultView(view, world, navigation),
    },
    getView: () => view,
    setView: (next, opts) => applyView(next, opts),
    settleView: settleCamera,
    clientToWorld,
    snapToRenderedPixel: snapWorld,
    renderedPixelNeighbors: (p) => renderer.renderedPixelNeighbors(p),
    snapToPrecisionGrid: (p) => renderer.snapPrecision(p),
    renderedSampleGrid: (targetCellPx, maxCount) => renderer.renderedSampleGrid(
      view,
      Math.max(1, frontCanvas.width),
      Math.max(1, frontCanvas.height),
      targetCellPx,
      maxCount,
    ),
    samplesF64: () => renderer.samplesF64(
      view,
      Math.max(1, frontCanvas.width),
      Math.max(1, frontCanvas.height),
    ),
    precisionGrid: () => renderer.precisionGrid(
      view,
      Math.max(1, frontCanvas.width),
      Math.max(1, frontCanvas.height),
    ),
    signals,
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
    zoomIn.disabled = !canZoomIn(view, minSpan);
    zoomOut.disabled = !canZoomOut(view, world);
    zoomReset.disabled = !canZoomOut(view, world) && atDefaultView(view, world, navigation);
  }

  function noteCamera(prev: ViewRect, next: ViewRect, kind?: 'reset' | 'back'): void {
    if (kind === 'back') signals?.emit('history-back');
    if (viewsEqual(prev, next)) return;
    const before = shortSpan(prev);
    const after = shortSpan(next);
    if (after < before * 0.99) signals?.emit('zoom-in');
    else if (after > before * 1.01) signals?.emit('zoom-out');
    else signals?.emit('pan');
    if (canZoomIn(prev, minSpan) && !canZoomIn(next, minSpan)) signals?.emit('zoom-limit');
  }

  let mapReadySent = false;

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
    const currentSize = computeSize(display, settledPx);
    if (renderer.samplesF64(foldViewY(view, navigation), currentSize.width, currentSize.height)) {
      // Progressive CPU work has no synchronous full-frame duration. Keep the
      // last settled pixel/iteration budget instead of changing parameters and
      // invalidating already computed f64 tiles on the next interaction.
      presentation.syncBudget(controls.targetFrameMs, params[mapDef.workBudget.param]);
      return;
    }
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
    applyShift(true);
    drawChrome();
    syncZoomBar();
    // Cached world tiles are composited immediately. Missing fine cells refine
    // in the renderer without lowering the resolution of cached cells.
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
    parameterRenderPending = true;
    if (phase === 'live' || phase === 'reset') {
      paramDragging = true;
      wantHalo = false;
      wantRefine = true;
      // Every slider value supersedes the in-flight tile generation. A running
      // pass may finish on the GPU, but it must never consume the final redraw.
      renderGen += 1;
      if (!rendering) void renderOnce();
      return;
    }
    paramDragging = false;
    applyBudget();
    requestVisible();
    if (!rendering) void renderOnce();
  }

  function swapMapCanvases(): void {
    mapShift.appendChild(backCanvas);
    backCanvas.classList.remove('map-pending');
    backCanvas.classList.add('is-front');
    backCanvas.setAttribute('aria-label', t('map'));
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

  function applyShift(moving = animating || gestureActive): void {
    mapShift.style.transform = 'none';
    delete mapShift.dataset.lockTransform;
    window.clearTimeout(viewQueryTimer);
    viewQueryTimer = window.setTimeout(() => replaceViewQuery(view), moving ? 100 : 0);
    if (frontCanvas.dataset.ready === '1') {
      renderer.setCanvas(frontCanvas);
      renderer.present(
        view,
        params,
        Math.max(1, frontCanvas.width),
        Math.max(1, frontCanvas.height),
        controls.invert,
        controls.median,
        moving,
      );
    }
    computedView = copyView(view);
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
    return renderer.snapWorld(p);
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
    const landing = foldViewY(target, navigation);
    const source = from
      ? unionView(alignViewY(foldViewY(from, navigation), landing, navigation), landing)
      : landing;
    const size = computeSize(display, settledPx);
    return renderer.prefetch(source, lookParams ?? params, size.width, size.height);
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
    const size = computeSize(display, settledPx);
    return renderer.prefetch(landing, lookaheadParams(landing) ?? params, size.width, size.height);
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
  }

  function resetHomeTick(eased: number): void {
    resetEase = eased;
    if (resetFromView) {
      const desired = eased >= 1
        ? copyView(world)
        : lerpViewShortY(resetFromView, world, eased, navigation);
      view = desired;
    }
    applyShift();
    drawChrome();
    syncZoomBar();
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

  /** Jump home without starting the progressive reset prefetch pipeline. */
  function resetHomeInstant(): void {
    stopCoast();
    cancelAnim();
    cancelPrefetch();
    gestureActive = false;
    const folded = foldViewY(view, navigation);
    if (!atDefaultView(folded, world, navigation)) history.push(copyView(folded));
    view = copyView(world);
    resetFromView = null;
    resetParamFrom = null;
    resetParamTo = null;
    resetEase = 1;
    unzoomTarget = null;
    lastCoverParams = null;
    parkedCover = null;
    parkedPad = 0;
    applyShift();
    syncZoomBar();
    markPrefsDirty();
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
    const origin = performance.now();
    animating = true;
    const step = (now: number): void => {
      if (token !== zoomToken) return;
      const u = Math.min(1, (now - origin) / SMOOTH_ZOOM_MS);
      const desired = lerpViewShortY(from, target, easeInOutCubic(u), navigation);
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
    const begin = (): void => {
      if (token !== zoomToken) return;
      animateViewTo(next, then);
    };
    // Do not enqueue simulation before animation: even a background compute
    // dispatch would make cached-LOD presentation miss frames.
    begin();
  }

  function settleCamera(): void {
    gestureActive = false;
    unzoomTarget = null;
    scheduleView({ immediate: true });
  }

  function applyView(next: ViewRect, opts?: ViewOpts): void {
    if (!opts?.quiet && !opts?.coasting) noteCamera(view, next);
    if (!opts?.quiet) presentation.noteActivity();
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
    getMinSpan: () => minSpan,
    setView(next, opts) {
      applyView(next, opts);
    },
    popHistory() {
      if (history.length <= 1) return;
      const prev = copyView(view);
      stopCoast();
      cancelZoomAnim();
      history.pop();
      view = copyView(history[history.length - 1]);
      noteCamera(prev, view, 'back');
      markPrefsDirty();
      scheduleView({ immediate: true });
      presentation.noteActivity();
    },
    pickPoint(x, y, clientX, clientY) {
      return presentation.pickPoint(x, y, clientX, clientY);
    },
    prefetchView(target) {
      const size = computeSize(display, settledPx);
      void renderer.prefetch(foldViewY(target, navigation), params, size.width, size.height);
    },
    interrupt() {
      cancelZoomAnim();
    },
    settleView() {
      settleCamera();
    },
    dismissUi() {
      presentation.dismiss();
    },
  }).stopCoast;

  function buttonZoom(factor: number): void {
    const c = viewCenter(view);
    applyView(zoomAbout(view, c.x, c.y, factor, world, navigation, minSpan), { pushHistory: true, animate: true });
  }

  zoomOut.addEventListener('click', () => buttonZoom(1 / BUTTON_ZOOM_FACTOR));
  zoomIn.addEventListener('click', () => buttonZoom(BUTTON_ZOOM_FACTOR));
  zoomReset.addEventListener('click', () => {
    signals?.emit('zoom-reset');
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
    if (rendering || (!wantRefine && !wantHalo)) return;
    const requestedView = copyView(view);
    const live = paramDragging;
    const parameterFrame = parameterRenderPending;
    parameterRenderPending = false;
    const gen = renderGen;
    rendering = true;
    renderingLive = live;
    wantRefine = false;
    wantHalo = false;
    try {
      const size = computeSize(display, live ? paramPreviewPx() : settledPx);
      // Parameter generations render off-screen. Resizing/configuring a visible
      // WebGPU canvas clears it immediately, before the submitted frame arrives.
      const targetCanvas = parameterFrame ? backCanvas : frontCanvas;
      renderer.setCanvas(targetCanvas);
      const ms = await renderer.render(
        foldViewY(requestedView, navigation),
        params,
        size.width,
        size.height,
        controls.invert,
        controls.median,
      );
      if (gen != renderGen) return;
      // Motion presentations do not increment renderGen until the gesture
      // settles. An async frame that began before that motion must not swap a
      // parked canvas or mark the new camera as already rendered.
      if (!sameView(view, requestedView)) return;
      if (live) lastParamMapMs = ms;
      else lastRefineMs = ms;
      await waitForPresent();
      if (gen != renderGen) return;
      if (!sameView(view, requestedView)) return;
      if (parameterFrame) swapMapCanvases();
      computedView = copyView(view);
      lastOverscanPad = 0;
      lastUnitSpan = { x: viewSpanX(view), y: viewSpanY(view) };
      applyShift(false);
      syncZoomBar();
      drawChrome();
      if (!live && !mapReadySent) {
        mapReadySent = true;
        signals?.set('map_ready', true);
        signals?.emit('map-ready');
      }
      if (!live) {
        const prevPx = settledPx;
        const prevWork = params[mapDef.workBudget.param];
        applyBudget();
        markPrefsDirty();
        if (
          (settledPx > prevPx || params[mapDef.workBudget.param] > prevWork)
          && lastRefineMs < controls.targetFrameMs * 0.85
        ) {
          wantRefine = true;
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      rendering = false;
      renderingLive = false;
      // Do not rely on the animation-frame loop to notice a parameter update
      // that arrived while the previous GPU pass was completing.
      if (wantRefine || wantHalo) queueMicrotask(() => void renderOnce());
    }
  }

  function tick(now: number): void {
    if (wantRefine || wantHalo) {
      if (!rendering) void renderOnce();
    }
    presentation.tick(now);
    requestAnimationFrame(tick);
  }

  drawChrome();
  presentation.noteActivity();
  requestAnimationFrame(tick);

  function typingInField(): boolean {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return false;
    return el.tagName === 'INPUT'
      || el.tagName === 'TEXTAREA'
      || el.tagName === 'SELECT'
      || el.isContentEditable;
  }

  function setChromeHidden(hidden: boolean): void {
    if (document.body.classList.contains('is-chrome-hidden') === hidden) return;
    document.body.classList.toggle('is-chrome-hidden', hidden);
    if (hidden) presentation.dismiss();
    presentation.resize();
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const toggle = key === 'f' || event.code === 'KeyF' || key === 'Escape';
    if (!toggle) return;
    if (key === 'Escape' && document.getElementById('ui-container')?.classList.contains('is-open')) {
      event.preventDefault();
      presentation.dismiss();
      return;
    }
    if (typingInField() && key !== 'Escape') return;
    event.preventDefault();
    setChromeHidden(!document.body.classList.contains('is-chrome-hidden'));
  });
}
