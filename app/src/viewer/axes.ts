import { theme } from '../theme';
import { viewSpanX, viewSpanY, type ViewRect } from '../maps/types';

const RAD2DEG = 180 / Math.PI;
const NICE = [1, 2, 5] as const;
/** Five unlabeled ticks between each pair of labeled majors. */
const MINOR_DIVS = 6;
const MAJOR_LEN = 18;
const MINOR_LEN = 4;

type NiceStep = { coeff: number; exp: number; step: number };
type AxisTick = { deg: number; major: boolean; label: string };

/** θ₁ along the bottom, θ₂ along the right — values in degrees. */
export function drawMapAxes(
  canvas: HTMLCanvasElement,
  view: ViewRect,
  xRoot: HTMLElement,
  yRoot: HTMLElement,
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
  ctx.shadowBlur = 2;

  const xTicks = axisTicks(view.xMin, view.xMax, w, 88);
  const yTicks = axisTicks(view.yMin, view.yMax, h, 88);

  ctx.strokeStyle = pal.th1;
  const xLabels: HTMLSpanElement[] = [];
  for (const tick of xTicks) {
    const x = ((tick.deg / RAD2DEG - view.xMin) / (view.xMax - view.xMin)) * w;
    if (x < 2 || x > w - 2) continue;
    const len = tick.major ? MAJOR_LEN : MINOR_LEN;
    ctx.globalAlpha = tick.major ? 1 : 0.6;
    ctx.lineWidth = tick.major ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x, h - len);
    ctx.stroke();
    if (!tick.major || x < 40 || x > w - 36) continue;
    const label = document.createElement('span');
    label.textContent = tick.label;
    label.style.left = `${x}px`;
    xLabels.push(label);
  }
  ctx.globalAlpha = 1;
  xRoot.replaceChildren(...xLabels);

  ctx.strokeStyle = pal.th2;
  const yLabels: HTMLSpanElement[] = [];
  for (const tick of yTicks) {
    const y = ((tick.deg / RAD2DEG - view.yMin) / (view.yMax - view.yMin)) * h;
    if (y < 2 || y > h - 2) continue;
    const len = tick.major ? MAJOR_LEN : MINOR_LEN;
    ctx.globalAlpha = tick.major ? 1 : 0.6;
    ctx.lineWidth = tick.major ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(w, y);
    ctx.lineTo(w - len, y);
    ctx.stroke();
    if (!tick.major || y < 16 || y > h - 18) continue;
    const label = document.createElement('span');
    label.textContent = tick.label;
    label.style.top = `${y}px`;
    yLabels.push(label);
  }
  ctx.globalAlpha = 1;
  yRoot.replaceChildren(...yLabels);
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
  while (span / nice.step > maxMajors) nice = bumpNice(nice);
  const minorStep = nice.step / MINOR_DIVS;
  const m0 = Math.ceil(min / minorStep - 1e-12);
  const m1 = Math.floor(max / minorStep + 1e-12);
  const out: AxisTick[] = [];
  for (let m = m0; m <= m1; m++) {
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
