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
  let count = u.size.y * u.size.z;
  if (gid.x >= count) {
    return;
  }
  let max_log = max(log(1.0 + f32(u.size.x)), 1e-6);
  let value = clamp(log(1.0 + raw[gid.x]) / max_log, 0.0, 1.0);
  let bin = min(255u, u32(floor(value * 256.0)));
  atomicAdd(&bins[bin], 1u);
}
