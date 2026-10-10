import { PRECISE_COORDINATE_BITS, PRECISE_QUERY_DIGITS } from '../constants';
import type { ViewRect } from '../maps/types';

export type CoordinateOrigin = { x: bigint; y: bigint };
export const COORDINATE_ONE = 1n << BigInt(PRECISE_COORDINATE_BITS);

/** Convert the exact IEEE-754 value, without rounding a tiny offset into its origin. */
export function coordinateFromNumber(value: number): bigint {
  if (!Number.isFinite(value)) throw new Error('Non-finite camera coordinate');
  if (value === 0) return 0n;
  const buffer = new DataView(new ArrayBuffer(8));
  buffer.setFloat64(0, Math.abs(value));
  const bits = buffer.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 2047n);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  const shift = PRECISE_COORDINATE_BITS + (exponent ? exponent - 1023 : -1022) - 52;
  const result = shift >= 0 ? mantissa << BigInt(shift) : mantissa >> BigInt(-shift);
  return value < 0 ? -result : result;
}

export function coordinateToNumber(value: bigint): number {
  if (value === 0n) return 0;
  const magnitude = value < 0n ? -value : value;
  const shift = Math.max(0, magnitude.toString(2).length - 53);
  return (value < 0n ? -1 : 1) * (Number(magnitude >> BigInt(shift)) / 2 ** 52) * 2 ** (shift + 52 - PRECISE_COORDINATE_BITS);
}

export function coordinateFromString(value: string): bigint {
  if (value.length > PRECISE_QUERY_DIGITS + 32) throw new Error('Camera coordinate is too long');
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) throw new Error('Invalid camera coordinate');
  const exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  if (Math.abs(exponent) > PRECISE_QUERY_DIGITS) throw new Error('Camera exponent is out of range');
  const digits = BigInt(match[2] + (match[3] ?? '')) * COORDINATE_ONE;
  const magnitude = exponent < 0 ? digits / 10n ** BigInt(-exponent) : digits * 10n ** BigInt(exponent);
  return match[1] === '-' ? -magnitude : magnitude;
}

export function coordinateToString(value: bigint, digits = PRECISE_QUERY_DIGITS): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const scale = 10n ** BigInt(digits);
  const rounded = (magnitude * scale + COORDINATE_ONE / 2n) / COORDINATE_ONE;
  const text = rounded.toString().padStart(digits + 1, '0');
  const result = `${text.slice(0, -digits)}.${text.slice(-digits)}`.replace(/\.?0+$/, '');
  return `${negative && rounded !== 0n ? '-' : ''}${result}`;
}

export function exactCenter(view: ViewRect): CoordinateOrigin {
  return {
    x: (view.origin?.x ?? 0n) + coordinateFromNumber((view.xMin + view.xMax) / 2),
    y: (view.origin?.y ?? 0n) + coordinateFromNumber((view.yMin + view.yMax) / 2),
  };
}

export function preciseView(origin: CoordinateOrigin, spanX: number, spanY: number): ViewRect {
  return { origin, xMin: -spanX / 2, xMax: spanX / 2, yMin: -spanY / 2, yMax: spanY / 2 };
}

export function withPrecision(view: ViewRect): ViewRect {
  return preciseView(exactCenter(view), view.xMax - view.xMin, view.yMax - view.yMin);
}

/** Express a rectangle in another camera's local frame for drawing and coverage tests. */
export function relativeView(view: ViewRect, target: ViewRect): ViewRect {
  if (!view.origin && !target.origin) return view;
  const dx = coordinateToNumber((view.origin?.x ?? 0n) - (target.origin?.x ?? 0n));
  const dy = coordinateToNumber((view.origin?.y ?? 0n) - (target.origin?.y ?? 0n));
  return { origin: target.origin, xMin: view.xMin + dx, xMax: view.xMax + dx, yMin: view.yMin + dy, yMax: view.yMax + dy };
}

export function approximateView(view: ViewRect): ViewRect {
  return relativeView(view, { xMin: 0, xMax: 0, yMin: 0, yMax: 0 });
}
