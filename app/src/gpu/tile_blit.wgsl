// Compose world-aligned scalar tiles with one shared exposure. The fragment
// shader reads raw map values, so changing exposure never invalidates a tile.

struct Exposure {
  range: vec4f, // low, high, invert, moving
  options: vec4u, // median window, tile width, tile height, unused
}

struct Draw {
  rect: vec4f, // NDC left, right, top, bottom
}

@group(0) @binding(0) var<storage, read> raw: array<f32>;
@group(0) @binding(1) var<uniform> exposure: Exposure;
@group(0) @binding(2) var<uniform> draw: Draw;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn tile_vs(@builtin(vertex_index) i: u32) -> VertexOut {
  let corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  );
  let p = corners[i];
  var out: VertexOut;
  out.position = vec4f(
    mix(draw.rect.x, draw.rect.y, p.x),
    mix(draw.rect.z, draw.rect.w, p.y),
    0.0,
    1.0,
  );
  out.uv = p;
  return out;
}

fn raw_at(x: i32, y: i32) -> f32 {
  let width = i32(exposure.options.y);
  let height = i32(exposure.options.z);
  let sx = clamp(x, 0, width - 1);
  let sy = clamp(y, 0, height - 1);
  return raw[u32(sy * width + sx)];
}

fn log_sample(uv: vec2f) -> f32 {
  let dims = vec2f(f32(exposure.options.y - 1u), f32(exposure.options.z - 1u));
  let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * dims;
  let base = vec2i(floor(p));
  if (exposure.range.w < 0.5) {
    return log(1.0 + raw_at(i32(round(p.x)), i32(round(p.y))));
  }
  let f = fract(p);
  let a = log(1.0 + raw_at(base.x, base.y));
  let b = log(1.0 + raw_at(base.x + 1, base.y));
  let c = log(1.0 + raw_at(base.x, base.y + 1));
  let d = log(1.0 + raw_at(base.x + 1, base.y + 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn filtered_sample(uv: vec2f) -> f32 {
  let n = i32(exposure.options.x);
  if (n <= 1) {
    return log_sample(uv);
  }
  let dims = vec2f(f32(exposure.options.y - 1u), f32(exposure.options.z - 1u));
  let center = vec2i(round(clamp(uv, vec2f(0.0), vec2f(1.0)) * dims));
  let radius = n / 2;
  let count = n * n;
  var samples: array<f32, 25>;
  var k = 0;
  for (var dy = -radius; dy <= radius; dy++) {
    for (var dx = -radius; dx <= radius; dx++) {
      samples[k] = log(1.0 + raw_at(center.x + dx, center.y + dy));
      k += 1;
    }
  }
  for (var a = 1; a < count; a++) {
    let value = samples[a];
    var b = a - 1;
    while (b >= 0 && samples[b] > value) {
      samples[b + 1] = samples[b];
      b -= 1;
    }
    samples[b + 1] = value;
  }
  return samples[count / 2];
}

@fragment
fn tile_fs(in: VertexOut) -> @location(0) vec4f {
  let value = filtered_sample(in.uv);
  var gray = 0.0;
  if (exposure.range.y > exposure.range.x) {
    gray = clamp((value - exposure.range.x) / (exposure.range.y - exposure.range.x), 0.0, 1.0);
  }
  if (exposure.range.z > 0.5) {
    gray = 1.0 - gray;
  }
  return vec4f(gray, gray, gray, 1.0);
}
