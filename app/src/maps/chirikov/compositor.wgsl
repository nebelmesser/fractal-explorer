// Cyclic high-chroma phase palette over a black orbit portrait.

const CHIRIKOV_COLOR_BANDS: f32 = 34.0;
const CHIRIKOV_ORBIT_BANDS: f32 = 6.0;

fn phase_palette(phase: f32) -> vec3f {
  let h = fract(phase);
  if (h < 0.16) {
    return mix(vec3f(1.0, 0.035, 0.005), vec3f(1.0, 0.72, 0.0), h / 0.16);
  }
  if (h < 0.34) {
    return mix(vec3f(1.0, 0.72, 0.0), vec3f(0.08, 0.92, 0.025), (h - 0.16) / 0.18);
  }
  if (h < 0.52) {
    return mix(vec3f(0.08, 0.92, 0.025), vec3f(0.0, 0.72, 0.90), (h - 0.34) / 0.18);
  }
  if (h < 0.69) {
    return mix(vec3f(0.0, 0.72, 0.90), vec3f(0.015, 0.16, 1.0), (h - 0.52) / 0.17);
  }
  if (h < 0.84) {
    return mix(vec3f(0.015, 0.16, 1.0), vec3f(0.72, 0.0, 0.68), (h - 0.69) / 0.15);
  }
  return mix(vec3f(0.72, 0.0, 0.68), vec3f(1.0, 0.035, 0.005), (h - 0.84) / 0.16);
}

fn map_sample_color(uv: vec2f, inverted: bool) -> vec3f {
  let dims = vec2f(f32(draw.size.x), f32(draw.size.y));
  let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * dims - vec2f(0.5);
  let packed = bitcast<u32>(raw_at(i32(round(p.x)), i32(round(p.y))));
  let phase = f32(packed & 1023u) / 1023.0;
  let coherence = f32((packed >> 10u) & 1023u) / 1023.0;
  let orbit_phase = f32((packed >> 20u) & 1023u) / 1023.0;
  let contour_phase = phase * CHIRIKOV_COLOR_BANDS + orbit_phase * CHIRIKOV_ORBIT_BANDS;
  let wave = 0.5 + 0.5 * cos(6.283185307179586 * contour_phase);
  let filament = pow(smoothstep(0.76, 0.997, wave), 1.5);
  let order = sqrt(coherence);
  let intensity = clamp(
    filament * (0.22 + 0.86 * order)
      + pow(coherence, 4.0) * 0.02,
    0.0,
    1.0,
  );
  var color = phase_palette(fract(phase + orbit_phase * 0.08)) * intensity;
  if (inverted) {
    color = vec3f(1.0) - color;
  }
  return color;
}
