/** Two f32 mantissas plus a shared exponent preserve reference accuracy on WebGPU. */
export function packReference(orbit: Float64Array): Float32Array {
  const result = new Float32Array(orbit.length * 2);
  for (let i = 0; i < orbit.length / 4; i++) {
    const r = orbit[i * 4], im = orbit[i * 4 + 1];
    const rh = Math.fround(r), ih = Math.fround(im);
    result.set([rh, r - rh, ih, im - ih, orbit[i * 4 + 2], 0, 0, 0], i * 8);
  }
  return result;
}
