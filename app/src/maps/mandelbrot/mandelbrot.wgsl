struct Uniforms {
  view: vec4f,
  orbit: vec4f, // morph, Julia real, Julia imaginary, escape radius squared
  pad: vec4f,
  size: vec4u,
  extra: vec4u,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> raw: array<f32>;

fn escape_time(point: vec2f) -> f32 {
  let morph = u.orbit.x;
  if (morph == 0.0) {
    let x = point.x - 0.25;
    let y2 = point.y * point.y;
    let q = x * x + y2;
    if (q * (q + x) <= 0.25 * y2 || (point.x + 1.0) * (point.x + 1.0) + y2 <= 0.0625) { return 0.0; }
  }
  let c = (1.0 - morph) * point + morph * u.orbit.yz;
  var z = morph * point;
  for (var n = 0u; n < u.size.x; n++) {
    z = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    let r2 = dot(z, z);
    if (r2 > u.orbit.w) {
      return max(1e-7, f32(n) + 2.0 - log2(0.5 * log(r2)));
    }

  }
  return 0.0;
}

@compute @workgroup_size(8, 8)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.size.y || gid.y >= u.size.z) { return; }
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / vec2f(u.size.yz);
  let point = vec2f(mix(u.view.x, u.view.y, uv.x), -mix(u.view.z, u.view.w, uv.y));
  raw[gid.y * u.size.y + gid.x] = escape_time(point);
}
