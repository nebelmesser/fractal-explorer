import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const directory = await mkdtemp(join(tmpdir(), 'deep-zoom-test-'));
try {
  async function module(path) {
    const output = join(directory, path.split('/').pop() + '.mjs');
    await build({ entryPoints: [path], outfile: output, bundle: true, platform: 'node', format: 'esm' });
    return import(pathToFileURL(output).href);
  }
  const c = await module('src/viewer/coordinates.ts');
  const v = await module('src/viewer/view.ts');
  const t = await module('src/maps/types.ts');
  const m = await module('src/maps/mandelbrot/deep-math.ts');
  const tiles = await module('src/viewer/precision-tiles.ts');
  const world = c.withPrecision({ xMin: -3, xMax: 3, yMin: -3, yMax: 3 });
  const close = (a,b,tol=1e-12) => assert.ok(Math.abs(a-b) <= tol * Math.max(Math.abs(a),Math.abs(b),b === 0 ? 1 : 1e-300), `${a} != ${b}`);
  for (const span of [1, 1e-15, 1e-80, 1e-250, 1e-280]) {
    const view = c.preciseView({ x: c.coordinateFromString('-0.743643887037151'), y: c.coordinateFromString('-0.13182590420533') }, span, span);
    const p = v.screenToMap(view, 320, 440, 800, 800);
    const zoom = v.zoomAbout(view, p.x, p.y, 0.5, world, {}, 1e-280, p.origin);
    const screen = v.screenToMap(zoom, 320, 440, 800, 800);
    close(c.coordinateToNumber(screen.origin.x + c.coordinateFromNumber(screen.x) - p.origin.x - c.coordinateFromNumber(p.x)) / span, 0, 1e-12);
    const pan = v.panView(view, 1, 0, 800, 800, {});
    assert.notEqual(pan.origin.x, view.origin.x);
    close(c.coordinateToNumber(pan.origin.x - view.origin.x), -span/800);
    const text = c.coordinateToString(pan.origin.x);
    close(c.coordinateToNumber(c.coordinateFromString(text) - pan.origin.x) / span, 0, 1e-12);
    const step = v.nextUnzoomCover(view, world, {});
    close(v.shortSpan(step), span * 2);
    const interpolated = t.lerpView(view, world, 0.5);
    assert.ok(Number.isFinite(v.shortSpan(interpolated)) && v.shortSpan(interpolated) > span);
    assert.ok(t.viewsEqual(view, t.copyView(view), 0));
    assert.ok(!t.viewsEqual(view, pan, 0));
    const cells = tiles.precisionCells(view, 800, 800);
    const shifted = tiles.precisionCells(pan, 800, 800);
    assert.equal(new Set(cells.map(cell => cell.id)).size, cells.length);
    assert.ok(shifted.filter(cell => cells.some(old => old.id === cell.id)).length >= cells.length * .8, 'one-pixel pan must reuse world tiles');
    for (let i = 1; i < cells.length; i++) assert.ok(cells[i].distance >= cells[i - 1].distance, 'center-first queue');
    const grid = c.relativeView(cells[0].view, view);
    assert.ok(Math.abs((grid.xMin + grid.xMax) / 2) < span / 4);
    const ready = new Map(), finalRings = [];
    for (const job of tiles.precisionTileQueue(cells, id => ready.get(id) ?? 0)) {
      assert.ok(job.size > (ready.get(job.cell.id) ?? 0), 'no duplicate tile work');
      ready.set(job.cell.id, job.size);
      if (job.size === 128) finalRings.push(job.cell.ring);
    }
    assert.equal(ready.size, cells.length);
    assert.ok([...ready.values()].every(size => size === 128));
    assert.deepEqual(finalRings, [...finalRings].sort((a, b) => a - b), 'full resolution expands in rings');
    assert.equal([...tiles.precisionTileQueue(cells, id => ready.get(id) ?? 0)].length, 0, 'cached view does no work');
  }
  // Independent 1200-bit escape oracle around the exactly representable cusp -2.
  function oracle(x, y, iterations) {
    const shift = 1200n, scale = 1n << shift;
    const cr = x >> (4096n-shift), ci = -y >> (4096n-shift);
    let r=0n,i=0n;
    for(let n=0;n<iterations;n++) {
      const next=(r*r-i*i)/scale+cr;i=2n*r*i/scale+ci;r=next;
      if(r*r+i*i>256n*scale*scale) return n;
    }
    return -1;
  }
  let cases=0;
  for(const span of [1e-8,1e-30,1e-80,1e-250,1e-280]) {
    const view = c.preciseView({ x: c.coordinateFromString('-2'), y:0n },span,span);
    const ref = m.makeReference(view,{ MAX_ITERATIONS:1024 });
    const samples=m.fillDeepTile(ref,view,9,9);
    for(let y=0;y<9;y++) for(let x=0;x<9;x++) {
      const px=((x+.5)/9-.5)*span,py=((y+.5)/9-.5)*span;
      const point={x:ref.center.x+c.coordinateFromNumber(px),y:c.coordinateFromNumber(py)};
      const value=samples[y*9+x], direct=m.directEscape(point,ref);
      assert.equal(value>0,oracle(point.x,point.y,1024)>=0,`oracle ${span} ${x},${y}`);
      close(value,direct,1e-6);
      cases++;
    }
    assert.ok(new Set(samples).size>9,'deep image contains distinct detail');
  }
  // Perturbation is also valid for the nonzero initial orbit of the Julia morph.
  for(const morph of [0,.5,1]) {
    const view=c.preciseView({x:c.coordinateFromString('-.743643887037151'.replace('-.','-0.')),y:c.coordinateFromString('-0.13182590420533')},1e-10,1e-10);
    const ref=m.makeReference(view,{MAX_ITERATIONS:8192,MORPH:morph});
    const samples=m.fillDeepTile(ref,view,5,5);
    for(let y=0;y<5;y++)for(let x=0;x<5;x++) {
      const point={x:ref.center.x+c.coordinateFromNumber(((x+.5)/5-.5)*1e-10),y:ref.center.y+c.coordinateFromNumber(((y+.5)/5-.5)*1e-10)};
      close(samples[y*5+x],m.directEscape(point,ref),1e-5);
    }
  }
  console.log(`Deep zoom: exact camera, anchored zoom, 1-pixel pan, URL, history, reset coverage and ${cases} independent high-precision samples through 1e-280 passed.`);
} finally { await rm(directory,{recursive:true,force:true}); }
