export type BurningShipTileRequest = {
  id: number;
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  maxIter: number;
};

export type BurningShipTileResponse = {
  id: number;
  buffer?: ArrayBuffer;
  error?: string;
};
