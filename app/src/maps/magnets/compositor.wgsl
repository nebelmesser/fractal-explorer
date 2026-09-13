// Magnetic-pendulum samples store three normalized dwell weights in 10 bits
// each. This presentation owns their translation to RGB; the map engine only
// transports the opaque f32 sample.

fn unpack_dwell(sample: f32) -> vec3f {
  let packed = bitcast<u32>(sample);
  return vec3f(
    f32(packed & 1023u),
    f32((packed >> 10u) & 1023u),
    f32((packed >> 20u) & 1023u),
  ) / 1023.0;
}

fn map_sample_color(uv: vec2f, inverted: bool) -> vec3f {
  let dims = vec2f(f32(draw.size.x), f32(draw.size.y));
  let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * dims - vec2f(0.5);
  var color = unpack_dwell(raw_at(i32(round(p.x)), i32(round(p.y))));
  if (inverted) {
    color = vec3f(1.0) - color;
  }
  return color;
}
