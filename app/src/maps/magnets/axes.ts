import { viewSpanX, viewSpanY, type ViewRect } from '../types';

const NICE = [1, 2, 5] as const;
const MINOR_DIVS = 5;
const MAJOR_LEN = 6;
const MINOR_LEN = 4 / 3;

function cssVar(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) throw new Error(`Missing magnets color ${name}`);
  return value;
}

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
type AxisTick = { value: number; major: boolean; label: string };

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

function flipYLabel(label: string): string {
  if (label === '0' || /^0(\.0+)?$/.test(label)) return label;
  if (label.startsWith('−')) return label.slice(1);
  return `−${label}`;
}

function formatTick(index: number, nice: NiceStep): string {
  const scaled = index * nice.coeff;
  const neg = scaled < 0;
  if (scaled === 0) return nice.exp >= 0 ? '0' : `0.${'0'.repeat(-nice.exp)}`;
  const digits = String(Math.abs(scaled));
  if (nice.exp >= 0) return `${neg ? '−' : ''}${digits}${'0'.repeat(nice.exp)}`;
  const pad = digits.padStart(-nice.exp + 1, '0');
  const split = pad.length + nice.exp;
  return `${neg ? '−' : ''}${pad.slice(0, split)}.${pad.slice(split)}`;
}

function axisTicks(min: number, max: number, cssPx: number, minLabelPx: number): AxisTick[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const maxMajors = Math.max(2, Math.floor(cssPx / minLabelPx));
  let nice = nearestNiceStep(span / maxMajors);
  while (span / nice.step > maxMajors) nice = bumpNice(nice);
  const minorStep = nice.step / MINOR_DIVS;
  const m0 = Math.ceil(min / minorStep - 1e-12);
  const m1 = Math.floor(max / minorStep + 1e-12);
  const count = Math.min(Math.max(0, Math.floor(m1 - m0) + 1), MINOR_DIVS * (maxMajors + 4));
  const out: AxisTick[] = [];
  for (let offset = 0; offset < count; offset++) {
    const m = m0 + offset;
    const major = m % MINOR_DIVS === 0;
    const index = m / MINOR_DIVS;
    out.push({
      value: major ? index * nice.coeff * 10 ** nice.exp : m * minorStep,
      major,
      label: major ? formatTick(index, nice) : '',
    });
  }
  return out;
}

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

/** Physics y-up: top of the screen is yMax. */
export function drawMagnetsAxes(
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

  const color = cssVar('--muted');
  const outline = cssVar('--axis-outline');
  ctx.shadowColor = cssVar('--shadow');
  ctx.shadowBlur = 4;

  const sx = viewSpanX(view);
  const sy = viewSpanY(view);
  const xTicks = axisTicks(view.xMin, view.xMax, w, 72);
  const yTicks = axisTicks(view.yMin, view.yMax, h, 72);

  const xLabels: HTMLSpanElement[] = [];
  for (const tick of xTicks) {
    const x = ((tick.value - view.xMin) / sx) * w;
    if (x < 2 || x > w - 2) continue;
    ctx.globalAlpha = tick.major ? 1 : 0.6;
    strokeTick(ctx, x, h, x, h - (tick.major ? MAJOR_LEN : MINOR_LEN), color, outline, tick.major ? 1.25 : 1);
    if (!tick.major || x < 28 || x > w - 28) continue;
    const label = document.createElement('span');
    label.textContent = tick.label;
    label.style.left = `${x}px`;
    xLabels.push(label);
  }
  syncLabels(xRoot, xLabels);

  const yLabels: HTMLSpanElement[] = [];
  for (const tick of yTicks) {
    const y = ((tick.value - view.yMin) / sy) * h;
    if (y < 2 || y > h - 2) continue;
    ctx.globalAlpha = tick.major ? 1 : 0.6;
    strokeTick(ctx, w, y, w - (tick.major ? MAJOR_LEN : MINOR_LEN), y, color, outline, tick.major ? 1.25 : 1);
    if (!tick.major || y < 16 || y > h - 18) continue;
    const label = document.createElement('span');
    label.textContent = flipYLabel(tick.label);
    label.style.top = `${y}px`;
    yLabels.push(label);
  }
  ctx.globalAlpha = 1;
  syncLabels(yRoot, yLabels);
}
