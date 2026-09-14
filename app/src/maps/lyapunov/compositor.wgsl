// Gold marks negative (stable) exponents; blue marks positive (chaotic)
// exponents. The black shoreline is lambda = 0.

const LYAPUNOV_OFFSET: f32 = 16.11809565095832;

fn palette_gold(t: f32) -> vec3f {
  let dark = vec3f(0.010, 0.006, 0.002);
  let amber = vec3f(0.72, 0.27, 0.005);
  let gold = vec3f(1.0, 0.68, 0.035);
  let light = vec3f(1.0, 0.965, 0.68);
  var color = mix(dark, amber, smoothstep(0.02, 0.52, t));
  color = mix(color, gold, smoothstep(0.40, 0.82, t));
  return mix(color, light, smoothstep(0.84, 1.0, t));
}

fn palette_blue(t: f32) -> vec3f {
  let dark = vec3f(0.002, 0.006, 0.018);
  let navy = vec3f(0.018, 0.075, 0.21);
  let cobalt = vec3f(0.055, 0.25, 0.62);
  let light = vec3f(0.27, 0.50, 0.83);
  var color = mix(dark, navy, smoothstep(0.0, 0.36, t));
  color = mix(color, cobalt, smoothstep(0.22, 0.76, t));
  return mix(color, light, smoothstep(0.72, 1.0, t));
}

fn adaptive_strength(tone: f32, value: f32, range: f32) -> f32 {
  let zero_tone = (log(1.0 + LYAPUNOV_OFFSET) - exposure.range.x) / range;
  if (value < 0.0) {
    return clamp((zero_tone - tone) / max(0.08, zero_tone), 0.0, 1.0);
  }
  return clamp((tone - zero_tone) / max(0.08, 1.0 - zero_tone), 0.0, 1.0);
}

fn lyapunov_color(value: f32, tone: f32, range: f32) -> vec3f {
  let fixed_strength = select(
    pow(clamp(value / 0.72, 0.0, 1.0), 0.46),
    pow(clamp(-value / 2.4, 0.0, 1.0), 0.42),
    value < 0.0,
  );
  let adaptive = adaptive_strength(tone, value, range);
  // A broad overview retains the original absolute contrast. Histogram gain
  // fades in only when zoom has compressed the visible exponent range.
  let adaptive_mix = 1.0 - smoothstep(0.025, 0.18, range);
  // A power lift makes small local variations legible when the whole zoomed
  // view sits close to zero, without flattening the absolute overview scale.
  let adaptive_lift = pow(adaptive, 0.30);
  let strength = mix(fixed_strength, adaptive_lift, adaptive_mix * 0.90);
  let fixed_edge = smoothstep(0.0, 0.018, abs(value));
  let adaptive_edge = smoothstep(0.006, 0.045, adaptive);
  let edge = mix(fixed_edge, adaptive_edge, adaptive_mix);
  if (value < 0.0) {
    return palette_gold(strength) * edge;
  }
  return palette_blue(strength) * edge;
}

fn map_sample_color(uv: vec2f, inverted: bool) -> vec3f {
  // Filtering cannot cross storage-buffer tile boundaries. Using it here
  // clamps the 3x3 neighborhood at every edge and draws a visible grid.
  // The longer orbit now supplies temporal stability without spatial seams.
  let sample_log = log_sample(uv);
  let value = exp(sample_log) - 1.0 - LYAPUNOV_OFFSET;
  let range = max(1e-6, exposure.range.y - exposure.range.x);
  let tone = clamp(
    (sample_log - exposure.range.x) / range,
    0.0,
    1.0,
  );
  var color = lyapunov_color(value, tone, range);
  if (inverted) {
    color = vec3f(1.0) - color;
  }
  return color;
}
