import { onUiChange, t } from '../../i18n';
import {
  PROBE_GRID_BOB_R,
  PROBE_CELL_MIN_PX,
  PROBE_CELL_PX,
  PROBE_CROSS_PX,
  PROBE_GRID_MAX,
  PROBE_LEVEL_DEFAULT,
  PROBE_PX_PER_LEN,
  PROBE_SCALE_BAND_X,
  PROBE_SCALE_BAND_Y,
  PROBE_SEP_PX,
} from './constants';
import type { MapParams } from '../types';

export type ProbeMode = 'none' | 'one' | 'two' | 'grid';

export type ProbeOrigin = { x: number; y: number };

export type CssRect = { x: number; y: number; w: number; h: number };

export type ProbeStep = {
  count: number;
  mode: ProbeMode;
  spacing: number;
};

const CHROME_IDS = ['map-hud', 'sidebar', 'menu-toggle', 'ui-container', 'narration-locale', 'ask-bar'] as const;
const CHROME_PAD = 10;
/** 0–1–2 sit farther apart than the later grid steps. */
const EARLY_GAP = 1.85;
const LABEL_GAP_PX = 44;

export function probeMode(step: ProbeStep): ProbeMode {
  return step.mode;
}

export function currentProbeStep(hud: ProbeHud): ProbeStep {
  return hud.steps[hud.index] ?? hud.steps[0] ?? { count: 0, mode: 'none', spacing: 0 };
}

/** Track fraction 0…1 for a discrete index; 0, 1, 2 get extra spacing. */
export function probeLevelPos(index: number, max: number): number {
  const n = Math.min(max, Math.max(0, index));
  if (max <= 0) return 0;
  const late = Math.max(1, max - 2);
  const total = 2 * EARLY_GAP + late;
  if (n <= 2) return (n * EARLY_GAP) / total;
  return (2 * EARLY_GAP + (n - 2)) / total;
}

export function probeLevelFromPos(t: number, max: number): number {
  const u = Math.min(1, Math.max(0, t));
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i <= max; i++) {
    const err = Math.abs(probeLevelPos(i, max) - u);
    if (err < bestErr) {
      best = i;
      bestErr = err;
    }
  }
  return best;
}

function indexForCount(steps: ProbeStep[], count: number): number {
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < steps.length; i++) {
    const err = Math.abs(steps[i].count - count);
    if (err < bestErr) {
      best = i;
      bestErr = err;
    }
  }
  return best;
}

function labeledIndices(steps: ProbeStep[], trackW: number): Set<number> {
  const last = steps.length - 1;
  const out = new Set<number>();
  if (last < 0) return out;
  out.add(0);
  if (last >= 1) out.add(1);
  if (last >= 2) out.add(2);
  if (last > 2) out.add(last);
  let prev = Math.min(2, last);
  for (let i = 3; i < last; i++) {
    const gap = (probeLevelPos(i, last) - probeLevelPos(prev, last)) * trackW;
    const rest = (1 - probeLevelPos(i, last)) * trackW;
    if (gap >= LABEL_GAP_PX && rest >= LABEL_GAP_PX) {
      out.add(i);
      prev = i;
    }
  }
  return out;
}

/** Clip-local boxes of HUD / zoom / menu / axis labels so probes stay off them. */
export function chromeRects(clip: HTMLElement): CssRect[] {
  if (document.body.classList.contains('is-chrome-hidden')) return [];
  const box = clip.getBoundingClientRect();
  const out: CssRect[] = [];
  for (const id of CHROME_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (id === 'ui-container' && !el.classList.contains('is-open')) continue;
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) continue;
    out.push({
      x: r.left - box.left - CHROME_PAD,
      y: r.top - box.top - CHROME_PAD,
      w: r.width + CHROME_PAD * 2,
      h: r.height + CHROME_PAD * 2,
    });
  }
  out.push({ x: 0, y: box.height - PROBE_SCALE_BAND_X, w: box.width, h: PROBE_SCALE_BAND_X });
  out.push({ x: box.width - PROBE_SCALE_BAND_Y, y: 0, w: PROBE_SCALE_BAND_Y, h: box.height });
  return out;
}

/** True when the reticle would sit on a chrome box. */
export function originHitsChrome(origin: ProbeOrigin, rects: CssRect[], radius: number): boolean {
  for (const r of rects) {
    const nx = Math.max(r.x, Math.min(origin.x, r.x + r.w));
    const ny = Math.max(r.y, Math.min(origin.y, r.y + r.h));
    if (Math.hypot(origin.x - nx, origin.y - ny) <= radius) return true;
  }
  return false;
}

function hangPad(params: MapParams): number {
  const bob = PROBE_GRID_BOB_R * Math.sqrt(Math.max(params.M1, params.M2, 0));
  return PROBE_CROSS_PX + bob + 8;
}

export function probePxPerLen(cell: number, params: MapParams): number {
  const total = Math.max(params.L1 + params.L2, 1e-6);
  return Math.max(4, (cell - hangPad(params)) / total);
}

