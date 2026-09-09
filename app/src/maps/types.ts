/** Axis-aligned rectangle in a map's own coordinate system. */
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
  /** Optional CSS theme name supplied by the map presentation. */
  tone?: string;
  /** Primary parameters stay in the first menu block. */
  section?: 'primary' | 'secondary';
  /** Scale the slider thumb area with the parameter value. */
  thumbArea?: boolean;
  /** Slider grows right while the stored value falls (min + max − value). */
  invert?: boolean;
};

export type MapParams = Record<string, number>;

export type NavigationPolicy = {
  /** Optional horizontal bounds for the camera center. */
  xCenter?: { min: number; max: number };
  /** Optional vertical period. Repeated views are rendered from one canonical band. */
  yPeriod?: { period: number; center: number };
};

export type WorkBudget = {
  /** Map parameter that limits per-pixel work. */
  param: string;
  min: number;
  max: number;
  step: number;
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

/** Optional CPU/WASM kernel for tiles finer than f32 can sample. */
export type CpuKernel = {
  fillTile(
    view: ViewRect,
    width: number,
    height: number,
    params: MapParams,
  ): Promise<Float32Array>;
  /** Independent tiles the engine may fill at once. Each tile may also split internally. */
  concurrency?: number;
};

export type MapDefinition = {
  id: string;
  title: string;
  /** Override only to preserve an existing storage key. */
  preferencesKey?: string;
  defaultView: ViewRect;
  navigation?: NavigationPolicy;
  workBudget: WorkBudget;
  params: MapParam[];
  gpu: GpuKernel;
  /** Used past the f32 zoom floor when the viewer is in `maxres` mode. */
  cpu?: CpuKernel;
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
  const span = Math.max(viewSpanX(a), viewSpanY(a), viewSpanX(b), viewSpanY(b));
  const mag = Math.max(
    Math.abs(a.xMin), Math.abs(a.xMax), Math.abs(b.xMin), Math.abs(b.xMax),
    Math.abs(a.yMin), Math.abs(a.yMax), Math.abs(b.yMin), Math.abs(b.yMax),
    span,
    1e-30,
  );
  const tol = Math.max(eps * Math.max(span, 0), mag * Number.EPSILON * 4);
  return (
    Math.abs(a.xMin - b.xMin) < tol
    && Math.abs(a.xMax - b.xMax) < tol
    && Math.abs(a.yMin - b.yMin) < tol
    && Math.abs(a.yMax - b.yMax) < tol
  );
}

/** Axis-aligned union of two views. */
export function unionView(a: ViewRect, b: ViewRect): ViewRect {
  return {
    xMin: Math.min(a.xMin, b.xMin),
    xMax: Math.max(a.xMax, b.xMax),
    yMin: Math.min(a.yMin, b.yMin),
    yMax: Math.max(a.yMax, b.yMax),
  };
}

/** Grow `view` by `pad` view-spans on each side. */
export function padView(view: ViewRect, pad: number): ViewRect {
  return padViewWith(view, pad, view);
}

/** Grow `core` by `pad` times the span of `unit` on each side. */
export function padViewWith(core: ViewRect, pad: number, unit: ViewRect): ViewRect {
  if (!(pad > 0)) return copyView(core);
  const sx = viewSpanX(unit);
  const sy = viewSpanY(unit);
  return {
    xMin: core.xMin - sx * pad,
    xMax: core.xMax + sx * pad,
    yMin: core.yMin - sy * pad,
    yMax: core.yMax + sy * pad,
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

/** Interpolate every declared slider; other keys (iteration cap) stay on `a`. */
export function lerpParams(spec: MapParam[], a: MapParams, b: MapParams, t: number): MapParams {
  const out: MapParams = { ...a };
  for (const param of spec) {
    const av = a[param.key] ?? param.default;
    const bv = b[param.key] ?? param.default;
    const value = av + (bv - av) * t;
    out[param.key] = param.kind === 'int' ? Math.round(value) : value;
  }
  return out;
}
