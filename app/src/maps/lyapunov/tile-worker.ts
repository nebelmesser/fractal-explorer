import { encodeLyapunovExponent, lyapunovExponent } from './physics';
import type { LyapunovTileRequest, LyapunovTileResponse } from './tile-job';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<LyapunovTileRequest>) => void) | null;
  postMessage(msg: LyapunovTileResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (event: MessageEvent<LyapunovTileRequest>) => {
  const req = event.data;
  try {
    const out = new Float32Array(req.width * req.height);
    const spanX = req.xMax - req.xMin;
    const spanY = req.yMax - req.yMin;
    for (let y = 0; y < req.height; y++) {
      const b = req.yMin + ((y + 0.5) / req.height) * spanY;
      for (let x = 0; x < req.width; x++) {
        const a = req.xMin + ((x + 0.5) / req.width) * spanX;
        out[y * req.width + x] = encodeLyapunovExponent(lyapunovExponent(
          a, b, req.maxIter, req.rhythm, req.seed,
        ));
      }
    }
    const reply: LyapunovTileResponse = { id: req.id, buffer: out.buffer };
    scope.postMessage(reply, [out.buffer]);
  } catch (error) {
    const reply: LyapunovTileResponse = {
      id: req.id,
      error: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(reply);
  }
};
