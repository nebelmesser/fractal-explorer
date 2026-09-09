import type { MapDefinition, MapParams, NavigationPolicy, ViewRect } from '../maps/types';

export type MapPoint = { x: number; y: number };

export type ViewerControls = {
  params: MapParams;
  invert: boolean;
  median: number;
  targetFrameMs: number;
};

export type ResetTransition = {
  begin(): void;
  tick(eased: number): void;
  end(): void;
  instant(): void;
  cancel(): void;
  isAway(): boolean;
};

export type ViewerSignals = {
  emit(name: string): void;
  set(key: string, value: string | number | boolean): void;
};

/** Services exposed by the map viewer to a map-specific UI presentation. */
export type PresentationHost = {
  clip: HTMLElement;
  map: MapDefinition;
  params: MapParams;
  navigation: NavigationPolicy;
  controls: ViewerControls;
  onParamsChange(phase: 'live' | 'reset' | 'settle'): void;
  resetTransition: ResetTransition;
  getView(): ViewRect;
  clientToWorld(clientX: number, clientY: number): MapPoint;
  snapToRenderedPixel(point: MapPoint): MapPoint;
  /** Nearest sample on the frozen deepest f64 grid. */
  snapToPrecisionGrid?(point: MapPoint): MapPoint;
  /**
   * World centers of the sample squares currently on screen.
   * Pass `targetCellPx <= 0` for every sample; otherwise thin toward that CSS pitch.
   * Pass `maxCount <= 0` to keep the complete sample grid.
   */
  renderedSampleGrid?(targetCellPx: number, maxCount: number): MapPoint[];
  /** True when the live view is past the f32 sample floor and uses CPU tiles. */
  samplesF64?(): boolean;
  /** Fixed deepest f64 grid and its current pitch/square size in CSS pixels. */
  precisionGrid?(): {
    spacing: number; spacingPx: number; sampleSpacing: number; sampleSpacingPx: number;
    pixelPx: number; sparse: boolean;
    floor: boolean; voidMix: number; mapOpacity: number;
  } | null;
  signals?: ViewerSignals;
};

/** Map-specific axes, overlays, HUD, and interaction hooks. */
export type MapPresentation = {
  draw(): void;
  tick(now: number): void;
  reset(): void;
  noteActivity(): void;
  resize(): void;
  dismiss(): void;
  pickPoint(x: number, y: number, clientX: number, clientY: number): boolean;
  syncBudget(targetMs: number, work: number): void;
};

export type MapPresentationFactory = {
  init?(): Promise<void>;
  mount(host: PresentationHost): MapPresentation;
};

export const emptyPresentation: MapPresentation = {
  draw() {},
  tick() {},
  reset() {},
  noteActivity() {},
  resize() {},
  dismiss() {},
  pickPoint() { return false; },
  syncBudget() {},
};
