import { onUiChange, t } from '../../i18n';
import { markPrefsDirty } from '../../viewer/prefs';
import type { MapParam } from '../types';
import type { PresentationHost } from '../../viewer/presentation';
import {
  SEGMENT_PAD_INSET_PX,
  SEGMENT_PAD_LABEL_GAP_PX,
  SEGMENT_PAD_LABEL_PX,
  SEGMENT_PAD_MAGNET_LEAVE_PX,
  SEGMENT_PAD_MAGNET_PX,
  SEGMENT_PAD_PIVOT_R,
} from './constants';
import {
  drawOverlaySegment,
  drawProbePivot,
  overlayBobRadius,
  overlayRodWidth,
} from './preview';
import { theme } from './theme';

const SEGMENTS = [
  { length: 'L1', mass: 'M1', tone: 'th1' as const },
  { length: 'L2', mass: 'M2', tone: 'th2' as const },
] as const;

type Segment = (typeof SEGMENTS)[number];

type Pad = {
  segment: Segment;
  length: MapParam;
  mass: MapParam;
  root: HTMLElement;
  plot: HTMLCanvasElement;
  yLabel: HTMLElement;
  xLabel: HTMLElement;
};

function massKeyEvent(key: string): boolean {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End';
}

function requireParam(host: PresentationHost, key: string): MapParam {
  const spec = host.map.params.find((param) => param.key === key);
  if (!spec) throw new Error(`Pendulum pad is missing parameter ${key}`);
  return spec;
}

function quantize(spec: MapParam, value: number): number {
  const stepped = spec.min + Math.round((value - spec.min) / spec.step) * spec.step;
  const clamped = Math.min(spec.max, Math.max(spec.min, stepped));
  return spec.kind === 'int' ? Math.round(clamped) : Number(clamped.toFixed(2));
}

function unit(spec: MapParam, value: number): number {
  const span = spec.max - spec.min;
  if (!(span > 0)) return 0;
  return Math.min(1, Math.max(0, (value - spec.min) / span));
}

function padStyle(plot: HTMLCanvasElement, length: MapParam): {
  css: number;
  inner: number;
  pxPerLen: number;
} {
  const css = Math.max(1, Math.round(Math.min(plot.clientWidth, plot.clientHeight)));
  const inner = Math.max(1, css - SEGMENT_PAD_INSET_PX * 2);
  return {
    css,
    inner,
    pxPerLen: inner / Math.max(length.max - length.min, 1e-6),
  };
}

function formatValue(spec: MapParam, value: number): string {
  return spec.kind === 'int' ? String(Math.round(value)) : Number(value).toFixed(2);
}

function snapHome(host: PresentationHost): boolean {
  if (!host.resetTransition.isAway()) return false;
  host.resetTransition.instant();
  return true;
}

function plotPoint(plot: HTMLCanvasElement, massU: number, lengthU: number): { x: number; y: number } {
  const inset = SEGMENT_PAD_INSET_PX;
  const inner = Math.max(1, Math.min(plot.clientWidth, plot.clientHeight) - inset * 2);
  const origin = inset;
  return {
    x: origin + massU * inner,
    y: origin + lengthU * inner,
  };
}

function valuesAt(plot: HTMLCanvasElement, clientX: number, clientY: number, length: MapParam, mass: MapParam): {
  length: number;
  mass: number;
} {
  const box = plot.getBoundingClientRect();
  const inset = SEGMENT_PAD_INSET_PX;
  const inner = Math.max(1, Math.min(box.width, box.height) - inset * 2);
  const uM = (clientX - box.left - inset) / inner;
  const uL = (clientY - box.top - inset) / inner;
  return {
    mass: mass.min + Math.min(1, Math.max(0, uM)) * (mass.max - mass.min),
    length: length.min + Math.min(1, Math.max(0, uL)) * (length.max - length.min),
  };
}

