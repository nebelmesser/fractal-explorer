import type { MapCompositor, Rgb } from '../../viewer/compositor';
import { PALETTE_OFFSET, PALETTE_PERIOD, PALETTE_STOPS } from './constants';

let palette: Rgb[] | null = null;

function colors(): Rgb[] {
  if (palette) return palette;
  const style = getComputedStyle(document.documentElement);
  palette = PALETTE_STOPS.map((_, index) => {
    const hex = style.getPropertyValue(`--mandelbrot-color-${index}`).trim();
    if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Missing Mandelbrot palette color ${index}`);
    return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as Rgb;
  });
  return palette;
}

/** A fixed escape-time palette keeps colors stable through pan, zoom, and morph. */
export function mandelbrotColor(sample: number): Rgb {
  if (!(sample > 0) || !Number.isFinite(sample)) return [0, 0, 0];
  const t = (Math.max(0, sample - PALETTE_OFFSET) / PALETTE_PERIOD) % 1;
  const palette = colors();
  for (let i = 1; i < PALETTE_STOPS.length; i++) {
    if (t > PALETTE_STOPS[i]) continue;
    const unit = (t - PALETTE_STOPS[i - 1]) / (PALETTE_STOPS[i] - PALETTE_STOPS[i - 1]);
    const blend = unit * unit * (3 - 2 * unit);
    return palette[i - 1].map((v, c) => v + blend * (palette[i][c] - v)) as Rgb;
  }
  return palette[0];
}

export const mandelbrotCompositor: MapCompositor = {
  get gpuWgsl() {
    const palette = colors();
    const vec = (rgb: Rgb) => `vec3f(${rgb.map((v) => v.toFixed(9)).join(', ')})`;
    const segments = PALETTE_STOPS.slice(1).map((stop, index) => `
      if (t <= ${stop.toFixed(6)}) {
        return mix(${vec(palette[index])}, ${vec(palette[index + 1])},
          smoothstep(${PALETTE_STOPS[index].toFixed(6)}, ${stop.toFixed(6)}, t));
      }`).join('\n');
    return `
      fn mandelbrot_color(sample: f32) -> vec3f {
        if (sample <= 0.0) { return vec3f(0.0); }
        let t = fract(max(0.0, sample - ${PALETTE_OFFSET.toFixed(1)}) / ${PALETTE_PERIOD.toFixed(1)});
        ${segments}
        return ${vec(palette[0])};
      }
      fn map_sample_color(uv: vec2f, inverted: bool) -> vec3f {
        let pixel = vec2i(round(uv * vec2f(draw.size) - vec2f(0.5)));
        let color = mandelbrot_color(raw_at(pixel.x, pixel.y));
        return select(color, vec3f(1.0) - color, inverted);
      }
    `;
  },
  colorize(sample, _tone, inverted) {
    const rgb = mandelbrotColor(sample);
    return inverted ? [1 - rgb[0], 1 - rgb[1], 1 - rgb[2]] : rgb;
  },
  exposure: 'none',
  initialMedian: 1,
};
