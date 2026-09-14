// Chirikov-Taylor standard map on a 2π × 2π torus.
// Each sample packs mean orbit phase, circular coherence, and terminal phase.

const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;
const CONTOUR_ITER: u32 = 24u;

struct Uniforms {
  view: vec4f,    // theta_min, theta_max, p_min, p_max
  orbit: vec4f,   // K, unused, unused, unused
  pad: vec4f,
  size: vec4u,    // iterations, width, height, unused
  extra: vec4u,   // unused, packed (x0,y0), packed (x1,y1), weight
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> raw: array<f32>;

fn wrap_angle(value: f32) -> f32 {
  return value - TAU * floor((value + PI) / TAU);
}

fn packed_signature(theta0: f32, momentum0: f32) -> f32 {
  var theta = wrap_angle(theta0);
  var momentum = wrap_angle(momentum0);
  var mean = vec2f(0.0);
  var contour_theta = theta;
  let steps = max(1u, u.size.x);
  let contour_step = min(CONTOUR_ITER, steps);

  for (var i = 0u; i < steps; i++) {
    let kick = sin(theta);
    momentum = wrap_angle(momentum + u.orbit.x * kick);
    theta = wrap_angle(theta + momentum);
    if (i + 1u == contour_step) {
      contour_theta = theta;
    }
    mean += vec2f(cos(momentum), sin(momentum));
  }

  mean /= f32(steps);
  let phase = fract(atan2(mean.y, mean.x) / TAU + 0.5);
  let coherence = clamp(length(mean), 0.0, 1.0);
  let orbit_phase = fract(contour_theta / TAU + 0.5);
  let phase_bits = u32(round(phase * 1023.0));
  let coherence_bits = u32(round(coherence * 1023.0));
  let orbit_phase_bits = u32(round(orbit_phase * 1023.0));
  return bitcast<f32>(phase_bits | (coherence_bits << 10u) | (orbit_phase_bits << 20u));
}

@compute @workgroup_size(8, 8)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let width = u.size.y;
  let height = u.size.z;
  if (gid.x >= width || gid.y >= height) {
    return;
  }
  let nx = (f32(gid.x) + 0.5) / f32(width);
  let ny = (f32(gid.y) + 0.5) / f32(height);
  let theta = mix(u.view.x, u.view.y, nx);
  let momentum = mix(u.view.z, u.view.w, ny);
  raw[gid.y * width + gid.x] = packed_signature(theta, momentum);
}
