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
import { computeSize, fitMapDisplay, nextComputePx, scaleSize, snapComputePx } from './viewer/budget';
import { bindMapInput } from './viewer/input';
import { bindMenu, type ExplorerControls } from './viewer/menu';
import { drawMapAxes } from './viewer/axes';
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
  const axesCanvas = document.getElementById('map-axes') as HTMLCanvasElement | null;
  const shiftEl = document.getElementById('map-shift');
  const linkLine = document.getElementById('pointer-link-line') as SVGLineElement | null;
  const zoomOutEl = document.getElementById('zoom-out') as HTMLButtonElement | null;
  const zoomInEl = document.getElementById('zoom-in') as HTMLButtonElement | null;
  const zoomResetEl = document.getElementById('zoom-reset') as HTMLButtonElement | null;
  if (!mapCanvas || !mapBack || !mapClip || !stage || !sidebar || !miniCanvas || !miniOverlay || !previewCanvas || !previewSteps || !previewMeta || !previewSwatch || !axesCanvas || !shiftEl || !linkLine || !zoomInEl || !zoomOutEl || !zoomResetEl) {
    throw new Error('Explorer DOM is incomplete');
  }
  const zoomIn = zoomInEl;
  const zoomOut = zoomOutEl;
  const zoomReset = zoomResetEl;
  const mapShift = shiftEl;
  const clip = mapClip;
  const stageEl = stage;
  const link = linkLine;
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

  const controls: ExplorerControls = {
    params,
    invert: saved?.invert ?? false,
    median: saved?.median ?? MEDIAN_DEFAULT,
    targetFrameMs: saved?.targetFrameMs ?? TARGET_FRAME_MS,
    animatePreview: saved?.animatePreview ?? false,
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

  bindPrefs(() => ({
    params: { ...params },
    invert: controls.invert,
    median: controls.median,
    targetFrameMs: controls.targetFrameMs,
    animatePreview: controls.animatePreview,
    lastComputePx: settledPx,
  }));

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
    if (!Number.isFinite(lastRefineMs)) return;
    // Halo time must not shrink the visible pass — budget is for the on-screen map.
    settledPx = Math.min(screenPx(), nextComputePx(settledPx, lastRefineMs, controls.targetFrameMs));
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
    drawMapAxes(axes, view);
    drawOverviewFrame(miniOverlay, mapDef.defaultView, view);
    updatePointerLink();
    const ctx = previewCanvas.getContext('2d');
    if (!ctx || !mapDef.pointView) return;
    mapDef.pointView.draw(ctx, picked, params);
  }

  function updatePointerLink(): void {
    if (!lastScreen) {
      link.setAttribute('visibility', 'hidden');
      return;
    }
    const stageBox = stageEl.getBoundingClientRect();
    const previewBox = previewCanvas.getBoundingClientRect();
    const pivot = mapDef.pointView?.anchor?.(previewCanvas, params) ?? {
      x: previewCanvas.width / 2,
      y: previewCanvas.height / 2,
    };
    const bw = Math.max(previewCanvas.width, 1);
    const bh = Math.max(previewCanvas.height, 1);
    link.setAttribute('visibility', 'visible');
    link.setAttribute('x1', String(lastScreen.x - stageBox.left));
    link.setAttribute('y1', String(lastScreen.y - stageBox.top));
    link.setAttribute('x2', String(previewBox.left + (pivot.x / bw) * previewBox.width - stageBox.left));
    link.setAttribute('y2', String(previewBox.top + (pivot.y / bh) * previewBox.height - stageBox.top));
  }

  function setSwatch(gray: number): void {
    const g = Math.round(Math.min(255, Math.max(0, gray)));
    swatchEl.style.backgroundColor = `rgb(${g}, ${g}, ${g})`;
  }

  function showFinalSteps(): void {
    previewCanvas.classList.add('is-live');
    const n = mapDef.pointView?.replayLength?.(picked, params) ?? 0;
    stepsEl.textContent = String(n);
    const live = renderer.grayForSteps(n, controls.invert);
    setSwatch(live ?? 0);
    metaEl.hidden = false;
    void refineSwatch();
  }

  function hidePreviewSteps(): void {
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

  async function refineSwatch(): Promise<void> {
    const nx = (picked.x - computedView.xMin) / viewSpanX(computedView);
    const ny = (picked.y - computedView.yMin) / viewSpanY(computedView);
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    const g = await renderer.sampleGray(nx, ny);
    if (g == null) return;
    setSwatch(g);
  }

  function cancelZoomAnim(): void {
    zoomToken += 1;
    animating = false;
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

  function applyView(next: ViewRect, opts?: { pushHistory?: boolean; animate?: boolean; immediate?: boolean; navigating?: boolean }): void {
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

  bindMapInput(clip, {
    getView: () => view,
    getWorld: () => world,
    setView(next, opts) {
      applyView(next, opts);
    },
    popHistory() {
      if (history.length <= 1) return;
      cancelZoomAnim();
      history.pop();
      view = copyView(history[history.length - 1]);
      markPrefsDirty();
      scheduleView({ immediate: true });
    },
    pickPoint(x, y, clientX, clientY) {
      picked = { x, y };
      hovering = false;
      previewPinned = true;
      lastScreen = { x: clientX, y: clientY };
      showFinalSteps();
      armPreviewIdle();
      drawChrome();
    },
    hoverPoint(x, y, clientX, clientY) {
      hovering = true;
      previewPinned = false;
      picked = { x, y };
      lastScreen = { x: clientX, y: clientY };
      showFinalSteps();
      armPreviewIdle();
      drawChrome();
    },
    hoverEnd() {
      if (previewPinned) return;
      hovering = false;
      previewPlaying = false;
      previewReplay = false;
      lastScreen = null;
      window.clearTimeout(idleTimer);
      hidePreviewSteps();
      previewState = mapDef.pointView?.createState?.(picked, params);
      drawChrome();
    },
  });

  function buttonZoom(factor: number): void {
    const c = viewCenter(view);
    applyView(zoomAbout(view, c.x, c.y, factor, world), { pushHistory: true, animate: true });
  }

  zoomOut.addEventListener('click', () => buttonZoom(1 / BUTTON_ZOOM_FACTOR));
  zoomIn.addEventListener('click', () => buttonZoom(BUTTON_ZOOM_FACTOR));
  zoomReset.addEventListener('click', () => {
    applyView(copyView(world), { pushHistory: true, animate: true });
  });
  syncZoomBar();

  const layout = (): void => {
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
    const halo = !wantRefine && wantHalo && !zooming;
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
      const renderView = copyView(zooming ? computedView : padView(view, pad));
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
      if (!zooming && !halo) {
        const prev = settledPx;
        applyBudget();
        markPrefsDirty();
        if (settledPx > prev && lastRefineMs < controls.targetFrameMs * 0.85) {
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
