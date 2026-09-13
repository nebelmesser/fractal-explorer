// Magnetic pendulum basins. Pixel = bob released from rest at (x, y).
// The semantic sample is normalized inverse-square dwell near each magnet,
// packed as three 10-bit weights in one f32. Presentation decides how those
// channels become colors. The weakest magnet is subtracted each step so a far
// swing does not wash the weights toward an even mix.
// gid.y = 0 is view.yMin (top of the tile).
//
// Capture is low speed AND near a magnet. Speed-only settle stops at the
// first turning point and paints concentric rings. Keep MAGNET_* numbers
// in sync with constants.ts.

struct Uniforms {
  view: vec4f,   // x_min, x_max, y_min, y_max
  phys: vec4f,   // K, G, F, H
  step: vec4f,   // DT, settle_speed^2, R, unused
  size: vec4u,   // max_iter, width, height, unused
  extra: vec4u,  // unused, packed (x0,y0), packed (x1,y1), weight
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> raw: array<f32>;

const SQRT3_2: f32 = 0.8660254037844386;
const SINGULAR: f32 = 1e-12;
const CAPTURE_FLOOR: f32 = 0.22;
const CAPTURE_PAD: f32 = 0.4;
const SETTLE_HOLD: u32 = 4u;
const CLOSE_RADIUS: f32 = 6.0;
const MAX_STEP: f32 = 0.1;
const SUBSTEP_MAX: u32 = 8u;

fn magnet(i: u32) -> vec2f {
  let r = max(u.step.z, 1e-6);
  if (i == 0u) {
    return vec2f(0.0, -r);
  }
  if (i == 1u) {
    return vec2f(-r * SQRT3_2, r * 0.5);
  }
  return vec2f(r * SQRT3_2, r * 0.5);
}

fn accel(p: vec2f, v: vec2f) -> vec2f {
  let k = u.phys.x;
  let g = u.phys.y;
  let f = u.phys.z;
  let h2 = u.phys.w * u.phys.w;
  var a = -g * p - f * v;
  for (var i = 0u; i < 3u; i++) {
    let d = magnet(i) - p;
    let r2 = dot(d, d) + h2;
    let r3 = r2 * sqrt(r2);
    a += k * d / max(r3, SINGULAR);
  }
  return a;
}

fn nearest(p: vec2f) -> u32 {
  var best = 0u;
  var best_d = 1e20;
  for (var i = 0u; i < 3u; i++) {
    let d = magnet(i) - p;
    let dist = dot(d, d);
    if (dist < best_d) {
      best_d = dist;
      best = i;
    }
  }
  return best;
}

fn capture_radius() -> f32 {
  return max(CAPTURE_FLOOR, CAPTURE_PAD * u.step.z + u.phys.w);
}

fn captured(p: vec2f, v: vec2f) -> bool {
  if (dot(v, v) >= u.step.y) {
    return false;
  }
  let cap2 = capture_radius() * capture_radius();
  for (var i = 0u; i < 3u; i++) {
    let d = magnet(i) - p;
    if (dot(d, d) < cap2) {
      return true;
    }
  }
  return false;
}

fn substeps(p: vec2f, v: vec2f, dt: f32) -> u32 {
  if (dot(p, p) > CLOSE_RADIUS * CLOSE_RADIUS) {
    return 1u;
  }
  let hop = length(v) * dt;
  if (hop <= MAX_STEP) {
    return 1u;
  }
  return min(SUBSTEP_MAX, 1u + u32(hop / MAX_STEP));
}

fn pack_dwell(dwell: vec3f) -> f32 {
  let m0 = u32(clamp(dwell.x, 0.0, 1.0) * 1023.0 + 0.5);
  let m1 = u32(clamp(dwell.y, 0.0, 1.0) * 1023.0 + 0.5);
  let m2 = u32(clamp(dwell.z, 0.0, 1.0) * 1023.0 + 0.5);
  return bitcast<f32>(m0 | (m1 << 10u) | (m2 << 20u));
}

fn fallback_dwell(p: vec2f) -> vec3f {
  let n = nearest(p);
  if (n == 0u) {
    return vec3f(1.0, 0.0, 0.0);
  }
  if (n == 1u) {
    return vec3f(0.0, 1.0, 0.0);
  }
  return vec3f(0.0, 0.0, 1.0);
}

fn normalized_dwell(dwell: vec3f, p: vec2f) -> vec3f {
  let sum = dwell.x + dwell.y + dwell.z;
  if (sum <= 1e-12) {
    return fallback_dwell(p);
  }
  return dwell / sum;
}

/** Inverse-square proximity, minus the weakest magnet so far-field stays saturated. */
fn dwell_step(p: vec2f, h: f32) -> vec3f {
  let eps = max(u.phys.w * u.phys.w, 1e-4);
  var w = vec3f(0.0);
  for (var m = 0u; m < 3u; m++) {
    let d = magnet(m) - p;
    w[m] = 1.0 / (dot(d, d) + eps);
  }
  let floor = min(w.x, min(w.y, w.z));
  return h * (w - vec3f(floor));
}

fn integrate(start: vec2f) -> f32 {
  var p = start;
  var v = vec2f(0.0);
  var dwell = vec3f(0.0);
  let dt = u.step.x;
  let max_iter = u.size.x;
  var hold = 0u;
  for (var i = 0u; i < max_iter; i++) {
    let n = substeps(p, v, dt);
    let h = dt / f32(n);
    for (var s = 0u; s < SUBSTEP_MAX; s++) {
      if (s >= n) {
        break;
      }
      let a = accel(p, v);
      v += a * h;
      p += v * h;
      dwell += dwell_step(p, h);
    }
    if (captured(p, v)) {
      hold += 1u;
      if (hold >= SETTLE_HOLD) {
        break;
      }
    } else {
      hold = 0u;
    }
  }
  return pack_dwell(normalized_dwell(dwell, p));
}

@compute @workgroup_size(8, 8)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let width = u.size.y;
  let height = u.size.z;
  if (gid.x >= width || gid.y >= height) {
    return;
  }
  let id = gid.y * width + gid.x;
  let nx = (f32(gid.x) + 0.5) / f32(width);
  let ny = (f32(gid.y) + 0.5) / f32(height);
  let x = mix(u.view.x, u.view.y, nx);
  let y = mix(u.view.z, u.view.w, ny);
  raw[id] = integrate(vec2f(x, y));
}
