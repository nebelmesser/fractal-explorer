import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'fractal-maps-'));
try {
  async function load(map) {
    const output = join(directory, `${map}.mjs`);
    await build({ entryPoints: [`src/maps/${map}/physics.ts`], outfile: output, bundle: true, platform: 'node', format: 'esm' });
    return import(pathToFileURL(output).href);
  }
  const ship = await load('burning-ship');

  // A separate radius-two membership oracle catches sign, folding and update-order errors.
  function shipEscapes(real, imag, count) {
    let z = [0, 0];
    for (let n = 0; n < count; n++) {
      const [x, y] = z.map(Math.abs);
      z = [x * x - y * y + real, 2 * x * y + imag];
      if (z[0] * z[0] + z[1] * z[1] > 4) return true;
    }
    return false;
  }
  for (let row = 0; row < 31; row++) {
    for (let col = 0; col < 37; col++) {
      const x = -2.2 + (col + 0.5) * 3.4 / 37;
      const y = -2 + (row + 0.5) * 2.8 / 31;
      const value = ship.shipEscapeTime(x, y, 2048);
      assert.ok(Number.isFinite(value) && value >= 0);
      assert.equal(value > 0, shipEscapes(x, y, 2048));
    }
  }
  for (const [x, y] of [[0, 0], [-1, 0], [-0.5, -0.5]]) assert.equal(ship.shipEscapeTime(x, y, 2048), 0);
  assert.notEqual(ship.shipEscapeTime(-1.8, -0.04, 2048), ship.shipEscapeTime(-1.8, 0.04, 2048));

  const orbitOutput = join(directory, 'ship-orbit.mjs');
  await build({ entryPoints: ['src/maps/burning-ship/orbit.ts'], outfile: orbitOutput, bundle: true, platform: 'node', format: 'esm' });
  const { shipStep, traceShip } = await import(pathToFileURL(orbitOutput).href);
  const step = shipStep({ r: -0.5, i: -0.25 }, { r: -1.8, i: -0.03 }, false);
  assert.deepEqual(step.folded, { r: 0.5, i: 0.25 });
  assert.deepEqual(step.squared, { r: 0.1875, i: 0.25 });
  assert.deepEqual(step.next, { r: -1.6125, i: 0.22 });
  for (const [x, y] of [[0, 0], [-1, 0], [-0.5, -0.5], [-1.8, -0.03], [1, 1]]) {
    for (const f32 of [false, true]) {
      const trace = traceShip(x, y, 2048, f32);
      assert.ok(trace.path.length <= 1024);
      assert.equal(trace.path.length, trace.construction.length + 1);
      assert.ok(trace.steps <= 2048);
      for (let n = 0; n < trace.construction.length; n++) {
        const construction = trace.construction[n];
        assert.deepEqual(construction.next, trace.path[n + 1]);
        assert.ok(construction.folded.r >= 0 && construction.folded.i >= 0);
      }
      if (!f32) assert.equal(trace.sample, ship.shipEscapeTime(x, y, 2048));
    }
  }
  const bounded = traceShip(0, 0, 16384, false);
  assert.equal(bounded.steps, 16384);
  assert.equal(bounded.escaped, false);
  assert.equal(bounded.truncated, false);
  assert.ok(bounded.path.length < 1024);
  assert.equal(bounded.cycle.length, 1);
  const periodTwo = traceShip(-1, 0, 2048, false);
  assert.equal(periodTwo.cycle.length, 2);
  assert.deepEqual(periodTwo.cycle, [{ r: -1, i: 0 }, { r: 0, i: 0 }]);
  const escaped = traceShip(1, 1, 2048, false);
  assert.equal(escaped.escaped, true);
  assert.ok(escaped.steps < 2048);

  const animationOutput = join(directory, 'ship-animation.mjs');
  await build({ entryPoints: ['src/maps/burning-ship/orbit-animation.ts'], outfile: animationOutput, bundle: true, platform: 'node', format: 'esm' });
  const { orbitTrail, visibleOrbitPath, orbitFade } = await import(pathToFileURL(animationOutput).href);
  assert.deepEqual(orbitTrail(0, 10, 0), [{ index: 0, opacity: 1 }]);
  assert.deepEqual(orbitTrail(3, 10, 0).map(dot => dot.index), [1, 2, 3]);
  assert.deepEqual(orbitTrail(20, 10, 0).map(dot => dot.index), [9, 9, 9]);
  assert.deepEqual(orbitTrail(10, 5, 2).map(dot => dot.index), [4, 3, 4]);
  assert.equal(visibleOrbitPath(periodTwo, p => p).length, 3);
  assert.equal(orbitFade(0, 180), 0);
  assert.equal(orbitFade(90, 180), 0.5);
  assert.equal(orbitFade(180, 180), 1);
  await build({ entryPoints: ['src/maps/burning-ship/constants.ts'], outfile: join(directory, 'ship-constants.mjs'), bundle: true, platform: 'node', format: 'esm' });
  const shipConstants = await import(pathToFileURL(join(directory, 'ship-constants.mjs')).href);
  await build({ entryPoints: ['src/maps/mandelbrot/constants.ts'], outfile: join(directory, 'mandelbrot-constants.mjs'), bundle: true, platform: 'node', format: 'esm' });
  const mandelbrotConstants = await import(pathToFileURL(join(directory, 'mandelbrot-constants.mjs')).href);
  for (const key of ['ORBIT_DWELL_MS','ORBIT_STEP_MS','ORBIT_TRAIL_DOTS','ORBIT_APPEAR_MS','ORBIT_CROSSFADE_MS','ORBIT_GRADIENT_STOPS','ORBIT_REPEAT_PX','ORBIT_PATH_LIMIT']) {
    assert.deepEqual(shipConstants[key], mandelbrotConstants[key], `Mandelbrot overlay parity: ${key}`);
  }

  // Execute the actual worker handler to verify pixel centers, orientation and transfer shape.
  for (const map of ['burning-ship']) {
    const bundle = await build({ entryPoints: [`src/maps/${map}/tile-worker.ts`], bundle: true, write: false, format: 'iife' });
    let reply;
    const scope = { postMessage(value) { reply = value; } };
    runInNewContext(bundle.outputFiles[0].text, { self: scope });
    const job = { id: 23, width: 9, height: 7, xMin: -2, xMax: 2, yMin: -0.8, yMax: 0.8, maxIter: 512, transient: 256, seedX: 0.1, seedY: 0.1 };
    scope.onmessage({ data: job });
    assert.equal(reply.id, job.id);
    assert.ok(!reply.error);
    const values = new Float32Array(reply.buffer);
    assert.equal(values.length, job.width * job.height);
    for (let y = 0; y < job.height; y++) {
      for (let x = 0; x < job.width; x++) {
        const a = job.xMin + (x + 0.5) / job.width * (job.xMax - job.xMin);
        const b = job.yMin + (y + 0.5) / job.height * (job.yMax - job.yMin);
        const expected = ship.shipEscapeTime(a, b, job.maxIter);
        assert.equal(values[y * job.width + x], Math.fround(expected));
      }
    }
  }
  console.log('PASS: Burning Ship escape oracle; construction stages; f32/f64 orbit traces; cycle and escape animation; Mandelbrot timing parity; actual worker tiles.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
