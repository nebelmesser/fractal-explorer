import type { MapCompositor, Rgb } from '../../viewer/compositor';
import type { MagnetsDwell } from './physics';
import compositorWgsl from './compositor.wgsl?raw';

export type MagnetsRgb = { r: number; g: number; b: number };

export function colorFromDwell(dwell: MagnetsDwell, fallbackMagnet: number): MagnetsRgb {
  const sum = dwell[0] + dwell[1] + dwell[2];
  if (sum <= 1e-12) {
    return {
      r: fallbackMagnet === 0 ? 1 : 0,
      g: fallbackMagnet === 1 ? 1 : 0,
      b: fallbackMagnet === 2 ? 1 : 0,
    };
  }
  return { r: dwell[0] / sum, g: dwell[1] / sum, b: dwell[2] / sum };
}

export function rgbCss(color: MagnetsRgb): string {
  return `rgb(${Math.round(color.r * 255)} ${Math.round(color.g * 255)} ${Math.round(color.b * 255)})`;
}

function unpackDwell(sample: number): Rgb {
  const words = new ArrayBuffer(4);
  new Float32Array(words)[0] = sample;
  const packed = new Uint32Array(words)[0];
  return [
    (packed & 1023) / 1023,
    ((packed >>> 10) & 1023) / 1023,
    ((packed >>> 20) & 1023) / 1023,
  ];
}

export const magnetsCompositor: MapCompositor = {
  gpuWgsl: compositorWgsl,
  colorize(sample, _tone, inverted) {
    const color = unpackDwell(sample);
    return inverted ? [1 - color[0], 1 - color[1], 1 - color[2]] : color;
  },
  exposure: 'none',
  initialMedian: 1,
};
