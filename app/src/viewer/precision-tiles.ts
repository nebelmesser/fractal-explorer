import { LOD_CPU_RINGS, PRECISE_TILE_INITIAL_PX, PRECISE_TILE_PX } from '../constants';
import { viewSpanX, viewSpanY, type ViewRect } from '../maps/types';
import { coordinateFromNumber, coordinateToNumber, exactCenter, preciseView } from './coordinates';

export type PrecisionCell = { id: string; view: ViewRect; distance: number; ring: number };

function floorDiv(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  return value < 0n && value % divisor !== 0n ? quotient - 1n : quotient;
}

/** A stable world grid, including where absolute tile indices no longer fit f64. */
export function precisionCells(view: ViewRect, width: number, height: number): PrecisionCell[] {
  const sx = viewSpanX(view), sy = viewSpanY(view);
  const exponent = Math.floor(Math.log2(Math.max(sx / width, sy / height) * PRECISE_TILE_PX));
  const span = 2 ** exponent, unit = coordinateFromNumber(span);
  const center = exactCenter(view);
  const x0 = floorDiv(center.x + coordinateFromNumber(-sx / 2), unit);
  const x1 = floorDiv(center.x + coordinateFromNumber(sx / 2) - 1n, unit);
  const y0 = floorDiv(center.y + coordinateFromNumber(-sy / 2), unit);
  const y1 = floorDiv(center.y + coordinateFromNumber(sy / 2) - 1n, unit);
  const cells: PrecisionCell[] = [];
  for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
    const origin = { x: ix * unit + unit / 2n, y: iy * unit + unit / 2n };
    const distance = Math.hypot(
      coordinateToNumber(origin.x - center.x) / sx * width,
      coordinateToNumber(origin.y - center.y) / sy * height,
    );
    const ring = Math.min(LOD_CPU_RINGS - 1, Math.floor(distance / (Math.min(width, height) / 2) * LOD_CPU_RINGS));
    cells.push({ id: `${exponent}:${ix}:${iy}`, view: preciseView(origin, span, span), distance, ring });
  }
  return cells.sort((a, b) => a.distance - b.distance);
}

/** The same center-first refinement waves as the ordinary CPU tile queue. */
export function* precisionTileQueue(cells: PrecisionCell[], resolution: (id: string) => number): Generator<{ cell: PrecisionCell; size: number }> {
  for (let wave = 0; wave < LOD_CPU_RINGS; wave++) {
    for (const cell of cells) {
      const target = cell.ring <= wave ? PRECISE_TILE_PX : PRECISE_TILE_INITIAL_PX;
      if (resolution(cell.id) < PRECISE_TILE_INITIAL_PX) yield { cell, size: PRECISE_TILE_INITIAL_PX };
      if (resolution(cell.id) < target) yield { cell, size: target };
    }
  }
}
