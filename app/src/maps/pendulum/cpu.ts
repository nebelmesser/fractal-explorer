import TileWorker from './tile-worker.ts?worker';
import { PENDULUM_CPU_WORKERS, PENDULUM_MIN_ITER } from './constants';
import type { MapParams, ViewRect } from '../types';
import type { TileStripRequest, TileStripResponse } from './tile-job';

type Pending = {
  worker: Worker;
  resolve: (buffer: ArrayBuffer) => void;
  reject: (error: Error) => void;
};

let pool: Worker[] | null = null;
let nextId = 1;
let cancelEpoch = 0;
const pending = new Map<number, Pending>();
const idle: Worker[] = [];
const waiters: Array<(worker: Worker) => void> = [];

function poolSize(): number {
  const cores = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency ?? 4;
  return Math.max(1, Math.min(PENDULUM_CPU_WORKERS, cores - 1));
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
  if (!pool?.includes(worker)) return;
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

function spawnWorker(): Worker {
  const worker = new TileWorker();
  worker.onmessage = onMessage;
  worker.onerror = (event) => failWorker(worker, new Error(event.message || 'CPU tile worker failed'));
  worker.onmessageerror = () => failWorker(worker, new Error('CPU tile worker message error'));
  return worker;
}

function failWorker(worker: Worker, err: Error): void {
  for (const [id, job] of pending) {
    if (job.worker !== worker) continue;
    pending.delete(id);
    job.reject(err);
  }
  const idleAt = idle.indexOf(worker);
  if (idleAt >= 0) idle.splice(idleAt, 1);
  if (pool) {
    const at = pool.indexOf(worker);
    if (at < 0) return;
    pool.splice(at, 1);
    try { worker.terminate(); } catch { /* already dead */ }
    const replacement = spawnWorker();
    pool.push(replacement);
    release(replacement);
  }
}

/** Stop tiles for a camera that is no longer visible and replace their workers. */
export function cancelPendulumCpu(): void {
  if (!pool) return;
  cancelEpoch += 1;
  const obsolete = new Set(pool);
  pool = [];
  idle.length = 0;
  const error = new Error('CPU tile superseded by a newer camera');
  error.name = 'AbortError';
  for (const [id, job] of pending) {
    if (!obsolete.has(job.worker)) continue;
    pending.delete(id);
    job.reject(error);
  }
  for (const worker of obsolete) {
    try { worker.terminate(); } catch { /* already dead */ }
  }
  for (let i = 0; i < poolSize(); i++) {
    const worker = spawnWorker();
    pool.push(worker);
    release(worker);
  }
}

function ensurePool(): Worker[] {
  if (pool) return pool;
  const workers: Worker[] = [];
  for (let i = 0; i < poolSize(); i++) {
    const worker = spawnWorker();
    workers.push(worker);
    idle.push(worker);
  }
  pool = workers;
  return workers;
}

function runStrip(worker: Worker, req: TileStripRequest): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    pending.set(req.id, { worker, resolve, reject });
    worker.postMessage(req);
  });
}

/**
 * Fill one f64 escape-time tile on one worker.
 *
 * The renderer already submits one independent tile per worker. Splitting every
 * tile into row jobs made the first tile reserve the whole pool while the other
 * center-first tiles waited, and multiplied worker messages for small strips.
 */
export async function fillPendulumTile(
  view: ViewRect,
  width: number,
  height: number,
  params: MapParams,
): Promise<Float32Array> {
  ensurePool();
  const epoch = cancelEpoch;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const maxIter = Math.max(PENDULUM_MIN_ITER, Math.round(params.MAX_ITERATIONS ?? PENDULUM_MIN_ITER));
  const worker = await acquire();
  try {
    // Requests already waiting for a worker when the camera changed are not in
    // `pending` yet, so terminating active workers alone cannot cancel them.
    if (epoch !== cancelEpoch) {
      const error = new Error('CPU tile superseded before dispatch');
      error.name = 'AbortError';
      throw error;
    }
    const id = nextId++;
    const buffer = await runStrip(worker, {
      id,
      row0: 0,
      row1: h,
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
    });
    return new Float32Array(buffer);
  } finally {
    release(worker);
  }
}
