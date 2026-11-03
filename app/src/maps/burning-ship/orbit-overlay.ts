import { onUiChange, t } from '../../i18n';
import type { PresentationHost } from '../../viewer/presentation';
import { viewSpanX, viewSpanY } from '../types';
import { shipColor } from './compositor';
import type { ComplexPoint, ShipTrace } from './orbit';
import { visibleOrbitPath, orbitTrail, orbitFade, type OrbitProjection as Projection } from './orbit-animation';
import type { ShipOrbitJob, ShipOrbitRequest, ShipOrbitReply } from './orbit-worker';
import OrbitWorker from './orbit-worker.ts?worker';
import {
  SHIP_DEFAULT_ITER, ORBIT_VIEW, ORBIT_OVERVIEW_WIDTH, ORBIT_OVERVIEW_HEIGHT,
  ORBIT_PREVIEW_ITER, ORBIT_DWELL_MS, ORBIT_STEP_MS, ORBIT_CROSSFADE_MS,
  ORBIT_MAX_DPR, ORBIT_PADDING, ORBIT_PANEL_GAP, ORBIT_MARK_RADIUS,
  ORBIT_MAP_LINE_PX, ORBIT_INSET_LINE_PX, ORBIT_GRADIENT_STOPS,
  ORBIT_COORDINATE_DIGITS, ORBIT_APPEAR_MS, ORBIT_CYCLE_RADIUS,
} from './constants';

type Pending = { id: number; job: ShipOrbitJob; full: boolean };

export function clipShipSegment(a: ComplexPoint, b: ComplexPoint, width: number, height: number): [ComplexPoint, ComplexPoint] | null {
  a = { ...a }; b = { ...b };
  const code = (p: ComplexPoint) => (p.r < 0 ? 1 : p.r > width ? 2 : 0) | (p.i < 0 ? 4 : p.i > height ? 8 : 0);
  const intersect = (v0: number, v1: number, s0: number, s1: number, edge: number) => Math.abs(edge - s0) < Math.abs(edge - s1)
    ? v0 + (v1 - v0) * ((edge - s0) / (s1 - s0)) : v1 + (v0 - v1) * ((edge - s1) / (s0 - s1));
  for (let n = 0; n < 8; n++) {
    const ca = code(a), cb = code(b);
    if (!(ca | cb)) return [a, b];
    if (ca & cb) return null;
    const outside = ca || cb;
    let p: ComplexPoint;
    if (outside & 12) {
      const i = outside & 4 ? 0 : height;
      p = { r: intersect(a.r, b.r, a.i, b.i, i), i };
    } else {
      const r = outside & 1 ? 0 : width;
      p = { r, i: intersect(a.i, b.i, a.r, b.r, r) };
    }
    if (!Number.isFinite(p.r + p.i)) return null;
    if (ca) a = p; else b = p;
  }
  return null;
}

function complex(point: ComplexPoint, precise = false): string {
  const number = (v: number) => Math.abs(v) < 1e-4 && v !== 0
    ? v.toExponential(precise ? 7 : 2) : precise ? Number(v.toPrecision(ORBIT_COORDINATE_DIGITS)).toString() : Number(v.toFixed(4)).toString();
  return `${number(point.r)} ${point.i < 0 ? '−' : '+'} ${number(Math.abs(point.i))}i`.replace(/-/g, '−');
}

