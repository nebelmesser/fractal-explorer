import { DEEP_REFERENCE_CACHE } from './constants';
import { packReference } from './deep-storage';
import { fillDeepTile, makeReference, type Reference } from './deep-math';
import type { MapParams, ViewRect } from '../types';
const references = new Map<number, Reference>();
self.onmessage = (event: MessageEvent<{ id: number; view: ViewRect; params?: MapParams; width?: number; height?: number; samples?: Float32Array; referenceId?: number }>) => {
  const job = event.data;
  try {
    if (job.params) {
      const reference = makeReference(job.view, job.params);
      references.set(job.id, reference);
      if (references.size > DEEP_REFERENCE_CACHE) references.delete([...references.keys()].find(id => id !== 0)!);
      const storage = packReference(reference.orbit);
      self.postMessage({ id: job.id, storage, center: reference.center }, { transfer: [storage.buffer] });
    } else {
      const samples = fillDeepTile(references.get(job.referenceId!)!, job.view, job.width!, job.height!, job.samples);
      self.postMessage({ id: job.id, samples }, { transfer: [samples.buffer] });
    }
  } catch (error) { self.postMessage({ id: job.id, error: String(error) }); }
};
