import './style.css';
import {
  BUTTON_ZOOM_FACTOR,
  LIVE_ZOOM_MS,
  MEDIAN_DEFAULT,
  OVERSCAN_PAD,
  OVERSCAN_RELOAD,
  OVERVIEW_PX,
  PROBE_ALPHA,
  PROBE_CROSS_PX,
  PROBE_DIVERGE_DEG,
  PROBE_ESTIMATE_STEPS,
  PROBE_HIT_PX,
  PROBE_MAX_STEPS,
  PROBE_PLAY_FPS,
  PROBE_PIVOT_DOWN_PX,
  PROBE_PIVOT_R,
  PROBE_PX_PER_LEN,
  PROBE_SEP_PX,
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
  lerpView,
  padView,
  unpadView,
  viewInset,
  viewsEqual,
  type MapParams,
  type ViewRect,
} from './maps/types';
import { createTrajectory, initMapCore, type Trajectory } from './wasm/core';
import { computeSize, fitMapDisplay, nextWorkBudget, preferredIters, scaleSize, snapComputePx } from './viewer/budget';
import { bindMapInput } from './viewer/input';
import { bindMenu, syncBudgetReadout, type ExplorerControls } from './viewer/menu';
import { drawMapAxes } from './viewer/axes';
import { drawOverviewFrame } from './viewer/minimap';
import { bindPrefs, consumeResetQuery, loadPrefs, markPrefsDirty } from './viewer/prefs';
import {
  drawOverlayFly,
  drawOverlayPendulum,
  drawProbeCross,
  drawProbePivot,
  firstBobSpeed,
  flyOffscreen,
  startFly,
  stepFly,
  type FlyState,
} from './maps/pendulum/preview';
import {
  canZoomIn,
  canZoomOut,
  easeInOutCubic,
  fitViewAspect,
  viewCenter,
  viewSpanX,
  viewSpanY,
  worldFromDisplay,
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
  const miniCanvas = document.getElementById('minimap') as HTMLCanvasElement;
  const miniOverlay = document.getElementById('minimap-overlay') as HTMLCanvasElement;
  const axesCanvas = document.getElementById('map-axes') as HTMLCanvasElement | null;
  const overlayCanvas = document.getElementById('probe-overlay') as HTMLCanvasElement | null;
  const scaleX = document.getElementById('map-scale-x');
  const scaleY = document.getElementById('map-scale-y');
  const shiftEl = document.getElementById('map-shift');
  const zoomOutEl = document.getElementById('zoom-out') as HTMLButtonElement | null;
  const zoomInEl = document.getElementById('zoom-in') as HTMLButtonElement | null;
  const zoomResetEl = document.getElementById('zoom-reset') as HTMLButtonElement | null;
  if (!mapCanvas || !mapBack || !mapClip || !stage || !sidebar || !miniCanvas || !miniOverlay || !axesCanvas || !overlayCanvas || !scaleX || !scaleY || !shiftEl || !zoomInEl || !zoomOutEl || !zoomResetEl) {
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
  let probes: [Trajectory, Trajectory] | null = null;
  let flies: [FlyState | null, FlyState | null] = [null, null];
  let probePlaying = false;
  let probeView: ViewRect | null = null;
  let probeSimTime = 0;
  let probePlayAcc = 0;
  let probePlayLast = 0;
  let probeDivergeSec: number | null = null;
  let divergeJob: {
    key: string;
    a: Trajectory;
    b: Trajectory;
    time: number;
    result: number | null;
    done: boolean;
  } | null = null;
  let stopCoast = (): void => {};
  let rendering = false;
  let wantRefine = true;
  let wantHalo = false;
  let renderGen = 0;
  let lastRefineMs = Infinity;
  let overviewKey = '';
  let zoomToken = 0;
  let lastRenderSize = { width: 0, height: 0 };
  let lastOverscanPad = 0;
  let forcedView: ViewRect | null = null;
  let forcedDone: (() => void) | null = null;

  const controls: ExplorerControls = {
    params,
    invert: saved?.invert ?? false,
    median: saved?.median ?? MEDIAN_DEFAULT,
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
  let overview: GpuMapRenderer | null = null;

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
    zoomReset.disabled = !canZoomOut(view, world) && viewsEqual(view, world);
  }

  function scaleDrift(): number {
    const expected = Math.max(1e-6, 1 + 2 * lastOverscanPad);
    const rx = viewSpanX(computedView) / viewSpanX(view);
    const ry = viewSpanY(computedView) / viewSpanY(view);
    return Math.max(Math.abs(rx / expected - 1), Math.abs(ry / expected - 1));
  }

  function screenPx(): number {
    return snapComputePx(Math.min(display.width, display.height));
  }

  function applyBudget(): void {
    if (!Number.isFinite(lastRefineMs)) {
      params.MAX_ITERATIONS = preferredIters(controls.targetFrameMs);
      syncBudgetReadout(controls.targetFrameMs, params.MAX_ITERATIONS);
      return;
    }
    const next = nextWorkBudget(
      { shortPx: settledPx, iters: params.MAX_ITERATIONS },
      lastRefineMs,
      controls.targetFrameMs,
      display,
    );
    settledPx = Math.min(screenPx(), next.shortPx);
    params.MAX_ITERATIONS = next.iters;
    syncBudgetReadout(controls.targetFrameMs, params.MAX_ITERATIONS);
  }

  function requestVisible(): void {
    wantHalo = false;
    wantRefine = true;
    renderGen += 1;
  }

  function scheduleView(opts: { immediate?: boolean; navigating?: boolean }): void {
    window.clearTimeout(viewTimer);
    applyShift();
    drawChrome();
    syncZoomBar();
    if (opts.immediate) {
      requestVisible();
      return;
    }
    const zoomed = scaleDrift() > 0.04;
    const inset = viewInset(view, computedView);
    if (zoomed) {
      viewTimer = window.setTimeout(() => requestVisible(), VIEW_DEBOUNCE_MS);
      return;
    }
    // Still on the last halo: CSS only, until the remaining pad is thin.
    if (inset < 0) {
      requestVisible();
      return;
    }
    if (inset < OVERSCAN_RELOAD && lastOverscanPad > 0) {
      wantHalo = true;
    }
  }

  function scheduleParams(): void {
    overviewKey = '';
    resetProbes();
    applyBudget();
    requestVisible();
  }

  function applyShift(): void {
    const sx = viewSpanX(computedView) / viewSpanX(view);
    const sy = viewSpanY(computedView) / viewSpanY(view);
    const cc = viewCenter(computedView);
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
      leftX: origins[0].x,
      rightX: origins[1].x,
      leftRad: worlds[0].x,
      rightRad: worlds[1].x,
      leftY: origins[0].y,
      rightY: origins[1].y,
      leftYRad: worlds[0].y,
      rightYRad: worlds[1].y,
      divergeText: divergeReadout(),
    });
    drawOverviewFrame(miniOverlay, mapDef.defaultView, view);
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
    const nx = (p.x - computedView.xMin) / viewSpanX(computedView);
    const ny = (p.y - computedView.yMin) / viewSpanY(computedView);
    const texel = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 ? renderer.mapTexel(nx, ny) : null;
    if (!texel) return p;
    const xDen = Math.max(texel.width - 1, 1);
    const yDen = Math.max(texel.height - 1, 1);
    return {
      x: computedView.xMin + (viewSpanX(computedView) * texel.ix) / xDen,
      y: computedView.yMin + (viewSpanY(computedView) * texel.iy) / yDen,
    };
  }

  function probeOrigins(): [{ x: number; y: number }, { x: number; y: number }] {
    const box = clip.getBoundingClientRect();
    const cx = box.width / 2;
    const cy = box.height / 2;
    const half = PROBE_SEP_PX / 2;
    return [
      { x: cx - half, y: cy },
      { x: cx + half, y: cy },
    ];
  }

  function probeWorlds(): [{ x: number; y: number }, { x: number; y: number }] {
    const box = clip.getBoundingClientRect();
    const [left, right] = probeOrigins();
    return [
      snapWorld(clientToWorld(box.left + left.x, box.top + left.y)),
      snapWorld(clientToWorld(box.left + right.x, box.top + right.y)),
    ];
  }

  function inProbeHit(clientX: number, clientY: number): boolean {
    const box = clip.getBoundingClientRect();
    const dx = clientX - (box.left + box.width / 2);
    const dy = clientY - (box.top + box.height / 2);
    return Math.hypot(dx, dy) <= PROBE_HIT_PX;
  }

  function playParams(): MapParams {
    return { ...params, MAX_ITERATIONS: PROBE_MAX_STEPS };
  }

  function probeDt(): number {
    return params.DT;
  }

  function resetProbes(): void {
    probes = null;
    flies = [null, null];
    probePlaying = false;
    probeView = null;
    probeSimTime = 0;
    probePlayAcc = 0;
    probeDivergeSec = null;
  }

  function divergeRad(): number {
    return PROBE_DIVERGE_DEG * Math.PI / 180;
  }

  function noteDiverge(): void {
    if (!probes || probeDivergeSec != null) return;
    if (Math.abs(probes[0].th1 - probes[1].th1) > divergeRad()) {
      probeDivergeSec = probeSimTime;
    }
  }

  function estimateKey(worlds: [{ x: number; y: number }, { x: number; y: number }]): string {
    return [
      worlds[0].x, worlds[0].y, worlds[1].x, worlds[1].y,
      params.L1, params.L2, params.M1, params.M2, params.G, params.F ?? 0, params.DT,
    ].join(',');
  }

  function ensureEstimate(worlds: [{ x: number; y: number }, { x: number; y: number }]): void {
    const key = estimateKey(worlds);
    if (divergeJob?.key === key) return;
    const a = createTrajectory(worlds[0].x, worlds[0].y);
    const b = createTrajectory(worlds[1].x, worlds[1].y);
    divergeJob = { key, a, b, time: 0, result: null, done: false };
    if (Math.abs(a.th1 - b.th1) > divergeRad()) {
      divergeJob.result = 0;
      divergeJob.done = true;
    }
  }

  function stepEstimate(): void {
    if (!divergeJob || divergeJob.done) return;
    const next = playParams();
    const limit = divergeRad();
    for (let i = 0; i < PROBE_ESTIMATE_STEPS; i++) {
      const dt = probeDt();
      divergeJob.a.step(next, dt);
      divergeJob.b.step(next, dt);
      divergeJob.time += dt;
      if (Math.abs(divergeJob.a.th1 - divergeJob.b.th1) > limit) {
        divergeJob.result = divergeJob.time;
        divergeJob.done = true;
        return;
      }
      if (divergeJob.a.done && divergeJob.b.done) {
        divergeJob.result = null;
        divergeJob.done = true;
        return;
      }
    }
  }

  function predictedDivergeSec(): number | null {
    if (probeDivergeSec != null) return probeDivergeSec;
    if (divergeJob?.done) return divergeJob.result;
    return null;
  }

  /** Wall-clock seconds of a 24 fps play-out of this many map-DT steps. */
  function playWallSec(simSec: number): number {
    const dt = probeDt();
    if (!(dt > 0)) return 0;
    return simSec / dt / PROBE_PLAY_FPS;
  }

  function divergeReadout(): string {
    const predicted = predictedDivergeSec();
    if (probePlaying) {
      if (predicted != null) {
        return `${Math.max(0, playWallSec(predicted - probeSimTime)).toFixed(2)} seconds to diverge`;
      }
      return '… seconds to diverge';
    }
    if (predicted != null) return `${playWallSec(predicted).toFixed(2)} seconds to diverge`;
    if (divergeJob && !divergeJob.done) return '… seconds to diverge';
    return '— seconds to diverge';
  }

  function syncDivergeLabel(): void {
    const el = document.querySelector('#map-scale-x .probe-diverge');
    if (el) el.textContent = divergeReadout();
  }

  function syncProbeWorlds(): [{ x: number; y: number }, { x: number; y: number }] {
    if (probes && probeView && !viewsEqual(view, probeView)) resetProbes();
    return probeWorlds();
  }

  function launchProbes(): void {
    const [left, right] = probeWorlds();
    probes = [createTrajectory(left.x, left.y), createTrajectory(right.x, right.y)];
    flies = [null, null];
    probeView = copyView(view);
    probePlaying = true;
    probeSimTime = 0;
    probePlayAcc = 0;
    probePlayLast = performance.now();
    probeDivergeSec = null;
    noteDiverge();
    syncDivergeLabel();
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
    const snap = params.SNAP ?? 0;
    while (probePlayAcc >= frame) {
      for (let i = 0; i < 2; i++) {
        const traj = probes[i];
        traj.step(next, dt);
        if (!flies[i] && snap > 0 && firstBobSpeed(traj.w1, next.L1) >= snap) {
          flies[i] = startFly(traj.th1, traj.th2, traj.w1, traj.w2, next.L1, next.L2);
        }
        const fly = flies[i];
        if (fly) stepFly(fly, next, dt);
      }
      probeSimTime += dt;
      probePlayAcc -= frame;
      noteDiverge();
      const hanging = probes.some((traj, i) => !flies[i] && !traj.done);
      const flying = flies.some((fly) => fly && !flyOffscreen(fly, 24));
      if (!hanging && !flying) {
        probePlaying = false;
        break;
      }
    }
    syncDivergeLabel();
  }

  function drawProbes(
    origins = probeOrigins(),
    worlds = syncProbeWorlds(),
  ): void {
    const w = overlay.clientWidth;
    const h = overlay.clientHeight;
    if (w < 8 || h < 8) return;
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
    const mid = {
      x: (origins[0].x + origins[1].x) / 2,
      y: (origins[0].y + origins[1].y) / 2 + PROBE_PIVOT_DOWN_PX,
    };
    for (let i = 0; i < 2; i++) {
      const fly = flies[i];
      if (fly) {
        drawOverlayFly(ctx, mid, fly, params, PROBE_PX_PER_LEN, PROBE_ALPHA);
        continue;
      }
      const th1 = probes ? probes[i].th1 : worlds[i].x;
      const th2 = probes ? probes[i].th2 : worlds[i].y;
      drawOverlayPendulum(ctx, mid, th1, th2, params, PROBE_PX_PER_LEN, PROBE_ALPHA);
    }
    drawProbePivot(ctx, mid, PROBE_PIVOT_R);
    for (let i = 0; i < 2; i++) {
      drawProbeCross(ctx, origins[i], PROBE_CROSS_PX);
    }
  }

  function cancelZoomAnim(): void {
    zoomToken += 1;
    animating = false;
    forcedView = null;
    if (forcedDone) {
      forcedDone();
      forcedDone = null;
    }
  }

  function computeForced(target: ViewRect): Promise<void> {
    return new Promise((resolve) => {
      forcedView = copyView(target);
      forcedDone = resolve;
      requestVisible();
    });
  }

  async function resetToWorld(): Promise<void> {
    if (viewsEqual(view, world) && viewsEqual(computedView, world)) return;
    stopCoast();
    cancelZoomAnim();
    const token = zoomToken;
    if (!viewsEqual(view, world)) history.push(copyView(view));
    markPrefsDirty();
    const from = copyView(view);
    await computeForced(copyView(world));
    if (token !== zoomToken) return;
    view = from;
    applyShift();
    drawChrome();
    syncZoomBar();
    animateViewTo(copyView(world), () => {
      wantHalo = true;
      scheduleView({});
    });
  }

  function animateViewTo(target: ViewRect, then: () => void): void {
    const from = copyView(view);
    const token = zoomToken;
    const t0 = performance.now();
    animating = true;
    // Sharpen the *frozen* start texture if the GPU is idle — never the moving view.
    if (lastRefineMs < LIVE_ZOOM_MS * 2) requestVisible();
    const step = (now: number): void => {
      if (token !== zoomToken) return;
      const u = Math.min(1, (now - t0) / SMOOTH_ZOOM_MS);
      view = lerpView(from, target, easeInOutCubic(u));
      applyShift();
      drawChrome();
      syncZoomBar();
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

  function applyView(next: ViewRect, opts?: { pushHistory?: boolean; animate?: boolean; immediate?: boolean; navigating?: boolean; coasting?: boolean }): void {
    if (!opts?.coasting) stopCoast();
    cancelZoomAnim();
    if (opts?.pushHistory && !viewsEqual(next, view)) history.push(copyView(view));
    markPrefsDirty();
    if (opts?.animate) {
      animateViewTo(next, () => scheduleView({ immediate: true }));
      return;
    }
    view = next;
    scheduleView({ immediate: opts?.immediate, navigating: opts?.navigating });
  }

  bindMenu(mapDef, controls, scheduleParams);

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
    },
    pickPoint(_x, _y, clientX, clientY) {
      if (!inProbeHit(clientX, clientY)) return false;
      launchProbes();
      drawProbes();
      return true;
    },
  }).stopCoast;

  function buttonZoom(factor: number): void {
    const c = viewCenter(view);
    applyView(zoomAbout(view, c.x, c.y, factor, world), { pushHistory: true, animate: true });
  }

  zoomOut.addEventListener('click', () => buttonZoom(1 / BUTTON_ZOOM_FACTOR));
  zoomIn.addEventListener('click', () => buttonZoom(BUTTON_ZOOM_FACTOR));
  zoomReset.addEventListener('click', () => {
    void resetToWorld();
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
    if (resized) {
      requestVisible();
      overviewKey = '';
    }
    applyShift();
    drawChrome();
    syncZoomBar();
  };
  layout();
  const ro = new ResizeObserver(layout);
  ro.observe(stage);

  async function renderOnce(): Promise<void> {
    if (rendering) return;
    if (!wantRefine && !wantHalo) return;
    const zooming = animating;
    const forced = !zooming && forcedView ? copyView(forcedView) : null;
    const halo = !wantRefine && wantHalo && !zooming && !forced;
    const gen = renderGen;
    rendering = true;
    wantRefine = false;
    wantHalo = false;
    try {
      const vis = computeSize(display, settledPx);
      const pad = zooming ? lastOverscanPad : halo ? OVERSCAN_PAD : 0;
      const size = zooming && lastRenderSize.width
        ? lastRenderSize
        : halo
          ? scaleSize(vis, 1 + 2 * OVERSCAN_PAD)
          : vis;
      // Visible first; the half-screen halo waits until that texture is up.
      // Zoom keeps a frozen start texture so scale does not jump then ease back.
      // Reset computes the world map first, then the zoom-out eases that texture.
      const renderView = copyView(zooming ? computedView : padView(forced ?? view, pad));
      // Halo pixels must not move the stretch — only the current screen does.
      const normView = unpadView(renderView, pad);
      renderer.setCanvas(backCanvas);
      const ms = await renderer.render(
        renderView,
        params,
        size.width,
        size.height,
        controls.invert,
        controls.median,
        normView,
      );
      if (halo && gen !== renderGen) return;
      if (!halo) lastRefineMs = ms;
      await waitForPresent();
      if (halo && gen !== renderGen) return;
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
      computedView = renderView;
      lastRenderSize = size;
      lastOverscanPad = pad;
      if (forced) {
        forcedView = null;
        const done = forcedDone;
        forcedDone = null;
        done?.();
      } else if (!zooming && !halo) {
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
      if (!zooming && halo && viewInset(view, computedView) < OVERSCAN_RELOAD) {
        wantHalo = true;
      }
      applyShift();
      const key = JSON.stringify(params);
      if (!animating && key !== overviewKey) {
        overview ??= await GpuMapRenderer.create(gpuOk, miniCanvas, mapDef);
        await overview.render(mapDef.defaultView, params, OVERVIEW_PX, OVERVIEW_PX, controls.invert, controls.median);
        overviewKey = key;
      }
      syncZoomBar();
      drawChrome();
    } catch (error) {
      if (forced) {
        forcedView = null;
        const done = forcedDone;
        forcedDone = null;
        done?.();
      }
      console.error(error);
      const hint = document.getElementById('gpu-missing');
      if (hint) {
        hint.hidden = false;
        hint.textContent = error instanceof Error ? error.message : String(error);
      }
    } finally {
      rendering = false;
    }
  }

  function tick(now: number): void {
    if ((wantRefine || wantHalo) && !rendering) {
      void renderOnce();
    }
    const worlds = syncProbeWorlds();
    ensureEstimate(worlds);
    stepEstimate();
    if (probePlaying) {
      stepProbes(now);
      drawProbes(probeOrigins(), worlds);
    }
    syncDivergeLabel();
    requestAnimationFrame(tick);
  }

  drawChrome();
  requestAnimationFrame(tick);
}

void boot();