export function gridLayout(
  width: number,
  height: number,
  targetCell: number,
): { cols: number; rows: number; cellW: number; cellH: number } {
  const cell = Math.max(PROBE_CELL_MIN_PX, targetCell);
  let cols = Math.max(1, Math.round(width / cell));
  let rows = Math.max(1, Math.round(height / cell));
  if (cols * rows > PROBE_GRID_MAX) {
    const aspect = width / Math.max(height, 1);
    rows = Math.max(1, Math.round(Math.sqrt(PROBE_GRID_MAX / Math.max(aspect, 1e-6))));
    cols = Math.max(1, Math.round(PROBE_GRID_MAX / rows));
  }
  return {
    cols,
    rows,
    cellW: width / cols,
    cellH: height / rows,
  };
}

export function probeOrigins(
  width: number,
  height: number,
  mode: ProbeMode,
  spacing: number,
): ProbeOrigin[] {
  const cx = width / 2;
  const cy = height / 2;
  if (mode === 'none') return [];
  if (mode === 'one') return [{ x: cx, y: cy }];
  if (mode === 'two') {
    const half = spacing / 2;
    return [
      { x: cx - half, y: cy },
      { x: cx + half, y: cy },
    ];
  }
  const { cols, rows, cellW, cellH } = gridLayout(width, height, spacing);
  const out: ProbeOrigin[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x: (c + 0.5) * cellW,
        y: (r + 0.5) * cellH,
      });
    }
  }
  return out;
}

/** One/two pendulums are 2×; the reticle grows in arm length only. */
export function overlaySightScale(mode: ProbeMode): number {
  return mode === 'one' || mode === 'two' ? 2 : 1;
}

export function overlayPxPerLen(
  mode: ProbeMode,
  width: number,
  height: number,
  spacing: number,
  params: MapParams,
): number {
  if (mode === 'one' || mode === 'two') return PROBE_PX_PER_LEN * overlaySightScale(mode);
  if (mode !== 'grid') return PROBE_PX_PER_LEN;
  const { cellW, cellH } = gridLayout(width, height, spacing);
  return probePxPerLen(Math.min(cellW, cellH), params);
}

export type ProbeHud = {
  index: number;
  steps: ProbeStep[];
};

export function probeSpacing(hud: ProbeHud): number {
  return currentProbeStep(hud).spacing;
}

/** Old attachment-point slider. Default HUD is Start-only. */
export function emptyProbeSteps(): ProbeStep[] {
  return [
    { count: 0, mode: 'none', spacing: 0 },
    { count: 1, mode: 'one', spacing: PROBE_SEP_PX },
    { count: 2, mode: 'two', spacing: PROBE_SEP_PX },
  ];
}

export const defaultProbeHud = (): ProbeHud => ({
  index: PROBE_LEVEL_DEFAULT,
  steps: emptyProbeSteps(),
});

export type ProbeHudUi = {
  syncPlay(playing: boolean): void;
  syncDrop(show: boolean): void;
  setLessonMode(lesson: boolean): void;
  setSteps(steps: ProbeStep[], silent?: boolean): void;
};

/** Distinct 0 / 1 / 2 + each unique grid that actually places pendulums. */
export function buildProbeSteps(clip: HTMLElement): ProbeStep[] {
  const box = clip.getBoundingClientRect();
  const blocked = chromeRects(clip);
  const countOf = (mode: ProbeMode, spacing: number): number => {
    const points = probeOrigins(box.width, box.height, mode, spacing);
    if (mode === 'grid') return points.length;
    return points.filter((origin) => (
      !originHitsChrome(origin, blocked, PROBE_CROSS_PX * overlaySightScale(mode) + 6)
    )).length;
  };
  const seen = new Set([0, 1, 2]);
  const grids: ProbeStep[] = [];
  const keys = new Set<string>();
  for (let cell = PROBE_CELL_PX; cell >= PROBE_CELL_MIN_PX; cell -= 1) {
    const layout = gridLayout(box.width, box.height, cell);
    const key = `${layout.cols}x${layout.rows}`;
    if (keys.has(key)) continue;
    keys.add(key);
    const count = countOf('grid', cell);
    if (seen.has(count)) continue;
    seen.add(count);
    grids.push({ count, mode: 'grid', spacing: cell });
  }
  grids.sort((a, b) => a.count - b.count);
  return [...emptyProbeSteps(), ...thinGridSteps(grids)];
}

/** Keep first and last grids; drop every other step in between. */
function thinGridSteps(grids: ProbeStep[]): ProbeStep[] {
  if (grids.length <= 2) return grids;
  const out: ProbeStep[] = [grids[0]];
  const mid = grids.slice(1, -1);
  for (let i = 0; i < mid.length; i += 2) out.push(mid[i]);
  out.push(grids[grids.length - 1]);
  return out;
}

