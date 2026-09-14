import { packedMagnetsDwellF64, prepareMagnetsCpuPhys } from './cpu-physics';
import type { MagnetsTileRequest, MagnetsTileResponse } from './tile-job';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<MagnetsTileRequest>) => void) | null;
  postMessage(msg: MagnetsTileResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (event: MessageEvent<MagnetsTileRequest>) => {
  const req = event.data;
  try {
    const buffer = new ArrayBuffer(req.width * req.height * Float32Array.BYTES_PER_ELEMENT);
    const packed = new Uint32Array(buffer);
    const spanX = req.xMax - req.xMin;
    const spanY = req.yMax - req.yMin;
    const phys = prepareMagnetsCpuPhys({
      K: req.K,
      G: req.G,
      F: req.F,
      H: req.H,
      R: req.R,
      DT: req.DT,
      maxIter: req.maxIter,
    });
    for (let y = 0; y < req.height; y++) {
      const worldY = req.yMin + ((y + 0.5) / req.height) * spanY;
      for (let x = 0; x < req.width; x++) {
        const worldX = req.xMin + ((x + 0.5) / req.width) * spanX;
        packed[y * req.width + x] = packedMagnetsDwellF64(worldX, worldY, phys);
      }
    }
    const reply: MagnetsTileResponse = { id: req.id, buffer };
    scope.postMessage(reply, [buffer]);
  } catch (error) {
    const reply: MagnetsTileResponse = {
      id: req.id,
      error: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(reply);
  }
};
