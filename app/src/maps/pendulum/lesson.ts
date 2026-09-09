import type { MapParams } from '../types';
import type { PresentationHost } from '../../viewer/presentation';
import {
  drawOverlayPendulum,
  drawProbePivot,
  overlayBobRadius,
} from './preview';
import {
  LESSON_AUTOSTART_MS,
  LESSON_BOB_HIT_PAD_PX,
  LESSON_DT,
  LESSON_MAGNET_MS,
  LESSON_MAX_FRAME_SEC,
  LESSON_MAX_SCALE_PX,
  LESSON_MIN_SCALE_PX,
  LESSON_NEIGHBOR_ALPHA,
  LESSON_NEIGHBOR_DEG,
  LESSON_POINTER_SLOP_PX,
  LESSON_VIEW_FILL,
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
  targetW1: number;
  targetW2: number;
  startW1: number;
  startW2: number;
  lastTh1: number;
  lastTh2: number;
  lastSampleAt: number;
  lastMoveAt: number;
  startedRunning: boolean;
  pointerMoved: boolean;
  eventSent: boolean;
  magnetStartedAt: number;
  magnetTh1: number;
  magnetTh2: number;
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

function angularDistance(a: number, b: number): number {
  return Math.abs(wrappedDelta(a, b));
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
  private autoStartAt = 0;
  private drag: DragState | null = null;
  private neighbors: PhysicsState[] = [];
  private neighborsVisible = false;
  private runStart = { th1: this.th1, th2: this.th2 };

  constructor(
    private readonly host: PresentationHost,
    private readonly canvas: HTMLCanvasElement,
    private readonly requestDraw: () => void,
    private readonly syncRunning: (running: boolean) => void,
  ) {
    this.bindPointerInput();
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    this.running = false;
    this.w1 = 0;
    this.w2 = 0;
    this.lastTick = performance.now();
    this.playAcc = 0;
    this.autoStartAt = 0;
    this.drag = null;
    this.hideNeighbors();
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
    this.autoStartAt = 0;
    this.drag = null;
    this.hideNeighbors();
    document.body.classList.remove('is-pendulum-mode');
    this.host.clip.classList.remove('is-bob-dragging');
    this.host.signals?.set('view_mode', 'map');
    this.host.signals?.set('simulation_running', false);
    this.syncRunning(false);
  }

  start(): void {
    if (!this.active || this.running) return;
    this.running = true;
    this.autoStartAt = 0;
    this.lastTick = performance.now();
    this.playAcc = 0;
    this.runStart = { th1: this.th1, th2: this.th2 };
    this.seedNeighbors();
    this.host.signals?.set('simulation_running', true);
    this.host.signals?.emit('pendulum-simulation-start');
    this.syncRunning(true);
    this.requestDraw();
  }

  pause(): void {
    if (!this.active || !this.running) return;
    this.running = false;
    this.autoStartAt = 0;
    this.playAcc = 0;
    this.hideNeighbors();
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
    this.constrainDrag();
    if (phase === 'settle' && this.running && !this.drag) this.seedNeighbors();
    this.requestDraw();
  }

  resize(): void {
    if (this.active) this.requestDraw();
  }

  tick(now: number): void {
    if (!this.active) return;
    if (!this.running) {
      if (this.drag) {
        this.applyDrag(now);
        this.requestDraw();
        return;
      }
      if (this.autoStartAt && now >= this.autoStartAt) this.start();
      return;
    }

    const elapsed = Math.min(
      LESSON_MAX_FRAME_SEC,
      Math.max(0, (now - this.lastTick) / 1000),
    );
    this.lastTick = now;
    const params = this.params();
    const frame = 1 / PROBE_PLAY_FPS;
    const dt = Math.max(1e-4, params.DT || LESSON_DT);
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
    this.autoStartAt = 0;
    this.th1 = this.runStart.th1;
    this.th2 = this.runStart.th2;
    this.w1 = 0;
    this.w2 = 0;
    this.playAcc = 0;
    this.hideNeighbors();
    this.host.signals?.set('simulation_running', false);
    this.host.signals?.emit('pendulum-simulation-pause');
    this.syncRunning(false);
    this.requestDraw();
  }

  private scale(width = this.canvas.clientWidth, height = this.canvas.clientHeight): number {
    const params = this.params();
    const total = Math.max(params.L1 + params.L2, 1e-6);
    return Math.max(
      LESSON_MIN_SCALE_PX,
      Math.min(
        LESSON_MAX_SCALE_PX,
        (width * LESSON_VIEW_FILL) / total,
        (height * LESSON_VIEW_FILL) / total,
      ),
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

  private hitBob(point: Point): Bob | null {
    const { first, second } = this.points();
    const params = this.params();
    const style = { large: true, pxPerLen: this.scale(), alpha: 1 };
    const r1 = overlayBobRadius(params.M1, style) + LESSON_BOB_HIT_PAD_PX;
    const r2 = overlayBobRadius(params.M2, style) + LESSON_BOB_HIT_PAD_PX;
    // The second bob is painted last, so it also wins if the two overlap.
    if (Math.hypot(point.x - second.x, point.y - second.y) <= r2) return 2;
    if (Math.hypot(point.x - first.x, point.y - first.y) <= r1) return 1;
    return null;
  }

  private hitTarget(point: Point): { bob: Bob; direct: boolean } | null {
    if (!this.running) {
      const bob = this.hitBob(point);
      if (bob) return { bob, direct: true };
    }
    const origin = this.origin();
    const scale = this.scale();
    const params = this.params();
    const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
    const firstRadius = Math.max(params.L1 * scale, 1);
    const secondRadius = Math.max(
      (params.L1 + params.L2) * scale,
      firstRadius,
    );

    // Two invisible, concentric hit regions: the inner disk controls the
    // first rod, while only the outer ring controls the second rod.
    if (distance <= firstRadius) return { bob: 1, direct: false };
    if (distance <= secondRadius) return { bob: 2, direct: false };
    return null;
  }

  private solveSecondTarget(target: Point): { th1: number; th2: number } {
    const origin = this.origin();
    const scale = this.scale();
    const params = this.params();
    const L1 = Math.max(params.L1 * scale, 1e-6);
    const L2 = Math.max(params.L2 * scale, 1e-6);
    let dx = target.x - origin.x;
    let dy = target.y - origin.y;
    let distance = Math.hypot(dx, dy);
    if (distance < 1e-6) {
      const current = this.points().second;
      dx = current.x - origin.x;
      dy = current.y - origin.y;
      distance = Math.max(Math.hypot(dx, dy), 1);
    }
    const ux = dx / distance;
    const uy = dy / distance;
    const reachable = Math.max(Math.abs(L1 - L2) + 1e-6, Math.min(L1 + L2, distance));
    const tip = { x: origin.x + ux * reachable, y: origin.y + uy * reachable };
    const along = (L1 * L1 - L2 * L2 + reachable * reachable) / (2 * reachable);
    const normal = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    const center = { x: origin.x + ux * along, y: origin.y + uy * along };
    const candidates = [-1, 1].map((side) => {
      const first = {
        x: center.x + (-uy * normal * side),
        y: center.y + (ux * normal * side),
      };
      return {
        th1: angleTo(origin, first.x, first.y),
        th2: angleTo(first, tip.x, tip.y),
      };
    });
    candidates.sort((a, b) => (
      angularDistance(a.th1, this.th1) + angularDistance(a.th2, this.th2)
      - angularDistance(b.th1, this.th1) - angularDistance(b.th2, this.th2)
    ));
    return candidates[0];
  }

  private constrainDrag(now = performance.now()): void {
    const drag = this.drag;
    if (!drag) return;
    let targetTh1: number;
    let targetTh2 = this.th2;
    if (drag.bob === 1) {
      targetTh1 = angleTo(this.origin(), drag.targetX, drag.targetY);
    } else {
      const solved = this.solveSecondTarget({ x: drag.targetX, y: drag.targetY });
      targetTh1 = solved.th1;
      targetTh2 = solved.th2;
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
    const targetX = point.x - drag.grabOffsetX;
    const targetY = point.y - drag.grabOffsetY;
    const moved = Math.hypot(targetX - drag.targetX, targetY - drag.targetY);
    drag.targetX = targetX;
    drag.targetY = targetY;
    this.constrainDrag();
    if (moved >= 0.25) {
      drag.pointerMoved = true;
      const elapsed = Math.max(1 / 120, Math.min(0.1, (now - drag.lastSampleAt) / 1000));
      drag.targetW1 = Math.max(
        -20,
        Math.min(20, wrappedDelta(this.th1, drag.lastTh1) / elapsed),
      );
      drag.targetW2 = Math.max(
        -20,
        Math.min(20, wrappedDelta(this.th2, drag.lastTh2) / elapsed),
      );
      drag.lastTh1 = this.th1;
      drag.lastTh2 = this.th2;
      drag.lastSampleAt = now;
      drag.lastMoveAt = now;
    }
    if (!drag.eventSent && Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY,
    ) >= LESSON_POINTER_SLOP_PX) {
      drag.eventSent = true;
      this.host.signals?.emit(
        drag.startedRunning ? 'pendulum-drag-running' : 'pendulum-drag-stopped',
      );
    }
    this.applyDrag(now);
    this.requestDraw();
  }

  private applyDrag(now = performance.now()): void {
    const drag = this.drag;
    if (!drag) return;
    this.constrainDrag(now);
    const moving = this.running && now - drag.lastMoveAt < 80;
    if (drag.bob === 1) {
      this.w1 = moving ? drag.targetW1 : 0;
    } else {
      this.w1 = moving ? drag.targetW1 : 0;
      this.w2 = moving ? drag.targetW2 : 0;
    }
    if (!this.running) {
      this.w1 = 0;
      this.w2 = 0;
    }
  }

  private bindPointerInput(): void {
    this.host.clip.addEventListener('pointerdown', (event) => {
      if (!this.active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.button !== 0 || this.drag) return;
      const now = performance.now();
      const point = this.pointerPoint(event.clientX, event.clientY);
      const hit = this.hitTarget(point);
      if (!hit) return;
      this.hideNeighbors();
      const bobPoint = hit.bob === 1 ? this.points().first : this.points().second;
      const target = hit.direct ? bobPoint : point;
      this.drag = {
        bob: hit.bob,
        direct: hit.direct,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        targetX: target.x,
        targetY: target.y,
        grabOffsetX: hit.direct ? point.x - bobPoint.x : 0,
        grabOffsetY: hit.direct ? point.y - bobPoint.y : 0,
        targetW1: 0,
        targetW2: 0,
        startW1: this.w1,
        startW2: this.w2,
        lastTh1: this.th1,
        lastTh2: this.th2,
        lastSampleAt: now,
        lastMoveAt: now,
        startedRunning: this.running,
        pointerMoved: false,
        eventSent: false,
        magnetStartedAt: now,
        magnetTh1: this.th1,
        magnetTh2: this.th2,
      };
      this.host.clip.classList.add('is-bob-dragging');
      this.host.clip.setPointerCapture(event.pointerId);
      this.autoStartAt = 0;
      this.constrainDrag();
      this.drag.lastTh1 = this.th1;
      this.drag.lastTh2 = this.th2;
      this.applyDrag();
      this.requestDraw();
    }, true);
    this.host.clip.addEventListener('pointermove', (event) => {
      if (!this.active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.moveDrag(event);
    }, true);
    const end = (event: PointerEvent): void => {
      if (!this.active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;
      this.moveDrag(event);
      const drag = this.drag;
      const now = performance.now();
      const recentlyMoved = drag.pointerMoved && now - drag.lastMoveAt < 100;
      this.drag = null;
      this.host.clip.classList.remove('is-bob-dragging');
      if (drag.startedRunning) {
        // Releasing a running pendulum resumes it with the velocity imparted
        // by the drag; grabbing must not turn a running simulation into rest.
        this.w1 = recentlyMoved ? drag.targetW1 : drag.startW1;
        if (drag.bob === 2) this.w2 = recentlyMoved ? drag.targetW2 : drag.startW2;
        this.lastTick = now;
        this.playAcc = 0;
        this.autoStartAt = 0;
      } else {
        this.w1 = 0;
        this.w2 = 0;
        this.autoStartAt = now + LESSON_AUTOSTART_MS;
      }
      if (event.type !== 'pointercancel') this.seedNeighbors();
      this.requestDraw();
    };
    this.host.clip.addEventListener('pointerup', end, true);
    this.host.clip.addEventListener('pointercancel', end, true);
    this.host.clip.addEventListener('wheel', (event) => {
      if (!this.active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, passive: false });
    this.host.clip.addEventListener('contextmenu', (event) => {
      if (!this.active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
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
