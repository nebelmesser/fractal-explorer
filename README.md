# Fractal Explorer

Interactive GPU map explorer. Published as part of
[Nebelmesser's Playground](https://nebelmesser.com/).

Open the [live page](/fractal/double-pendulum.html)
or the built `fractal/double-pendulum.html`. Source lives in `app/`
(TypeScript + Vite + WebGPU, with a small Rust/WASM crate for the point
preview). The map itself is computed only on the GPU.

The first map is a double pendulum: each pixel is an initial pair of angles.
Hover the map to pose the pendulum at that point. The viewer does not know
the map — other maps can register in the catalog.

The square map panel fills the window. Compute resolution follows the frame
budget; zoom animation can use more pixels if the GPU is idle. + / − above
the preview zoom the view; the last zoom-out returns to the original map.
Refresh starts at that view.

## Develop

```
cd app
npm install
npm run dev      # http://localhost:5173/double-pendulum.html
npm run build    # writes ../double-pendulum.html and ../assets/explorer.{js,css}
```

`npm run build` compiles the Rust crate to WASM (`wasm-pack`) and then Vite.
You need a Rust toolchain with the `wasm32-unknown-unknown` target and
`wasm-pack` on `PATH`.

Preview the built files via the playground HTTPS origin
(`https://127.0.0.1:4000/fractal/viewer.html`).

## License

MIT. Made by [Nebelmesser](https://nebelmesser.com/).
