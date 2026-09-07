# Fractal Explorer

## Repository

`fractal/` is a Git submodule. Work and inspect Git state from this directory;
the parent repository only tracks the submodule commit.

Source lives in `app/`. The root `double-pendulum.html` and `assets/` are build
outputs and must not be edited by hand. `dp_map/` is temporary reference
material: do not import it, link to it, or mention it in product documentation.

Keep code comments in English. Put constants in the constants file belonging
to their layer. Put colors in the CSS owned by the corresponding presentation.

## Layer 1: map engine

The reusable engine lives in `app/src/viewer/` and `app/src/gpu/`.

It owns:

- WebGPU device setup and the compute/postprocess/blit pipeline;
- camera state, pan, zoom, inertia, history, and responsive view fitting;
- adaptive resolution and per-pixel work budgeting;
- visible rendering, double buffering, predicted landing renders, overscan,
  and progressive zoom-out/reset preloading;
- persistence of engine preferences.

The engine must not import a concrete map module or refer to pendulum concepts,
parameter names, angle units, DOM IDs for map-specific UI, or overlay state.
There is no CPU fallback for computing a map. Use `f32` on the GPU.

Keep the last complete texture visible during asynchronous work. Normalize
brightness against the visible view, never against overscan or prefetched
coverage. Every completed gesture or animation must finish with a full-quality
render. A page reload resets camera position and history.

## Layer 2: map definition

Shared map contracts live in `app/src/maps/types.ts`. A `MapDefinition`
describes only what the engine needs to compute and navigate a map:

- default coordinate view and navigation policy;
- parameter declarations;
- the work-budget parameter and its range;
- GPU shader and uniform packing.

Each map implementation lives in its own `app/src/maps/<map>/` directory and
is registered in `app/src/maps/catalog.ts` when catalog discovery is needed.
Map physics, domain wrapping, shader semantics, parameter names, and map
constants must remain inside that module.

Adding another map must not require editing the GPU renderer, camera/input
logic, prefetch pipeline, or reset transition algorithm.

## Layer 3: presentation

The bridge between a map and its UI implements `MapPresentationFactory` from
`app/src/viewer/presentation.ts`. A presentation may initialize supporting
code and owns all map-specific visual and interface behavior.

For the double-pendulum map, `app/src/maps/pendulum/` owns:

- axes, units, labels, and probe marks;
- overlay layout, drawing, animation, and trajectory simulation;
- pendulum controls, HUD binding, and map-specific CSS/theme;
- Rust/WASM trajectory integration.

The generic runtime may call presentation lifecycle hooks, but it must not
inspect or mutate presentation state. A map may provide a completely different
presentation or no overlay at all while retaining the same map interaction and
rendering engine.

The concrete page entrypoint composes a `MapDefinition`, its presentation, and
`bootViewer`. Keep this composition thin.

## Rendering transitions

Pan, pinch, wheel, and inertia transform the best available texture while the
engine predicts and computes future coverage. Do not start a full budgeted pass
for every pointer event.

Zoom-out, view reset, and parameter reset share one progressive transition
model: render wider or future parameter states ahead of the camera, animate the
current complete texture, and swap only when the next cover is ready. Parameter
reset interpolates camera, parameters, and controls together. Interrupted or
stale renders must not be allowed to swap later.

## Build and verification

From `fractal/app`:

```bash
npm run build
```

This builds Rust/WASM, runs TypeScript checking, and writes production files to
`fractal/`.

For integrated preview, follow the parent repository instructions and run only
from the playground root:

```bash
./scripts/preview status
./scripts/preview
```

Open `https://127.0.0.1:4000/fractal/double-pendulum.html`. Do not start another
Jekyll, Python, Vite preview, or static-file server.

After engine changes, verify cold load, desktop and mobile gestures, inertia,
zoom in/out, view reset, parameter reset, resizing, visible normalization, and
the final full-quality render. After presentation changes, verify its controls,
axes, overlay lifecycle, and behavior during camera and parameter changes.
