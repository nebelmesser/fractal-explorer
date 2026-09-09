import { readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..');

export default defineConfig({
  base: './',
  publicDir: 'public',
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
        input: resolve(__dirname, 'double-pendulum.html'),
      output: {
        entryFileNames: 'assets/explorer.js',
        chunkFileNames: 'assets/explorer-[name].js',
        assetFileNames: (info) => {
          const name = info.name ?? '';
          // Keep the wasm next to the JS so the bundled loader can fetch it.
          if (name.endsWith('.wasm')) return 'assets/[name][extname]';
          return 'assets/explorer[extname]';
        },
      },
    },
  },
  server: {
    open: '/double-pendulum.html',
  },
  worker: {
    format: 'es',
    plugins: () => [wasm()],
  },
  plugins: [
    wasm(),
    {
      name: 'strip-crossorigin',
      transformIndexHtml(html) {
        return html
          .replace(/ crossorigin(?:="[^"]*")?/g, '')
          .replace('src="./assets/explorer.js"', 'src="./assets/explorer.js?v=sim-run"')
          .replace('href="./assets/explorer.css"', 'href="./assets/explorer.css?v=sim-run"');
      },
    },
    {
      name: 'clean-old-hashed-assets',
      buildStart() {
        const assets = resolve(outDir, 'assets');
        rmSync(resolve(outDir, 'explorer.html'), { force: true });
        rmSync(resolve(outDir, 'viewer.html'), { force: true });
        try {
          for (const name of readdirSync(assets)) {
            if (
              name === 'explorer.js' || name === 'explorer.css'
              || name.startsWith('explorer-') || name.startsWith('tile-worker-')
              || name.startsWith('map_core_bg')
            ) {
              rmSync(resolve(assets, name), { force: true });
            }
          }
        } catch {
          // assets/ may not exist on a fresh clone
        }
      },
    },
    {
      name: 'redirect-root',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/' || req.url === '/index.html') {
            res.writeHead(302, { Location: '/double-pendulum.html' });
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
});
