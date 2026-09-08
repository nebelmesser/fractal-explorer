import { rmSync } from 'node:fs';
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
  plugins: [
    wasm(),
    {
      name: 'strip-crossorigin',
      transformIndexHtml(html) {
        return html
          .replace(/ crossorigin(?:="[^"]*")?/g, '')
          .replace('src="./assets/explorer.js"', 'src="./assets/explorer.js?v=start-hud"')
          .replace('href="./assets/explorer.css"', 'href="./assets/explorer.css?v=start-hud"');
      },
    },
    {
      name: 'clean-old-hashed-assets',
      buildStart() {
        const assets = resolve(outDir, 'assets');
        rmSync(resolve(outDir, 'explorer.html'), { force: true });
        rmSync(resolve(outDir, 'viewer.html'), { force: true });
        rmSync(resolve(assets, 'explorer.js'), { force: true });
        rmSync(resolve(assets, 'explorer.css'), { force: true });
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
