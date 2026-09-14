import type { MapCompositor, Rgb } from '../../viewer/compositor';
import { decodeLyapunovExponent } from './physics';
import compositorWgsl from './compositor.wgsl?raw';

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

function gold(t: number): Rgb {
  let color = mix([0.010, 0.006, 0.002], [0.72, 0.27, 0.005], smoothstep(0.02, 0.52, t));
  color = mix(color, [1, 0.68, 0.035], smoothstep(0.40, 0.82, t));
  return mix(color, [1, 0.965, 0.68], smoothstep(0.84, 1, t));
}

function blue(t: number): Rgb {
  let color = mix([0.002, 0.006, 0.018], [0.018, 0.075, 0.21], smoothstep(0, 0.36, t));
  color = mix(color, [0.055, 0.25, 0.62], smoothstep(0.22, 0.76, t));
  return mix(color, [0.27, 0.50, 0.83], smoothstep(0.72, 1, t));
}

export function lyapunovColor(
  value: number,
  tone: number,
  exposure?: { lo: number; hi: number },
): Rgb {
  if (!Number.isFinite(value)) return [0, 0, 0];
  const fixedStrength = value < 0
    ? clamp01((-value / 2.4) ** 0.42)
    : clamp01((value / 0.72) ** 0.46);
  let strength = fixedStrength;
  let edge = smoothstep(0, 0.018, Math.abs(value));
  if (exposure) {
    const range = Math.max(1e-6, exposure.hi - exposure.lo);
    const zeroTone = (Math.log1p(-Math.log(1e-7)) - exposure.lo) / range;
    const adaptive = value < 0
      ? clamp01((zeroTone - tone) / Math.max(0.08, zeroTone))
      : clamp01((tone - zeroTone) / Math.max(0.08, 1 - zeroTone));
    const adaptiveMix = 1 - smoothstep(0.025, 0.18, range);
    const adaptiveLift = adaptive ** 0.30;
    strength += (adaptiveLift - strength) * adaptiveMix * 0.90;
    const adaptiveEdge = smoothstep(0.006, 0.045, adaptive);
    edge += (adaptiveEdge - edge) * adaptiveMix;
  }
  const color = value < 0 ? gold(strength) : blue(strength);
  return [color[0] * edge, color[1] * edge, color[2] * edge];
}

export const lyapunovCompositor: MapCompositor = {
  gpuWgsl: compositorWgsl,
  colorize(sample, tone, inverted, exposure) {
    const color = lyapunovColor(decodeLyapunovExponent(sample), tone, exposure);
    return inverted ? [1 - color[0], 1 - color[1], 1 - color[2]] : color;
  },
  // The encoded exponent occupies a very narrow log range. Exact visible
  // quantiles retain the auto-exposure detail that 256 broad bins discard.
  exposure: 'quantile',
  // Cross-tile median neighborhoods are unavailable in the tiled compositor.
  // Temporal convergence in the kernel avoids the grid a clamped filter drew.
  initialMedian: 1,
};
