export type MagnetsTileRequest = {
  id: number;
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  K: number;
  G: number;
  F: number;
  H: number;
  R: number;
  DT: number;
  maxIter: number;
};

export type MagnetsTileResponse = {
  id: number;
  buffer?: ArrayBuffer;
  error?: string;
};
