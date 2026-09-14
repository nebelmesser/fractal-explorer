// Lyapunov exponent of a periodically forced logistic map.
// Pixel coordinates are the two growth parameters A and B; the forcing word
// A selected A/B rhythm is repeated after a short transient. Negative values are stable and
// positive values are chaotic. gid.y = 0 is view.yMin (top of the tile).

struct Uniforms {
  view: vec4f,    // x_min, x_max, y_min, y_max
  orbit: vec4f,   // seed, derivative epsilon, transient steps, encode offset
  pad: vec4f,
  size: vec4u,    // measured steps, width, height, rhythm index
  extra: vec4u,   // unused, packed (x0,y0), packed (x1,y1), weight
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> raw: array<f32>;

fn orbit_step(x: f32, r: f32) -> f32 {
  return r * x * (1.0 - x);
}

fn sequence_length(rhythm: u32) -> u32 {
  switch rhythm {
    case 1u: { return 2u; }
    case 2u: { return 3u; }
    case 3u: { return 3u; }
    case 4u: { return 4u; }
    default: { return 5u; }
  }
}

fn orbit_cycle(x0: f32, a: f32, b: f32, rhythm: u32) -> f32 {
  var x = x0;
  switch rhythm {
    case 1u: { // AB
      x = orbit_step(x, a);
      x = orbit_step(x, b);
    }
    case 2u: { // AAB
      x = orbit_step(x, a);
      x = orbit_step(x, a);
      x = orbit_step(x, b);
    }
    case 3u: { // ABB
      x = orbit_step(x, a);
      x = orbit_step(x, b);
      x = orbit_step(x, b);
    }
    case 4u: { // AABB
      x = orbit_step(x, a);
      x = orbit_step(x, a);
      x = orbit_step(x, b);
      x = orbit_step(x, b);
    }
    default: { // AABAB
      x = orbit_step(x, a);
      x = orbit_step(x, a);
      x = orbit_step(x, b);
      x = orbit_step(x, a);
      x = orbit_step(x, b);
    }
  }
  return x;
}

fn measure_step(state: vec2f, r: f32) -> vec2f {
  let derivative = abs(r * (1.0 - 2.0 * state.x));
  return vec2f(
    r * state.x * (1.0 - state.x),
    state.y + log(max(u.orbit.y, derivative)),
  );
}

fn measure_cycle(state0: vec2f, a: f32, b: f32, rhythm: u32) -> vec2f {
  var state = state0;
  switch rhythm {
    case 1u: {
      state = measure_step(state, a);
      state = measure_step(state, b);
    }
    case 2u: {
      state = measure_step(state, a);
      state = measure_step(state, a);
      state = measure_step(state, b);
    }
    case 3u: {
      state = measure_step(state, a);
      state = measure_step(state, b);
      state = measure_step(state, b);
    }
    case 4u: {
      state = measure_step(state, a);
      state = measure_step(state, a);
      state = measure_step(state, b);
      state = measure_step(state, b);
    }
    default: {
      state = measure_step(state, a);
      state = measure_step(state, a);
      state = measure_step(state, b);
      state = measure_step(state, a);
      state = measure_step(state, b);
    }
  }
  return state;
}

fn encoded_exponent(a: f32, b: f32) -> f32 {
  let rhythm = min(u.size.w, 4u);
  let length = sequence_length(rhythm);
  var x = u.orbit.x;
  let warm_cycles = max(1u, u32(u.orbit.z) / length);
  for (var i = 0u; i < warm_cycles; i++) {
    x = orbit_cycle(x, a, b, rhythm);
    if (!isFinite(x) || abs(x) > 16.0) {
      return u.orbit.w + 1.5;
    }
  }

  let measured_cycles = max(1u, u.size.x / length);
  var state = vec2f(x, 0.0);
  for (var i = 0u; i < measured_cycles; i++) {
    state = measure_cycle(state, a, b, rhythm);
    if (!isFinite(state.x) || abs(state.x) > 16.0) {
      return u.orbit.w + 1.5;
    }
  }
  return u.orbit.w + state.y / f32(measured_cycles * length);
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
  let a = mix(u.view.x, u.view.y, nx);
  let b = mix(u.view.z, u.view.w, ny);
  raw[gid.y * width + gid.x] = encoded_exponent(a, b);
}
