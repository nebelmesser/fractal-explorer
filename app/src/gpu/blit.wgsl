// Copy the compute texture onto the canvas. textureLoad keeps pixels crisp
// and works with r32float (unfilterable).

@group(0) @binding(0) var blit_src: texture_2d<f32>;

@fragment
fn blit_fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dims = textureDimensions(blit_src);
  let x = u32(min(max(pos.x, 0.0), f32(dims.x) - 1.0));
  let y = u32(min(max(pos.y, 0.0), f32(dims.y) - 1.0));
  let t = textureLoad(blit_src, vec2u(x, y), 0).r;
  return vec4f(t, t, t, 1.0);
}

@vertex
fn blit_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(pos[i], 0.0, 1.0);
}
