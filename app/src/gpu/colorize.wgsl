// Stretch log1p(raw) to grayscale using the GPU min/max.

struct Uniforms {
  view: vec4f,
  phys: vec4f,
  step: vec4f,
  size: vec4u,
  extra: vec4u,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> raw: array<f32>;
@group(0) @binding(2) var<storage, read> minmax: array<f32>;
@group(0) @binding(3) var color_tex: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn colorize(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.size.y || gid.y >= u.size.z) {
    return;
  }
  let id = gid.y * u.size.y + gid.x;
  let lo = minmax[0];
  let hi = minmax[1];
  let v = log(1.0 + raw[id]);
  var t = 0.0;
  if (hi > lo) {
    t = clamp((v - lo) / (hi - lo), 0.0, 1.0);
  }
  if (u.size.w != 0u) {
    t = 1.0 - t;
  }
  textureStore(color_tex, vec2i(i32(gid.x), i32(gid.y)), vec4f(t, 0.0, 0.0, 1.0));
}
