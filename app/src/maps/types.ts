/** Axis-aligned view in map coordinates (radians for the pendulum). */
export type ViewRect = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

export type MapParamKind = 'float' | 'int';

/** One slider the viewer can bind without knowing the map. */
export type MapParam = {
  key: string;
  label: string;
  kind: MapParamKind;
  min: number;
  max: number;
  step: number;
  default: number;
};

export type MapParams = Record<string, number>;

export type PointVisualizer = {
  /** Static pose for a picked (x, y) in map space. */
  draw(ctx: CanvasRenderingContext2D, point: { x: number; y: number }, params: MapParams, degDigits?: number): void;
  createState?(point: { x: number; y: number }, params: MapParams): unknown;
  /** One map-kernel integrator step (same dt the shader uses). */
  step?(state: unknown, params: MapParams, dt: number): unknown;
  /** Draw from an animation state (angles already integrated). */
  drawState?(ctx: CanvasRenderingContext2D, state: unknown, params: MapParams, degDigits?: number): void;
  /** Integrator dt the map kernel uses. */
  replayDt?(params: MapParams): number;
  /** True when the kernel would break (escape or iteration cap). */
  replayDone?(state: unknown): boolean;
  replaySteps?(state: unknown): number;
  /** Kernel steps until this point stops (escape or cap). */
  replayLength?(point: { x: number; y: number }, params: MapParams): number;
  /** Preview-canvas pixel of the sketch's attachment point. */
  anchor?(canvas: HTMLCanvasElement, params: MapParams): { x: number; y: number };
};

export type PostUniforms = {
  invert: boolean;
  median: number;
  /** Stretch grayscale over this view; defaults to the computed `view` (whole buffer). */
  normView?: ViewRect;
};

export type GpuKernel = {
  /** Compute shader that writes one f32 per pixel into a storage buffer. */
  computeWgsl: string;
  entryPoint: string;
  /** Byte length of the uniform buffer (must be a multiple of 16). */
  uniformBytes: number;
  packUniforms(
    view: ViewRect,
    width: number,
    height: number,
    params: MapParams,
    post: PostUniforms,
  ): ArrayBuffer;
};

export type MapDefinition = {
  id: string;
  title: string;
  defaultView: ViewRect;
  params: MapParam[];
  gpu: GpuKernel;
  pointView?: PointVisualizer;
};

export function viewSpanX(view: ViewRect): number {
  return view.xMax - view.xMin;
}

export function viewSpanY(view: ViewRect): number {
  return view.yMax - view.yMin;
}

export function viewCenter(view: ViewRect): { x: number; y: number } {
  return {
    x: (view.xMin + view.xMax) / 2,
    y: (view.yMin + view.yMax) / 2,
  };
}

export function copyView(view: ViewRect): ViewRect {
  return { xMin: view.xMin, xMax: view.xMax, yMin: view.yMin, yMax: view.yMax };
}

export function lerpView(a: ViewRect, b: ViewRect, t: number): ViewRect {
  return {
    xMin: a.xMin + (b.xMin - a.xMin) * t,
    xMax: a.xMax + (b.xMax - a.xMax) * t,
    yMin: a.yMin + (b.yMin - a.yMin) * t,
    yMax: a.yMax + (b.yMax - a.yMax) * t,
  };
}

export function viewsEqual(a: ViewRect, b: ViewRect, eps = 1e-12): boolean {
  return (
    Math.abs(a.xMin - b.xMin) < eps
    && Math.abs(a.xMax - b.xMax) < eps
    && Math.abs(a.yMin - b.yMin) < eps
    && Math.abs(a.yMax - b.yMax) < eps
  );
}

/** Grow `view` by `pad` view-spans on each side. */
export function padView(view: ViewRect, pad: number): ViewRect {
  const sx = viewSpanX(view);
  const sy = viewSpanY(view);
  return {
    xMin: view.xMin - sx * pad,
    xMax: view.xMax + sx * pad,
    yMin: view.yMin - sy * pad,
    yMax: view.yMax + sy * pad,
  };
}

/** Inverse of `padView`: the unpadded center of a padded view. */
export function unpadView(view: ViewRect, pad: number): ViewRect {
  if (!(pad > 0)) return copyView(view);
  const f = pad / (1 + 2 * pad);
  const sx = viewSpanX(view);
  const sy = viewSpanY(view);
  return {
    xMin: view.xMin + sx * f,
    xMax: view.xMax - sx * f,
    yMin: view.yMin + sy * f,
    yMax: view.yMax - sy * f,
  };
}

/**
 * Pixel half-open rect inside a `width×height` buffer whose samples lie in `region`.
 * Matches the shader: sample i maps to xMin + span * i / (size-1).
 */
export function normPixelRect(
  render: ViewRect,
  region: ViewRect,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const sx = viewSpanX(render);
  const sy = viewSpanY(render);
  if (!(sx > 0) || !(sy > 0) || width < 1 || height < 1) {
    return { x0: 0, y0: 0, x1: Math.max(1, width), y1: Math.max(1, height) };
  }
  const xDen = Math.max(width, 2) - 1;
  const yDen = Math.max(height, 2) - 1;
  const x0 = Math.min(width, Math.max(0, Math.round(((region.xMin - render.xMin) / sx) * xDen)));
  const x1 = Math.min(width, Math.max(x0 + 1, Math.round(((region.xMax - render.xMin) / sx) * xDen) + 1));
  const y0 = Math.min(height, Math.max(0, Math.round(((region.yMin - render.yMin) / sy) * yDen)));
  const y1 = Math.min(height, Math.max(y0 + 1, Math.round(((region.yMax - render.yMin) / sy) * yDen) + 1));
  return { x0, y0, x1, y1 };
}

/**
 * How far `inner` sits inside `outer`, as a fraction of the inner span.
 * Negative means `inner` sticks out of `outer`.
 */
export function viewInset(inner: ViewRect, outer: ViewRect): number {
  const sx = viewSpanX(inner);
  const sy = viewSpanY(inner);
  if (!(sx > 0) || !(sy > 0)) return -1;
  const mx = Math.min(inner.xMin - outer.xMin, outer.xMax - inner.xMax) / sx;
  const my = Math.min(inner.yMin - outer.yMin, outer.yMax - inner.yMax) / sy;
  return Math.min(mx, my);
}

export function viewAround(
  x: number,
  y: number,
  spanX: number,
  spanY: number,
): ViewRect {
  return {
    xMin: x - spanX / 2,
    xMax: x + spanX / 2,
    yMin: y - spanY / 2,
    yMax: y + spanY / 2,
  };
}

export function defaultParams(def: MapDefinition): MapParams {
  const out: MapParams = {};
  for (const param of def.params) out[param.key] = param.default;
  return out;
}
