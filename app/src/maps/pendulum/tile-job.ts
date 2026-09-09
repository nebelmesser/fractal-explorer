export type TileStripRequest = {
  id: number;
  width: number;
  height: number;
  row0: number;
  row1: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  L1: number;
  L2: number;
  M1: number;
  M2: number;
  G: number;
  DT: number;
  F: number;
  maxIter: number;
};

export type TileStripResponse = {
  id: number;
  buffer?: ArrayBuffer;
  error?: string;
};
