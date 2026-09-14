import { mapToneRgb, mapToneWgsl } from '../mapTone';

export type Rgb = [number, number, number];

export type CompositorExposure = 'histogram' | 'quantile' | 'none' | {
  /** Bounds in the compositor's log1p sample domain. */
  lo: number;
  hi: number;
};

/**
 * Presentation-owned translation from one semantic map sample to display RGB.
 *
 * `gpuWgsl` must define `map_sample_color(uv, inverted)`. It is appended to
 * the generic tile compositor and may use its `raw_at` and `filtered_sample`
 * helpers. The CPU callback is the equivalent Canvas 2D path.
 */
export type MapCompositor = {
  gpuWgsl: string;
  colorize(
    sample: number,
    tone: number,
    inverted: boolean,
    exposure: { lo: number; hi: number },
  ): Rgb;
  exposure: CompositorExposure;
  /** Initial median window; 1 disables the filter. */
  initialMedian?: number;
};

export function fixedCompositorExposure(compositor: MapCompositor): { lo: number; hi: number } | null {
  if (compositor.exposure === 'histogram' || compositor.exposure === 'quantile') return null;
  if (compositor.exposure === 'none') return { lo: 0, hi: 1 };
  return {
    lo: compositor.exposure.lo,
    hi: Math.max(compositor.exposure.hi, compositor.exposure.lo + 1e-6),
  };
}

const toneGpuWgsl = `${mapToneWgsl()}
fn map_sample_color(uv: vec2f, inverted: bool) -> vec3f {
  let value = filtered_sample(uv);
  var tone = 0.0;
  if (exposure.range.y > exposure.range.x) {
    tone = clamp((value - exposure.range.x) / (exposure.range.y - exposure.range.x), 0.0, 1.0);
  }
  if (inverted) {
    tone = 1.0 - tone;
  }
  return map_tone(tone);
}
`;

/** House log-tone presentation used when a map supplies no custom compositor. */
export const toneMapCompositor: MapCompositor = {
  gpuWgsl: toneGpuWgsl,
  colorize(_sample, tone, inverted) {
    return mapToneRgb(inverted ? 1 - tone : tone);
  },
  exposure: 'histogram',
};
