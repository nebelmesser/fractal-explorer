export type LyapunovTileRequest = {
  id: number;
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  maxIter: number;
  rhythm: number;
  seed: number;
};

export type LyapunovTileResponse = {
  id: number;
  buffer?: ArrayBuffer;
  error?: string;
};
