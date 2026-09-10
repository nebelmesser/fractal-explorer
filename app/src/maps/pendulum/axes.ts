import { theme } from './theme';
import { viewSpanX, viewSpanY, type ViewRect } from '../types';
import { wrapViewX, wrapViewY } from '../../viewer/view';
import type { NavigationPolicy } from '../types';

const RAD2DEG = 180 / Math.PI;
const NICE = [1, 2, 5] as const;
/** Five unlabeled ticks between each pair of labeled majors. */
const MINOR_DIVS = 6;
const AXIS_TICK_GUARD = 4;
const MAJOR_LEN = 6;
const MINOR_LEN = 4 / 3;
const PROBE_LEN = 12;

function strokeTick(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  outline: string,
  width: number,
): void {
  ctx.lineCap = 'butt';
  ctx.strokeStyle = outline;
  ctx.lineWidth = width + 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

type NiceStep = { coeff: number; exp: number; step: number };
type AxisTick = { deg: number; major: boolean; label: string };

export type ProbePointMark = {
  x: number;
  y: number;
  xRad: number;
  yRad: number;
};

export type ProbeAxisMarks = {
  points: ProbePointMark[];
  /** Grid: only attachment-point ticks, no other numbered axis marks. */
  probesOnly?: boolean;
};

/** Reuse label nodes while the camera moves; replacing the whole subtree on
 * every pointer frame forces avoidable allocation, style work, and layout. */
function syncLabels(root: HTMLElement, desired: HTMLSpanElement[]): void {
  const current = Array.from(root.children) as HTMLSpanElement[];
  for (let i = 0; i < desired.length; i++) {
    const source = desired[i];
    const target = current[i] ?? document.createElement('span');
    if (!current[i]) root.append(target);
    if (target.textContent !== source.textContent) target.textContent = source.textContent;
    if (target.className !== source.className) target.className = source.className;
    if (target.style.left !== source.style.left) target.style.left = source.style.left;
    if (target.style.top !== source.style.top) target.style.top = source.style.top;
  }
  for (let i = current.length - 1; i >= desired.length; i--) current[i].remove();
}

/** θ₁ along the bottom, θ₂ along the right — values in degrees. */
export function drawMapAxes(
  canvas: HTMLCanvasElement,
  view: ViewRect,
  xRoot: HTMLElement,
  yRoot: HTMLElement,
  navigation: NavigationPolicy,
  probes?: ProbeAxisMarks,
): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 8 || h < 8) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pal = theme();
  ctx.lineWidth = 1;
  ctx.shadowColor = pal.axisShadow;
  ctx.shadowBlur = 4;

  const probesOnly = Boolean(probes?.probesOnly);
  const xTicks = probesOnly ? [] : axisTicks(view.xMin, view.xMax, w, 88);
  const yTicks = probesOnly ? [] : axisTicks(view.yMin, view.yMax, h, 88);

  ctx.strokeStyle = pal.th1;
  const xLabels: HTMLSpanElement[] = [];
  const probeXs = probes?.points.map((p) => p.x) ?? [];
  for (const tick of xTicks) {
    const x = ((tick.deg / RAD2DEG - view.xMin) / (view.xMax - view.xMin)) * w;
    if (x < 2 || x > w - 2) continue;
    const nearProbe = probeXs.some((px) => Math.abs(x - px) < 28);
    if (nearProbe) continue;
    const len = tick.major ? MAJOR_LEN : MINOR_LEN;
    ctx.globalAlpha = tick.major ? 1 : 0.6;
    strokeTick(ctx, x, h, x, h - len, pal.th1, pal.axisOutline, tick.major ? 1.25 : 1);
    if (!tick.major || x < 40 || x > w - 36) continue;
    const label = document.createElement('span');
    label.textContent = wrapTickLabel(tick, (rad) => wrapViewX(rad, navigation));
    label.style.left = `${x}px`;
    xLabels.push(label);
  }
  if (probes) xLabels.push(...probeTickLabels(ctx, w, h, view, navigation, probes));
  ctx.globalAlpha = 1;
  syncLabels(xRoot, xLabels);

  ctx.strokeStyle = pal.th2;
  const yLabels: HTMLSpanElement[] = [];
  const probeYs = probes?.points.map((p) => p.y) ?? [];
  for (const tick of yTicks) {
    const y = ((tick.deg / RAD2DEG - view.yMin) / (view.yMax - view.yMin)) * h;
    if (y < 2 || y > h - 2) continue;
    const nearProbe = probeYs.some((py) => Math.abs(y - py) < 22);
    if (nearProbe) continue;
    const len = tick.major ? MAJOR_LEN : MINOR_LEN;
    ctx.globalAlpha = tick.major ? 1 : 0.6;
    ctx.lineWidth = tick.major ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(w, y);
    ctx.lineTo(w - len, y);
    ctx.stroke();
    if (!tick.major || y < 16 || y > h - 18) continue;
    const label = document.createElement('span');
    label.textContent = wrapTickLabel(tick, (rad) => wrapViewY(rad, navigation));
    label.style.top = `${y}px`;
    yLabels.push(label);
  }
  if (probes) yLabels.push(...probeYTickLabels(ctx, w, h, view, navigation, probes));
  ctx.globalAlpha = 1;
  syncLabels(yRoot, yLabels);
}

