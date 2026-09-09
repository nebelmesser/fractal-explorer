declare module './pkg/map_core.js' {
  export default function init(
    input?: { module_or_path?: RequestInfo | URL | BufferSource | WebAssembly.Module },
  ): Promise<unknown>;
  export class Pendulum {
    constructor(th1: number, th2: number);
    step(l1: number, l2: number, m1: number, m2: number, g: number, f: number, dt: number): void;
    readonly th1: number;
    readonly th2: number;
    readonly w1: number;
    readonly w2: number;
  }
  export function fill_map_tile(
    out: Float32Array,
    width: number,
    height: number,
    row0: number,
    row1: number,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    l1: number,
    l2: number,
    m1: number,
    m2: number,
    g: number,
    dt: number,
    f: number,
    maxIter: number,
  ): void;
}

declare module './pkg/map_core_bg.wasm?url' {
  const url: string;
  export default url;
}
