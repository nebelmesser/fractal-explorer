// Double-pendulum escape-time map. Pixel = initial (theta1, theta2), omega = 0.
// Brightness is how many Euler steps until |theta1| > 2pi.

struct Uniforms {
  view: vec4f,   // x_min, x_max, y_min, y_max
  phys: vec4f,   // L1, L2, M1, M2
  step: vec4f,   // G, DT, unused, unused
  size: vec4u,   // max_iter, width, height, invert
  extra: vec4u,  // median, pad, pad, pad
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> raw: array<f32>;

const TWO_PI: f32 = 6.283185307179586;
const SINGULAR: f32 = 1e-9;

@compute @workgroup_size(8, 8)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let width = u.size.y;
  let height = u.size.z;
  if (gid.x >= width || gid.y >= height) {
    return;
  }
  let id = gid.y * width + gid.x;
  let x_den = max(width, 2u) - 1u;
  let y_den = max(height, 2u) - 1u;
  let th1 = u.view.x + (u.view.y - u.view.x) * f32(gid.x) / f32(x_den);
  let th2 = u.view.z + (u.view.w - u.view.z) * f32(gid.y) / f32(y_den);
  raw[id] = integrate(th1, th2);
}

fn integrate(start_th1: f32, start_th2: f32) -> f32 {
  var th1 = start_th1;
  var th2 = start_th2;
  var w1 = 0.0;
  var w2 = 0.0;
  var cycles = 0u;
  let L1 = u.phys.x;
  let L2 = u.phys.y;
  let M1 = u.phys.z;
  let M2 = u.phys.w;
  let G = u.step.x;
  let DT = u.step.y;
  let g_m1_plus_m2 = G * (M1 + M2);
  let two_m1_plus_m2 = 2.0 * M1 + M2;
  let max_iter = u.size.x;

  for (var i = 0u; i < max_iter; i++) {
    let sin_th1 = sin(th1);
    let cos_th1 = cos(th1);
    let sin_th1_minus_th2 = sin(th1 - th2);
    let cos_th1_minus_th2 = cos(th1 - th2);
    let cos_2th1_minus_2th2 = cos(2.0 * (th1 - th2));
    let den_factor = two_m1_plus_m2 - M2 * cos_2th1_minus_2th2;

    var alpha1 = 0.0;
    let den1 = L1 * den_factor;
    if (abs(den1) >= SINGULAR) {
      let num1_1 = -G * two_m1_plus_m2 * sin_th1;
      let sin_th1_minus_2th2 = sin(th1 - 2.0 * th2);
      let num1_3_and_4 = -2.0 * sin_th1_minus_th2 * M2
        * (w2 * w2 * L2 + w1 * w1 * L1 * cos_th1_minus_th2);
      alpha1 = (num1_1 + (-M2 * G * sin_th1_minus_2th2) + num1_3_and_4) / den1;
    }

    var alpha2 = 0.0;
    let den2 = L2 * den_factor;
    if (abs(den2) >= SINGULAR) {
      let term_sum = w1 * w1 * L1 * (M1 + M2)
        + g_m1_plus_m2 * cos_th1
        + w2 * w2 * L2 * M2 * cos_th1_minus_th2;
      alpha2 = (2.0 * sin_th1_minus_th2 * term_sum) / den2;
    }

    w1 += alpha1 * DT;
    w2 += alpha2 * DT;
    th1 += w1 * DT;
    th2 += w2 * DT;
    cycles += 1u;
    if (abs(th1) > TWO_PI) {
      break;
    }
  }
  return f32(cycles);
}