type AxisMark = { px: number; rad: number };

function uniqueMarks(marks: AxisMark[], eps = 0.5): AxisMark[] {
  const sorted = [...marks].sort((a, b) => a.px - b.px);
  const out: AxisMark[] = [];
  for (const mark of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(mark.px - last.px) < eps) continue;
    out.push(mark);
  }
  return out;
}

/** Keep first/last and drop intermediates that would sit on top of a neighbor. */
function thinMarks(marks: AxisMark[], minGap: number): AxisMark[] {
  if (marks.length <= 2) return marks;
  const out = [marks[0]];
  for (let i = 1; i < marks.length - 1; i++) {
    if (marks[i].px - out[out.length - 1].px >= minGap) out.push(marks[i]);
  }
  const last = marks[marks.length - 1];
  if (last.px - out[out.length - 1].px < minGap && out.length > 1) out.pop();
  out.push(last);
  return out;
}

function probeTickLabels(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: ViewRect,
  navigation: NavigationPolicy,
  probes: ProbeAxisMarks,
): HTMLSpanElement[] {
  const digits = angleDigits(view, w, h);
  const marks = uniqueMarks(probes.points.map((p) => ({ px: p.x, rad: p.xRad })));
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = theme().th1;
  for (const mark of marks) {
    if (mark.px < 2 || mark.px > w - 2) continue;
    ctx.beginPath();
    ctx.moveTo(mark.px, h);
    ctx.lineTo(mark.px, h - PROBE_LEN);
    ctx.stroke();
  }
  ctx.restore();

  const labeled = thinMarks(marks, 52);
  const labels: HTMLSpanElement[] = labeled.map((mark, i) => {
    const el = document.createElement('span');
    el.className = 'probe-mark';
    if (labeled.length === 2) {
      el.className += i === 0 ? ' probe-mark-left' : ' probe-mark-right';
    }
    el.textContent = formatAngleDeg(wrapViewX(mark.rad, navigation), digits);
    el.style.left = `${mark.px}px`;
    return el;
  });
  if (marks.length === 2) {
    const mid = (marks[0].px + marks[1].px) / 2;
    const delta = document.createElement('span');
    delta.className = 'probe-delta';
    delta.textContent = formatDeltaDeg(marks[1].rad - marks[0].rad, digits);
    delta.style.left = `${mid}px`;
    labels.push(delta);
  }
  return labels;
}

function probeYTickLabels(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: ViewRect,
  navigation: NavigationPolicy,
  probes: ProbeAxisMarks,
): HTMLSpanElement[] {
  const digits = angleDigits(view, w, h);
  const marks = uniqueMarks(probes.points.map((p) => ({ px: p.y, rad: p.yRad })));
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = theme().th2;
  for (const mark of marks) {
    if (mark.px < 2 || mark.px > h - 2) continue;
    ctx.beginPath();
    ctx.moveTo(w, mark.px);
    ctx.lineTo(w - PROBE_LEN, mark.px);
    ctx.stroke();
  }
  ctx.restore();

  const labeled = thinMarks(marks, 22);
  return labeled.map((mark, i) => {
    const el = document.createElement('span');
    el.className = 'probe-mark';
    if (labeled.length === 2) {
      el.className += i === 0 ? ' probe-mark-top' : ' probe-mark-bottom';
    }
    el.textContent = formatAngleDeg(wrapViewY(mark.rad, navigation), digits);
    el.style.top = `${mark.px}px`;
    return el;
  });
}

function wrapTickLabel(tick: AxisTick, wrap: (rad: number) => number): string {
  if (!tick.major) return '';
  const wrapped = wrap(tick.deg / RAD2DEG) * RAD2DEG;
  const dot = tick.label.indexOf('.');
  const degree = tick.label.indexOf('°');
  const places = dot >= 0 && degree > dot ? degree - dot - 1 : 0;
  const n = Number(wrapped.toFixed(places));
  if (Object.is(n, -0) || n === 0) return '0°';
  return `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(places)}°`;
}

function formatDeltaDeg(rad: number, digits: number): string {
  const deg = Math.abs(rad * RAD2DEG);
  if (!Number.isFinite(deg)) return '0° difference';
  const places = Math.min(8, Math.max(2, digits));
  const n = Number(deg.toFixed(places));
  if (n === 0) return `${(0).toFixed(places)}° difference`;
  return `${n.toFixed(places)}° difference`;
}

