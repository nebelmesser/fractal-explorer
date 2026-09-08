// Build a log-domain histogram for stable percentile exposure. The map values
// stay on the GPU; the CPU reads only 256 counters.

struct Uniforms {
  view: vec4f,
  phys: vec4f,
  step: vec4f,
  size: vec4u,
  extra: vec4u,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> raw: array<f32>;
@group(0) @binding(2) var<storage, read_write> bins: array<atomic<u32>>;

@compute @workgroup_size(256)
fn histogram(@builtin(global_invocation_id) gid: vec3u) {
  let width = u.size.y;
  let height = u.size.z;
  var x0 = u.extra.y & 0xffffu;
  var y0 = u.extra.y >> 16u;
  var x1 = u.extra.z & 0xffffu;
  var y1 = u.extra.z >> 16u;
  if (x1 <= x0 || y1 <= y0 || x1 > width || y1 > height) {
    x0 = 0u; y0 = 0u; x1 = width; y1 = height;
  }
  let region_width = x1 - x0;
  let count = region_width * (y1 - y0);
  if (gid.x >= count) {
    return;
  }
  let id = (y0 + gid.x / region_width) * width + x0 + gid.x % region_width;
  let max_log = max(log(1.0 + f32(u.size.x)), 1e-6);
  let value = clamp(log(1.0 + raw[id]) / max_log, 0.0, 1.0);
  let bin = min(255u, u32(floor(value * 256.0)));
  atomicAdd(&bins[bin], 1u);
}
