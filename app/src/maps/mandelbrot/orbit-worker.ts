import { calculateOrbit, type OrbitJob } from './orbit-job';
import type { MapParams, ViewRect } from '../types';
import { sampleOverview } from './orbit-overview';
import type { OrbitTrace } from './cycles';

export type OrbitRequest = { kind: 'trace'; id: number; job: OrbitJob } | { kind: 'overview'; key: string; width: number; height: number; view: ViewRect; params: MapParams };
export type OrbitReply = { kind: 'trace'; id: number; trace?: OrbitTrace; error?: string } | { kind: 'overview'; key: string; width: number; height: number; samples: Float32Array };
self.onmessage = (event: MessageEvent<OrbitRequest>) => {
  const request = event.data;
  if (request.kind === 'overview') {
    const { width, height, key, view, params } = request;
    const samples = sampleOverview(view,width,height,params);
    self.postMessage({kind:'overview',key,width,height,samples}, {transfer:[samples.buffer]});
    return;
  }
  try { self.postMessage({ kind: 'trace', id: request.id, trace: calculateOrbit(request.job) }); }
  catch (error) { self.postMessage({ kind: 'trace', id: request.id, error: String(error) }); }
};
