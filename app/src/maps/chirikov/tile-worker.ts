import { chirikovSignature, packChirikovSignature } from './physics';
import type { ChirikovTileRequest, ChirikovTileResponse } from './tile-job';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ChirikovTileRequest>) => void) | null;
  postMessage(msg: ChirikovTileResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (event: MessageEvent<ChirikovTileRequest>) => {
  const req = event.data;
  try {
    const buffer = new ArrayBuffer(req.width * req.height * Float32Array.BYTES_PER_ELEMENT);
    const packed = new Uint32Array(buffer);
    const spanX = req.xMax - req.xMin;
    const spanY = req.yMax - req.yMin;
    for (let y = 0; y < req.height; y++) {
      const momentum = req.yMin + ((y + 0.5) / req.height) * spanY;
      for (let x = 0; x < req.width; x++) {
        const theta = req.xMin + ((x + 0.5) / req.width) * spanX;
        packed[y * req.width + x] = packChirikovSignature(chirikovSignature(
          theta,
          momentum,
          req.k,
          req.iterations,
        ));
      }
    }
    const reply: ChirikovTileResponse = { id: req.id, buffer };
    scope.postMessage(reply, [buffer]);
  } catch (error) {
    const reply: ChirikovTileResponse = {
      id: req.id,
      error: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(reply);
  }
};
