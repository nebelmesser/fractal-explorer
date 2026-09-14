export type ChirikovTileRequest = {
  id: number;
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  k: number;
  iterations: number;
};

export type ChirikovTileResponse = {
  id: number;
  buffer?: ArrayBuffer;
  error?: string;
};
