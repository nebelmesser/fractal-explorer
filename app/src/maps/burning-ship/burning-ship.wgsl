struct Uniforms {
  view: vec4f,
  orbit: vec4f, // escape radius squared, minimum positive sample
  pad: vec4f,
  size: vec4u,
  extra: vec4u,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> raw: array<f32>;

fn escape_time(c: vec2f) -> f32 {
  var z = vec2f(0.0);
  for (var n = 0u; n < u.size.x; n++) {
    z = vec2f(z.x * z.x - z.y * z.y, 2.0 * abs(z.x * z.y)) + c;
    let r2 = dot(z, z);
    if (r2 > u.orbit.x) {
      return max(u.orbit.y, f32(n) + 2.0 - log2(0.5 * log(r2)));
    }
  }
  return 0.0;
}

@compute @workgroup_size(8, 8)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.size.y || gid.y >= u.size.z) { return; }
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / vec2f(u.size.yz);
  // The conventional Burning Ship orientation has Im(c) increasing downward.
  let point = vec2f(mix(u.view.x, u.view.y, uv.x), mix(u.view.z, u.view.w, uv.y));
  raw[gid.y * u.size.y + gid.x] = escape_time(point);
}
