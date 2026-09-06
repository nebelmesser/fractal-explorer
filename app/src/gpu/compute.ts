import type { GpuContext } from './device';
import type { MapDefinition, MapParams, ViewRect } from '../maps/types';
import reduceWgsl from './reduce.wgsl?raw';
import colorizeWgsl from './colorize.wgsl?raw';
import medianWgsl from './median.wgsl?raw';
import blitWgsl from './blit.wgsl?raw';

type Targets = {
  canvas: HTMLCanvasElement;
  context: GPUCanvasContext;
  configuredW: number;
  configuredH: number;
};

type GpuBuffers = {
  width: number;
  height: number;
  uniform: GPUBuffer;
  raw: GPUBuffer;
  minmax: GPUBuffer;
  color: GPUTexture;
  median: GPUTexture;
  colorView: GPUTextureView;
  medianView: GPUTextureView;
};

/**
 * Runs one map on the GPU: compute → log-minmax → colorize → median → blit.
 * Nothing in this path reads the map back to the CPU.
 */
export class GpuMapRenderer {
  lastError: string | null = null;
  /** log1p min/max of the on-screen region — same stretch the colorize shader uses. */
  lastScale: { lo: number; hi: number } | null = null;
  private buffers: GpuBuffers | null = null;
  private readonly cache: GpuBuffers[] = [];
  private lastGray: { tex: GPUTexture; width: number; height: number } | null = null;
  private gpuTail: Promise<void> = Promise.resolve();
  private readonly canvasPx = new WeakMap<HTMLCanvasElement, { w: number; h: number }>();
  private readonly computeLayout: GPUBindGroupLayout;
  private readonly reduceLayout: GPUBindGroupLayout;
  private readonly colorLayout: GPUBindGroupLayout;
  private readonly medianLayout: GPUBindGroupLayout;
  private readonly blitLayout: GPUBindGroupLayout;

  private constructor(
    private readonly gpu: GpuContext,
    private readonly map: MapDefinition,
    private target: Targets,
    private readonly computePipeline: GPUComputePipeline,
    private readonly reducePipeline: GPUComputePipeline,
    private readonly colorPipeline: GPUComputePipeline,
    private readonly medianPipeline: GPUComputePipeline,
    private readonly blitPipeline: GPURenderPipeline,
    layouts: {
      compute: GPUBindGroupLayout;
      reduce: GPUBindGroupLayout;
      color: GPUBindGroupLayout;
      median: GPUBindGroupLayout;
      blit: GPUBindGroupLayout;
    },
  ) {
    this.computeLayout = layouts.compute;
    this.reduceLayout = layouts.reduce;
    this.colorLayout = layouts.color;
    this.medianLayout = layouts.median;
    this.blitLayout = layouts.blit;
  }

