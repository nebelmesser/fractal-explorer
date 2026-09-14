import {
  LYAPUNOV_DERIVATIVE_EPSILON,
  LYAPUNOV_ENCODE_OFFSET,
  LYAPUNOV_RHYTHM_DEFAULT,
  LYAPUNOV_RHYTHMS,
  LYAPUNOV_SEED,
  LYAPUNOV_TRANSIENT,
} from './constants';

function rhythmSteps(rhythm: number): string {
  const index = Math.max(0, Math.min(LYAPUNOV_RHYTHMS.length - 1, Math.round(rhythm)));
  return LYAPUNOV_RHYTHMS[index] ?? LYAPUNOV_RHYTHMS[LYAPUNOV_RHYTHM_DEFAULT];
}

/** f64 reference kernel used by workers and the hover readout. */
export function lyapunovExponent(
  a: number,
  b: number,
  measured: number,
  rhythm = LYAPUNOV_RHYTHM_DEFAULT,
  seed = LYAPUNOV_SEED,
): number {
  const sequence = rhythmSteps(rhythm);
  const length = sequence.length;
  let x = seed;
  const warmCycles = Math.max(1, Math.floor(LYAPUNOV_TRANSIENT / length));
  for (let cycle = 0; cycle < warmCycles; cycle++) {
    for (let step = 0; step < length; step++) {
      const r = sequence.charCodeAt(step) === 66 ? b : a;
      x = r * x * (1 - x);
    }
    if (!Number.isFinite(x) || Math.abs(x) > 16) return 1.5;
  }

  const cycles = Math.max(1, Math.floor(Math.round(measured) / length));
  let sum = 0;
  for (let cycle = 0; cycle < cycles; cycle++) {
    for (let step = 0; step < length; step++) {
      const r = sequence.charCodeAt(step) === 66 ? b : a;
      sum += Math.log(Math.max(LYAPUNOV_DERIVATIVE_EPSILON, Math.abs(r * (1 - 2 * x))));
      x = r * x * (1 - x);
    }
    if (!Number.isFinite(x) || Math.abs(x) > 16) return 1.5;
  }
  return sum / (cycles * length);
}

export function encodeLyapunovExponent(value: number): number {
  return LYAPUNOV_ENCODE_OFFSET + value;
}

export function decodeLyapunovExponent(value: number): number {
  return value - LYAPUNOV_ENCODE_OFFSET;
}
