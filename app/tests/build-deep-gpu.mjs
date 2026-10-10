import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const result = await build({
  entryPoints: ['tests/deep-gpu.ts'], bundle: true, write: false, format: 'esm',
  plugins: [{ name: 'wgsl-source', setup(builder) {
    builder.onResolve({ filter: /\.wgsl\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.replace('?raw', '')), namespace: 'wgsl' }));
    builder.onLoad({ filter: /.*/, namespace: 'wgsl' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
  } }],
});
const code = result.outputFiles[0].text;
const hash = createHash('sha256').update(code).digest('hex').slice(0, 10);
const directory = resolve('../test-output');
const script = `deep-gpu-${hash}.js`;
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, script), code);
await writeFile(resolve(directory, 'deep-gpu.html'), `<!doctype html><html><head><title>Deep zoom verification</title></head><body><pre id="report"></pre><script type="module" src="./${script}"></script></body></html>`);
console.log('Open http://127.0.0.1:4000/fractal/test-output/deep-gpu.html using the playground preview.');
