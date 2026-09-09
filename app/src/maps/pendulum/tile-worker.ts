import init, { fill_map_tile } from './pkg/map_core.js';
import wasmUrl from './pkg/map_core_bg.wasm?url';
import type { TileStripRequest, TileStripResponse } from './tile-job';

const ready = init({ module_or_path: wasmUrl });
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<TileStripRequest>) => void) | null;
  postMessage(msg: TileStripResponse, transfer?: Transferable[]): void;
};

scope.onmessage = async (event: MessageEvent<TileStripRequest>) => {
  const req = event.data;
  try {
    await ready;
    const rows = Math.max(0, req.row1 - req.row0);
    const out = new Float32Array(req.width * rows);
    fill_map_tile(
      out,
      req.width,
      req.height,
      req.row0,
      req.row1,
      req.xMin,
      req.xMax,
      req.yMin,
      req.yMax,
      req.L1,
      req.L2,
      req.M1,
      req.M2,
      req.G,
      req.DT,
      req.F,
      req.maxIter,
    );
    const reply: TileStripResponse = { id: req.id, buffer: out.buffer };
    scope.postMessage(reply, [out.buffer]);
  } catch (error) {
    const reply: TileStripResponse = {
      id: req.id,
      error: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(reply);
  }
};