  static async create(
    gpu: GpuContext,
    canvas: HTMLCanvasElement,
    map: MapDefinition,
  ): Promise<GpuMapRenderer> {
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Canvas has no WebGPU context');
    const device = gpu.device;

    const computeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const reduceLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const colorLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'r32float', viewDimension: '2d' },
        },
      ],
    });
    const medianLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'r32float', viewDimension: '2d' },
        },
      ],
    });
    const blitLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
      ],
    });

    const computeMod = device.createShaderModule({ code: map.gpu.computeWgsl });
    const reduceMod = device.createShaderModule({ code: reduceWgsl });
    const colorMod = device.createShaderModule({ code: colorizeWgsl });
    const medianMod = device.createShaderModule({ code: medianWgsl });
    const blitMod = device.createShaderModule({ code: blitWgsl });
    await assertShader(computeMod, 'compute');
    await assertShader(reduceMod, 'reduce');
    await assertShader(colorMod, 'colorize');
    await assertShader(medianMod, 'median');
    await assertShader(blitMod, 'blit');

    const computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
      compute: { module: computeMod, entryPoint: map.gpu.entryPoint },
    });
    const reducePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [reduceLayout] }),
      compute: { module: reduceMod, entryPoint: 'reduce_minmax' },
    });
    const colorPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [colorLayout] }),
      compute: { module: colorMod, entryPoint: 'colorize' },
    });
    const medianPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [medianLayout] }),
      compute: { module: medianMod, entryPoint: 'median' },
    });
    const blitPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [blitLayout] }),
      vertex: { module: blitMod, entryPoint: 'blit_vs' },
      fragment: {
        module: blitMod,
        entryPoint: 'blit_fs',
        targets: [{ format: gpu.format }],
      },
    });

    return new GpuMapRenderer(
      gpu,
      map,
      { canvas, context, configuredW: 0, configuredH: 0 },
      computePipeline,
      reducePipeline,
      colorPipeline,
      medianPipeline,
      blitPipeline,
      { compute: computeLayout, reduce: reduceLayout, color: colorLayout, median: medianLayout, blit: blitLayout },
    );
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.gpuTail.then(fn, fn);
    this.gpuTail = run.then(() => undefined, () => undefined);
    return run;
  }

  async render(
    view: ViewRect,
    params: MapParams,
    width: number,
    height: number,
    invert: boolean,
    median: number,
    normView: ViewRect = view,
  ): Promise<number> {
    return this.enqueue(() => this.renderLocked(view, params, width, height, invert, median, normView));
  }

  private async renderLocked(
    view: ViewRect,
    params: MapParams,
    width: number,
    height: number,
    invert: boolean,
    median: number,
    normView: ViewRect,
  ): Promise<number> {
    const { device } = this.gpu;
    await this.ensureBuffers(width, height);
    this.configureCanvas(width, height);
    const packed = this.map.gpu.packUniforms(view, width, height, params, { invert, median, normView });
    device.queue.writeBuffer(this.buffers!.uniform, 0, packed);

    const groupsX = Math.ceil(width / 8);
    const groupsY = Math.ceil(height / 8);
    const encoder = device.createCommandEncoder();

    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.bind(this.computeLayout, [
      { binding: 0, resource: { buffer: this.buffers!.uniform } },
      { binding: 1, resource: { buffer: this.buffers!.raw } },
    ]));
    computePass.dispatchWorkgroups(groupsX, groupsY);
    computePass.end();

    const reducePass = encoder.beginComputePass();
    reducePass.setPipeline(this.reducePipeline);
    reducePass.setBindGroup(0, this.bind(this.reduceLayout, [
      { binding: 0, resource: { buffer: this.buffers!.uniform } },
      { binding: 1, resource: { buffer: this.buffers!.raw } },
      { binding: 2, resource: { buffer: this.buffers!.minmax } },
    ]));
    reducePass.dispatchWorkgroups(1);
    reducePass.end();

    const colorPass = encoder.beginComputePass();
    colorPass.setPipeline(this.colorPipeline);
    colorPass.setBindGroup(0, this.bind(this.colorLayout, [
      { binding: 0, resource: { buffer: this.buffers!.uniform } },
      { binding: 1, resource: { buffer: this.buffers!.raw } },
      { binding: 2, resource: { buffer: this.buffers!.minmax } },
      { binding: 3, resource: this.buffers!.colorView },
    ]));
    colorPass.dispatchWorkgroups(groupsX, groupsY);
    colorPass.end();

    const medianPass = encoder.beginComputePass();
    medianPass.setPipeline(this.medianPipeline);
    medianPass.setBindGroup(0, this.bind(this.medianLayout, [
      { binding: 0, resource: { buffer: this.buffers!.uniform } },
      { binding: 1, resource: this.buffers!.colorView },
      { binding: 2, resource: this.buffers!.medianView },
    ]));
    medianPass.dispatchWorkgroups(groupsX, groupsY);
    medianPass.end();

    const display = median > 1 ? this.buffers!.medianView : this.buffers!.colorView;
    const color = this.target.context.getCurrentTexture().createView();
    const blitPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: color,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    blitPass.setPipeline(this.blitPipeline);
    blitPass.setBindGroup(0, this.bind(this.blitLayout, [
      { binding: 0, resource: display },
    ]));
    blitPass.draw(3);
    blitPass.end();

    device.pushErrorScope('validation');
    device.pushErrorScope('internal');
    const t0 = performance.now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const internal = await device.popErrorScope();
    const validation = await device.popErrorScope();
    const err = internal ?? validation;
    if (err) {
      this.lastError = err.message;
      throw new Error(err.message);
    }
    this.lastError = null;
    this.target.canvas.dataset.ready = '1';
    const grayTex = median > 1 ? this.buffers!.median : this.buffers!.color;
    this.lastGray = { tex: grayTex, width, height };
    await this.refreshScale();
    return performance.now() - t0;
  }

  /** Map a running escape count to the same gray the colorize shader would paint. */
  grayForSteps(steps: number, invert: boolean): number | null {
    const scale = this.lastScale;
    if (!scale) return null;
    const v = Math.log1p(Math.max(0, steps));
    let t = scale.hi > scale.lo ? (v - scale.lo) / (scale.hi - scale.lo) : 0;
    t = Math.min(1, Math.max(0, t));
    if (invert) t = 1 - t;
    return t * 255;
  }

  /** One grayscale byte (0–255) from the last computed map, or null. */
  async sampleGray(nx: number, ny: number): Promise<number | null> {
    return this.enqueue(() => this.sampleGrayLocked(nx, ny));
  }

  private async sampleGrayLocked(nx: number, ny: number): Promise<number | null> {
    const src = this.lastGray;
    if (!src) return null;
    const x = Math.min(src.width - 1, Math.max(0, Math.round(nx * (src.width - 1))));
    const y = Math.min(src.height - 1, Math.max(0, Math.round(ny * (src.height - 1))));
    const { device } = this.gpu;
    const staging = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: src.tex, origin: { x, y } },
      { buffer: staging, bytesPerRow: 256 },
      { width: 1, height: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await staging.mapAsync(GPUMapMode.READ);
    const value = new Float32Array(staging.getMappedRange().slice(0, 4))[0];
    staging.unmap();
    staging.destroy();
    if (!Number.isFinite(value)) return null;
    return Math.round(Math.min(1, Math.max(0, value)) * 255);
  }

  private async refreshScale(): Promise<void> {
    const src = this.buffers;
    if (!src) return;
    const { device } = this.gpu;
    const staging = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(src.minmax, 0, staging, 0, 8);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const [lo, hi] = new Float32Array(staging.getMappedRange().slice(0, 8));
    staging.unmap();
    staging.destroy();
    if (Number.isFinite(lo) && Number.isFinite(hi)) this.lastScale = { lo, hi };
  }

  /** Draw the next pass onto a hidden canvas so the visible one stays intact. */
  setCanvas(canvas: HTMLCanvasElement): void {
    if (this.target.canvas === canvas) return;
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Canvas has no WebGPU context');
    const prev = this.canvasPx.get(canvas);
    this.target = {
      canvas,
      context,
      configuredW: prev?.w ?? 0,
      configuredH: prev?.h ?? 0,
    };
  }

  private bind(layout: GPUBindGroupLayout, entries: GPUBindGroupEntry[]): GPUBindGroup {
    return this.gpu.device.createBindGroup({ layout, entries });
  }

  private configureCanvas(width: number, height: number): void {
    const { canvas, context } = this.target;
    if (
      this.target.configuredW === width
      && this.target.configuredH === height
      && canvas.width === width
      && canvas.height === height
    ) {
      return;
    }
    canvas.width = width;
    canvas.height = height;
    context.configure({
      device: this.gpu.device,
      format: this.gpu.format,
      alphaMode: 'opaque',
    });
    this.target.configuredW = width;
    this.target.configuredH = height;
    this.canvasPx.set(canvas, { w: width, h: height });
  }

  private destroyBuffers(bufs: GpuBuffers): void {
    bufs.color.destroy();
    bufs.median.destroy();
    bufs.raw.destroy();
    bufs.minmax.destroy();
    bufs.uniform.destroy();
  }

  private async ensureBuffers(width: number, height: number): Promise<void> {
    if (this.buffers?.width === width && this.buffers.height === height) return;
    const hit = this.cache.find((b) => b.width === width && b.height === height);
    if (hit) {
      this.buffers = hit;
      return;
    }

    const { device } = this.gpu;
    const pixels = width * height;
    const texDesc = {
      size: { width, height },
      format: 'r32float' as const,
      usage:
        GPUTextureUsage.STORAGE_BINDING
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC,
    };
    const color = device.createTexture(texDesc);
    const medianTex = device.createTexture(texDesc);
    this.buffers = {
      width,
      height,
      uniform: device.createBuffer({
        size: this.map.gpu.uniformBytes,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      raw: device.createBuffer({
        size: pixels * 4,
        usage: GPUBufferUsage.STORAGE,
      }),
      minmax: device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      }),
      color,
      median: medianTex,
      colorView: color.createView(),
      medianView: medianTex.createView(),
    };
    this.cache.push(this.buffers);
    const evict: GpuBuffers[] = [];
    while (this.cache.length > 2) {
      const old = this.cache.shift();
      if (!old || old === this.buffers) continue;
      if (this.lastGray && (this.lastGray.tex === old.color || this.lastGray.tex === old.median)) {
        this.lastGray = null;
      }
      evict.push(old);
    }
    if (evict.length) {
      await device.queue.onSubmittedWorkDone();
      for (const old of evict) this.destroyBuffers(old);
    }
  }
}

async function assertShader(mod: GPUShaderModule, label: string): Promise<void> {
  const info = await mod.getCompilationInfo();
  const bad = info.messages.filter((m) => m.type === 'error');
  if (bad.length) {
    throw new Error(`${label}: ${bad.map((m) => `${m.lineNum}: ${m.message}`).join('; ')}`);
  }
}
