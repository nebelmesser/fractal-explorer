# Fractal Explorer

Interactive GPU map explorer. Published as part of
[Nebelmesser's Playground](https://nebelmesser.com/).

Open the [live page](/fractal/double-pendulum.html)
or the built `fractal/double-pendulum.html`. Source lives in `app/`
(TypeScript + Vite + WebGPU, with a small Rust/WASM crate for the point
preview). Maps use f32 on the GPU and f64 CPU workers for deep zoom or
the explicit `?cpu=1` mode. WebGPU unavailability also falls back to CPU.

The first map is a double pendulum: each pixel is an initial pair of angles.
The second is a magnetic pendulum: each pixel is a bob released over three
magnets, colored RGB by time spent near each magnet. Hover the map to pose the
pendulum at that point. The viewer does not know the map — other maps can
register in the catalog.

[Mandelbrot & Julia](/fractal/mandelbrot.html) adds the classic black set with
a blue, cyan, cream, and gold escape-time palette. In settings, the transition
slider continuously changes from Mandelbrot (`t = 0`) to Julia (`t = 1`):
`z₀ = t p`, `c = (1 − t) p + t c_J`, then `z ← z² + c`. The Julia constant
and iteration limit are adjustable. The same viewer handles navigation,
progressive rendering and CPU fallback. This map opts into exact camera origins
and [reference-orbit perturbation](https://mathr.co.uk/web/deep-zoom.html).
Ordinary tiles use GPU f32, then CPU f64 when the coordinate grid needs it.
Once f64 cannot distinguish neighboring samples accurately, the worker computes
the reference using fixed-point BigInt arithmetic with a
precision selected from the view span, plus 96 guard bits. WebGPU uses paired
f32 mantissas and separate exponents for the small differences. Unstable pixels
get additional references, then an f64 or fixed-point CPU repair when needed.
The `cpu=1` path does all calculation in workers and never requests WebGPU.

The minimum short-axis span is `1e-280` (roughly 280 decimal orders of zoom).
Pan, anchored zoom, history, reset and camera URLs preserve the exact center.
World-aligned tiles refine in a queue from the center outwards, with full detail
expanding in rings. Completed tiles appear immediately and survive interrupted
gestures; panning reuses cached tiles and computes only the missing area. The
previous coverage stays visible while work is pending. Other maps retain their existing f32/f64
precision limits. The iteration control runs from 128 to 262144: increase it
when a deep boundary remains black. More iterations and difficult reference
orbits can take substantially longer; there is no fixed frame-rate guarantee.

Run `npm run test:mandelbrot` and `npm run test:deep-zoom` from `app/` for
mathematical and camera regression checks. `npm run test:deep-gpu:build` creates
an ignored browser harness at `/fractal/test-output/deep-gpu.html` on the
playground preview. It compares the real WebGPU shader with the CPU kernel
and checks touch pinch anchoring.

The square map panel fills the window. Compute resolution follows the frame
budget; zoom animation can use more pixels if the GPU is idle. + / − above
the preview zoom the view; the last zoom-out returns to the original map.
Refresh starts at that view.

## Develop

```
cd app
npm install
npm run dev      # http://localhost:5173/double-pendulum.html
npm run build    # writes HTML and assets under fractal/
```

`npm run build` compiles the Rust crate to WASM (`wasm-pack`) and then Vite.
You need a Rust toolchain with the `wasm32-unknown-unknown` target and
`wasm-pack` on `PATH`.

Preview the built files via the playground HTTP origin
(`http://127.0.0.1:4000/fractal/mandelbrot.html`, or another map endpoint).

Mandelbrot interiors remain black. The trajectory setting is enabled by default and keeps a full-set overview visible, using the current morph, Julia constant, iteration limit, and palette. Real-number ticks, italic imaginary ticks, and the hovered pixel's italic complex number appear in the overview. Hover or tap draws the orbit there, and also on the main map whenever z₀ is visible, clipping the rest at the screen edges. The curve fades in and crossfades between completed worker results without blank frames during pointer movement. Independently, visible z₀ and the hovered point are connected on the main map whenever both fit. The curve shows iteration order with a cyan-to-gold gradient; moving dots begin after 500 ms of rest. The selected parameter c and the initial value z₀ = 0 are distinct in Mandelbrot mode. A short worker preview keeps the path live; a cancellable full trace uses the current iteration budget after the dwell. The overlay detects attracting cycles up to period 256 and uses f32, f64, or exact fixed-point coordinates at the corresponding depth. It does not add any work or period encoding to map tiles.

## License

MIT. Made by [Nebelmesser](https://nebelmesser.com/).
