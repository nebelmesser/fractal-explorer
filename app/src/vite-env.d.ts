/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

declare module '*.wgsl?raw' {
  const src: string;
  export default src;
}

declare module '*.wasm?url' {
  const url: string;
  export default url;
}