export function mountShipOrbit(host: PresentationHost) {
  const overlay = document.createElement('canvas');
  overlay.id = 'ship-orbit-overlay'; overlay.setAttribute('aria-hidden', 'true');
  const panel = document.createElement('aside');
  panel.className = 'ship-orbit-inset'; panel.setAttribute('data-viewer-ui', '');
  panel.innerHTML = `<div class="ship-orbit-heading"><span class="ship-orbit-title"></span></div>
    <canvas class="ship-orbit-preview" aria-hidden="true"></canvas><div class="ship-orbit-coordinate"></div>
    <div class="ship-orbit-legend"><span>z₀</span><i></i><span>zₙ</span></div>
    <div class="ship-orbit-formula">z₀ = 0<br>zₙ₊₁ = (|Re zₙ| + i|Im zₙ|)² + c</div>
    <div class="ship-orbit-status" aria-live="polite"></div>`;
  const node = <T extends HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const title = node('.ship-orbit-title'), coordinate = node('.ship-orbit-coordinate');
  const inset = node<HTMLCanvasElement>('.ship-orbit-preview'), status = node('.ship-orbit-status');
  const backdrop = document.createElement('canvas');
  const style = getComputedStyle(document.documentElement);
  const color = (name: string) => style.getPropertyValue(`--ship-orbit-${name}`).trim();
  const gradient = ORBIT_GRADIENT_STOPS.map((_, i) => [1, 3, 5].map(offset => parseInt(color(`gradient-${i}`).slice(offset, offset + 2), 16)));
  host.clip.append(overlay, panel);
  let enabled = true, resting = false, failed = false;
  let point: ComplexPoint | null = null;
  let trace: ShipTrace | null = null, previous: ShipTrace | null = null;
  let traceWorker: Worker | null = null, overviewWorker: Worker | null = null;
  let busy: Pending | null = null, queued: Pending | null = null;
  let version = 0, overviewVersion = 0, overviewBudget = -1, overviewReady = false;
  let desiredKey = '', dwellTimer = 0, changedAt = 0, appearedAt = 0, started = 0, lastStep = -1;

  function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const dpr = Math.min(window.devicePixelRatio || 1, ORBIT_MAX_DPR);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ink = canvas.getContext('2d');
    if (ink) { ink.setTransform(dpr, 0, 0, dpr, 0, 0); ink.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight); }
    return ink;
  }

  function pathColor(unit: number): string {
    const value = Math.max(0, Math.min(1, unit));
    let stop = 1;
    while (stop < ORBIT_GRADIENT_STOPS.length - 1 && value > ORBIT_GRADIENT_STOPS[stop]) stop++;
    const lo = ORBIT_GRADIENT_STOPS[stop - 1], hi = ORBIT_GRADIENT_STOPS[stop], blend = (value - lo) / (hi - lo);
    const rgb = gradient[stop - 1].map((v, c) => Math.round(v + blend * (gradient[stop][c] - v)));
    return `rgb(${rgb.join(' ')})`;
  }

  function text(): void {
    title.textContent = t('burning_ship.orbit.title');
    coordinate.textContent = point ? `c = ${complex(point, true)}` : '—';
    status.textContent = !point ? t('burning_ship.orbit.idle') : failed ? t('burning_ship.orbit.error') : !trace ? t('burning_ship.orbit.loading')
      : trace.cycle.length ? t('burning_ship.orbit.period').replace('{period}', String(trace.cycle.length))
      : t(trace.escaped ? 'burning_ship.orbit.escape' : 'burning_ship.orbit.bounded').replace('{steps}', String(trace.steps));
    if (trace?.truncated) status.textContent += ` · ${t('burning_ship.orbit.limit').replace('{steps}', String(trace.construction.length))}`;
    panel.dataset.animating = overlay.dataset.animating = String(resting);
    panel.dataset.parameter = JSON.stringify(point);
    panel.dataset.budget = String(trace?.steps ?? 0);
    panel.dataset.precision = trace ? trace.f32 ? 'f32' : 'f64' : '';
    panel.dataset.pathPoints = overlay.dataset.pathPoints = String(trace?.path.length ?? 0);
    panel.dataset.period = String(trace?.cycle.length ?? 0);
  }

  function pump(): void {
    if (!enabled || busy || !queued) return;
    if (!traceWorker) {
      const worker = new OrbitWorker(); traceWorker = worker;
      worker.onmessage = ({ data: reply }: MessageEvent<ShipOrbitReply>) => {
        if (worker !== traceWorker || reply.kind !== 'trace') return;
        busy = null;
        if (reply.id === version) {
          failed = !reply.trace;
          if (reply.trace) {
            const now = performance.now();
            if (trace) { previous = trace; changedAt = now; } else appearedAt = now;
            trace = reply.trace;
          }
          text(); draw(performance.now());
        }
        pump();
      };
      worker.onerror = () => { if (worker === traceWorker) { worker.terminate(); traceWorker = null; busy = null; queued = null; failed = true; text(); } };
    }
    busy = queued; queued = null;
    traceWorker.postMessage({ kind: 'trace', id: busy.id, job: busy.job } satisfies ShipOrbitRequest);
  }

  function requestTrace(): void {
    if (!enabled || !point) return;
    const job: ShipOrbitJob = { real: point.r, imag: point.i,
      maxIter: Math.round(host.params.MAX_ITERATIONS ?? SHIP_DEFAULT_ITER), f32: !(host.samplesF64?.() ?? false) };
    const key = JSON.stringify(job);
    if (!enabled || desiredKey === key) return;
    desiredKey = key; version++; failed = false; resting = false;
    window.clearTimeout(dwellTimer);
    if (busy?.full) { traceWorker?.terminate(); traceWorker = null; busy = null; }
    queued = { id: version, job: { ...job, maxIter: Math.min(ORBIT_PREVIEW_ITER, job.maxIter) }, full: false };
    pump();
    const id = version;
    dwellTimer = window.setTimeout(() => {
      if (id !== version || !enabled) return;
      resting = true; started = performance.now(); lastStep = -1;
      queued = { id, job, full: true }; pump(); text(); draw(started);
    }, ORBIT_DWELL_MS);
    text();
  }

  function requestOverview(): void {
    const maxIter = Math.round(host.params.MAX_ITERATIONS ?? SHIP_DEFAULT_ITER);
    if (overviewBudget === maxIter) return;
    overviewBudget = maxIter; const id = ++overviewVersion;
    overviewWorker?.terminate();
    const worker = new OrbitWorker(); overviewWorker = worker;
    worker.onmessage = ({ data: reply }: MessageEvent<ShipOrbitReply>) => {
      if (worker !== overviewWorker || reply.kind !== 'overview' || reply.id !== overviewVersion) return;
      backdrop.width = reply.width; backdrop.height = reply.height;
      const ink = backdrop.getContext('2d')!, image = ink.createImageData(reply.width, reply.height);
      for (let i = 0; i < reply.samples.length; i++) image.data.set([...shipColor(reply.samples[i]).map(c => Math.round(c * 255)), 255], i * 4);
      ink.putImageData(image, 0, 0); overviewReady = true;
      worker.terminate(); overviewWorker = null; draw(performance.now());
    };
    worker.onerror = () => { if (worker === overviewWorker) { worker.terminate(); overviewWorker = null; overviewBudget = -1; } };
    worker.postMessage({ kind: 'overview', id, view: ORBIT_VIEW, width: ORBIT_OVERVIEW_WIDTH, height: ORBIT_OVERVIEW_HEIGHT, maxIter } satisfies ShipOrbitRequest);
  }

  function segment(ink: CanvasRenderingContext2D, a: ComplexPoint, b: ComplexPoint, stroke: string, width: number): void {
    const pair = clipShipSegment(a, b, ink.canvas.clientWidth, ink.canvas.clientHeight);
    if (!pair) return;
    ink.beginPath(); ink.moveTo(pair[0].r, pair[0].i); ink.lineTo(pair[1].r, pair[1].i);
    ink.strokeStyle = stroke; ink.lineWidth = width; ink.stroke();
  }

  function dot(ink: CanvasRenderingContext2D, p: ComplexPoint, fill: string, label?: string): void {
    if (p.r < 0 || p.i < 0 || p.r > ink.canvas.clientWidth || p.i > ink.canvas.clientHeight) return;
    ink.beginPath(); ink.arc(p.r, p.i, ORBIT_MARK_RADIUS, 0, Math.PI * 2);
    ink.fillStyle = fill; ink.fill(); ink.lineWidth = 1.5; ink.strokeStyle = color('outline'); ink.stroke();
    if (label) {
      ink.font = 'italic 11px Georgia, serif'; ink.lineWidth = 3; ink.strokeText(label, p.r + 6, p.i - 6);
      ink.fillText(label, p.r + 6, p.i - 6);
    }
  }

  function onScreen(p: ComplexPoint, width: number, height: number): boolean {
    return Number.isFinite(p.r + p.i) && p.r >= 0 && p.r <= width && p.i >= 0 && p.i <= height;
  }

  function drawOrbit(ink: CanvasRenderingContext2D, orbit: ShipTrace, project: Projection, now: number, opacity: number, animate: boolean): void {
    if (opacity <= 0) return;
    ink.save(); ink.globalAlpha = opacity;
    const path = visibleOrbitPath(orbit, project), count = Math.max(1, path.length - 1);
    ink.lineJoin = 'round'; ink.lineCap = 'round';
    for (let i = 1; i < path.length; i++) {
      const pair = clipShipSegment(project(path[i - 1]), project(path[i]), ink.canvas.clientWidth, ink.canvas.clientHeight);
      if (!pair) continue;
      const [a, b] = pair, ramp = ink.createLinearGradient(a.r, a.i, b.r, b.i);
      ramp.addColorStop(0, pathColor((i - 1) / count)); ramp.addColorStop(1, pathColor(i / count));
      ink.beginPath(); ink.moveTo(a.r, a.i); ink.lineTo(b.r, b.i); ink.strokeStyle = ramp;
      ink.lineWidth = ink.canvas === overlay ? ORBIT_MAP_LINE_PX : ORBIT_INSET_LINE_PX; ink.stroke();
    }
    for (const p of orbit.cycle) {
      const q = project(p); if (!onScreen(q, ink.canvas.clientWidth, ink.canvas.clientHeight)) continue;
      ink.beginPath(); ink.arc(q.r, q.i, ORBIT_CYCLE_RADIUS, 0, Math.PI * 2);
      ink.strokeStyle = color('line'); ink.lineWidth = 1; ink.stroke();
    }
    if (animate && resting) {
      const step = Math.floor((now - started) / ORBIT_STEP_MS);
      for (const trail of orbitTrail(step, path.length, orbit.cycle.length)) {
        const q = project(path[trail.index]);
        if (!onScreen(q, ink.canvas.clientWidth, ink.canvas.clientHeight)) continue;
        ink.globalAlpha = opacity * trail.opacity;
        dot(ink, q, pathColor(trail.index / count));
      }
    }
    ink.restore();
  }

  function drawTrajectory(ink: CanvasRenderingContext2D, project: Projection, now: number): void {
    if (!trace) return;
    const opacity = orbitFade(now - appearedAt, ORBIT_APPEAR_MS);
    const blend = previous ? orbitFade(now - changedAt, ORBIT_CROSSFADE_MS) : 1;
    if (previous) drawOrbit(ink, previous, project, now, opacity * (1 - blend), false);
    drawOrbit(ink, trace, project, now, opacity * blend, true);
    overlay.dataset.orbitOpacity = String(opacity);
    overlay.dataset.animationStep = String(resting ? Math.floor((now - started) / ORBIT_STEP_MS) : -1);
  }

  function positionPanel(): void {
    const box = host.clip.getBoundingClientRect(), panelBox = panel.getBoundingClientRect();
    let bottom = ORBIT_PANEL_GAP;
    for (const id of ['site-credit', 'ask-bar']) {
      const other = document.getElementById(id)?.getBoundingClientRect();
      if (other?.height && panelBox.left < other.right && panelBox.right > other.left) bottom = Math.max(bottom, box.bottom - other.top + ORBIT_PANEL_GAP);
    }
    panel.style.bottom = `${Math.ceil(bottom)}px`;
  }

  function draw(now: number): void {
    panel.hidden = !enabled;
    const ink = context(overlay);
    if (!enabled || !ink) { overlay.dataset.mode = 'hidden'; return; }
    overlay.dataset.mode = point ? 'map' : 'preview';
    requestTrace(); requestOverview(); positionPanel();
    const mini = context(inset); if (!mini) return;
    const view = host.getView(), w = overlay.clientWidth, h = overlay.clientHeight;
    const project: Projection = p => ({ r: (p.r - view.xMin) / viewSpanX(view) * w, i: (p.i - view.yMin) / viewSpanY(view) * h });
    const scale = Math.min((inset.clientWidth - 2 * ORBIT_PADDING) / viewSpanX(ORBIT_VIEW), (inset.clientHeight - 2 * ORBIT_PADDING) / viewSpanY(ORBIT_VIEW));
    const preview: Projection = p => ({
      r: inset.clientWidth / 2 + (p.r - (ORBIT_VIEW.xMin + ORBIT_VIEW.xMax) / 2) * scale,
      i: inset.clientHeight / 2 + (p.i - (ORBIT_VIEW.yMin + ORBIT_VIEW.yMax) / 2) * scale,
    });
    const top = preview({ r: ORBIT_VIEW.xMin, i: ORBIT_VIEW.yMin }), bottom = preview({ r: ORBIT_VIEW.xMax, i: ORBIT_VIEW.yMax });
    if (overviewReady) mini.drawImage(backdrop, top.r, top.i, bottom.r - top.r, bottom.i - top.i);
    segment(mini, preview({ r: ORBIT_VIEW.xMin, i: 0 }), preview({ r: ORBIT_VIEW.xMax, i: 0 }), color('axis'), 1);
    segment(mini, preview({ r: 0, i: ORBIT_VIEW.yMin }), preview({ r: 0, i: ORBIT_VIEW.yMax }), color('axis'), 1);
    const origin = preview({ r: 0, i: 0 });
    mini.fillStyle = color('muted'); mini.font = '10px system-ui';
    for (let n = -2; n <= 2; n++) {
      const p = preview({ r: n, i: n });
      if (p.r >= ORBIT_PADDING && p.r <= inset.clientWidth - ORBIT_PADDING) mini.fillText(String(n), p.r + 3, origin.i + 12);
      if (n && p.i >= ORBIT_PADDING && p.i <= inset.clientHeight - ORBIT_PADDING) {
        mini.font = 'italic 12px Georgia, serif';
        mini.fillText(n === 1 ? 'i' : n === -1 ? '−i' : `${n < 0 ? '−' : ''}${Math.abs(n)}i`, origin.r + 4, p.i - 3);
        mini.font = '10px system-ui';
      }
    }
    if (!point) { overlay.dataset.connector = 'false'; text(); return; }
    const mainStart = project({ r: 0, i: 0 }), marker = project(point);
    const bothVisible = onScreen(mainStart, w, h) && onScreen(marker, w, h);
    overlay.dataset.connector = String(bothVisible);
    drawTrajectory(mini, preview, now);
    if (!bothVisible && onScreen(marker, w, h)) {
      const insetBox = inset.getBoundingClientRect(), clipBox = host.clip.getBoundingClientRect();
      segment(ink, { r: insetBox.left - clipBox.left + origin.r, i: insetBox.top - clipBox.top + origin.i }, marker, color('connector'), ORBIT_MAP_LINE_PX);
    }
    const panelBox = panel.getBoundingClientRect(), overlayBox = overlay.getBoundingClientRect();
    ink.save(); ink.beginPath(); ink.rect(0, 0, w, h);
    ink.rect(panelBox.left - overlayBox.left, panelBox.top - overlayBox.top, panelBox.width, panelBox.height); ink.clip('evenodd');
    drawTrajectory(ink, project, now);
    if (previous && now - changedAt >= ORBIT_CROSSFADE_MS) previous = null;
    if (bothVisible) {
      ink.setLineDash([4, 4]); segment(ink, mainStart, marker, color('connector'), ORBIT_MAP_LINE_PX); ink.setLineDash([]);
    }
    if (onScreen(marker, w, h)) {
      dot(ink, marker, color('line'));
      ink.beginPath(); ink.arc(marker.r, marker.i, ORBIT_MARK_RADIUS + 4, 0, Math.PI * 2);
      ink.strokeStyle = color('line'); ink.lineWidth = 1; ink.stroke();
    }
    dot(ink, mainStart, color('gradient-0'), 'z₀');
    ink.restore();
    dot(mini, preview(point), color('line'), 'c'); dot(mini, origin, color('gradient-0'), 'z₀');
    text();
  }

  function select(clientX: number, clientY: number): void {
    if (!enabled) return;
    const selected = host.snapToRenderedPixel(host.clientToWorld(clientX, clientY));
    if (selected.x === point?.r && selected.y === point?.i) return;
    point = { r: selected.x, i: selected.y }; desiredKey = ''; draw(performance.now());
  }
  host.clip.addEventListener('pointermove', event => {
    if (event.buttons || event.pointerType === 'touch' || (event.target instanceof Element && event.target.closest('[data-viewer-ui]'))) return;
    select(event.clientX, event.clientY);
  });
  onUiChange(() => { text(); draw(performance.now()); });
  function clear(): void {
    version++; window.clearTimeout(dwellTimer); traceWorker?.terminate(); traceWorker = null; busy = null; queued = null;
    point = null; trace = null; previous = null; failed = false; resting = false; desiredKey = '';
    panel.dataset.animating = overlay.dataset.animating = 'false'; overlay.dataset.mode = 'hidden';
    if (!enabled) { overviewWorker?.terminate(); overviewWorker = null; overviewBudget = -1; }
    text(); draw(performance.now());
  }
  return {
    clear,
    draw: () => draw(performance.now()),
    tick(now: number) {
      const step = Math.floor((now - started) / ORBIT_STEP_MS);
      if (trace && (now - appearedAt < ORBIT_APPEAR_MS || previous || Number(overlay.dataset.orbitOpacity) < 1 || resting && step !== lastStep)) {
        lastStep = step; if (enabled) draw(now);
      }
    },
    pickPoint(_x: number, _y: number, clientX: number, clientY: number, pointerType: string) {
      if (pointerType === 'touch') select(clientX, clientY); return false;
    },
    setEnabled(value: boolean) { enabled = value; clear(); },
  };
}
