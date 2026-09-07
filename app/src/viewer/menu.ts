import {
  INVERT_DEFAULT,
  PARAM_RESET_MS,
  SLIDER_THUMB_PX,
  TARGET_FRAME_MS_MAX,
  TARGET_FRAME_MS_MIN,
} from '../constants';
import type { MapDefinition, MapParam, MapParams } from '../maps/types';
import type { ResetTransition, ViewerControls } from './presentation';
import { markPrefsDirty } from './prefs';
import { easeInOutCubic } from './view';

function formatValue(kind: 'float' | 'int', value: number): string {
  return kind === 'int' ? String(Math.round(value)) : Number(value).toFixed(2);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function toSlider(spec: MapParam, actual: number): number {
  const v = spec.invert ? spec.min + spec.max - actual : actual;
  return spec.kind === 'int' ? Math.round(v) : v;
}

function fromSlider(spec: MapParam, slider: number): number {
  const v = spec.invert ? spec.min + spec.max - slider : slider;
  return spec.kind === 'int' ? Math.round(v) : v;
}

/** Fill the track and optionally size the thumb so its area follows the value. */
export function paintRange(input: HTMLInputElement, mass?: number): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const span = max - min;
  const t = span > 0 ? (value - min) / span : 0;
  input.style.setProperty('--fill', `${(Math.min(1, Math.max(0, t)) * 100).toFixed(3)}%`);
  if (mass != null && Number.isFinite(mass)) {
    const d = SLIDER_THUMB_PX * Math.sqrt(Math.max(mass, 1e-6));
    input.style.setProperty('--thumb', `${d.toFixed(2)}px`);
  }
}

let hideMenu: (() => void) | null = null;

export function closeMenu(): void {
  hideMenu?.();
}

export function syncBudgetReadout(ms: number, iters: number): void {
  const el = document.getElementById('targetValue');
  if (!el) return;
  const n = Math.max(0, Math.round(iters || 0));
  el.textContent = `${Math.round(ms)} ms · ${n}`;
}

