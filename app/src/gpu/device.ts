/** Request a WebGPU device. Returns null when the browser has no GPU path. */

export type GpuContext = {
  adapter: GPUAdapter;
  device: GPUDevice;
  format: GPUTextureFormat;
};

export async function requestGpu(): Promise<GpuContext | null> {
  const gpu = navigator.gpu;
  if (!gpu) return null;
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  // Storage textures + compute are required; if they are missing we refuse
  // rather than silently falling back to the CPU.
  const device = await adapter.requestDevice();
  device.lost.then((info) => {
    console.warn('WebGPU device lost:', info.message);
  });
  device.addEventListener('uncapturederror', (event) => {
    console.error('WebGPU:', event.error.message);
  });
  return {
    adapter,
    device,
    format: gpu.getPreferredCanvasFormat(),
  };
}
