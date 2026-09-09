import TileWorker from './tile-worker.ts?worker';
import { PENDULUM_CPU_WORKERS, PENDULUM_MIN_ITER } from './constants';
import type { MapParams, ViewRect } from '../types';
import type { TileStripRequest, TileStripResponse } from './tile-job';

type Pending = {
  resolve: (buffer: ArrayBuffer) => void;
  reject: (error: Error) => void;
};

let pool: Worker[] | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const idle: Worker[] = [];
const waiters: Array<(worker: Worker) => void> = [];

function poolSize(): number {
  const cores = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency ?? 4;
  return Math.max(1, Math.min(PENDULUM_CPU_WORKERS, cores));
}

/** How many independent tiles the engine should dispatch together. */
export function pendulumCpuConcurrency(): number {
  return poolSize();
}

function acquire(): Promise<Worker> {
  const worker = idle.pop();
  if (worker) return Promise.resolve(worker);
  return new Promise((resolve) => waiters.push(resolve));
}

function release(worker: Worker): void {
  const waiter = waiters.shift();
  if (waiter) waiter(worker);
  else idle.push(worker);
}

function onMessage(event: MessageEvent<TileStripResponse>): void {
  const job = pending.get(event.data.id);
  if (!job) return;
  pending.delete(event.data.id);
  if (event.data.error || !event.data.buffer) {
    job.reject(new Error(event.data.error ?? 'CPU tile worker returned no buffer'));
    return;
  }
  job.resolve(event.data.buffer);
}

function ensurePool(): Worker[] {
  if (pool) return pool;
  const workers: Worker[] = [];
  for (let i = 0; i < poolSize(); i++) {
    const worker = new TileWorker();
    worker.onmessage = onMessage;
    worker.onerror = (event) => {
      const err = new Error(event.message || 'CPU tile worker failed');
      for (const [id, job] of pending) {
        pending.delete(id);
        job.reject(err);
      }
    };
    workers.push(worker);
    idle.push(worker);
  }
  pool = workers;
  return workers;
}

function runStrip(worker: Worker, req: TileStripRequest): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    pending.set(req.id, { resolve, reject });
    worker.postMessage(req);
  });
}

/** f64 escape-time tile, split across WASM workers by rows. */
export async function fillPendulumTile(
  view: ViewRect,
  width: number,
  height: number,
  params: MapParams,
): Promise<Float32Array> {
  const workers = ensurePool();
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  // Keep an 8×8 tile on one worker so the pool can run many tiles at once.
  // Split only when a strip is fat enough that one core would sit on it.
  const samples = w * h;
  const count = samples <= 64 ? 1 : Math.min(workers.length, h);
  const rowsPer = Math.ceil(h / count);
  const out = new Float32Array(w * h);
  const maxIter = Math.max(PENDULUM_MIN_ITER, Math.round(params.MAX_ITERATIONS ?? PENDULUM_MIN_ITER));
  const base = {
    width: w,
    height: h,
    xMin: view.xMin,
    xMax: view.xMax,
    yMin: view.yMin,
    yMax: view.yMax,
    L1: params.L1,
    L2: params.L2,
    M1: params.M1,
    M2: params.M2,
    G: params.G,
    DT: params.DT,
    F: params.F ?? 0,
    maxIter,
  };
  await Promise.all(Array.from({ length: count }, async (_, i) => {
    const row0 = i * rowsPer;
    const row1 = Math.min(h, row0 + rowsPer);
    if (row0 >= row1) return;
    const worker = await acquire();
    try {
      const id = nextId++;
      const buffer = await runStrip(worker, { id, row0, row1, ...base });
      out.set(new Float32Array(buffer), row0 * w);
    } finally {
      release(worker);
    }
  }));
  return out;
}
