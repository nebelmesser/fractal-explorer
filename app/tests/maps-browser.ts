import { shipMap, packShipUniforms } from '../src/maps/burning-ship/spec';
import { shipEscapeTime } from '../src/maps/burning-ship/physics';
import type { MapDefinition, MapParams, ViewRect } from '../src/maps/types';

const report = document.getElementById('report')!;
const log = (value: unknown) => { report.textContent += JSON.stringify(value) + '\n'; };
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }

async function gpuTile(device: GPUDevice, map: MapDefinition, view: ViewRect, params: MapParams): Promise<Float32Array> {
  const width = 25, height = 19;
  const code = device.createShaderModule({ code: map.gpu.computeWgsl });
  const info = await code.getCompilationInfo();
  check(!info.messages.some(m => m.type === 'error'), info.messages.map(m => m.message).join('\n'));
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: code, entryPoint: 'simulate' } });
  const packed = packShipUniforms(view, width, height, params, {});
  const uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const output = device.createBuffer({ size: width * height * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const read = device.createBuffer({ size: width * height * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, packed);
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: output } }] });
  const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(4, 3); pass.end();
  encoder.copyBufferToBuffer(output, 0, read, 0, width * height * 4);
  device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const values = new Float32Array(read.getMappedRange().slice(0));
  for (const buffer of [uniform, output, read]) buffer.destroy();
  return values;
}

async function checkGpu(): Promise<void> {
  const adapter = await navigator.gpu?.requestAdapter();
  check(adapter, 'WebGPU adapter unavailable in the test browser');
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', e => log({ gpuError: e.error.message }));
  for (const [map, view, params] of [
    [shipMap, shipMap.defaultView, { MAX_ITERATIONS: 512 }],
    [shipMap, { xMin: -1.82, xMax: -1.72, yMin: -0.08, yMax: 0.02 }, { MAX_ITERATIONS: 1024 }],
  ] as const) {
    const values = await gpuTile(device, map, view, params);
    let mismatch = 0, totalError = 0;
    const errors: number[] = [];
    for (let i = 0; i < values.length; i++) {
      const x = view.xMin + (i % 25 + 0.5) / 25 * (view.xMax - view.xMin);
      const y = view.yMin + (Math.floor(i / 25) + 0.5) / 19 * (view.yMax - view.yMin);
      const p = params as MapParams;
      const cpu = shipEscapeTime(x, y, p.MAX_ITERATIONS);
      check(Number.isFinite(values[i]) && values[i] >= 0, 'Invalid semantic GPU sample');
      if ((cpu > 0) !== (values[i] > 0)) mismatch++;
      else { const error = Math.abs(cpu - values[i]); totalError += error; errors.push(error); }
    }
    const meanError = totalError / values.length;
    errors.sort((a, b) => a - b);
    const medianError = errors[Math.floor(errors.length * 0.5)];
    const p90Error = errors[Math.floor(errors.length * 0.9)];
    log({ map: map.id, view, mismatch, meanError, medianError, p90Error });
    check(mismatch <= 5, 'GPU/CPU escape classification mismatch');
    // Long chaotic orbits separate at f32/f64; compare membership and median
    // escape error rather than exact agreement on long sensitive trajectories.
    check(medianError < 0.01, 'GPU/CPU error outside tolerance');
  }
  device.destroy();
}

