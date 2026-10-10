import { escapeTime } from './physics';
import type { MandelbrotTileRequest, MandelbrotTileResponse } from './tile-job';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<MandelbrotTileRequest>) => void) | null;
  postMessage(msg: MandelbrotTileResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (event: MessageEvent<MandelbrotTileRequest>) => {
  const req = event.data;
  try {
    const out = new Float32Array(req.width * req.height);
    const spanX = req.xMax - req.xMin;
    const spanY = req.yMax - req.yMin;
    for (let y = 0; y < req.height; y++) {
      const imag = -(req.yMin + ((y + 0.5) / req.height) * spanY);
      for (let x = 0; x < req.width; x++) {
        const real = req.xMin + ((x + 0.5) / req.width) * spanX;
        out[y * req.width + x] = escapeTime(
          real, imag, req.maxIter, req.morph, req.juliaReal, req.juliaImag,
        );
      }
    }
    const reply: MandelbrotTileResponse = { id: req.id, buffer: out.buffer };
    scope.postMessage(reply, [out.buffer]);
  } catch (error) {
    const reply: MandelbrotTileResponse = {
      id: req.id,
      error: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(reply);
  }
};
