import {
  INVERT_DEFAULT,
  MEDIAN_DEFAULT,
  MEDIAN_MAX,
  TARGET_FRAME_MS_MAX,
  TARGET_FRAME_MS_MIN,
} from '../constants';
import type { MapDefinition, MapParams } from '../maps/types';
import { markPrefsDirty } from './prefs';

export type ExplorerControls = {
  params: MapParams;
  invert: boolean;
  median: number;
  targetFrameMs: number;
  animatePreview: boolean;
};

function formatValue(kind: 'float' | 'int', value: number): string {
  return kind === 'int' ? String(Math.round(value)) : Number(value).toFixed(2);
}

let hideMenu: (() => void) | null = null;

export function closeMenu(): void {
  hideMenu?.();
}

export function bindMenu(
  map: MapDefinition,
  controls: ExplorerControls,
  onParamsChange: () => void,
): void {
  const menuToggle = document.getElementById('menu-toggle') as HTMLButtonElement;
  const menuBackdrop = document.getElementById('menu-backdrop') as HTMLElement;
  const uiContainer = document.getElementById('ui-container') as HTMLElement;
  const paramRoot = document.getElementById('map-params');
  if (!menuToggle || !menuBackdrop || !uiContainer || !paramRoot) {
    throw new Error('Menu DOM is incomplete');
  }

  const sliders: { key: string; input: HTMLInputElement; readout: HTMLElement }[] = [];

  paramRoot.replaceChildren();
  for (const spec of map.params) {
    const label = document.createElement('label');
    label.className = 'slider-label';
    const row = document.createElement('span');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = spec.label;
    const readout = document.createElement('span');
    readout.dataset.paramValue = spec.key;
    readout.textContent = formatValue(spec.kind, controls.params[spec.key] ?? spec.default);
    row.append(name, readout);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(controls.params[spec.key] ?? spec.default);
    input.addEventListener('input', () => {
      const raw = Number(input.value);
      controls.params[spec.key] = spec.kind === 'int' ? Math.round(raw) : raw;
      readout.textContent = formatValue(spec.kind, controls.params[spec.key]);
      markPrefsDirty();
      onParamsChange();
    });
    label.append(row, input);
    paramRoot.append(label);
    sliders.push({ key: spec.key, input, readout });
  }

  const invert = document.getElementById('invertCheck') as HTMLInputElement;
  const median = document.getElementById('medianSlider') as HTMLInputElement;
  const medianValue = document.getElementById('medianValue');
  const target = document.getElementById('targetSlider') as HTMLInputElement;
  const targetValue = document.getElementById('targetValue');
  const animate = document.getElementById('animateCheck') as HTMLInputElement;
  const reset = document.getElementById('resetParams');

  function syncParams(): void {
    for (const spec of map.params) {
      const row = sliders.find((s) => s.key === spec.key);
      if (!row) continue;
      const value = controls.params[spec.key] ?? spec.default;
      row.input.value = String(value);
      row.readout.textContent = formatValue(spec.kind, value);
    }
  }

  function syncExtras(): void {
    invert.checked = controls.invert;
    median.max = String(MEDIAN_MAX);
    median.value = String(controls.median);
    if (medianValue) medianValue.textContent = String(controls.median);
    target.min = String(TARGET_FRAME_MS_MIN);
    target.max = String(TARGET_FRAME_MS_MAX);
    target.value = String(controls.targetFrameMs);
    if (targetValue) targetValue.textContent = `${Math.round(controls.targetFrameMs)} ms`;
    animate.checked = controls.animatePreview;
  }

  invert.addEventListener('change', () => {
    controls.invert = invert.checked;
    markPrefsDirty();
    onParamsChange();
  });
  median.addEventListener('input', () => {
    // Only 0 (off) or odd windows; the shader sorts n² samples.
    const n = Math.round(Number(median.value));
    controls.median = n <= 0 ? 0 : n <= 3 ? 3 : 5;
    median.value = String(controls.median);
    if (medianValue) medianValue.textContent = String(controls.median);
    markPrefsDirty();
    onParamsChange();
  });
  target.addEventListener('input', () => {
    controls.targetFrameMs = Number(target.value);
    if (targetValue) targetValue.textContent = `${Math.round(controls.targetFrameMs)} ms`;
    markPrefsDirty();
    onParamsChange();
  });
  animate.addEventListener('change', () => {
    controls.animatePreview = animate.checked;
    markPrefsDirty();
  });
  reset?.addEventListener('click', () => {
    for (const spec of map.params) {
      controls.params[spec.key] = spec.default;
    }
    controls.invert = INVERT_DEFAULT;
    controls.median = MEDIAN_DEFAULT;
    syncParams();
    syncExtras();
    markPrefsDirty();
    onParamsChange();
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