async function until(fn: () => boolean, message: string): Promise<void> {
  const start = performance.now();
  while (!fn()) {
    check(performance.now() - start < 45000, message);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function cpuPage(slug: string, explicit: boolean): Promise<void> {
  const url = new URL(`maps-${explicit ? 'cpu' : 'fallback'}-${slug}.html`, location.href);
  if (explicit) url.search = '?cpu=1&check=preserved';
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:360px;height:640px;border:0;';
  document.body.append(frame);
  frame.src = url.href;
  await until(() => !!(frame.contentWindow as any)?.mapPaints, `CPU page did not render: ${slug}`);
  const win = frame.contentWindow as Window & { adapterRequests: number; mapPaints: number; mapWorkers: number; pageErrors: string[] };
  check(win.adapterRequests === (explicit ? 0 : 1), `Unexpected WebGPU requests: ${slug} ${win.adapterRequests}`);
  check(win.mapWorkers > 0, 'CPU page did not start map workers');
  const doc = frame.contentDocument!;
  const box = (id: string) => doc.getElementById(id)!.getBoundingClientRect();
  const hud = box('map-hud'), sidebar = box('sidebar'), locale = box('narration-locale');
  check(hud.left >= sidebar.right && hud.right <= locale.left, 'Compact HUD overlaps navigation or language select');
  const panel = doc.querySelector('.ship-orbit-inset') as HTMLElement;
  check(panel.dataset.parameter === 'null', 'Overlay selected a parameter without hover or tap');
  const surface = doc.getElementById('map-clip')!, surfaceBox = surface.getBoundingClientRect();
  const camera = new URL(win.location.href).searchParams;
  const short = Number(camera.get('span'));
  const spanX = short * Math.max(1, surfaceBox.width / surfaceBox.height);
  const spanY = short * Math.max(1, surfaceBox.height / surfaceBox.width);
  const px = surfaceBox.left + ((-1 - Number(camera.get('x'))) / spanX + 0.5) * surfaceBox.width;
  const py = surfaceBox.top + ((0 - Number(camera.get('y'))) / spanY + 0.5) * surfaceBox.height;
  const choose = () => surface.dispatchEvent(new win.PointerEvent('pointermove', {pointerType:'mouse',clientX:px,clientY:py,bubbles:true}));
  const chosenAt = performance.now();
  choose();
  check(panel.dataset.animating === 'false', 'Orbit dots started before pointer dwell');
  await until(() => Number(panel.dataset.pathPoints) > 1 && panel.dataset.precision === 'f64', 'CPU orbit trace did not arrive');
  await until(() => panel.dataset.animating === 'true', 'Orbit dots did not start after pointer dwell');
  check(performance.now() - chosenAt >= 450, 'Pointer dwell is shorter than the Mandelbrot delay');
  const overlay = doc.getElementById('ship-orbit-overlay')!;
  const animationStep = Number(overlay.dataset.animationStep);
  await until(() => Number(overlay.dataset.animationStep) > animationStep + 1, 'Orbit dots did not advance');
  check(Number(overlay.dataset.orbitOpacity) > 0.99, 'Orbit curve did not finish fading in');
  const inset = panel.getBoundingClientRect();
  check(inset.left >= 0 && inset.right <= 360 && inset.bottom <= 640 && inset.top >= 0, 'Orbit inset overflows compact view');
  const selected = panel.dataset.parameter;
  surface.dispatchEvent(new win.PointerEvent('pointerleave', {pointerType:'mouse', bubbles:true}));
  check(panel.dataset.parameter === selected, 'Pointer leave discarded the orbit');
  const initial = win.mapPaints;
  (doc.getElementById('zoom-in') as HTMLButtonElement).click();
  await until(() => win.mapPaints > initial && (doc.getElementById('zoom-reset') as HTMLButtonElement).disabled === false, 'CPU zoom did not settle');
  check(panel.dataset.parameter === selected, 'Zoom changed the selected orbit');
  if (explicit) check(win.location.search.includes('cpu=1') && win.location.search.includes('check=preserved'), 'Camera discarded CPU/extra URL flags');
  const before = win.mapPaints;
  const slider = doc.querySelector('#map-params input') as HTMLInputElement;
  slider.value = '0'; slider.dispatchEvent(new win.Event('input', { bubbles: true })); slider.dispatchEvent(new win.Event('change', { bubbles: true }));
  await until(() => win.mapPaints > before, 'CPU parameter change did not render');
  choose();
  await until(() => Number(panel.dataset.pathPoints) > 1, 'Orbit did not refresh after a parameter change');
  const pinchSelected = panel.dataset.parameter;
  const clip = doc.getElementById('map-clip')!;
  const span = Number(new URL(win.location.href).searchParams.get('span'));
  const pointer = (type: string, pointerId: number, x: number) => clip.dispatchEvent(new win.PointerEvent(type, {
    pointerId, pointerType: 'touch', clientX: x, clientY: 300, button: 0, bubbles: true,
  }));
  pointer('pointerdown', 10, 120); pointer('pointerdown', 11, 240);
  pointer('pointermove', 11, 240); pointer('pointermove', 10, 90); pointer('pointermove', 11, 270);
  pointer('pointerup', 10, 90); pointer('pointerup', 11, 270);
  await until(() => Number(new URL(win.location.href).searchParams.get('span')) < span * 0.95, 'Touch pinch did not change camera span');
  check(panel.dataset.parameter === pinchSelected, 'Pinch changed the selected orbit');
  (doc.getElementById('resetParams') as HTMLButtonElement).click();
  await until(() => doc.querySelector('#map-params')!.textContent!.includes('512'), 'Parameter reset did not restore defaults');
  const toggle = doc.getElementById('show-ship-orbit') as HTMLInputElement;
  toggle.checked = false; toggle.dispatchEvent(new win.Event('change', {bubbles:true}));
  check(panel.hidden, 'Overlay toggle did not hide panel');
  toggle.checked = true; toggle.dispatchEvent(new win.Event('change', {bubbles:true}));
  check(!panel.hidden && panel.dataset.parameter === 'null', 'Overlay toggle did not reset selection like Mandelbrot');
  check(win.pageErrors.length === 0, `CPU page errors: ${win.pageErrors}`);
  log({ map: slug, explicitCpu: explicit, adapterRequests: win.adapterRequests, workers: win.mapWorkers, paints: win.mapPaints, compactLayout: true, touchPinch: true, parameterReset: true, animatedTrail: true, errors: win.pageErrors });
  frame.remove();
}

try {
  await checkGpu();
  for (const slug of ['burning-ship']) {
    await cpuPage(slug, true);
    await cpuPage(slug, false);
  }
  log('PASS');
} catch (error) { log({ error: String(error) }); }
