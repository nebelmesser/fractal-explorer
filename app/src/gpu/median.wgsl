// Spatial median on the grayscale map — knocks out single-pixel fireflies.

struct Uniforms {
  view: vec4f,
  phys: vec4f,
  step: vec4f,
  size: vec4u,
  extra: vec4u,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var color_src: texture_2d<f32>;
@group(0) @binding(2) var median_tex: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn median(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.size.y || gid.y >= u.size.z) {
    return;
  }
  let n = i32(u.extra.x);
  if (n <= 1) {
    let c = textureLoad(color_src, vec2i(i32(gid.x), i32(gid.y)), 0);
    textureStore(median_tex, vec2i(i32(gid.x), i32(gid.y)), c);
    return;
  }
  let r = n / 2;
  let count = n * n;
  var samples: array<f32, 25>;
  var k = 0;
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      let sx = clamp(i32(gid.x) + dx, 0, i32(u.size.y) - 1);
      let sy = clamp(i32(gid.y) + dy, 0, i32(u.size.z) - 1);
      samples[k] = textureLoad(color_src, vec2i(sx, sy), 0).r;
      k += 1;
    }
  }
  for (var i = 1; i < count; i++) {
    let key = samples[i];
    var j = i - 1;
    loop {
      if (j < 0 || samples[j] <= key) {
        break;
      }
      samples[j + 1] = samples[j];
      j -= 1;
    }
    samples[j + 1] = key;
  }
  let mid = samples[count / 2];
  textureStore(median_tex, vec2i(i32(gid.x), i32(gid.y)), vec4f(mid, 0.0, 0.0, 1.0));
}
