import { onUiChange, t } from '../i18n';
import {
  INVERT_DEFAULT,
  SLIDER_THUMB_PX,
  TARGET_FRAME_MS_MAX,
  TARGET_FRAME_MS_MIN,
} from '../constants';
import type { MapDefinition, MapParam, MapParams } from '../maps/types';
import type { ResetTransition, ViewerControls, ViewerSignals } from './presentation';
import { markPrefsDirty } from './prefs';

function formatValue(spec: MapParam, value: number): string {
  return spec.kind === 'int'
    ? String(Math.round(value))
    : Number(value).toFixed(spec.digits ?? 2);
}

function toSlider(spec: MapParam, actual: number): number {
  if (spec.scale === 'log') {
    const lo = Math.log(spec.min);
    const hi = Math.log(spec.max);
    const unit = (Math.log(Math.min(spec.max, Math.max(spec.min, actual))) - lo) / (hi - lo);
    return spec.invert ? 1 - unit : unit;
  }
  const v = spec.invert ? spec.min + spec.max - actual : actual;
  return spec.kind === 'int' ? Math.round(v) : v;
}

function fromSlider(spec: MapParam, slider: number): number {
  if (spec.scale === 'log') {
    const unit = spec.invert ? 1 - slider : slider;
    const value = Math.exp(Math.log(spec.min) + unit * Math.log(spec.max / spec.min));
    const quantized = spec.min + Math.round((value - spec.min) / spec.step) * spec.step;
    return Math.min(spec.max, Math.max(spec.min, quantized));
  }
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

export type MenuBinding = {
  syncParams(): void;
  setOpen(open: boolean): void;
};

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
  signals?: ViewerSignals,
  getDefault: (spec: MapParam) => number = (spec) => spec.default,
  keepOpenOnOutside: () => boolean = () => false,
): MenuBinding {
  const menuToggle = document.getElementById('menu-toggle') as HTMLButtonElement;
  const uiContainer = document.getElementById('ui-container') as HTMLElement;
  const paramRoot = document.getElementById('map-params');
  if (!menuToggle || !uiContainer || !paramRoot) {
    throw new Error('Menu DOM is incomplete');
  }
  const extraRoot = document.getElementById('map-params-more') ?? paramRoot;
  const advanced = new URLSearchParams(window.location.search).get('advanced') === '1';

  const sliders: { key: string; input: HTMLInputElement; readout: HTMLElement }[] = [];
  function cancelResetAnim(): void {
    onResetHome.cancel();
  }

  /** Sharp unzoom so a parameter edit always starts from the full map. */
  function snapHomeForParams(): boolean {
    if (!onResetHome.isAway()) return false;
    onResetHome.instant();
    return true;
  }

  function paintParam(spec: MapParam, input: HTMLInputElement): void {
    paintRange(input, spec.thumbArea ? controls.params[spec.key] : undefined);
  }

  paramRoot.replaceChildren();
  if (extraRoot !== paramRoot) extraRoot.replaceChildren();
  for (const spec of map.params) {
    if (spec.bind === false || (spec.advanced && !advanced)) continue;
    const host = spec.section === 'primary' ? paramRoot : extraRoot;
    const label = document.createElement('label');
    label.className = 'slider-label';
    if (spec.lessonOnly) label.classList.add('lesson-only-setting');
    if (spec.tone) label.dataset.tone = spec.tone;
    if (spec.thumbArea) label.dataset.scaledThumb = spec.key;
    const raw = controls.params[spec.key] ?? spec.default;
    const start = Math.min(spec.max, Math.max(spec.min, raw));
    controls.params[spec.key] = spec.kind === 'int' ? Math.round(start) : start;
    const row = document.createElement('span');
    row.className = 'row';
    const name = document.createElement('span');
    name.dataset.i18n = spec.label;
    name.textContent = t(spec.label);
    const readout = document.createElement('span');
    readout.dataset.paramValue = spec.key;
    readout.textContent = formatValue(spec, controls.params[spec.key]);
    row.append(name, readout);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = spec.scale === 'log' ? '0' : String(spec.min);
    input.max = spec.scale === 'log' ? '1' : String(spec.max);
    input.step = spec.scale === 'log' ? '0.001' : String(spec.step);
    input.value = String(toSlider(spec, controls.params[spec.key]));
    paintParam(spec, input);
    input.addEventListener('pointerdown', () => {
      cancelResetAnim();
      if (snapHomeForParams()) onParamsChange('live');
    });
    input.addEventListener('input', () => {
      cancelResetAnim();
      snapHomeForParams();
      const next = fromSlider(spec, Number(input.value));
      controls.params[spec.key] = next;
      readout.textContent = formatValue(spec, next);
      paintParam(spec, input);
      markPrefsDirty();
      signals?.set('param', spec.key);
      signals?.set('param_value', next);
      signals?.emit('param-change');
      onParamsChange('live');
    });
    input.addEventListener('change', () => onParamsChange('settle'));
    label.append(row, input);
    host.append(label);
    sliders.push({ key: spec.key, input, readout });
  }

  const target = document.getElementById('targetSlider') as HTMLInputElement;
  const reset = document.getElementById('resetParams');
  const targetSetting = document.getElementById('target-setting')
    ?? target.closest<HTMLElement>('.slider-label');
  if (targetSetting) targetSetting.hidden = !advanced;
  controls.invert = INVERT_DEFAULT;

  function syncParams(): void {
    for (const spec of map.params) {
      const row = sliders.find((s) => s.key === spec.key);
      if (!row) continue;
      const value = controls.params[spec.key] ?? spec.default;
      row.input.value = String(toSlider(spec, value));
      row.readout.textContent = formatValue(spec, value);
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
    signals?.set('budget_ms', controls.targetFrameMs);
    signals?.emit('budget-change');
    onParamsChange('live');
  });
  target.addEventListener('change', () => onParamsChange('settle'));
  reset?.addEventListener('click', () => {
    let paramsDirty = false;
    for (const spec of map.params) {
      const defaultValue = getDefault(spec);
      const value = controls.params[spec.key] ?? defaultValue;
      if (Math.abs(value - defaultValue) > spec.step * 0.25) paramsDirty = true;
    }
    const viewAway = onResetHome.isAway();
    if (!paramsDirty && !viewAway) return;

    cancelResetAnim();
    for (const spec of map.params) controls.params[spec.key] = getDefault(spec);
    syncParams();
    syncExtras();
    onResetHome.instant();
    markPrefsDirty();
    signals?.emit('params-reset');
    onParamsChange('settle');
  });

  function setMenuOpen(open: boolean): void {
    const wasOpen = uiContainer.classList.contains('is-open');
    uiContainer.classList.toggle('is-open', open);
    menuToggle.classList.toggle('is-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    syncHudForMenu();
    if (open === wasOpen) return;
    signals?.set('menu', open ? 'open' : 'closed');
    signals?.emit(open ? 'menu-open' : 'menu-close');
  }

  function syncHudForMenu(): void {
    const hud = document.getElementById('map-hud');
    if (!hud) return;
    const open = uiContainer.classList.contains('is-open');
    let hide = false;
    if (open) {
      const hudBox = hud.getBoundingClientRect();
      const panelBox = uiContainer.getBoundingClientRect();
      const gap = 12;
      hide = hudBox.width > 0
        && hudBox.right > panelBox.left - gap
        && hudBox.left < panelBox.right + gap
        && hudBox.bottom > panelBox.top - gap
        && hudBox.top < panelBox.bottom + gap;
    }
    document.body.classList.toggle('is-menu-hud-hidden', hide);
    hud.toggleAttribute('aria-hidden', hide);
  }

  function isMenuChrome(target: EventTarget | null): boolean {
    return target instanceof Node && (
      uiContainer.contains(target)
      || menuToggle.contains(target)
      || (target instanceof Element && Boolean(target.closest('#narration-locale, #mode-switch')))
    );
  }

  hideMenu = () => setMenuOpen(false);
  menuToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenuOpen(!uiContainer.classList.contains('is-open'));
  });
  // No overlay: map gestures must reach the clip. Close on any outside gesture.
  document.addEventListener('pointerdown', (event) => {
    if (!uiContainer.classList.contains('is-open')) return;
    if (keepOpenOnOutside()) return;
    if (isMenuChrome(event.target)) return;
    setMenuOpen(false);
  }, true);
  document.addEventListener('wheel', (event) => {
    if (!uiContainer.classList.contains('is-open')) return;
    if (keepOpenOnOutside()) return;
    if (isMenuChrome(event.target)) return;
    setMenuOpen(false);
  }, { capture: true, passive: true });

  syncExtras();
  const hud = document.getElementById('map-hud');
  const hudWatch = new ResizeObserver(() => syncHudForMenu());
  hudWatch.observe(uiContainer);
  if (hud) hudWatch.observe(hud);
  window.addEventListener('resize', syncHudForMenu);
  onUiChange(syncHudForMenu);
  // Stay closed so the map can be hovered; the toggle is always visible.
  setMenuOpen(false);
  return { syncParams, setOpen: setMenuOpen };
}
