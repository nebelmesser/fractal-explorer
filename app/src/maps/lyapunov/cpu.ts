import TileWorker from './tile-worker.ts?worker';
import {
  LYAPUNOV_CPU_WORKERS,
  LYAPUNOV_MIN_ITER,
  LYAPUNOV_RHYTHM_DEFAULT,
  LYAPUNOV_SEED,
} from './constants';
import type { MapParams, ViewRect } from '../types';
import type { LyapunovTileRequest, LyapunovTileResponse } from './tile-job';

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
  return Math.max(1, Math.min(LYAPUNOV_CPU_WORKERS, cores - 1));
}

export function lyapunovCpuConcurrency(): number {
  return poolSize();
}

function acquire(): Promise<Worker> {
  const worker = idle.pop();
  return worker ? Promise.resolve(worker) : new Promise((resolve) => waiters.push(resolve));
}

function release(worker: Worker): void {
  if (!pool?.includes(worker)) return;
  const waiter = waiters.shift();
  if (waiter) waiter(worker);
  else idle.push(worker);
}

function onMessage(event: MessageEvent<LyapunovTileResponse>): void {
  const job = pending.get(event.data.id);
  if (!job) return;
  pending.delete(event.data.id);
  if (!event.data.buffer || event.data.error) {
    job.reject(new Error(event.data.error ?? 'Lyapunov CPU worker returned no buffer'));
    return;
  }
  job.resolve(event.data.buffer);
}

function spawnWorker(): Worker {
  const worker = new TileWorker();
  worker.onmessage = onMessage;
  worker.onerror = (event) => failWorker(worker, new Error(event.message || 'Lyapunov CPU worker failed'));
  worker.onmessageerror = () => failWorker(worker, new Error('Lyapunov CPU worker message error'));
  return worker;
}

function failWorker(worker: Worker, error: Error): void {
  for (const [id, job] of pending) {
    if (job.worker !== worker) continue;
    pending.delete(id);
    job.reject(error);
  }
  const idleAt = idle.indexOf(worker);
  if (idleAt >= 0) idle.splice(idleAt, 1);
  if (!pool) return;
  const at = pool.indexOf(worker);
  if (at < 0) return;
  pool.splice(at, 1);
  try { worker.terminate(); } catch { /* already stopped */ }
  const replacement = spawnWorker();
  pool.push(replacement);
  release(replacement);
}

export function cancelLyapunovCpu(): void {
  if (!pool) return;
  cancelEpoch += 1;
  const obsolete = new Set(pool);
  pool = [];
  idle.length = 0;
  const error = new Error('Lyapunov CPU tile superseded by a newer camera');
  error.name = 'AbortError';
  for (const [id, job] of pending) {
    if (!obsolete.has(job.worker)) continue;
    pending.delete(id);
    job.reject(error);
  }
  for (const worker of obsolete) {
    try { worker.terminate(); } catch { /* already stopped */ }
  }
  for (let i = 0; i < poolSize(); i++) {
    const worker = spawnWorker();
    pool.push(worker);
    release(worker);
  }
}

function ensurePool(): void {
  if (pool) return;
  pool = [];
  for (let i = 0; i < poolSize(); i++) {
    const worker = spawnWorker();
    pool.push(worker);
    idle.push(worker);
  }
}

function run(worker: Worker, request: LyapunovTileRequest): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    pending.set(request.id, { worker, resolve, reject });
    worker.postMessage(request);
  });
}

export async function fillLyapunovTile(
  view: ViewRect,
  width: number,
  height: number,
  params: MapParams,
): Promise<Float32Array> {
  ensurePool();
  const epoch = cancelEpoch;
  const worker = await acquire();
  try {
    if (epoch !== cancelEpoch) {
      const error = new Error('Lyapunov CPU tile superseded before dispatch');
      error.name = 'AbortError';
      throw error;
    }
    const buffer = await run(worker, {
      id: nextId++,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      xMin: view.xMin,
      xMax: view.xMax,
      yMin: view.yMin,
      yMax: view.yMax,
      maxIter: Math.max(LYAPUNOV_MIN_ITER, Math.round(params.MAX_ITERATIONS ?? LYAPUNOV_MIN_ITER)),
      rhythm: Math.round(params.RHYTHM ?? LYAPUNOV_RHYTHM_DEFAULT),
      seed: params.SEED ?? LYAPUNOV_SEED,
    });
    return new Float32Array(buffer);
  } finally {
    release(worker);
  }
}
