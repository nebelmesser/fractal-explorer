import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const result = await build({
  entryPoints: ['tests/maps-browser.ts'], bundle: true, write: false, format: 'esm',
  plugins: [{ name: 'map-test-imports', setup(builder) {
    builder.onResolve({ filter: /\?worker$/ }, () => ({ path: 'unused-worker', namespace: 'worker-stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'worker-stub' }, () => ({ contents: 'export default class {}' }));
    builder.onResolve({ filter: /\.wgsl\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.replace('?raw', '')), namespace: 'wgsl' }));
    builder.onLoad({ filter: /.*/, namespace: 'wgsl' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
  } }],
});
const code = result.outputFiles[0].text;
const hash = createHash('sha256').update(code).digest('hex').slice(0, 10);
const directory = resolve('../test-output');
const script = `maps-browser-${hash}.js`;
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, script), code);
await writeFile(resolve(directory, 'maps-browser.html'), `<!doctype html><html><head><title>New map verification</title></head><body><pre id="report"></pre><script type="module" src="./${script}"></script></body></html>`);
const instrumentation = `<base href="../"><script>
  window.adapterRequests = 0; window.mapPaints = 0; window.mapWorkers = 0; window.pageErrors = [];
  addEventListener('error', e => window.pageErrors.push(e.message));
  addEventListener('unhandledrejection', e => window.pageErrors.push(String(e.reason)));
  Object.defineProperty(navigator, 'gpu', {value:{requestAdapter:async()=>{window.adapterRequests++;return null;}}});
  const OriginalWorker = Worker;
  window.Worker = class extends OriginalWorker {constructor(...args){super(...args);window.mapWorkers++;}};
  const original = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function(...args) {if(this.canvas.classList.contains('map-view'))window.mapPaints++;return original.apply(this,args);};
</script>`;
for (const slug of ['burning-ship']) {
  const html = (await readFile(resolve('..', `${slug}.html`), 'utf8'))
    .replace('<head>', `<head>${instrumentation}`)
    .replace(/<script async src="https:\/\/www.googletagmanager[^>]*><\/script>/, '');
  for (const mode of ['cpu', 'fallback']) await writeFile(resolve(directory, `maps-${mode}-${slug}.html`), html);
}
await writeFile(resolve(directory, 'maps-mobile.html'), `<!doctype html><html><head><title>Mobile map previews</title><style>
body{margin:16px;background:#181818;color:#eee;font:14px system-ui;display:flex;gap:16px}section{width:390px;flex:none}h1{font-size:14px;font-weight:500}iframe{width:390px;height:844px;border:0}
</style></head><body><section><h1>Burning Ship · 390 × 844</h1><iframe title="Burning Ship" src="../burning-ship.html"></iframe></section></body></html>`);
console.log('Open http://127.0.0.1:4000/fractal/test-output/maps-browser.html using the playground preview.');
