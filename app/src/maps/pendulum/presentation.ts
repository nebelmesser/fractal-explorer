import type { MapParams, ViewRect } from '../types';
import type { MapPresentation, MapPresentationFactory, PresentationHost } from '../../viewer/presentation';
import { bindMenu, closeMenu, syncBudgetReadout } from '../../viewer/menu';
import { viewsEqual, copyView, viewSpanX, viewSpanY } from '../types';
import { MIN_VIEW_SPAN } from '../../constants';
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
  flyOnOverlay,
  startFly,
  stepFly,
  type FlyState,
} from './preview';
import { createTrajectory, initMapCore, type Trajectory } from './trajectory';
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
  DRAGON_FONT,
  DRAGON_OPACITY,
  DRAGON_FADE_SPAN,
  DRAGON_TILE_X,
  DRAGON_TILE_Y,
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
  top.textContent = 'HERE BE';
  top.setAttribute('y', '-0.55em');
  const bottom = document.createElementNS(SVG_NS, 'text');
  bottom.textContent = 'DRAGONS';
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
  const probeHud = defaultProbeHud();
  const singleHud = new URLSearchParams(window.location.search).get('single') === '1';
  let probes: Trajectory[] | null = null;
  let flies: (FlyState | 'gone' | null)[] = [];
  let playing = false;
  let probeView: ViewRect | null = null;
  let pinToMap = false;
  let pinnedWorlds: { x: number; y: number }[] | null = null;
  let pinPxPerLen = PROBE_PX_PER_LEN;
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

  type PresentationFrame = {
    origins: { x: number; y: number }[];
    worlds: { x: number; y: number }[];
  };

  function worldToOverlay(world: { x: number; y: number }, box: DOMRectReadOnly): { x: number; y: number } {
    const view = host.getView();
    const sx = viewSpanX(view);
    const sy = viewSpanY(view);
    return {
      x: sx > 0 ? ((world.x - view.xMin) / sx) * box.width : 0,
      y: sy > 0 ? ((world.y - view.yMin) / sy) * box.height : 0,
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

  function sampleFrame(): PresentationFrame {
    const box = host.clip.getBoundingClientRect();
    if (pinToMap && pinnedWorlds) {
      return {
        origins: pinnedWorlds.map((world) => worldToOverlay(world, box)),
        worlds: pinnedWorlds,
      };
    }
    if (!singleHud) return { origins: [], worlds: [] };
    const nextOrigins = origins(box);
    const nextWorlds = nextOrigins.map((origin) => host.snapToRenderedPixel(
      host.clientToWorld(box.left + origin.x, box.top + origin.y),
    ));
    if (probes && (
      (probeView && !viewsEqual(host.getView(), probeView))
      || probes.length !== nextWorlds.length
    )) reset();
    return { origins: nextOrigins, worlds: nextWorlds };
  }

  function reset(): void {
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
    pinnedWorlds = null;
    hangWatchAt = 0;
    hangEmitted = false;
    playAcc = 0;
  }

  function placeOverlayProbes(): boolean {
    reset();
    const next = sampleFrame().worlds;
    if (!next.length) return false;
    probes = next.map((point) => createTrajectory(point.x, point.y));
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
    host.signals?.set('probe_count', probes?.length ?? 1);
  }

  function armPinnedGrid(): void {
    const box = host.clip.getBoundingClientRect();
    const layout = gridLayout(box.width, box.height, START_GRID_CELL_PX);
    const points = layoutOrigins(box.width, box.height, 'grid', START_GRID_CELL_PX);
    if (!points.length) return;
    reset();
    pinToMap = true;
    gridCols = layout.cols;
    pinPxPerLen = probePxPerLen(Math.min(layout.cellW, layout.cellH), params);
    pinnedWorlds = points.map((origin) => host.snapToRenderedPixel(
      host.clientToWorld(box.left + origin.x, box.top + origin.y),
    ));
    probes = pinnedWorlds.map((point) => createTrajectory(point.x, point.y));
    flies = pinnedWorlds.map(() => null);
    playing = false;
    playAcc = 0;
    hangWatchAt = 0;
    hangEmitted = false;
    hudUi?.syncPlay(false);
    host.signals?.set('probe_count', pinnedWorlds.length);
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
    const plan = revealPlan(neighborAngleDelta(), gridCols);
    revealStep = plan.stepMs;
    revealStride = plan.stride;
    revealCount = Math.min(probes.length, revealStride);
    revealNextAt = 0;
    revealPauseUntil = 0;
    playAcc = 0;
    hangWatchAt = 0;
    hangEmitted = false;
    hudUi?.syncPlay(false);
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
    playAcc = 0;
    playLast = 0;
    hangWatchAt = 0;
    hudUi?.syncPlay(true);
    syncDrop();
    draw();
  }

  function beginPhysics(now: number): void {
    if (!probes) return;
    intro = false;
    revealCount = probes.length;
    playing = true;
    playAcc = 0;
    playLast = now;
    hangWatchAt = 0;
    hangEmitted = false;
    hudUi?.syncPlay(true);
    syncDrop();
  }

  function stepReveal(now: number): boolean {
    if (!intro || !probes) return false;
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
    if (!revealPauseUntil) {
      revealPauseUntil = now + START_REVEAL_PAUSE_MS;
      return false;
    }
    if (now < revealPauseUntil) return false;
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
    // Start is a click: row-wise reveal, then physics. Ignore idle autostart.
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
    const crossHalf = PROBE_CROSS_PX * overlaySightScale(mode);
    const drawPad = 160;
    const last = probes ? shownCount() : nextOrigins.length;
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
    const view = host.getView();
    const spanX = viewSpanX(view);
    const spanY = viewSpanY(view);
    const short = Math.min(spanX, spanY);
    const fade = short >= DRAGON_FADE_SPAN
      ? 0
      : Math.min(1, Math.log(DRAGON_FADE_SPAN / short) / Math.log(DRAGON_FADE_SPAN / MIN_VIEW_SPAN));
    const alpha = fade * DRAGON_OPACITY;
    mapVoid.style.opacity = String(alpha);
    if (!(alpha > 0)) {
      for (const stamp of dragonStamps) stamp.setAttribute('visibility', 'hidden');
      return;
    }
    const box = host.clip.getBoundingClientRect();
    const width = Math.max(1, box.width);
    const height = Math.max(1, box.height);
    mapVoid.setAttribute('viewBox', `0 0 ${width} ${height}`);
    dragonLayer.removeAttribute('transform');
    const sx = width / spanX;
    const sy = height / spanY;
    const fontPx = DRAGON_FONT * Math.min(sx, sy);
    const pad = Math.max(DRAGON_TILE_X, DRAGON_TILE_Y);
    const ix0 = Math.floor((view.xMin - pad) / DRAGON_TILE_X);
    const ix1 = Math.floor((view.xMax + pad) / DRAGON_TILE_X);
    const iy0 = Math.floor((view.yMin - pad) / DRAGON_TILE_Y);
    const iy1 = Math.floor((view.yMax + pad) / DRAGON_TILE_Y);
    let n = 0;
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        let stamp = dragonStamps[n];
        if (!stamp) {
          stamp = makeDragonStamp();
          dragonStamps.push(stamp);
          dragonLayer.appendChild(stamp);
        }
        const cx = (ix + 0.5) * DRAGON_TILE_X;
        const cy = (iy + 0.5) * DRAGON_TILE_Y;
        const x = (cx - view.xMin) * sx;
        const y = (cy - view.yMin) * sy;
        stamp.setAttribute('transform', `translate(${x} ${y}) rotate(-24)`);
        for (const text of stamp.querySelectorAll('text')) {
          text.setAttribute('font-size', String(fontPx));
        }
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
    const frame = sampleFrame();
    const { origins: nextOrigins, worlds: nextWorlds } = frame;
    const last = probes ? shownCount() : nextOrigins.length;
    drawMapAxes(axes, host.getView(), xScale, yScale, host.navigation, {
      points: nextOrigins.slice(0, last).flatMap((origin, i) => (
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
      reset();
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
      ? pinnedWorlds.map((world) => worldToOverlay(world, box))
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
        host.signals?.emit('probe-end');
        if (singleHud) reset();
        else syncDrop();
        break;
      }
    }
    return true;
  }

  function tick(now: number): void {
    syncVoid();
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

  hudUi = bindProbeHud(probeHud, () => {
    reset();
    draw();
    const stepNow = currentProbeStep(probeHud);
    host.signals?.set('probe_count', stepNow.count);
    host.signals?.emit('probe-count');
  }, () => {
    if (singleHud) armSingle();
    else armPinnedGrid();
    startIntro();
    if (!probes) return;
    host.signals?.emit('simulation-start');
    draw();
  }, () => {
    dropAll();
  });
  bindMenu(host.map, host.controls, host.onParamsChange, host.resetTransition, host.signals);

  return {
    draw,
    tick,
    reset,
    noteActivity,
    resize() {
      hudUi?.setSteps(singleHud ? emptyProbeSteps() : buildProbeSteps(host.clip), true);
      draw();
    },
    dismiss: closeMenu,
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
