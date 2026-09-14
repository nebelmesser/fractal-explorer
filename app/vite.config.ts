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
      input: {
        explorer: resolve(__dirname, 'double-pendulum.html'),
        magnets: resolve(__dirname, 'magnetic-pendulum.html'),
        lyapunov: resolve(__dirname, 'lyapunov.html'),
        chirikov: resolve(__dirname, 'chirikov.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        // Every file in one module graph must share the build's content
        // identity. Stable shared-chunk names can mix incompatible Rollup
        // export aliases when a browser or CDN caches across deployments.
        assetFileNames: 'assets/[name]-[hash][extname]',
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
        return html.replace(/ crossorigin(?:="[^"]*")?/g, '');
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
              || name === 'magnets.js' || name === 'magnets.css'
              || name === 'lyapunov.js' || name === 'lyapunov.css'
              || name === 'chirikov.js' || name === 'chirikov.css'
              || name === 'ask.css' || name === 'menu.css'
              || name.startsWith('explorer-') || name.startsWith('tile-worker-')
              || name.startsWith('magnets-') || name.startsWith('lyapunov-')
              || name.startsWith('chirikov-') || name.startsWith('menu-')
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
