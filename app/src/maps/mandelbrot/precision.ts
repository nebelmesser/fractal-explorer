import { packPerturbationUniforms } from './deep-uniforms';
import DeepWorker from './deep-worker.ts?worker';
import computeWgsl from './perturbation.wgsl?raw';
import { coordinateFromNumber, exactCenter, preciseView, type CoordinateOrigin } from '../../viewer/coordinates';
import { viewSpanX, viewSpanY, type PrecisionKernel, type PrecisionSession, type ViewRect } from '../types';
import { DEEP_MIN_SPAN, DEEP_THRESHOLD, DEEP_REFERENCE_RETRIES, DEEP_REFERENCE_MIN_FLAGS } from './constants';

type Reply = { id: number; error?: string; storage?: Float32Array; center?: CoordinateOrigin; samples?: Float32Array };
export const mandelbrotPrecision: PrecisionKernel = {
  minSpan: DEEP_MIN_SPAN, threshold: DEEP_THRESHOLD,
  gpu: { computeWgsl, entryPoint: 'simulate', uniformBytes: 64 },
  async begin(view, params, signal) {
    if (signal.aborted) throw new DOMException('Superseded', 'AbortError');
    const worker = new DeepWorker();
    let nextId = 0;
    const pending = new Map<number, { resolve(reply: Reply): void; reject(error: Error): void }>();
    const stop = (error: Error): void => { worker.terminate(); for (const job of pending.values()) job.reject(error); pending.clear(); };
    signal.addEventListener('abort', () => stop(new DOMException('Superseded', 'AbortError')), { once: true });
    worker.onerror = event => stop(new Error(event.message));
    worker.onmessageerror = () => stop(new Error('Deep worker message failed'));
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const job = pending.get(event.data.id); if (!job) return;
      pending.delete(event.data.id);
      if (event.data.error) job.reject(new Error(event.data.error)); else job.resolve(event.data);
    };
    const run = (data: object): Promise<Reply> => new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('Superseded', 'AbortError')); return; }
      const id = nextId++; pending.set(id, { resolve, reject }); worker.postMessage({ ...data, id });
    });
    const sessionFor = (result: Reply, depth = 0): PrecisionSession => {
      const center = result.center!, storage = result.storage!;
      const fill = async (tile: ViewRect, width: number, height: number, samples?: Float32Array): Promise<Float32Array> => (await run({ view: tile, width, height, samples, referenceId: result.id })).samples!;
      return {
        needsRefinement: samples => samples.some(v => v < 0 || !Number.isFinite(v)),
        mergeRefinement(samples, replacement) {
          for (let i = 0; i < samples.length; i++) if (samples[i] < 0 || !Number.isFinite(samples[i])) samples[i] = replacement[i];
          return samples;
        },
        gpu: {
          storage,
          packUniforms: (tile, width, height) => packPerturbationUniforms(tile, width, height, center, storage.length / 8, params),
        },
        async refineTile(samples, tile, width, height) {
          if (depth >= DEEP_REFERENCE_RETRIES) return null;
          const flagged: number[] = [];
          for (let i = 0; i < samples.length; i++) if (samples[i] < 0 || !Number.isFinite(samples[i])) flagged.push(i);
          if (flagged.length < DEEP_REFERENCE_MIN_FLAGS) return null;
          const index = flagged[Math.floor(flagged.length / 2)];
          const tc = exactCenter(tile), sx = viewSpanX(tile), sy = viewSpanY(tile);
          const point = { x: tc.x + coordinateFromNumber(((index % width + 0.5) / width - 0.5) * sx), y: tc.y + coordinateFromNumber(((Math.floor(index / width) + 0.5) / height - 0.5) * sy) };
          return sessionFor(await run({ view: preciseView(point, sx, sy), params }), depth + 1);
        },
        fillTile: (tile, width, height) => fill(tile, width, height),
        repairTile: (samples, tile, width, height) => samples.some(v => v < 0 || !Number.isFinite(v)) ? fill(tile, width, height, samples) : Promise.resolve(samples),
      };
    };
    return sessionFor(await run({ view, params }));
  },
};
