import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'mandelbrot-test-'));
try {
  const output = join(directory, 'physics.mjs');
  await build({ entryPoints: ['src/maps/mandelbrot/physics.ts'], outfile: output, bundle: true, platform: 'node', format: 'esm' });
  const { escapeTime } = await import(pathToFileURL(output).href);
  const sample = (x, y, t = 0, cr = -0.8, ci = 0.156, iterations = 2048) =>
    escapeTime(x, y, iterations, t, cr, ci);

  // Known Mandelbrot interior points and escaping points, including the real cusp.
  for (const [x, y] of [[0, 0], [-1, 0], [-2, 0], [0.25, 0], [-0.125, 0.75]]) {
    assert.equal(sample(x, y), 0, `bounded Mandelbrot point ${x},${y}`);
  }
  for (const [x, y] of [[1, 0], [0.5, 0.5], [-2.01, 0], [0.251, 0]]) {
    assert.ok(sample(x, y) > 0, `escaping Mandelbrot point ${x},${y}`);
  }
  assert.equal(sample(-0.75, 0.2, 0, 2, -2), sample(-0.75, 0.2, 0, -2, 2));

  // Julia c=0 is the unit disk, independent of angle.
  for (let index = 0; index < 32; index++) {
    const angle = index * Math.PI / 16;
    assert.equal(sample(0.99 * Math.cos(angle), 0.99 * Math.sin(angle), 1, 0, 0), 0);
    assert.ok(sample(1.01 * Math.cos(angle), 1.01 * Math.sin(angle), 1, 0, 0) > 0);
  }

  // Compare endpoint membership against a separate radius-two escape oracle.
  function escapes(zr, zi, cr, ci) {
    for (let n = 0; n < 2048; n++) {
      [zr, zi] = [zr * zr - zi * zi + cr, 2 * zr * zi + ci];
      if (zr * zr + zi * zi > 4) return true;
    }
    return false;
  }
  for (let row = 0; row < 29; row++) {
    for (let col = 0; col < 37; col++) {
      const x = -2.2 + (col + 0.5) * 3.4 / 37;
      const y = -1.3 + (row + 0.5) * 2.6 / 29;
      assert.equal(sample(x, y) > 0, escapes(0, 0, x, y));
      assert.equal(sample(x, y, 1) > 0, escapes(x, y, -0.8, 0.156));
      assert.equal(sample(x, y), sample(x, -y));
      for (const t of [0.1, 0.5, 0.9]) {
        const value = sample(x, y, t);
        assert.ok(Number.isFinite(value) && value >= 0);
        assert.equal(value, sample(x, -y, t, -0.8, -0.156));
      }
    }
  }
  assert.ok(Math.abs(sample(1.5, 0.7, 0.5) - sample(1.5, 0.7, 0.500001)) < 0.001);
  assert.equal(sample(1, 0, 0, 0, 0, 128), sample(1, 0, 0, 0, 0, 8192));

  // These adjacent deep samples alias at f32 but remain distinct in the CPU kernel.
  const x = -0.743643887037151;
  const y = 0.13182590420533;
  assert.equal(Math.fround(x), Math.fround(x + 1e-12));
  assert.notEqual(sample(x, y, 0, 0, 0, 8192), sample(x + 1e-12, y, 0, 0, 0, 8192));
  console.log('Mandelbrot: endpoints, independent escape oracle, Julia unit disk, symmetry, morph continuity, and f64 detail passed.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
