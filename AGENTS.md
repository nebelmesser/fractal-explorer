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
The map is computed in f32 on the GPU until the current view needs finer
coordinates. Tiles past that point are filled automatically by the map's
optional CPU/WASM kernel. At the deepest distinct f64 grid, samples separate
once their pitch reaches 4 CSS pixels, grow more slowly to at most 16 pixels,
and reveal the black precision void between them.

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

Overlay trajectories match the GPU in f32. When `host.samplesF64()` is true
(the live view is on CPU/f64 tiles), they step with the f64 WASM kernel so
neighboring probes stay distinct.

The generic runtime may call presentation lifecycle hooks, but it must not
inspect or mutate presentation state. A map may provide a completely different
presentation or no overlay at all while retaining the same map interaction and
rendering engine.

The concrete page entrypoint composes a `MapDefinition`, its presentation, and
`bootViewer`. Keep this composition thin.

## Narration

Voiceover and subtitles are `@nebelmesser/narration` (`file:../../narration`).
Only the page entrypoint mounts it. The engine and presentations must not
import that package; they talk through optional `ViewerSignals` on
`PresentationHost`:

```ts
signals.emit('probe-detach');
signals.set('zoom_deg', 45);
```

`emit(name)` is a fire-and-forget app event. `set(key, value)` writes the
in-memory KV store (`string | number | boolean`). A missing key is not
`false`. Pendulum wiring is `app/src/maps/pendulum/main.ts`: it forwards
`emit`/`set` to the narrator and listens for highlight events coming back.
The overlay and cues stay off unless the page URL has `narration=1`.
UI copy is independent of that flag: author strings in `narration/ui.yaml`
(source language). `npm run narrate` translates them with the cues, writes
`ui.*` keys into `i18n/*.yaml`, and emits `narration/ui.json` for the app.
UI strings are never sent to TTS. Do not hand-edit `ui.json`. The language
select is always visible, to the left of the settings button. Enable sound
sits on the subtitle itself. Changing language clears heard cues and starts
the scenario again: `map-ready`, then the current `zoom_deg`,
`page_sec`, and `simulation_sec` store values so `when:` cues can play
in the new language.

Degrees and seconds are store variables, not emit names. The longest screen
side is `zoom_deg` (integer degrees); running physics is `simulation_sec`;
time on the page since the narrator mounted is `page_sec`.
The app walks every integer it crosses, so a cue like this still fires if
the camera skips past the threshold:

```yaml
- once: close-up
  when:
    zoom_deg: 45
  text: …
```

Catalog every app `emit` name in `narration/events.yaml`. Scenario cues bind
with that same name:

- `once: map-ready` — play the first time the event fires this session;
- `on: pan` — play every time.

Do not hand-edit `manifest.json`, `ui.json`, generated `i18n/*.yaml`, or
`audio/` except to set `frozen: true` on a translation you want to keep.
Sync hashes text in `.sync-lock.json` and rebuilds only changed locales
and mp3s. After changing `narration/scenario.yaml` or `narration/ui.yaml`,
regenerate from `fractal/app`:

```bash
npm run narrate
```

To iterate on Russian cue text and timing without translation or TTS:

```bash
npm run narrate:source && npx vite build
```

`--source-only` updates `i18n/{source}.yaml`, `manifest.json`, and `ui.json`,
leaves `.sync-lock.json` and audio alone, and strips audio from cues whose
source text changed so the overlay uses text timing. Full `npm run narrate`
later still translates and rebuilds mp3s.

The narrator can emit back into the app from `at_start` / `finally`. The
format is `target-event` (`settings-panel-highlight`). `bindHighlight` /
`bindUnhighlight` listen for `highlight` / `unhighlight`; the prefix is the
target token. Register tokens in the entrypoint map (`settings-panel` →
`#ui-container`). Highlighted nodes use `.is-narrate-on` in the map's CSS.

Engine-generic events (camera, menu chrome, map-ready) belong in
`app/src/viewer/`. Map-specific events (probes, pendulum sliders) belong in
that map's presentation. Keep names in `narration/events.yaml` in sync when
you add or rename an emit.

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
`fractal/`. After scenario or UI copy changes, run `npm run narrate` first so
`narration/manifest.json`, `narration/ui.json`, and audio are current before
the Vite build.

For integrated preview, follow the parent repository instructions and run only
from the playground root:

```bash
./scripts/preview status
./scripts/preview
```

Open `https://127.0.0.1:4000/fractal/double-pendulum.html`. Add `?narration=1`
to show the narrator overlay and play cues. Deep views switch to CPU/WASM tiles
automatically. Do not start another Jekyll, Python, Vite preview, or static-file
server.

After engine changes, verify cold load, desktop and mobile gestures, inertia,
zoom in/out, view reset, parameter reset, resizing, visible normalization, and
the final full-quality render. After presentation changes, verify its controls,
axes, overlay lifecycle, and behavior during camera and parameter changes.
