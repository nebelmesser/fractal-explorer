/** Spacing of IEEE-754 binary32 values at `x`. */
export function f32Ulp(x: number): number {
  const y = Math.fround(x);
  if (!Number.isFinite(y)) return Number.POSITIVE_INFINITY;
  if (y === 0) return 2 ** -149;
  const bits = new DataView(new ArrayBuffer(4));
  bits.setFloat32(0, Math.abs(y), true);
  const u = bits.getUint32(0, true);
  bits.setUint32(0, u + 1, true);
  const next = bits.getFloat32(0, true);
  if (!Number.isFinite(next)) {
    bits.setUint32(0, u - 1, true);
    return Math.abs(y) - bits.getFloat32(0, true);
  }
  return next - Math.abs(y);
}
