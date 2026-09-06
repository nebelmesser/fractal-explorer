import { theme } from '../theme';
import type { ViewRect } from '../maps/types';

const RAD2DEG = 180 / Math.PI;
const NICE = [1, 2, 5];

/** θ₁ along the bottom, θ₂ along the right — values in degrees. */
export function drawMapAxes(canvas: HTMLCanvasElement, view: ViewRect): void {
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
  ctx.font = '11px Rubik, sans-serif';
  ctx.lineWidth = 1;
  ctx.shadowColor = pal.axisShadow;
  ctx.shadowBlur = 3;

  const xTicks = degreeTicks(view.xMin, view.xMax, w / 160);
  const yTicks = degreeTicks(view.yMin, view.yMax, h / 150);
  const bottom = h - 8;
  const right = w - 8;

  ctx.fillStyle = pal.th1;
  ctx.strokeStyle = pal.th1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const deg of xTicks) {
    const x = ((deg / RAD2DEG - view.xMin) / (view.xMax - view.xMin)) * w;
    if (x < 88 || x > w - 44) continue;
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x, h - 5);
    ctx.stroke();
    ctx.fillText(formatAxisDeg(deg), x, bottom);
  }

  ctx.fillStyle = pal.th2;
  ctx.strokeStyle = pal.th2;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const deg of yTicks) {
    const y = ((deg / RAD2DEG - view.yMin) / (view.yMax - view.yMin)) * h;
    if (y < 44 || y > h - 28) continue;
    ctx.beginPath();
    ctx.moveTo(w, y);
    ctx.lineTo(w - 5, y);
    ctx.stroke();
    ctx.fillText(formatAxisDeg(deg), right, y);
  }
}

function degreeTicks(minRad: number, maxRad: number, targetCount: number): number[] {
  const min = minRad * RAD2DEG;
  const max = maxRad * RAD2DEG;
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const step = nearestNice(span / Math.max(2, targetCount));
  const start = Math.ceil((min - 1e-9) / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-6; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    if (out.length > 16) break;
  }
  return out;
}

function nearestNice(target: number): number {
  if (!(target > 0) || !Number.isFinite(target)) return 1;
  const exp = Math.floor(Math.log10(target));
  let best = 10 ** exp;
  let bestErr = Infinity;
  for (const k of NICE) {
    for (const e of [exp - 1, exp, exp + 1]) {
      const value = k * 10 ** e;
      const err = Math.abs(Math.log(value / target));
      if (err < bestErr) {
        best = value;
        bestErr = err;
      }
    }
  }
  return best;
}

function formatAxisDeg(deg: number): string {
  if (Math.abs(deg) < 1e-9) return '0°';
  const abs = Math.abs(deg);
  const body = abs >= 0.01 ? String(Number(abs.toPrecision(3))) : abs.toExponential(0);
  return `${deg < 0 ? '−' : ''}${body}°`;
}
