import type { ViewRect } from '../types';
import { shipEscapeTime } from './physics';
import { traceShip, type ShipTrace } from './orbit';

export type ShipOrbitJob = { real: number; imag: number; maxIter: number; f32: boolean };
export type ShipOrbitRequest = { kind: 'trace'; id: number; job: ShipOrbitJob }
  | { kind: 'overview'; id: number; view: ViewRect; width: number; height: number; maxIter: number };
export type ShipOrbitReply = { kind: 'trace'; id: number; trace?: ShipTrace; error?: string }
  | { kind: 'overview'; id: number; samples: Float32Array; width: number; height: number };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ShipOrbitRequest>) => void) | null;
  postMessage(reply: ShipOrbitReply, transfer?: Transferable[]): void;
};

scope.onmessage = ({ data: request }) => {
  if (request.kind === 'trace') {
    try {
      const job = request.job;
      scope.postMessage({ kind: 'trace', id: request.id, trace: traceShip(job.real, job.imag, job.maxIter, job.f32) });
    } catch (error) { scope.postMessage({ kind: 'trace', id: request.id, error: String(error) }); }
    return;
  }
  const { view, width, height } = request;
  const samples = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    samples[y * width + x] = shipEscapeTime(
      view.xMin + (x + 0.5) / width * (view.xMax - view.xMin),
      view.yMin + (y + 0.5) / height * (view.yMax - view.yMin), request.maxIter,
    );
  }
  scope.postMessage({ kind: 'overview', id: request.id, width, height, samples }, [samples.buffer]);
};
