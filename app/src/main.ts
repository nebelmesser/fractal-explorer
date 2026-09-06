import './style.css';
import {
  BUTTON_ZOOM_FACTOR,
  LIVE_ZOOM_MS,
  MEDIAN_DEFAULT,
  OVERSCAN_PAD,
  OVERSCAN_RELOAD,
  OVERVIEW_PX,
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
import { initMapCore } from './wasm/core';
import { computeSize, fitMapDisplay, nextWorkBudget, preferredIters, scaleSize, snapComputePx } from './viewer/budget';
import { bindMapInput, followScreenCenter } from './viewer/input';
import { bindMenu, syncBudgetReadout, type ExplorerControls } from './viewer/menu';
import { angleDigits, drawMapAxes, formatAngleDeg } from './viewer/axes';
import { drawOverviewFrame } from './viewer/minimap';
import { bindPrefs, consumeResetQuery, loadPrefs, markPrefsDirty } from './viewer/prefs';
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
  const previewCanvas = document.getElementById('preview') as HTMLCanvasElement;
  const previewSteps = document.getElementById('preview-steps');
  const previewMeta = document.getElementById('preview-meta');
  const previewSwatch = document.getElementById('preview-swatch');
  const previewTh1 = document.getElementById('preview-th1');
  const previewTh2 = document.getElementById('preview-th2');
  const axesCanvas = document.getElementById('map-axes') as HTMLCanvasElement | null;
  const scaleX = document.getElementById('map-scale-x');
  const scaleY = document.getElementById('map-scale-y');
  const shiftEl = document.getElementById('map-shift');
  const linkLine = document.getElementById('pointer-link-line') as SVGLineElement | null;
  const linkHoleEl = document.getElementById('pointer-link-hole') as SVGRectElement | null;
  const linkMaskBgEl = document.getElementById('pointer-link-mask-bg') as SVGRectElement | null;
  const zoomOutEl = document.getElementById('zoom-out') as HTMLButtonElement | null;
  const zoomInEl = document.getElementById('zoom-in') as HTMLButtonElement | null;
  const zoomResetEl = document.getElementById('zoom-reset') as HTMLButtonElement | null;
  if (!mapCanvas || !mapBack || !mapClip || !stage || !sidebar || !miniCanvas || !miniOverlay || !previewCanvas || !previewSteps || !previewMeta || !previewSwatch || !previewTh1 || !previewTh2 || !axesCanvas || !scaleX || !scaleY || !shiftEl || !linkLine || !linkHoleEl || !linkMaskBgEl || !zoomInEl || !zoomOutEl || !zoomResetEl) {
    throw new Error('Explorer DOM is incomplete');
  }
  const zoomIn = zoomInEl;
  const zoomOut = zoomOutEl;
  const zoomReset = zoomResetEl;
  const xScale = scaleX;
  const yScale = scaleY;
  const th1Readout = previewTh1;
  const th2Readout = previewTh2;
  const mapShift = shiftEl;
  const clip = mapClip;
  const stageEl = stage;
  const link = linkLine;
  const linkHole = linkHoleEl;
  const linkMaskBg = linkMaskBgEl;
  const stepsEl = previewSteps;
  const metaEl = previewMeta;
  const swatchEl = previewSwatch;
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
  let picked = viewCenter(view);
  let previewState = mapDef.pointView?.createState?.(picked, params);
  let hovering = false;
  let previewPlaying = false;
  let previewReplay = false;
  let previewPinned = false;
  let lastScreen: { x: number; y: number } | null = null;
  let lastProbeKey = '';
  let stopCoast = (): void => {};
  let idleTimer = 0;
  let rendering = false;
  let wantRefine = true;
  let wantHalo = false;
  let renderGen = 0;
  let lastRefineMs = Infinity;
  let overviewKey = '';
  let zoomToken = 0;
  let lastRenderSize = { width: 0, height: 0 };
  let lastOverscanPad = 0;
  let mapEpoch = 0;
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
    lastProbeKey = '';
    previewState = mapDef.pointView?.createState?.(picked, params);
    if (hovering || previewPinned) {
      showFinalSteps();
      armPreviewIdle();
    }
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
    if (followScreenCenter()) {
      const c = viewCenter(view);
      picked = { x: c.x, y: c.y };
      previewPinned = true;
      hovering = true;
    }
    if (hovering || previewPinned) showFinalSteps();
    const box = clip.getBoundingClientRect();
    const digits = angleDigits(view, box.width, box.height);
    th1Readout.textContent = formatAngleDeg(picked.x, digits);
    th2Readout.textContent = formatAngleDeg(picked.y, digits);
    const previewCss = Math.max(1, Math.round(previewCanvas.clientWidth));
    const previewDpr = Math.min(window.devicePixelRatio || 1, 2);
    const previewPx = Math.round(previewCss * previewDpr);
    if (previewCanvas.width !== previewPx || previewCanvas.height !== previewPx) {
      previewCanvas.width = previewPx;
      previewCanvas.height = previewPx;
    }
    const ctx = previewCanvas.getContext('2d');
    if (ctx && mapDef.pointView) mapDef.pointView.draw(ctx, picked, params, digits);
    drawMapAxes(axes, view, xScale, yScale);
    drawOverviewFrame(miniOverlay, mapDef.defaultView, view);
    updatePointerLink();
  }

  function updatePointerLink(): void {
    if (!lastScreen || metaEl.hidden) {
      link.setAttribute('visibility', 'hidden');
      return;
    }
    const stageBox = stageEl.getBoundingClientRect();
    const swatch = swatchEl.getBoundingClientRect();
    linkMaskBg.setAttribute('width', String(Math.ceil(stageBox.width)));
    linkMaskBg.setAttribute('height', String(Math.ceil(stageBox.height)));
    linkHole.setAttribute('x', String(swatch.left - stageBox.left));
    linkHole.setAttribute('y', String(swatch.top - stageBox.top));
    linkHole.setAttribute('width', String(swatch.width));
    linkHole.setAttribute('height', String(swatch.height));
    link.setAttribute('visibility', 'visible');
    link.setAttribute('x1', String(lastScreen.x - stageBox.left));
    link.setAttribute('y1', String(lastScreen.y - stageBox.top));
    link.setAttribute('x2', String(swatch.left + swatch.width / 2 - stageBox.left));
    link.setAttribute('y2', String(swatch.top + swatch.height / 2 - stageBox.top));
  }

  function worldToClient(p: { x: number; y: number }): { x: number; y: number } {
    const box = clip.getBoundingClientRect();
    return {
      x: box.left + ((p.x - view.xMin) / viewSpanX(view)) * box.width,
      y: box.top + ((p.y - view.yMin) / viewSpanY(view)) * box.height,
    };
  }

  function snapProbeToMapPixel(): void {
    const nx = (picked.x - computedView.xMin) / viewSpanX(computedView);
    const ny = (picked.y - computedView.yMin) / viewSpanY(computedView);
    const texel = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 ? renderer.mapTexel(nx, ny) : null;
    if (texel) {
      const xDen = Math.max(texel.width - 1, 1);
      const yDen = Math.max(texel.height - 1, 1);
      picked = {
        x: computedView.xMin + (viewSpanX(computedView) * texel.ix) / xDen,
        y: computedView.yMin + (viewSpanY(computedView) * texel.iy) / yDen,
      };
    }
    lastScreen = worldToClient(picked);
  }

  function setSwatch(gray: number): void {
    const g = Math.round(Math.min(255, Math.max(0, gray)));
    swatchEl.style.backgroundColor = `rgb(${g}, ${g}, ${g})`;
  }

  function showFinalSteps(): void {
    previewCanvas.classList.add('is-live');
    snapProbeToMapPixel();
    metaEl.hidden = false;
    const nx = (picked.x - computedView.xMin) / viewSpanX(computedView);
    const ny = (picked.y - computedView.yMin) / viewSpanY(computedView);
    const n = renderer.mapSteps(nx, ny);
    if (n == null) return;
    const steps = Math.round(n);
    const key = `${mapEpoch}:${picked.x},${picked.y},${steps},${controls.invert}`;
    if (key === lastProbeKey) return;
    lastProbeKey = key;
    stepsEl.textContent = String(steps);
    setSwatch(renderer.grayForSteps(n, controls.invert) ?? 0);
  }

  function hidePreviewSteps(): void {
    lastProbeKey = '';
    stepsEl.textContent = '';
    metaEl.hidden = true;
    previewCanvas.classList.remove('is-live');
  }

  function resetPreviewBg(): void {
    previewCanvas.classList.remove('is-settled');
    previewCanvas.classList.add('is-live');
  }

  function armPreviewIdle(): void {
    window.clearTimeout(idleTimer);
    previewPlaying = false;
    previewReplay = false;
    resetPreviewBg();
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

  window.matchMedia('(hover: none)').addEventListener('change', () => {
    if (!followScreenCenter()) {
      previewPinned = false;
      hovering = false;
      lastScreen = null;
      hidePreviewSteps();
    }
    drawChrome();
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
    },
    pickPoint(x, y, clientX, clientY) {
      if (followScreenCenter()) {
        drawChrome();
        return;
      }
      picked = { x, y };
      hovering = false;
      previewPinned = true;
      lastScreen = { x: clientX, y: clientY };
      armPreviewIdle();
      drawChrome();
    },
    hoverPoint(x, y, _clientX, _clientY) {
      if (followScreenCenter()) return;
      hovering = true;
      previewPinned = false;
      picked = { x, y };
      armPreviewIdle();
      drawChrome();
    },
    hoverEnd() {
      if (followScreenCenter() || previewPinned) return;
      hovering = false;
      previewPlaying = false;
      previewReplay = false;
      lastScreen = null;
      window.clearTimeout(idleTimer);
      hidePreviewSteps();
      previewState = mapDef.pointView?.createState?.(picked, params);
      drawChrome();
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
      mapEpoch += 1;
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

  function tick(): void {
    if ((wantRefine || wantHalo) && !rendering) {
      void renderOnce();
    }
    requestAnimationFrame(tick);
  }

  drawChrome();
  requestAnimationFrame(tick);
}

void boot();