function magnetize(
  plot: HTMLCanvasElement,
  lengthSpec: MapParam,
  massSpec: MapParam,
  length: number,
  mass: number,
  held: { length: boolean; mass: boolean },
): { length: number; mass: number } {
  const center = plotPoint(
    plot,
    unit(massSpec, massSpec.default),
    unit(lengthSpec, lengthSpec.default),
  );
  const point = plotPoint(plot, unit(massSpec, mass), unit(lengthSpec, length));
  const enter = SEGMENT_PAD_MAGNET_PX;
  const leave = SEGMENT_PAD_MAGNET_LEAVE_PX;
  const snapMass = Math.abs(point.x - center.x) <= (held.mass ? leave : enter);
  const snapLength = Math.abs(point.y - center.y) <= (held.length ? leave : enter);
  held.mass = snapMass;
  held.length = snapLength;
  return {
    mass: snapMass ? massSpec.default : mass,
    length: snapLength ? lengthSpec.default : length,
  };
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  outline: string,
): void {
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = 3;
  ctx.strokeStyle = outline;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawPad(host: PresentationHost, pad: Pad): void {
  const { plot, length, mass } = pad;
  const { css, pxPerLen } = padStyle(plot, length);
  if (css < 8) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixel = Math.round(css * dpr);
  if (plot.width !== pixel || plot.height !== pixel) {
    plot.width = pixel;
    plot.height = pixel;
  }
  const ctx = plot.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, css, css);

  const pal = theme();
  const color = pad.segment.tone === 'th1' ? pal.th1 : pal.th2;
  const L = host.controls.params[length.key] ?? length.default;
  const M = host.controls.params[mass.key] ?? mass.default;
  const style = { large: true, pxPerLen, alpha: 1 };
  const bob = plotPoint(plot, unit(mass, M), unit(length, L));
  const origin = { x: bob.x, y: SEGMENT_PAD_INSET_PX };
  const r = overlayBobRadius(M, style);
  const rodW = overlayRodWidth(style);
  drawOverlaySegment(ctx, origin, bob, M, color, style);
  drawProbePivot(ctx, origin, SEGMENT_PAD_PIVOT_R);
  const lengthText = formatValue(length, L);
  const massText = formatValue(mass, M);

  ctx.save();
  ctx.font = `${SEGMENT_PAD_LABEL_PX}px Rubik, sans-serif`;
  ctx.textBaseline = 'middle';
  const gap = SEGMENT_PAD_LABEL_GAP_PX;
  const textW = Math.max(ctx.measureText(lengthText).width, ctx.measureText(massText).width);
  const clear = Math.max(r, rodW / 2 + 1, SEGMENT_PAD_PIVOT_R);
  const onRight = bob.x + clear + gap + textW + 4 <= css;
  ctx.textAlign = onRight ? 'left' : 'right';
  const labelX = onRight ? bob.x + clear + gap : bob.x - clear - gap;
  const rodMidY = origin.y + Math.max(0, bob.y - origin.y) * 0.5;
  drawCaption(ctx, lengthText, labelX, rodMidY, color, pal.figureOutline);
  drawCaption(ctx, massText, labelX, bob.y, color, pal.figureOutline);
  ctx.restore();
}

function syncAria(host: PresentationHost, pad: Pad): void {
  const L = host.controls.params[pad.length.key] ?? pad.length.default;
  const M = host.controls.params[pad.mass.key] ?? pad.mass.default;
  pad.yLabel.textContent = t(pad.length.label);
  pad.xLabel.textContent = t(pad.mass.label);
  pad.plot.setAttribute('aria-label', `${t(pad.length.label)} ${formatValue(pad.length, L)}, ${t(pad.mass.label)} ${formatValue(pad.mass, M)}`);
}

function applyPoint(
  host: PresentationHost,
  pad: Pad,
  clientX: number,
  clientY: number,
  phase: 'live' | 'settle',
  magnet: { length: boolean; mass: boolean },
): void {
  host.resetTransition.cancel();
  const snapped = snapHome(host);
  const raw = valuesAt(pad.plot, clientX, clientY, pad.length, pad.mass);
  const next = magnetize(pad.plot, pad.length, pad.mass, raw.length, raw.mass, magnet);
  const length = quantize(pad.length, next.length);
  const mass = quantize(pad.mass, next.mass);
  const prevL = host.controls.params[pad.length.key] ?? pad.length.default;
  const prevM = host.controls.params[pad.mass.key] ?? pad.mass.default;
  const lengthChanged = length !== prevL;
  const massChanged = mass !== prevM;
  if (!lengthChanged && !massChanged && !snapped && phase === 'live') return;
  host.controls.params[pad.length.key] = length;
  host.controls.params[pad.mass.key] = mass;
  drawPad(host, pad);
  syncAria(host, pad);
  markPrefsDirty();
  if (lengthChanged || massChanged) {
    const key = massChanged && !lengthChanged ? pad.mass.key : pad.length.key;
    const value = key === pad.mass.key ? mass : length;
    host.signals?.set('param', key);
    host.signals?.set('param_value', value);
    host.signals?.emit('param-change');
  }
  host.onParamsChange(phase);
}

