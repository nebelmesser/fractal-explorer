struct Uniforms { offset: vec4f, tail: vec4f, size: vec4u, extra: vec4u }
// Each real component is the unevaluated sum of two f32 values.
struct Complex { m: vec4f, e: i32 }
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> raw: array<f32>;
@group(0) @binding(2) var<storage, read> reference: array<vec4f>;

fn ds_sum(a: vec2f, b: vec2f) -> vec2f {
  let s = a.x + b.x;
  let v = s - a.x;
  let err = (a.x - (s - v)) + (b.x - v) + a.y + b.y;
  let hi = s + err;
  return vec2f(hi, err - (hi - s));
}
fn ds_mul(a: vec2f, b: vec2f) -> vec2f {
  let p = a.x * b.x;
  let ac = 4097.0 * a.x; let ah = ac - (ac - a.x); let al = a.x - ah;
  let bc = 4097.0 * b.x; let bh = bc - (bc - b.x); let bl = b.x - bh;
  let err = ((ah * bh - p) + ah * bl + al * bh) + al * bl + a.x * b.y + a.y * b.x;
  let hi = p + err;
  return vec2f(hi, err - (hi - p));
}
fn norm(m: vec4f, e: i32) -> Complex {
  let size = max(abs(m.x), abs(m.z));
  if (size == 0.0) { return Complex(vec4f(0.0), 0); }
  let shift = i32(floor(log2(size)));
  return Complex(ldexp(m, vec4i(-shift)), e + shift);
}
fn scalar(value: f32) -> Complex { return norm(vec4f(value, 0.0, 0.0, 0.0), 0); }
fn add(a: Complex, b: Complex) -> Complex {
  if (all(a.m == vec4f(0.0))) { return b; }
  if (all(b.m == vec4f(0.0))) { return a; }
  if (a.e - b.e > 100) { return a; }
  if (b.e - a.e > 100) { return b; }
  let e = max(a.e, b.e);
  let av = ldexp(a.m, vec4i(a.e - e)); let bv = ldexp(b.m, vec4i(b.e - e));
  return norm(vec4f(ds_sum(av.xy, bv.xy), ds_sum(av.zw, bv.zw)), e);
}
fn mul(a: Complex, b: Complex) -> Complex {
  return norm(vec4f(ds_sum(ds_mul(a.m.xy, b.m.xy), -ds_mul(a.m.zw, b.m.zw)), ds_sum(ds_mul(a.m.xy, b.m.zw), ds_mul(a.m.zw, b.m.xy))), a.e + b.e);
}
fn log_size(z: Complex) -> f32 {
  if (all(z.m == vec4f(0.0))) { return -1e20; }
  return f32(z.e) + 0.5 * log2(dot(z.m.xz, z.m.xz));
}
fn log_sum(a: f32, b: f32) -> f32 {
  return max(a, b) + log2(1.0 + exp2(-min(120.0, abs(a - b))));
}
fn reference_at(index: u32) -> Complex {
  return Complex(reference[2u * index], i32(reference[2u * index + 1u].x));
}
fn sample(point: Complex) -> f32 {
  let morph = vec2f(bitcast<f32>(u.extra.y), bitcast<f32>(u.extra.z));
  let dc = mul(point, norm(vec4f(ds_sum(vec2f(1.0, 0.0), -morph), 0.0, 0.0), 0));
  var delta = mul(point, norm(vec4f(morph, 0.0, 0.0), 0));
  var m = 0u;
  let initial = reference_at(0u);
  let dc_size = log_size(dc);
  var error_log = -1e20;
  for (var n = 0u; n < u.size.y; n++) {
    let z = reference_at(m);
    let zs = log_size(z); let ds = log_size(delta);
    let propagated = error_log + 1.0 + log_sum(zs, ds);
    let rounding = max(max(zs + ds + 1.0, ds * 2.0), dc_size) - 42.0;
    error_log = log_sum(propagated, rounding);
    delta = add(add(mul(Complex(z.m, z.e + 1), delta), mul(delta, delta)), dc);
    m++;
    let next = reference_at(m);
    let actual = add(next, delta);
    let size = log_size(actual);
    if (max(error_log, log_size(next) - 44.0) > size - 16.0) { return -1.0; }
    if (size > 4.0) { return max(1e-7, f32(n) + 2.0 - log2(size * 0.6931471805599453)); }
    // Near cancellation, recompute this pixel in the CPU's higher precision.
    if (size < log_size(next) - 36.0) { return -1.0; }
    if (size < log_size(delta) || m + 1u >= u.extra.x) {
      delta = add(actual, Complex(-initial.m, initial.e)); m = 0u;
      error_log = log_sum(error_log, log_size(next) - 43.0);
    }
  }
  return 0.0;
}
fn fraction(a: f32, b: f32) -> vec2f {
  let hi = a / b;
  let remainder = ds_sum(vec2f(a, 0.0), -ds_mul(vec2f(hi, 0.0), vec2f(b, 0.0)));
  return ds_sum(vec2f(hi, 0.0), vec2f((remainder.x + remainder.y) / b, 0.0));
}
@compute @workgroup_size(8, 8)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.size.z || gid.y >= u.size.w) { return; }
  let px = fraction(f32(2u * gid.x + 1u) - f32(u.size.z), 2.0 * f32(u.size.z));
  let py = fraction(f32(2u * gid.y + 1u) - f32(u.size.w), 2.0 * f32(u.size.w));
  let r = ds_sum(vec2f(u.offset.x, u.tail.x), ds_mul(px, vec2f(u.offset.z, u.tail.z)));
  let i = ds_sum(vec2f(u.offset.y, u.tail.y), ds_mul(py, vec2f(u.offset.w, u.tail.w)));
  raw[gid.y * u.size.z + gid.x] = sample(norm(vec4f(r, -i), bitcast<i32>(u.size.x)));
}
