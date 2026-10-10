export type MandelbrotTileRequest = {
  id: number;
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  maxIter: number;
  morph: number;
  juliaReal: number;
  juliaImag: number;
};

export type MandelbrotTileResponse = {
  id: number;
  buffer?: ArrayBuffer;
  error?: string;
};
