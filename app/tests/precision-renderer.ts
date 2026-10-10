import type { MapDefinition, ViewRect } from '../src/maps/types';
import { PrecisionRenderer } from '../src/viewer/precision-renderer';
import { precisionCells } from '../src/viewer/precision-tiles';
import { coordinateFromNumber, coordinateFromString, exactCenter, preciseView } from '../src/viewer/coordinates';

const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

/** Exercise asynchronous publication, cancellation and reuse on the real Canvas compositor. */
export async function checkPrecisionRenderer(): Promise<string> {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const width = 512, height = 384, span = .0005;
  const view = preciseView({ x: coordinateFromString('0.019868263825616673'), y: coordinateFromString('0.08603614835648674') }, span * width / height, span);
  const cells = precisionCells(view, width, height);
  const pause = deferred(), reached = deferred();
  let calls = 0, block = true;
  const sampled: ViewRect[] = [];
  const fill = async (tile: ViewRect, w: number, h: number) => {
    calls++; sampled.push(tile);
    if (block && calls === 2) { reached.resolve(); await pause.promise; }
    return new Float32Array(w * h).fill(1);
  };
  const map = {
    cpu: { fillTile: fill },
    precision: { threshold: 1, begin: async () => ({ fillTile: fill }) },
  } as unknown as MapDefinition;
  const renderer = await PrecisionRenderer.create(null, canvas, map, {
    gpuWgsl: '', exposure: 'none', colorize: () => [1, 1, 1],
  });
  try {
    const pending = renderer.render(view, {}, width, height, false, 1);
    await reached.promise;
    assert(canvas.dataset.ready === '1' && canvas.dataset.complete === '0', 'first tile must publish before the frame is complete');
    const first = exactCenter(sampled[0]), expected = exactCenter(cells[0].view);
    assert(first.x === expected.x && first.y === expected.y, 'first published tile must be nearest to the center');
    const image = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    assert(image[(Math.floor(height / 2) * width + Math.floor(width / 2)) * 4] > 0 && image[0] === 0, 'center must appear before corners');
    const away = preciseView({ x: view.origin!.x + coordinateFromNumber(span), y: view.origin!.y }, span * width / height, span);
    renderer.present(away, {}, width, height, false, 1);
    pause.resolve(); await pending;
    assert(calls === 2, 'cancelled view must not drain the old queue');
    block = false;
    const before = calls;
    await renderer.render(view, {}, width, height, false, 1);
    assert(calls - before === cells.length * 2 - 1, 'completed tile must survive cancellation; interrupted tile must be retried');
    assert(canvas.dataset.complete === '1', 'queue must finish at full resolution');
    assert(canvas.getContext('2d')!.getImageData(0, 0, width, height).data.every(value => value === 255), 'adjacent tiles must not leave dark seams');
    const cached = calls;
    await renderer.render(view, {}, width, height, false, 1);
    assert(calls === cached, 'cached view must not recompute');
    const moved = preciseView({ x: view.origin!.x + coordinateFromNumber(span / height), y: view.origin!.y }, span * width / height, span);
    const missing = precisionCells(moved, width, height).filter(cell => !cells.some(old => old.id === cell.id)).length;
    await renderer.render(moved, {}, width, height, false, 1);
    assert(calls - cached === missing * 2, 'pan must compute only newly exposed world tiles');
    return `Tile queue PASS: center publishes while edge pending; stale work cancels; ${cells.length} cached tiles reused; one-pixel pan computes ${missing} new tiles`;
  } finally { renderer.invalidateParams({}); canvas.remove(); }
}
