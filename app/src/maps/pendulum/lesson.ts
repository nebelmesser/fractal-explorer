import {
  viewCenter,
  viewSpanX,
  viewSpanY,
  type MapParams,
  type ViewRect,
} from '../types';
import type { PresentationHost } from '../../viewer/presentation';
import {
  drawOverlayPendulum,
  drawProbePivot,
  overlayBobRadius,
  overlayRodWidth,
} from './preview';
import {
  LESSON_BOB_HIT_PAD_PX,
  LESSON_MAGNET_MS,
  LESSON_MAX_FRAME_SEC,
  LESSON_MIN_SCALE_PX,
  LESSON_NEIGHBOR_ALPHA,
  LESSON_NEIGHBOR_DEG,
  LESSON_POINTER_SLOP_PX,
  LESSON_PIVOT_HIT_PX,
  LESSON_ROD_HANDOFF_PX,
  LESSON_UNIT_LENGTH,
  LESSON_VIEW_FILL,
  LESSON_VIEW_IDLE_MS,
  PENDULUM_DT,
  PROBE_LARGE_BOB_PER_LEN,
  PROBE_OUTLINE_PX,
  PROBE_PLAY_FPS,
  PROBE_SNAP_DEG,
} from './constants';
import { theme } from './theme';

type Bob = 1 | 2;

type DragState = {
  bob: Bob;
  direct: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  startedRunning: boolean;
  eventSent: boolean;
  magnetStartedAt: number;
  magnetTh1: number;
  magnetTh2: number;
  /** First-rod angle frozen when an outward drag continues onto rod two. */
  handoffTh1: number | null;
};

type Point = { x: number; y: number };
type PhysicsState = { th1: number; th2: number; w1: number; w2: number };

