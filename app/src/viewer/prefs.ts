import { PREFS_KEY, PREFS_WRITE_MS } from '../constants';
import type { MapParams } from '../maps/types';

export type StoredPrefs = {
  params: MapParams;
  invert: boolean;
  median: number;
  targetFrameMs: number;
  animatePreview: boolean;
  lastComputePx?: number;
};

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function consumeResetQuery(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get('reset') !== '1') return false;
  try {
    localStorage.removeItem(PREFS_KEY);
  } catch {
    /* private mode */
  }
  params.delete('reset');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  return true;
}

export function loadPrefs(): Partial<StoredPrefs> | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object') return null;
    return sanitize(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

function sanitize(data: Record<string, unknown>): Partial<StoredPrefs> {
  const out: Partial<StoredPrefs> = {};
  if (data.params && typeof data.params === 'object') {
    const src = data.params as Record<string, unknown>;
    const params: MapParams = {};
    for (const [key, value] of Object.entries(src)) {
      const n = num(value);
      if (n !== null) params[key] = n;
    }
    if (Object.keys(params).length) out.params = params;
  }
  if (typeof data.invert === 'boolean') out.invert = data.invert;
  const median = num(data.median);
  if (median !== null) out.median = median;
  const target = num(data.targetFrameMs);
  if (target !== null) out.targetFrameMs = target;
  if (typeof data.animatePreview === 'boolean') out.animatePreview = data.animatePreview;
  const last = num(data.lastComputePx);
  if (last !== null) out.lastComputePx = last;
  return out;
}

let snapshot: (() => StoredPrefs) | null = null;
let writeTimer = 0;

export function bindPrefs(get: () => StoredPrefs): void {
  snapshot = get;
  window.addEventListener('pagehide', flushPrefs);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushPrefs();
  });
}

export function markPrefsDirty(): void {
  if (!snapshot) return;
  window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(flushPrefs, PREFS_WRITE_MS);
}

export function flushPrefs(): void {
  if (!snapshot) return;
  window.clearTimeout(writeTimer);
  writeTimer = 0;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(snapshot()));
  } catch {
    /* ignore quota */
  }
}
