// Compose world-aligned scalar tiles with one shared exposure. The fragment
// shader reads raw map values, so changing exposure never invalidates a tile.

struct Exposure {
  range: vec4f, // low, high, invert, reserved
  options: vec4u, // median window, unused
}

struct Draw {
  rect: vec4f, // NDC left, right, top, bottom
  size: vec2u, // native scalar-buffer dimensions
  pad: vec2u,
  sparse: vec4f, // visible fraction x/y, sparse flag, map opacity
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
  let width = i32(draw.size.x);
  let height = i32(draw.size.y);
  let sx = clamp(x, 0, width - 1);
  let sy = clamp(y, 0, height - 1);
  return raw[u32(sy * width + sx)];
}

fn log_sample(uv: vec2f) -> f32 {
  let dims = vec2f(f32(draw.size.x), f32(draw.size.y));
  let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * dims - vec2f(0.5);
  // Use one sampling rule both during and after a gesture. Switching from
  // bilinear motion to nearest-neighbor on release visibly changed chaotic
  // regions on the settle frame.
  return log(1.0 + raw_at(i32(round(p.x)), i32(round(p.y))));
}

fn filtered_sample(uv: vec2f) -> f32 {
  let n = i32(exposure.options.x);
  if (n <= 1) {
    return log_sample(uv);
  }
  let dims = vec2f(f32(draw.size.x), f32(draw.size.y));
  let center = vec2i(round(clamp(uv, vec2f(0.0), vec2f(1.0)) * dims - vec2f(0.5)));
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

fn sparse_sample_visible(uv: vec2f) -> bool {
  if (draw.sparse.z < 0.5) {
    return true;
  }
  if (draw.size.x <= 1u || draw.size.y <= 1u) {
    let d = abs(uv - vec2f(0.5));
    return d.x <= draw.sparse.x * 0.5 && d.y <= draw.sparse.y * 0.5;
  }
  let dims = vec2f(f32(draw.size.x), f32(draw.size.y));
  let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * dims - vec2f(0.5);
  let d = abs(p - round(p));
  return d.x <= draw.sparse.x * 0.5 && d.y <= draw.sparse.y * 0.5;
}

// Color ramp: map_tone() is prepended from src/mapTone.ts.

@fragment
fn tile_fs(in: VertexOut) -> @location(0) vec4f {
  if (!sparse_sample_visible(in.uv)) {
    return vec4f(0.0);
  }
  let value = filtered_sample(in.uv);
  var gray = 0.0;
  if (exposure.range.y > exposure.range.x) {
    gray = clamp((value - exposure.range.x) / (exposure.range.y - exposure.range.x), 0.0, 1.0);
  }
  if (exposure.range.z > 0.5) {
    gray = 1.0 - gray;
  }
  let alpha = draw.sparse.w;
  let rgb = map_tone(gray) * alpha;
  return vec4f(rgb, alpha);
}