export function bindMenu(
  map: MapDefinition,
  controls: ViewerControls,
  onParamsChange: (phase: 'live' | 'reset' | 'settle') => void,
  onResetHome: ResetTransition,
): void {
  const menuToggle = document.getElementById('menu-toggle') as HTMLButtonElement;
  const menuBackdrop = document.getElementById('menu-backdrop') as HTMLElement;
  const uiContainer = document.getElementById('ui-container') as HTMLElement;
  const paramRoot = document.getElementById('map-params');
  if (!menuToggle || !menuBackdrop || !uiContainer || !paramRoot) {
    throw new Error('Menu DOM is incomplete');
  }
  const extraRoot = document.getElementById('map-params-more') ?? paramRoot;

  const sliders: { key: string; input: HTMLInputElement; readout: HTMLElement }[] = [];
  let resetAnim = 0;
  function cancelResetAnim(): void {
    resetAnim += 1;
    onResetHome.cancel();
  }

  function paintParam(spec: MapParam, input: HTMLInputElement): void {
    paintRange(input, spec.thumbArea ? controls.params[spec.key] : undefined);
  }

  paramRoot.replaceChildren();
  if (extraRoot !== paramRoot) extraRoot.replaceChildren();
  for (const spec of map.params) {
    const host = spec.section === 'primary' ? paramRoot : extraRoot;
    const label = document.createElement('label');
    label.className = 'slider-label';
    if (spec.tone) label.dataset.tone = spec.tone;
    if (spec.thumbArea) label.dataset.scaledThumb = spec.key;
    const raw = controls.params[spec.key] ?? spec.default;
    const start = Math.min(spec.max, Math.max(spec.min, raw));
    controls.params[spec.key] = spec.kind === 'int' ? Math.round(start) : start;
    const row = document.createElement('span');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = spec.label;
    const readout = document.createElement('span');
    readout.dataset.paramValue = spec.key;
    readout.textContent = formatValue(spec.kind, controls.params[spec.key]);
    row.append(name, readout);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(toSlider(spec, controls.params[spec.key]));
    paintParam(spec, input);
    input.addEventListener('input', () => {
      cancelResetAnim();
      const next = fromSlider(spec, Number(input.value));
      controls.params[spec.key] = next;
      readout.textContent = formatValue(spec.kind, next);
      paintParam(spec, input);
      markPrefsDirty();
      onParamsChange('live');
    });
    input.addEventListener('change', () => onParamsChange('settle'));
    label.append(row, input);
    host.append(label);
    sliders.push({ key: spec.key, input, readout });
  }

  const target = document.getElementById('targetSlider') as HTMLInputElement;
  const reset = document.getElementById('resetParams');
  controls.invert = INVERT_DEFAULT;

  function syncParams(): void {
    for (const spec of map.params) {
      const row = sliders.find((s) => s.key === spec.key);
      if (!row) continue;
      const value = controls.params[spec.key] ?? spec.default;
      row.input.value = String(toSlider(spec, value));
      row.readout.textContent = formatValue(spec.kind, value);
      paintParam(spec, row.input);
    }
  }

  function syncExtras(): void {
    target.min = String(TARGET_FRAME_MS_MIN);
    target.max = String(TARGET_FRAME_MS_MAX);
    target.value = String(controls.targetFrameMs);
    paintRange(target);
    syncBudgetReadout(controls.targetFrameMs, controls.params[map.workBudget.param]);
  }

  target.addEventListener('input', () => {
    cancelResetAnim();
    controls.targetFrameMs = Number(target.value);
    paintRange(target);
    syncBudgetReadout(controls.targetFrameMs, controls.params[map.workBudget.param]);
    markPrefsDirty();
    onParamsChange('live');
  });
  target.addEventListener('change', () => onParamsChange('settle'));
  reset?.addEventListener('click', () => {
    const from: Record<string, number> = {};
    let paramsDirty = false;
    for (const spec of map.params) {
      const value = controls.params[spec.key] ?? spec.default;
      from[spec.key] = value;
      if (Math.abs(value - spec.default) > spec.step * 0.25) paramsDirty = true;
    }
    const viewAway = onResetHome.isAway();
    if (!paramsDirty && !viewAway) return;

    cancelResetAnim();
    onResetHome.begin();
    const token = ++resetAnim;
    const t0 = performance.now();
    const tick = (now: number): void => {
      if (token !== resetAnim) return;
      const u = Math.min(1, (now - t0) / PARAM_RESET_MS);
      const e = easeInOutCubic(u);
      if (paramsDirty) {
        for (const spec of map.params) {
          const value = lerp(from[spec.key], spec.default, e);
          controls.params[spec.key] = spec.kind === 'int' ? Math.round(value) : value;
        }
        syncParams();
      }
      onResetHome.tick(e);
      markPrefsDirty();
      if (u < 1) {
        requestAnimationFrame(tick);
      } else {
        if (paramsDirty) {
          for (const spec of map.params) controls.params[spec.key] = spec.default;
          syncParams();
          syncExtras();
        }
        onResetHome.end();
        onParamsChange('settle');
      }
    };
    requestAnimationFrame(tick);
  });

  function setMenuOpen(open: boolean): void {
    uiContainer.classList.toggle('is-open', open);
    menuToggle.classList.toggle('is-open', open);
    menuBackdrop.classList.toggle('is-on', open);
    menuToggle.setAttribute('aria-expanded', String(open));
  }

  hideMenu = () => setMenuOpen(false);
  menuToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenuOpen(!uiContainer.classList.contains('is-open'));
  });
  menuBackdrop.addEventListener('click', () => setMenuOpen(false));

  syncExtras();
  // Stay closed so the map can be hovered; the toggle is always visible.
  setMenuOpen(false);
}