export function bindSegmentPads(host: PresentationHost): { sync(): void } {
  const root = document.getElementById('map-params');
  if (!root) throw new Error('Pendulum pads are missing #map-params');
  const stack = document.createElement('div');
  stack.className = 'segment-pads';
  const pads: Pad[] = [];

  for (const segment of SEGMENTS) {
    const length = requireParam(host, segment.length);
    const mass = requireParam(host, segment.mass);
    const card = document.createElement('div');
    card.className = 'segment-pad';
    card.dataset.tone = segment.tone;
    const yLabel = document.createElement('span');
    yLabel.className = 'segment-pad-y';
    yLabel.dataset.i18n = length.label;
    const frame = document.createElement('div');
    frame.className = 'segment-pad-frame';
    const plot = document.createElement('canvas');
    plot.className = 'segment-pad-plot';
    plot.tabIndex = 0;
    const xLabel = document.createElement('span');
    xLabel.className = 'segment-pad-x';
    xLabel.dataset.i18n = mass.label;
    frame.append(plot);
    card.append(frame, yLabel, xLabel);
    stack.append(card);
    const pad: Pad = { segment, length, mass, root: card, plot, yLabel, xLabel };
    pads.push(pad);

    let dragging = false;
    const magnet = { length: false, mass: false };
    plot.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      magnet.length = false;
      magnet.mass = false;
      plot.setPointerCapture(event.pointerId);
      applyPoint(host, pad, event.clientX, event.clientY, 'live', magnet);
    });
    plot.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      applyPoint(host, pad, event.clientX, event.clientY, 'live', magnet);
    });
    const endDrag = (event: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      applyPoint(host, pad, event.clientX, event.clientY, 'settle', magnet);
    };
    plot.addEventListener('pointerup', endDrag);
    plot.addEventListener('pointercancel', endDrag);

    plot.addEventListener('keydown', (event) => {
      const curL = host.controls.params[pad.length.key] ?? pad.length.default;
      const curM = host.controls.params[pad.mass.key] ?? pad.mass.default;
      let nextL = curL;
      let nextM = curM;
      if (event.key === 'ArrowLeft') nextM -= pad.mass.step;
      else if (event.key === 'ArrowRight') nextM += pad.mass.step;
      else if (event.key === 'ArrowUp') nextL -= pad.length.step;
      else if (event.key === 'ArrowDown') nextL += pad.length.step;
      else if (event.key === 'Home') nextM = pad.mass.min;
      else if (event.key === 'End') nextM = pad.mass.max;
      else if (event.key === 'PageUp') nextL = pad.length.min;
      else if (event.key === 'PageDown') nextL = pad.length.max;
      else return;
      event.preventDefault();
      host.resetTransition.cancel();
      snapHome(host);
      nextL = quantize(pad.length, nextL);
      nextM = quantize(pad.mass, nextM);
      host.controls.params[pad.length.key] = nextL;
      host.controls.params[pad.mass.key] = nextM;
      drawPad(host, pad);
      syncAria(host, pad);
      markPrefsDirty();
      const key = massKeyEvent(event.key) ? pad.mass.key : pad.length.key;
      host.signals?.set('param', key);
      host.signals?.set('param_value', key === pad.mass.key ? nextM : nextL);
      host.signals?.emit('param-change');
      host.onParamsChange('live');
    });
    plot.addEventListener('keyup', (event) => {
      if (
        event.key === 'ArrowLeft' || event.key === 'ArrowRight'
        || event.key === 'ArrowUp' || event.key === 'ArrowDown'
        || event.key === 'Home' || event.key === 'End'
        || event.key === 'PageUp' || event.key === 'PageDown'
      ) host.onParamsChange('settle');
    });
  }

  root.replaceChildren(stack);
  for (const pad of pads) {
    host.controls.params[pad.length.key] = quantize(
      pad.length,
      host.controls.params[pad.length.key] ?? pad.length.default,
    );
    host.controls.params[pad.mass.key] = quantize(
      pad.mass,
      host.controls.params[pad.mass.key] ?? pad.mass.default,
    );
  }

  function sync(): void {
    for (const pad of pads) {
      drawPad(host, pad);
      syncAria(host, pad);
    }
  }

  const observer = new ResizeObserver(() => sync());
  observer.observe(stack);
  for (const pad of pads) observer.observe(pad.plot);
  const menu = document.getElementById('ui-container');
  if (menu) observer.observe(menu);
  document.getElementById('resetParams')?.addEventListener('click', () => sync());
  onUiChange(() => sync());
  sync();
  return { sync };
}
