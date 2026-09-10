/**
 * Map display colormap (after exposure, before canvas/GPU output).
 *
 * Tone 0 stays black. The stop below is the dark-violet peak of the low end;
 * above it the ramp continues to white. Edit these two values:
 *
 *   MAP_TONE_PURPLE_AT  — where the purple sits, in 0…1 of the displayed range
 *   MAP_TONE_PURPLE     — linear RGB 0…1 of that stop
 */
export const MAP_TONE_PURPLE_AT = 0.15;
export const MAP_TONE_PURPLE = [0.14, 0.11, 0.20] as const;

export function mapToneRgb(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const at = Math.max(1e-6, Math.min(1 - 1e-6, MAP_TONE_PURPLE_AT));
  const [pr, pg, pb] = MAP_TONE_PURPLE;
  if (x <= at) {
    const u = x / at;
    return [pr * u, pg * u, pb * u];
  }
  const u = (x - at) / (1 - at);
  return [pr + (1 - pr) * u, pg + (1 - pg) * u, pb + (1 - pb) * u];
}

export function mapToneCss(t: number): string {
  const [r, g, b] = mapToneRgb(t);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** WGSL `map_tone(t)` — keep in lockstep with `mapToneRgb`. */
export function mapToneWgsl(): string {
  const at = Math.max(1e-6, Math.min(1 - 1e-6, MAP_TONE_PURPLE_AT));
  const [r, g, b] = MAP_TONE_PURPLE;
  return `
fn map_tone(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0);
  let at = ${at};
  let purple = vec3f(${r}, ${g}, ${b});
  if (x <= at) {
    return purple * (x / at);
  }
  return mix(purple, vec3f(1.0), (x - at) / (1.0 - at));
}
`;
}
