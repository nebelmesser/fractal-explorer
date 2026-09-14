import type { MapCompositor, Rgb } from '../../viewer/compositor';
import { CHIRIKOV_COLOR_BANDS, CHIRIKOV_ORBIT_BANDS } from './constants';
import compositorWgsl from './compositor.wgsl?raw';

type Signature = {
  phase: number;
  coherence: number;
  contourPhase: number;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(lo: number, hi: number, value: number): number {
  const t = clamp01((value - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function unpack(sample: number): Signature {
  const words = new ArrayBuffer(4);
  new Float32Array(words)[0] = sample;
  const packed = new Uint32Array(words)[0];
  return {
    phase: (packed & 1023) / 1023,
    coherence: ((packed >>> 10) & 1023) / 1023,
    contourPhase: ((packed >>> 20) & 1023) / 1023,
  };
}

export function chirikovPalette(phase: number): Rgb {
  const h = ((phase % 1) + 1) % 1;
  const stops: readonly [number, Rgb][] = [
    [0.00, [1.00, 0.035, 0.005]],
    [0.16, [1.00, 0.72, 0.000]],
    [0.34, [0.08, 0.92, 0.025]],
    [0.52, [0.00, 0.72, 0.90]],
    [0.69, [0.015, 0.16, 1.00]],
    [0.84, [0.72, 0.00, 0.68]],
    [1.00, [1.00, 0.035, 0.005]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (h > stops[i][0]) continue;
    const [loAt, lo] = stops[i - 1];
    const [hiAt, hi] = stops[i];
    return mix(lo, hi, (h - loAt) / (hiAt - loAt));
  }
  return stops[0][1];
}

export function chirikovColor(sample: number): Rgb {
  const signature = unpack(sample);
  const contourPhase = (
    signature.phase * CHIRIKOV_COLOR_BANDS
    + signature.contourPhase * CHIRIKOV_ORBIT_BANDS
  );
  const wave = 0.5 + 0.5 * Math.cos(Math.PI * 2 * contourPhase);
  const filament = smoothstep(0.76, 0.997, wave) ** 1.5;
  const order = Math.sqrt(signature.coherence);
  const intensity = clamp01(
    filament * (0.22 + 0.86 * order)
    + signature.coherence ** 4 * 0.02,
  );
  const color = chirikovPalette((signature.phase + signature.contourPhase * 0.08) % 1);
  return [
    color[0] * intensity,
    color[1] * intensity,
    color[2] * intensity,
  ];
}

export const chirikovCompositor: MapCompositor = {
  gpuWgsl: compositorWgsl,
  colorize(sample, _tone, inverted) {
    const color = chirikovColor(sample);
    return inverted ? [1 - color[0], 1 - color[1], 1 - color[2]] : color;
  },
  exposure: 'none',
  initialMedian: 1,
};