function axisTicks(
  minRad: number,
  maxRad: number,
  cssPx: number,
  minLabelPx: number,
): AxisTick[] {
  const min = minRad * RAD2DEG;
  const max = maxRad * RAD2DEG;
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const maxMajors = Math.max(2, Math.floor(cssPx / minLabelPx));
  let nice = nearestNiceStep(span / maxMajors);
  // At the f64 zoom floor, dividing an absolute angle (about 200 degrees) by
  // a tiny minor step can produce an index above Number.MAX_SAFE_INTEGER.
  // Incrementing such an index may then leave it unchanged forever. Coarsen
  // the ruler until every minor-tick index is an exact JS integer.
  const maxAbs = Math.max(Math.abs(min), Math.abs(max));
  while (
    span / nice.step > maxMajors
    || maxAbs / (nice.step / MINOR_DIVS) > Number.MAX_SAFE_INTEGER
  ) nice = bumpNice(nice);
  const minorStep = nice.step / MINOR_DIVS;
  const m0 = Math.ceil(min / minorStep - 1e-12);
  const m1 = Math.floor(max / minorStep + 1e-12);
  const out: AxisTick[] = [];
  // Keep the loop bounded even if a future coordinate system violates the
  // safe-index invariant above. A ruler never needs more than the number of
  // visible major intervals times its minor subdivisions.
  const count = Math.min(
    Math.max(0, Math.floor(m1 - m0) + 1),
    MINOR_DIVS * (maxMajors + AXIS_TICK_GUARD),
  );
  for (let offset = 0; offset < count; offset++) {
    const m = m0 + offset;
    const major = m % MINOR_DIVS === 0;
    const index = m / MINOR_DIVS;
    out.push({
      deg: major ? tickDeg(index, nice) : m * minorStep,
      major,
      label: major ? formatNiceTick(index, nice) : '',
    });
  }
  return out;
}

function bumpNice(nice: NiceStep): NiceStep {
  if (nice.coeff === 1) return { coeff: 2, exp: nice.exp, step: 2 * 10 ** nice.exp };
  if (nice.coeff === 2) return { coeff: 5, exp: nice.exp, step: 5 * 10 ** nice.exp };
  return { coeff: 1, exp: nice.exp + 1, step: 10 ** (nice.exp + 1) };
}

function nearestNiceStep(target: number): NiceStep {
  if (!(target > 0) || !Number.isFinite(target)) return { coeff: 1, exp: 0, step: 1 };
  const exp0 = Math.floor(Math.log10(target));
  let bestCoeff = 1;
  let bestExp = exp0;
  let bestErr = Infinity;
  for (const coeff of NICE) {
    for (const exp of [exp0 - 1, exp0, exp0 + 1]) {
      const step = coeff * 10 ** exp;
      const err = Math.abs(Math.log(step / target));
      if (err < bestErr) {
        bestCoeff = coeff;
        bestExp = exp;
        bestErr = err;
      }
    }
  }
  return { coeff: bestCoeff, exp: bestExp, step: bestCoeff * 10 ** bestExp };
}

/** Exact nice number: index × coeff × 10^exp. */
function tickDeg(index: number, nice: NiceStep): number {
  return index * nice.coeff * 10 ** nice.exp;
}

/** Format from integers so neighboring ticks cannot collapse to one string. */
function formatNiceTick(index: number, nice: NiceStep): string {
  const scaled = index * nice.coeff;
  if (scaled === 0) {
    return nice.exp >= 0 ? '0°' : `0.${'0'.repeat(-nice.exp)}°`;
  }
  const neg = scaled < 0;
  const digits = String(Math.abs(scaled));
  if (nice.exp >= 0) return `${neg ? '−' : ''}${digits}${'0'.repeat(nice.exp)}°`;
  const pad = digits.padStart(-nice.exp + 1, '0');
  const split = pad.length + nice.exp;
  return `${neg ? '−' : ''}${pad.slice(0, split)}.${pad.slice(split)}°`;
}

/** Digits so a one-pixel move on the map changes the last place. */
export function angleDigits(view: ViewRect, widthPx: number, heightPx: number): number {
  const step = Math.min(
    (viewSpanX(view) * RAD2DEG) / Math.max(widthPx, 1),
    (viewSpanY(view) * RAD2DEG) / Math.max(heightPx, 1),
  );
  if (!(step > 0) || !Number.isFinite(step)) return 1;
  return Math.min(12, Math.max(0, Math.ceil(-Math.log10(step))));
}

/** Format a map angle (radians) for the pendulum readout. */
export function formatAngleDeg(rad: number, digits: number): string {
  const deg = rad * RAD2DEG;
  const n = Number(deg.toFixed(digits));
  if (Object.is(n, -0) || n === 0) return digits > 0 ? `0.${'0'.repeat(digits)}°` : '0°';
  return `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}°`;
}