export function bindProbeHud(
  hud: ProbeHud,
  onChange: () => void,
  onStart: () => void,
  onDrop: () => void,
): ProbeHudUi {
  const root = document.getElementById('probe-count');
  const track = document.getElementById('probe-count-track');
  const fill = document.getElementById('probe-count-fill');
  const ticks = document.getElementById('probe-count-ticks');
  const thumb = document.getElementById('probe-count-thumb');
  const start = document.getElementById('probe-start') as HTMLButtonElement | null;
  const drop = document.getElementById('probe-drop') as HTMLButtonElement | null;
  if (!root || !track || !fill || !ticks || !thumb || !start || !drop) {
    throw new Error('Probe HUD DOM is incomplete');
  }
  const rootEl = root;
  const trackEl = track;
  const fillEl = fill;
  const ticksEl = ticks;
  const thumbEl = thumb;
  const startEl = start;
  const dropEl = drop;
  let playing = false;
  let lessonMode = false;
  let dropVisible = false;

  function lastIndex(): number {
    return Math.max(0, hud.steps.length - 1);
  }

  function rebuildTicks(): void {
    const max = lastIndex();
    const labeled = labeledIndices(hud.steps, trackEl.getBoundingClientRect().width || 400);
    ticksEl.replaceChildren();
    for (let i = 0; i <= max; i++) {
      const mark = document.createElement('div');
      mark.className = 'probe-count-tick';
      if (labeled.has(i)) mark.classList.add('is-labeled');
      mark.style.left = `${probeLevelPos(i, max) * 100}%`;
      mark.dataset.index = String(i);
      const stem = document.createElement('i');
      const label = document.createElement('span');
      label.textContent = String(hud.steps[i].count);
      mark.append(stem, label);
      ticksEl.append(mark);
    }
  }

  function setIndex(next: number, silent = false): void {
    const n = Math.min(lastIndex(), Math.max(0, Math.round(next)));
    if (!silent && hud.index === n) return;
    hud.index = n;
    sync();
    if (!silent) onChange();
  }

  function sync(): void {
    const max = lastIndex();
    const step = currentProbeStep(hud);
    const pos = probeLevelPos(hud.index, max);
    fillEl.style.width = `${pos * 100}%`;
    thumbEl.style.left = `${pos * 100}%`;
    rootEl.setAttribute('aria-valuemin', String(hud.steps[0]?.count ?? 0));
    rootEl.setAttribute('aria-valuemax', String(hud.steps[max]?.count ?? 0));
    rootEl.setAttribute('aria-valuenow', String(step.count));
    startEl.disabled = false;
    startEl.classList.toggle('is-playing', playing);
    startEl.classList.toggle('is-lesson', lessonMode);
    const startKey = lessonMode
      ? (playing ? 'stop_pendulum' : 'start_pendulum')
      : (playing ? 'restart_pendulums' : 'pin_multiple_pendulums');
    startEl.setAttribute('aria-label', t(startKey));
    const startLabel = startEl.querySelector('.probe-start-label');
    if (startLabel) startLabel.textContent = t(startKey);
    dropEl.hidden = !dropVisible;
    dropEl.setAttribute('aria-label', t('remove_pendulums'));
    const dropLabel = dropEl.querySelector('.probe-start-label');
    if (dropLabel) dropLabel.textContent = t('remove');
    for (const mark of ticksEl.querySelectorAll<HTMLElement>('[data-index]')) {
      mark.classList.toggle('is-on', Number(mark.dataset.index) === hud.index);
    }
  }

  function setFromClientX(clientX: number): void {
    const box = trackEl.getBoundingClientRect();
    if (!(box.width > 0)) return;
    setIndex(probeLevelFromPos((clientX - box.left) / box.width, lastIndex()));
  }

  let dragging = false;
  rootEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    rootEl.setPointerCapture(event.pointerId);
    setFromClientX(event.clientX);
  });
  rootEl.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    setFromClientX(event.clientX);
  });
  const endDrag = (): void => {
    dragging = false;
  };
  rootEl.addEventListener('pointerup', endDrag);
  rootEl.addEventListener('pointercancel', endDrag);

  rootEl.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex(hud.index - 1);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex(hud.index + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setIndex(lastIndex());
    }
  });

  startEl.addEventListener('click', () => onStart());
  dropEl.addEventListener('click', () => onDrop());
  rebuildTicks();
  sync();
  onUiChange(() => sync());
  return {
    syncPlay(next) {
      playing = next;
      sync();
    },
    syncDrop(show) {
      dropVisible = show;
      dropEl.hidden = !show;
    },
    setLessonMode(lesson) {
      lessonMode = lesson;
      if (lesson) dropVisible = false;
      sync();
    },
    setSteps(next, silent = false) {
      const prev = currentProbeStep(hud);
      hud.steps = next.length ? next : emptyProbeSteps();
      hud.index = indexForCount(hud.steps, prev.count || PROBE_LEVEL_DEFAULT);
      rebuildTicks();
      sync();
      const cur = currentProbeStep(hud);
      if (!silent && (cur.count !== prev.count || cur.mode !== prev.mode || cur.spacing !== prev.spacing)) {
        onChange();
      }
    },
  };
}
