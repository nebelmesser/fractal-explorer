import { viewSpanX, viewSpanY, type ViewRect } from '../types';

type Tick = { value: number; label: string };

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function niceStep(span: number, pixels: number): number {
  const target = span / Math.max(2, Math.floor(pixels / 90));
  const power = 10 ** Math.floor(Math.log10(Math.max(target, Number.MIN_VALUE)));
  const unit = target / power;
  const coefficient = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return coefficient * power;
}

function format(value: number, step: number): string {
  const digits = Math.max(0, Math.min(8, -Math.floor(Math.log10(step))));
  const fixed = value.toFixed(digits);
  const text = digits > 0 ? fixed.replace(/\.?0+$/, '') : fixed;
  return text === '-0' ? '0' : text.replace('-', '−');
}

function ticks(min: number, max: number, pixels: number): Tick[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const step = niceStep(span, pixels);
  const first = Math.ceil(min / step - 1e-10) * step;
  const out: Tick[] = [];
  for (let value = first; value <= max + step * 1e-10 && out.length < 64; value += step) {
    out.push({ value, label: format(value, step) });
  }
  return out;
}

function syncLabels(root: HTMLElement, labels: HTMLSpanElement[]): void {
  const current = Array.from(root.children) as HTMLSpanElement[];
  for (let i = 0; i < labels.length; i++) {
    const source = labels[i];
    const target = current[i] ?? document.createElement('span');
    if (!current[i]) root.append(target);
    target.textContent = source.textContent;
    target.style.left = source.style.left;
    target.style.top = source.style.top;
  }
  for (let i = current.length - 1; i >= labels.length; i--) current[i].remove();
}

export function drawChirikovAxes(
  canvas: HTMLCanvasElement,
  view: ViewRect,
  xRoot: HTMLElement,
  yRoot: HTMLElement,
): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width < 8 || height < 8) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = cssVar('--chirikov-axis');
  ctx.shadowColor = cssVar('--shadow');
  ctx.shadowBlur = 4;
  ctx.lineWidth = 1;

  const xLabels: HTMLSpanElement[] = [];
  for (const tick of ticks(view.xMin, view.xMax, width)) {
    const x = (tick.value - view.xMin) / viewSpanX(view) * width;
    if (x <= 2 || x >= width - 2) continue;
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.lineTo(x, height - 6);
    ctx.stroke();
    if (x < 28 || x > width - 28) continue;
    const label = document.createElement('span');
    label.textContent = tick.label;
    label.style.left = `${x}px`;
    xLabels.push(label);
  }
  syncLabels(xRoot, xLabels);

  const yLabels: HTMLSpanElement[] = [];
  for (const tick of ticks(view.yMin, view.yMax, height)) {
    const y = (tick.value - view.yMin) / viewSpanY(view) * height;
    if (y <= 2 || y >= height - 2) continue;
    ctx.beginPath();
    ctx.moveTo(width, y);
    ctx.lineTo(width - 6, y);
    ctx.stroke();
    if (y < 16 || y > height - 18) continue;
    const label = document.createElement('span');
    label.textContent = tick.label;
    label.style.top = `${y}px`;
    yLabels.push(label);
  }
  syncLabels(yRoot, yLabels);
}