function wrappedDelta(next: number, prev: number): number {
  let delta = next - prev;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function angleTo(from: Point, clientX: number, clientY: number): number {
  return Math.atan2(clientX - from.x, clientY - from.y);
}

function closestOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 1e-12)) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function distToSegment(point: Point, a: Point, b: Point): number {
  const closest = closestOnSegment(point, a, b);
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

export class PendulumLesson {
  active = false;
  running = false;

  private th1 = Math.PI * 0.72;
  private th2 = Math.PI * 0.42;
  private w1 = 0;
  private w2 = 0;
  private lastTick = 0;
  private playAcc = 0;
  private drag: DragState | null = null;
  private neighbors: PhysicsState[] = [];
  private neighborsVisible = false;
  private mapCenter = { x: Number.NaN, y: Number.NaN };
  private poseFromViewAt = 0;

  constructor(
    private readonly host: PresentationHost,
    private readonly canvas: HTMLCanvasElement,
    private readonly requestDraw: () => void,
    private readonly syncRunning: (running: boolean) => void,
  ) {
    this.bindPointerInput();
  }

  enter(initial = viewCenter(this.host.getView())): void {
    if (this.active) return;
    this.active = true;
    this.running = false;
    this.th1 = initial.x;
    this.th2 = initial.y;
    this.w1 = 0;
    this.w2 = 0;
    this.lastTick = performance.now();
    this.playAcc = 0;
    this.drag = null;
    this.hideNeighbors();
    this.rememberMapCenter();
    this.poseFromViewAt = 0;
    document.body.classList.add('is-pendulum-mode');
    this.host.signals?.set('view_mode', 'pendulum');
    this.host.signals?.set('simulation_running', false);
    this.host.signals?.emit('pendulum-mode');
    this.syncRunning(false);
    this.requestDraw();
  }

  leave(): void {
    if (!this.active) return;
    this.active = false;
    this.running = false;
    const movedMap = this.drag?.eventSent === true;
    this.drag = null;
    this.hideNeighbors();
    this.poseFromViewAt = 0;
    this.mapCenter = { x: Number.NaN, y: Number.NaN };
    document.body.classList.remove('is-pendulum-mode');
    this.host.clip.classList.remove('is-bob-dragging');
    if (movedMap) this.host.settleView();
    this.host.signals?.set('view_mode', 'map');
    this.host.signals?.set('simulation_running', false);
    this.syncRunning(false);
  }

  start(): void {
    if (!this.active || this.running) return;
    this.running = true;
    const now = performance.now();
    this.lastTick = now;
    this.playAcc = 0;
    this.poseFromViewAt = 0;
    this.rememberMapCenter();
    this.seedNeighbors();
    this.host.signals?.set('simulation_running', true);
    this.host.signals?.emit('pendulum-simulation-start');
    this.syncRunning(true);
    this.requestDraw();
  }

  pause(restorePose = true): void {
    if (!this.active || !this.running) return;
    this.running = false;
    this.playAcc = 0;
    this.w1 = 0;
    this.w2 = 0;
    if (restorePose) this.restorePoseFromMap();
    else this.hideNeighbors();
    this.host.signals?.set('simulation_running', false);
    this.host.signals?.emit('pendulum-simulation-pause');
    this.syncRunning(false);
    this.requestDraw();
  }

  toggle(): void {
    if (this.running) this.pause();
    else this.start();
  }

  paramsChanged(phase: 'live' | 'reset' | 'settle' = 'live'): void {
    if (!this.active) return;
    this.hideNeighbors();
    this.applyDrag();
    if (phase === 'settle' && this.running && !this.drag) this.seedNeighbors();
    this.requestDraw();
  }

  resize(): void {
    if (this.active) this.requestDraw();
  }

  tick(now: number): void {
    if (!this.active) return;
    this.syncWithView();
    if (!this.running) {
      if (this.drag) {
        this.applyDrag(now);
        this.requestDraw();
        return;
      }
      if (
        this.poseFromViewAt
        && !this.neighborsVisible
        && now - this.poseFromViewAt >= LESSON_VIEW_IDLE_MS
      ) {
        this.seedNeighbors();
        this.requestDraw();
      }
      return;
    }

    const elapsed = Math.min(
      LESSON_MAX_FRAME_SEC,
      Math.max(0, (now - this.lastTick) / 1000),
    );
    this.lastTick = now;
    const params = this.params();
    const frame = 1 / PROBE_PLAY_FPS;
    const dt = Math.max(1e-4, params.DT || PENDULUM_DT);
    this.playAcc += elapsed;
    this.applyDrag(now);
    while (this.playAcc >= frame) {
      const prevTh1 = this.th1;
      this.applyDrag();
      this.integrate(params, dt);
      if (this.neighborsVisible && !this.drag) {
        for (const neighbor of this.neighbors) this.integrateState(neighbor, params, dt);
      }
      this.applyDrag();
      if (!this.drag && this.mainDetached(prevTh1)) {
        this.resetAfterDetach();
        return;
      }
      this.playAcc -= frame;
    }
    this.requestDraw();
  }

  draw(): void {
    if (!this.active) return;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    if (width < 8 || height < 8) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const origin = this.origin(width, height);
    const scale = this.scale(width, height);
    if (this.neighborsVisible && !this.drag) {
      for (const neighbor of this.neighbors) {
        drawOverlayPendulum(ctx, origin, neighbor.th1, neighbor.th2, this.params(), {
          large: true,
          pxPerLen: scale,
          alpha: LESSON_NEIGHBOR_ALPHA,
          color: theme().lessonNeighbor,
        });
      }
    }
    drawOverlayPendulum(ctx, origin, this.th1, this.th2, this.params(), {
      large: true,
      pxPerLen: scale,
      alpha: 1,
    });
    drawProbePivot(ctx, origin, 4, 1);
  }

  private origin(width = this.canvas.clientWidth, height = this.canvas.clientHeight): Point {
    return { x: width / 2, y: height / 2 };
  }

  private params(): MapParams {
    return this.host.controls.params;
  }

  private hideNeighbors(): void {
    this.neighborsVisible = false;
    this.neighbors = [];
  }

  private mapViewAtPose(resetZoom: boolean): ViewRect {
    const current = this.host.getView();
    let spanX = viewSpanX(current);
    let spanY = viewSpanY(current);
    if (resetZoom) {
      const baseShort = Math.min(
        viewSpanX(this.host.map.defaultView),
        viewSpanY(this.host.map.defaultView),
      );
      const aspect = spanX / Math.max(spanY, Number.MIN_VALUE);
      if (aspect >= 1) {
        spanX = baseShort * aspect;
        spanY = baseShort;
      } else {
        spanX = baseShort;
        spanY = baseShort / Math.max(aspect, Number.MIN_VALUE);
      }
    }
    return {
      xMin: this.th1 - spanX / 2,
      xMax: this.th1 + spanX / 2,
      yMin: this.th2 - spanY / 2,
      yMax: this.th2 + spanY / 2,
    };
  }

  /** Pose the camera on the current angles. Physics never calls this, so a
   * running simulation keeps the map frozen at the pose it started from. */
  private syncMapToPose(resetZoom = false): void {
    const current = this.host.getView();
    const defaultShort = Math.min(
      viewSpanX(this.host.map.defaultView),
      viewSpanY(this.host.map.defaultView),
    );
    const zoomed = Math.min(viewSpanX(current), viewSpanY(current)) < defaultShort * 0.99;
    this.host.setView(this.mapViewAtPose(resetZoom && zoomed), {
      navigating: true,
      quiet: true,
    });
    this.rememberMapCenter();
  }

  /** Keep the overlay pose on the map center when the camera moves. Skip
   * while a rod is grabbed so the pointer stays in charge. */
  syncWithView(): void {
    if (!this.active || this.drag) return;
    const { x, y } = viewCenter(this.host.getView());
    if (!Number.isFinite(this.mapCenter.x) || !Number.isFinite(this.mapCenter.y)) {
      this.mapCenter = { x, y };
      return;
    }
    const viewDx = wrappedDelta(x, this.mapCenter.x);
    const viewDy = wrappedDelta(y, this.mapCenter.y);
    this.mapCenter = { x, y };
    if (viewDx === 0 && viewDy === 0) return;
    if (this.running) this.pause(false);
    this.th1 += wrappedDelta(x, this.th1);
    this.th2 += wrappedDelta(y, this.th2);
    this.w1 = 0;
    this.w2 = 0;
    this.hideNeighbors();
    const now = performance.now();
    this.poseFromViewAt = now;
    this.requestDraw();
  }

  private restorePoseFromMap(): void {
    const { x, y } = viewCenter(this.host.getView());
    this.th1 += wrappedDelta(x, this.th1);
    this.th2 += wrappedDelta(y, this.th2);
    this.w1 = 0;
    this.w2 = 0;
    this.rememberMapCenter();
    this.seedNeighbors();
  }

  private rememberMapCenter(): void {
    const center = viewCenter(this.host.getView());
    this.mapCenter = { x: center.x, y: center.y };
  }

  private seedNeighbors(): void {
    const d = (this.params().NEIGHBOR_DEG ?? LESSON_NEIGHBOR_DEG) * Math.PI / 180;
    const base = { w1: this.w1, w2: this.w2 };
    this.neighbors = [
      { ...base, th1: this.th1 - d, th2: this.th2 },
      { ...base, th1: this.th1 + d, th2: this.th2 },
      { ...base, th1: this.th1, th2: this.th2 - d },
      { ...base, th1: this.th1, th2: this.th2 + d },
    ];
    this.neighborsVisible = true;
  }

  private mainDetached(prevTh1: number): boolean {
    const snap = PROBE_SNAP_DEG * Math.PI / 180;
    return Math.abs(this.th1 - prevTh1) >= snap;
  }

  private resetAfterDetach(): void {
    this.running = false;
    this.playAcc = 0;
    this.restorePoseFromMap();
    this.host.signals?.set('simulation_running', false);
    this.host.signals?.emit('pendulum-simulation-pause');
    this.syncRunning(false);
    this.requestDraw();
  }

  private scale(width = this.canvas.clientWidth, height = this.canvas.clientHeight): number {
    const available = Math.min(width, height) * 0.5 * LESSON_VIEW_FILL;
    const refReach = LESSON_UNIT_LENGTH * 2;
    const pad = PROBE_OUTLINE_PX * 2;
    return Math.max(
      LESSON_MIN_SCALE_PX,
      (available - pad) / (refReach + PROBE_LARGE_BOB_PER_LEN),
    );
  }

  private points(): { origin: Point; first: Point; second: Point } {
    const origin = this.origin();
    const scale = this.scale();
    const params = this.params();
    const first = {
      x: origin.x + Math.sin(this.th1) * params.L1 * scale,
      y: origin.y + Math.cos(this.th1) * params.L1 * scale,
    };
    return {
      origin,
      first,
      second: {
        x: first.x + Math.sin(this.th2) * params.L2 * scale,
        y: first.y + Math.cos(this.th2) * params.L2 * scale,
      },
    };
  }

  private pointerPoint(clientX: number, clientY: number): Point {
    const box = this.host.clip.getBoundingClientRect();
    return { x: clientX - box.left, y: clientY - box.top };
  }

  private bobStyle(): { large: true; pxPerLen: number; alpha: number } {
    return { large: true, pxPerLen: this.scale(), alpha: 1 };
  }

  private firstRodHitRadius(): number {
    const params = this.params();
    return Math.max(params.L1 * this.scale(), 1)
      + overlayBobRadius(params.M1, this.bobStyle())
      + LESSON_BOB_HIT_PAD_PX;
  }

  private hitHandle(point: Point): { bob: Bob; handle: Point | null } | null {
    const { origin, first, second } = this.points();
    const params = this.params();
    const style = this.bobStyle();
    const r1 = overlayBobRadius(params.M1, style) + LESSON_BOB_HIT_PAD_PX;
    const r2 = overlayBobRadius(params.M2, style) + LESSON_BOB_HIT_PAD_PX;
    const rodHit = overlayRodWidth(style) / 2 + LESSON_BOB_HIT_PAD_PX;
    // The second bob is painted last, so it also wins if the two overlap.
    if (Math.hypot(point.x - second.x, point.y - second.y) <= r2) {
      return { bob: 2, handle: second };
    }
    if (Math.hypot(point.x - first.x, point.y - first.y) <= r1) {
      return { bob: 1, handle: first };
    }
    if (distToSegment(point, first, second) <= rodHit) {
      return { bob: 2, handle: closestOnSegment(point, first, second) };
    }
    if (distToSegment(point, origin, first) <= rodHit) {
      return { bob: 1, handle: closestOnSegment(point, origin, first) };
    }
    if (Math.hypot(point.x - origin.x, point.y - origin.y) <= LESSON_PIVOT_HIT_PX) {
      return { bob: 1, handle: null };
    }
    return null;
  }

  private hitTarget(point: Point): { bob: Bob; direct: boolean; handle: Point | null } | null {
    if (this.running) {
      const origin = this.origin();
      const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
      if (distance <= this.firstRodHitRadius()) {
        return { bob: 1, direct: false, handle: null };
      }
      const handle = this.hitHandle(point);
      if (handle?.bob === 2) {
        return { bob: 2, direct: true, handle: handle.handle };
      }
      return null;
    }
    const handle = this.hitHandle(point);
    if (!handle) return null;
    return { bob: handle.bob, direct: true, handle: handle.handle };
  }

  private constrainDrag(now = performance.now()): void {
    const drag = this.drag;
    if (!drag) return;
    if (drag.bob === 1) {
      const origin = this.origin();
      const pointerX = drag.targetX + drag.grabOffsetX;
      const pointerY = drag.targetY + drag.grabOffsetY;
      const distance = Math.hypot(pointerX - origin.x, pointerY - origin.y);
      if (distance >= this.firstRodHitRadius() + LESSON_ROD_HANDOFF_PX) {
        drag.bob = 2;
        drag.direct = false;
        drag.handoffTh1 = this.th1;
        drag.magnetStartedAt = now;
        drag.magnetTh1 = this.th1;
        drag.magnetTh2 = this.th2;
      }
    }
    let targetTh1: number;
    let targetTh2 = this.th2;
    if (drag.bob === 1) {
      const origin = this.origin();
      const dx = drag.targetX - origin.x;
      const dy = drag.targetY - origin.y;
      const minReach = drag.direct ? LESSON_PIVOT_HIT_PX : 4;
      targetTh1 = Math.hypot(dx, dy) < minReach ? this.th1 : angleTo(origin, drag.targetX, drag.targetY);
    } else {
      const origin = this.origin();
      const params = this.params();
      const scale = this.scale();
      const th1 = drag.handoffTh1 ?? this.th1;
      const first = {
        x: origin.x + Math.sin(th1) * params.L1 * scale,
        y: origin.y + Math.cos(th1) * params.L1 * scale,
      };
      targetTh1 = th1;
      targetTh2 = angleTo(first, drag.targetX, drag.targetY);
    }
    const progress = drag.direct
      ? 1
      : Math.max(0, Math.min(1, (now - drag.magnetStartedAt) / LESSON_MAGNET_MS));
    const eased = 1 - (1 - progress) ** 3;
    this.th1 = drag.magnetTh1 + wrappedDelta(targetTh1, drag.magnetTh1) * eased;
    if (drag.bob === 2) {
      this.th2 = drag.magnetTh2 + wrappedDelta(targetTh2, drag.magnetTh2) * eased;
    }
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const point = this.pointerPoint(event.clientX, event.clientY);
    drag.targetX = point.x - drag.grabOffsetX;
    drag.targetY = point.y - drag.grabOffsetY;
    const resetZoom = !drag.eventSent && Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY,
    ) >= LESSON_POINTER_SLOP_PX;
    this.applyDrag(now, resetZoom);
    this.requestDraw();
  }

  private applyDrag(now = performance.now(), resetZoom = false): void {
    const drag = this.drag;
    if (!drag) return;
    const prevTh1 = this.th1;
    const prevTh2 = this.th2;
    this.constrainDrag(now);
    // Manual posing is purely kinematic. Physics never advances under the
    // pointer, so the untouched rod cannot drift on its own.
    this.w1 = 0;
    this.w2 = 0;
    const posed = this.th1 !== prevTh1 || this.th2 !== prevTh2;
    if ((posed || resetZoom) && !drag.eventSent) {
      drag.eventSent = true;
      this.host.signals?.emit(
        drag.startedRunning ? 'pendulum-drag-running' : 'pendulum-drag-stopped',
      );
    }
    if (posed || resetZoom) this.syncMapToPose(resetZoom);
  }

  private bindPointerInput(): void {
    this.host.clip.addEventListener('pointerdown', (event) => {
      if (!this.active) return;
      if (this.drag) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.button !== 0) return;
      const now = performance.now();
      const point = this.pointerPoint(event.clientX, event.clientY);
      const hit = this.hitTarget(point);
      if (!hit) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const startedRunning = this.running;
      if (startedRunning) this.pause(false);
      this.hideNeighbors();
      const target = hit.handle ?? point;
      this.drag = {
        bob: hit.bob,
        direct: hit.direct,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        targetX: target.x,
        targetY: target.y,
        grabOffsetX: hit.handle ? point.x - hit.handle.x : 0,
        grabOffsetY: hit.handle ? point.y - hit.handle.y : 0,
        startedRunning,
        eventSent: false,
        magnetStartedAt: now,
        magnetTh1: this.th1,
        magnetTh2: this.th2,
        handoffTh1: hit.bob === 2 ? this.th1 : null,
      };
      this.host.clip.classList.add('is-bob-dragging');
      try {
        this.host.clip.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic events and some browsers may not capture.
      }
      this.poseFromViewAt = 0;
      this.applyDrag(now);
      this.syncMapToPose();
      this.requestDraw();
    }, true);
    this.host.clip.addEventListener('pointermove', (event) => {
      if (!this.active || !this.drag) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.moveDrag(event);
    }, true);
    const end = (event: PointerEvent): void => {
      if (!this.active || !this.drag || this.drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.moveDrag(event);
      this.drag = null;
      this.host.clip.classList.remove('is-bob-dragging');
      this.w1 = 0;
      this.w2 = 0;
      if (event.type !== 'pointercancel') this.seedNeighbors();
      this.host.settleView();
      this.requestDraw();
    };
    this.host.clip.addEventListener('pointerup', end, true);
    this.host.clip.addEventListener('pointercancel', end, true);
  }

  private integrate(params: MapParams, dt: number): void {
    const state = { th1: this.th1, th2: this.th2, w1: this.w1, w2: this.w2 };
    this.integrateState(state, params, dt);
    this.th1 = state.th1;
    this.th2 = state.th2;
    this.w1 = state.w1;
    this.w2 = state.w2;
  }

  private integrateState(state: PhysicsState, params: MapParams, dt: number): void {
    const { L1, L2, M1, M2, G } = params;
    const friction = params.F ?? 0;
    const sin1 = Math.sin(state.th1);
    const cos1 = Math.cos(state.th1);
    const s12 = Math.sin(state.th1 - state.th2);
    const c12 = Math.cos(state.th1 - state.th2);
    const common = 2 * M1 + M2 - M2 * Math.cos(2 * (state.th1 - state.th2));
    const den1 = L1 * common;
    const den2 = L2 * common;
    let a1 = 0;
    let a2 = 0;
    if (Math.abs(den1) >= 1e-9) {
      a1 = (
        -G * (2 * M1 + M2) * sin1
        - M2 * G * Math.sin(state.th1 - 2 * state.th2)
        - 2 * s12 * M2 * (state.w2 * state.w2 * L2 + state.w1 * state.w1 * L1 * c12)
      ) / den1;
    }
    if (Math.abs(den2) >= 1e-9) {
      const term = state.w1 * state.w1 * L1 * (M1 + M2)
        + G * (M1 + M2) * cos1
        + state.w2 * state.w2 * L2 * M2 * c12;
      a2 = (2 * s12 * term) / den2;
    }
    state.w1 += (a1 - friction * state.w1) * dt;
    state.w2 += (a2 - friction * state.w2) * dt;
    state.th1 += state.w1 * dt;
    state.th2 += state.w2 * dt;
  }
}
