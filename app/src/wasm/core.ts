import { PENDULUM_MIN_ITER } from '../constants';
import type { MapParams } from '../maps/types';

export type Trajectory = {
  th1: number;
  th2: number;
  startTh1: number;
  startTh2: number;
  steps: number;
  done: boolean;
  step(params: MapParams, dt: number): void;
};

const ESCAPE = Math.PI * 2;

function afterKernelStep(traj: Trajectory, params: MapParams): void {
  traj.steps += 1;
  const cap = Math.max(PENDULUM_MIN_ITER, Math.round(params.MAX_ITERATIONS ?? PENDULUM_MIN_ITER));
  if (Math.abs(traj.th1) > ESCAPE || traj.steps >= cap) traj.done = true;
}

type WasmPendulum = {
  new(th1: number, th2: number): {
    step(l1: number, l2: number, m1: number, m2: number, g: number, dt: number): void;
    readonly th1: number;
    readonly th2: number;
  };
};

let WasmCtor: WasmPendulum | null = null;

/** Load the WASM crate that steps one pendulum. The map never goes through here. */
export async function initMapCore(): Promise<void> {
  try {
    const mod = await import('./pkg/map_core.js');
    const wasmUrl = (await import('./pkg/map_core_bg.wasm?url')).default;
    await mod.default(wasmUrl);
    WasmCtor = mod.Pendulum as unknown as WasmPendulum;
  } catch (error) {
    console.warn('map_core WASM failed to load; preview uses the TS integrator', error);
    WasmCtor = null;
  }
}

export function createTrajectory(th1: number, th2: number): Trajectory {
  if (WasmCtor) {
    const inner = new WasmCtor(th1, th2);
    const traj: Trajectory = {
      startTh1: th1,
      startTh2: th2,
      steps: 0,
      done: false,
      get th1() { return inner.th1; },
      get th2() { return inner.th2; },
      step(params, dt) {
        if (traj.done) return;
        inner.step(params.L1, params.L2, params.M1, params.M2, params.G, dt);
        afterKernelStep(traj, params);
      },
    };
    return traj;
  }
  return new TsPendulum(th1, th2);
}

/** Same ODE as the Rust crate / WGSL kernel — used only if WASM is missing. */
class TsPendulum implements Trajectory {
  th1: number;
  th2: number;
  startTh1: number;
  startTh2: number;
  steps = 0;
  done = false;
  private w1 = 0;
  private w2 = 0;

  constructor(th1: number, th2: number) {
    this.th1 = th1;
    this.th2 = th2;
    this.startTh1 = th1;
    this.startTh2 = th2;
  }

  step(params: MapParams, dt: number): void {
    if (this.done) return;
    const { L1, L2, M1, M2, G } = params;
    const gM = G * (M1 + M2);
    const twoM = 2 * M1 + M2;
    const sin1 = Math.sin(this.th1);
    const cos1 = Math.cos(this.th1);
    const s12 = Math.sin(this.th1 - this.th2);
    const c12 = Math.cos(this.th1 - this.th2);
    const c2 = Math.cos(2 * (this.th1 - this.th2));
    const common = twoM - M2 * c2;
    const den1 = L1 * common;
    let a1 = 0;
    if (Math.abs(den1) >= 1e-9) {
      a1 = (
        -G * twoM * sin1
        + (-M2 * G * Math.sin(this.th1 - 2 * this.th2))
        + (-2 * s12 * M2 * (this.w2 * this.w2 * L2 + this.w1 * this.w1 * L1 * c12))
      ) / den1;
    }
    const den2 = L2 * common;
    let a2 = 0;
    if (Math.abs(den2) >= 1e-9) {
      const term = this.w1 * this.w1 * L1 * (M1 + M2) + gM * cos1 + this.w2 * this.w2 * L2 * M2 * c12;
      a2 = (2 * s12 * term) / den2;
    }
    this.w1 += a1 * dt;
    this.w2 += a2 * dt;
    this.th1 += this.w1 * dt;
    this.th2 += this.w2 * dt;
    afterKernelStep(this, params);
  }
}
