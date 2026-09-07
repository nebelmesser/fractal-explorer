import type { MapParams, ViewRect } from '../types';
import type { MapPresentation, MapPresentationFactory, PresentationHost } from '../../viewer/presentation';
import { bindMenu, closeMenu, syncBudgetReadout } from '../../viewer/menu';
import { viewsEqual, copyView } from '../types';
import { drawMapAxes } from './axes';
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
} from './probes';
import {
  drawOverlayFly,
  drawOverlayPendulum,
  drawProbeCross,
  drawProbePivot,
  flyOnOverlay,
  startFly,
  stepFly,
  type FlyState,
} from './preview';
import { createTrajectory, initMapCore, type Trajectory } from './trajectory';
import {
  PROBE_ALPHA,
  PROBE_AUTOSTART_MS,
  PROBE_CROSS_PX,
  PROBE_FLY_TIME,
  PROBE_MAX_STEPS,
  PROBE_PIVOT_R,
  PROBE_PLAY_FPS,
  PROBE_SIGHT_ALPHA,
  PROBE_SIGHT_FLY_ALPHA,
  PROBE_SNAP_DEG,
} from './constants';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Double-pendulum presentation is missing #${id}`);
  return element as T;
}

function mountPendulumPresentation(host: PresentationHost): MapPresentation {
  const axes = requireElement<HTMLCanvasElement>('map-axes');
  const overlay = requireElement<HTMLCanvasElement>('probe-overlay');
  const xScale = requireElement<HTMLElement>('map-scale-x');
  const yScale = requireElement<HTMLElement>('map-scale-y');
  const params = host.params;
  const probeHud = defaultProbeHud();
  let probes: Trajectory[] | null = null;
  let flies: (FlyState | 'gone' | null)[] = [];
  let playing = false;
  let probeView: ViewRect | null = null;
  let playAcc = 0;
  let playLast = 0;
  let autoStartTimer = 0;
  let autoStartAt = 0;
  let drawFrame = 0;
  let hudUi: ReturnType<typeof bindProbeHud> | null = null;

  type PresentationFrame = {
    origins: { x: number; y: number }[];
    worlds: { x: number; y: number }[];
  };

  function origins(box = host.clip.getBoundingClientRect()): { x: number; y: number }[] {
    const blocked = chromeRects(host.clip);
    const mode = currentProbeStep(probeHud).mode;
    const hitR = PROBE_CROSS_PX * overlaySightScale(mode) + 6;
    return layoutOrigins(box.width, box.height, mode, probeSpacing(probeHud))
      .filter((origin) => !originHitsChrome(origin, blocked, hitR));
  }

  function sampleFrame(): PresentationFrame {
    const box = host.clip.getBoundingClientRect();
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
    hudUi?.syncPlay(false);
    probeView = null;
    playAcc = 0;
  }

  function launch(): void {
    window.clearTimeout(autoStartTimer);
    autoStartTimer = 0;
    const next = sampleFrame().worlds;
    if (!next.length) return;
    probes = next.map((point) => createTrajectory(point.x, point.y));
    flies = next.map(() => null);
    probeView = copyView(host.getView());
    playing = true;
    playAcc = 0;
    playLast = performance.now();
    hudUi?.syncPlay(true);
  }

  function noteActivity(): void {
    if (currentProbeStep(probeHud).count <= 0) {
      window.clearTimeout(autoStartTimer);
      autoStartTimer = 0;
      return;
    }
    autoStartAt = performance.now() + PROBE_AUTOSTART_MS;
    if (autoStartTimer) return;
    const startWhenIdle = (): void => {
      const remaining = autoStartAt - performance.now();
      if (remaining > 1) {
        autoStartTimer = window.setTimeout(startWhenIdle, remaining);
        return;
      }
      autoStartTimer = 0;
      launch();
      draw();
    };
    autoStartTimer = window.setTimeout(startWhenIdle, PROBE_AUTOSTART_MS);
  }

  function drawPendulums(frame: PresentationFrame): void {
    const { origins: nextOrigins, worlds: nextWorlds } = frame;
    const width = overlay.clientWidth;
    const height = overlay.clientHeight;
    if (width < 8 || height < 8) return;
    const mode = currentProbeStep(probeHud).mode;
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
      pxPerLen: overlayPxPerLen(mode, width, height, probeSpacing(probeHud), params),
      alpha: large ? PROBE_ALPHA : 1,
    };
    const crossHalf = PROBE_CROSS_PX * overlaySightScale(mode);
    for (let i = 0; i < nextOrigins.length; i++) {
      const origin = nextOrigins[i];
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
        const th1 = probes ? probes[i].th1 : nextWorlds[i].x;
        const th2 = probes ? probes[i].th2 : nextWorlds[i].y;
        drawOverlayPendulum(ctx, origin, th1, th2, params, style, sight);
      }
    }
  }

  function drawNow(): void {
    drawFrame = 0;
    const frame = sampleFrame();
    const { origins: nextOrigins, worlds: nextWorlds } = frame;
    drawMapAxes(axes, host.getView(), xScale, yScale, host.navigation, {
      points: nextOrigins.map((origin, i) => ({
        x: origin.x,
        y: origin.y,
        xRad: nextWorlds[i].x,
        yRad: nextWorlds[i].y,
      })),
      probesOnly: currentProbeStep(probeHud).mode === 'grid',
    });
    drawPendulums(frame);
  }

  /** Pointer events may arrive faster than the display refresh rate. Coalesce all
   * presentation work so axis DOM and pendulum canvases render at most once per frame. */
  function draw(): void {
    if (drawFrame) return;
    drawFrame = requestAnimationFrame(drawNow);
  }

  function step(now: number): boolean {
    if (!playing || !probes) return false;
    if (probeView && !viewsEqual(host.getView(), probeView)) {
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
    const nextOrigins = origins();
    const width = overlay.clientWidth;
    const height = overlay.clientHeight;
    const scale = overlayPxPerLen(
      currentProbeStep(probeHud).mode,
      width,
      height,
      probeSpacing(probeHud),
      params,
    );
    while (playAcc >= frame) {
      for (let i = 0; i < probes.length; i++) {
        const live = flies[i];
        if (live === 'gone') continue;
        if (live) {
          stepFly(live, playParams, flyDt);
          const origin = nextOrigins[i];
          if (!origin || !flyOnOverlay(live, origin, scale, width, height)) flies[i] = 'gone';
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
        }
      }
      playAcc -= frame;
      const hanging = probes.some((trajectory, i) => !flies[i] && !trajectory.done);
      const flying = flies.some((fly) => fly && fly !== 'gone');
      if (!hanging && !flying) {
        playing = false;
        hudUi?.syncPlay(false);
        break;
      }
    }
    return true;
  }

  function tick(now: number): void {
    if (!playing) return;
    if (step(now)) draw();
  }

  hudUi = bindProbeHud(probeHud, () => {
    reset();
    draw();
    noteActivity();
  }, () => {
    launch();
    draw();
  });
  bindMenu(host.map, host.controls, host.onParamsChange, host.resetTransition);

  return {
    draw,
    tick,
    reset,
    noteActivity,
    resize() {
      hudUi?.setSteps(buildProbeSteps(host.clip));
      draw();
      noteActivity();
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
