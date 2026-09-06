// Min/max of log1p(raw) over the on-screen rect (not the halo). One workgroup.

struct Uniforms {
  view: vec4f,   // x_min, x_max, y_min, y_max
  phys: vec4f,   // L1, L2, M1, M2
  step: vec4f,   // G, DT, unused, unused
  size: vec4u,   // max_iter, width, height, invert
  extra: vec4u,  // median, packed (x0,y0), packed (x1,y1), pad
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> raw: array<f32>;
@group(0) @binding(2) var<storage, read_write> minmax: array<f32>;

var<workgroup> smin: array<f32, 256>;
var<workgroup> smax: array<f32, 256>;

@compute @workgroup_size(256)
fn reduce_minmax(
  @builtin(local_invocation_index) li: u32,
  @builtin(global_invocation_id) gi: vec3u,
) {
  let width = u.size.y;
  let height = u.size.z;
  var x0 = u.extra.y & 0xffffu;
  var y0 = u.extra.y >> 16u;
  var x1 = u.extra.z & 0xffffu;
  var y1 = u.extra.z >> 16u;
  if (x1 <= x0 || y1 <= y0 || x1 > width || y1 > height) {
    x0 = 0u;
    y0 = 0u;
    x1 = width;
    y1 = height;
  }
  let nw = x1 - x0;
  let n = nw * (y1 - y0);
  var lo = 1e20;
  var hi = -1e20;
  for (var k = gi.x; k < n; k += 256u) {
    let i = (y0 + k / nw) * width + (x0 + k % nw);
    let v = log(1.0 + raw[i]);
    lo = min(lo, v);
    hi = max(hi, v);
  }
  smin[li] = lo;
  smax[li] = hi;
  workgroupBarrier();

  var stride = 128u;
  while (stride > 0u) {
    if (li < stride) {
      smin[li] = min(smin[li], smin[li + stride]);
      smax[li] = max(smax[li], smax[li + stride]);
    }
    workgroupBarrier();
    stride = stride / 2u;
  }
  if (li == 0u) {
    minmax[0] = smin[0];
    minmax[1] = smax[0];
  }
}
