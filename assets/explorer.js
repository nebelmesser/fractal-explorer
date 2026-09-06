(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))i(r);new MutationObserver(r=>{for(const o of r)if(o.type==="childList")for(const s of o.addedNodes)s.tagName==="LINK"&&s.rel==="modulepreload"&&i(s)}).observe(document,{childList:!0,subtree:!0});function n(r){const o={};return r.integrity&&(o.integrity=r.integrity),r.referrerPolicy&&(o.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?o.credentials="include":r.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function i(r){if(r.ep)return;r.ep=!0;const o=n(r);fetch(r.href,o)}})();const te=160,ct=64,Gt=2048,Ve=4096,Ne=1e3,Fe=200,We=4e3,ee=.7,Xe=90,qe=840,Ye=.5,ne=.5,$e=.0015,He=1,je=140,Me=1e-5,ie=.5,re=.2,be=3,Ze=5,Ke=!1,st=Math.PI,Je=1,Qe=1,tn=1,en=1,nn=9.81,rn=.2,on=3e3,oe=160,Dt="fractal-explorer",sn=250;async function an(){const t=navigator.gpu;if(!t)return null;const e=await t.requestAdapter({powerPreference:"high-performance"});if(!e)return null;const n=await e.requestDevice();return n.lost.then(i=>{console.warn("WebGPU device lost:",i.message)}),n.addEventListener("uncapturederror",i=>{console.error("WebGPU:",i.error.message)}),{adapter:e,device:n,format:t.getPreferredCanvasFormat()}}const cn=`// Min/max of log1p(raw) over the on-screen rect (not the halo). One workgroup.

struct Uniforms {
  view: vec4f,   // x_min, x_max, y_min, y_max
  phys: vec4f,   // L1, L2, M1, M2
  step: vec4f,   // G, DT, unused, unused
  size: vec4u,   // max_iter, width, height, invert
  extra: vec4u,  // median, packed (x0,y0), packed (x1,y1), pad
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> raw: array<f32>;
@group(0) @binding(2) var<storage, read_write> minmax: array<f32>;

var<workgroup> smin: array<f32, 256>;
var<workgroup> smax: array<f32, 256>;

@compute @workgroup_size(256)
fn reduce_minmax(
  @builtin(local_invocation_index) li: u32,
  @builtin(global_invocation_id) gi: vec3u,
) {
  let width = u.size.y;
  let height = u.size.z;
  var x0 = u.extra.y & 0xffffu;
  var y0 = u.extra.y >> 16u;
  var x1 = u.extra.z & 0xffffu;
  var y1 = u.extra.z >> 16u;
  if (x1 <= x0 || y1 <= y0 || x1 > width || y1 > height) {
    x0 = 0u;
    y0 = 0u;
    x1 = width;
    y1 = height;
  }
  let nw = x1 - x0;
  let n = nw * (y1 - y0);
  var lo = 1e20;
  var hi = -1e20;
  for (var k = gi.x; k < n; k += 256u) {
    let i = (y0 + k / nw) * width + (x0 + k % nw);
    let v = log(1.0 + raw[i]);
    lo = min(lo, v);
    hi = max(hi, v);
  }
  smin[li] = lo;
  smax[li] = hi;
  workgroupBarrier();

  var stride = 128u;
  while (stride > 0u) {
    if (li < stride) {
      smin[li] = min(smin[li], smin[li + stride]);
      smax[li] = max(smax[li], smax[li + stride]);
    }
    workgroupBarrier();
    stride = stride / 2u;
  }
  if (li == 0u) {
    minmax[0] = smin[0];
    minmax[1] = smax[0];
  }
}
`,un=`// Stretch log1p(raw) to grayscale using the GPU min/max.

struct Uniforms {
  view: vec4f,
  phys: vec4f,
  step: vec4f,
  size: vec4u,
  extra: vec4u,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> raw: array<f32>;
@group(0) @binding(2) var<storage, read> minmax: array<f32>;
@group(0) @binding(3) var color_tex: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn colorize(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.size.y || gid.y >= u.size.z) {
    return;
  }
  let id = gid.y * u.size.y + gid.x;
  let lo = minmax[0];
  let hi = minmax[1];
  let v = log(1.0 + raw[id]);
  var t = 0.0;
  if (hi > lo) {
    t = clamp((v - lo) / (hi - lo), 0.0, 1.0);
  }
  if (u.size.w != 0u) {
    t = 1.0 - t;
  }
  textureStore(color_tex, vec2i(i32(gid.x), i32(gid.y)), vec4f(t, 0.0, 0.0, 1.0));
}
`,ln=`// Spatial median on the grayscale map — knocks out single-pixel fireflies.

struct Uniforms {
  view: vec4f,
  phys: vec4f,
  step: vec4f,
  size: vec4u,
  extra: vec4u,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var color_src: texture_2d<f32>;
@group(0) @binding(2) var median_tex: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn median(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.size.y || gid.y >= u.size.z) {
    return;
  }
  let n = i32(u.extra.x);
  if (n <= 1) {
    let c = textureLoad(color_src, vec2i(i32(gid.x), i32(gid.y)), 0);
    textureStore(median_tex, vec2i(i32(gid.x), i32(gid.y)), c);
    return;
  }
  let r = n / 2;
  let count = n * n;
  var samples: array<f32, 25>;
  var k = 0;
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      let sx = clamp(i32(gid.x) + dx, 0, i32(u.size.y) - 1);
      let sy = clamp(i32(gid.y) + dy, 0, i32(u.size.z) - 1);
      samples[k] = textureLoad(color_src, vec2i(sx, sy), 0).r;
      k += 1;
    }
  }
  for (var i = 1; i < count; i++) {
    let key = samples[i];
    var j = i - 1;
    loop {
      if (j < 0 || samples[j] <= key) {
        break;
      }
      samples[j + 1] = samples[j];
      j -= 1;
    }
    samples[j + 1] = key;
  }
  let mid = samples[count / 2];
  textureStore(median_tex, vec2i(i32(gid.x), i32(gid.y)), vec4f(mid, 0.0, 0.0, 1.0));
}
`,dn=`// Copy the compute texture onto the canvas. textureLoad keeps pixels crisp
// and works with r32float (unfilterable).

@group(0) @binding(0) var blit_src: texture_2d<f32>;

@fragment
fn blit_fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dims = textureDimensions(blit_src);
  let x = u32(min(max(pos.x, 0.0), f32(dims.x) - 1.0));
  let y = u32(min(max(pos.y, 0.0), f32(dims.y) - 1.0));
  let t = textureLoad(blit_src, vec2u(x, y), 0).r;
  return vec4f(t, t, t, 1.0);
}

@vertex
fn blit_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(pos[i], 0.0, 1.0);
}
`;class Mt{constructor(e,n,i,r,o,s,a,u,d){this.gpu=e,this.map=n,this.target=i,this.computePipeline=r,this.reducePipeline=o,this.colorPipeline=s,this.medianPipeline=a,this.blitPipeline=u,this.computeLayout=d.compute,this.reduceLayout=d.reduce,this.colorLayout=d.color,this.medianLayout=d.median,this.blitLayout=d.blit}gpu;map;target;computePipeline;reducePipeline;colorPipeline;medianPipeline;blitPipeline;lastError=null;lastScale=null;buffers=null;cache=[];lastGray=null;gpuTail=Promise.resolve();canvasPx=new WeakMap;computeLayout;reduceLayout;colorLayout;medianLayout;blitLayout;static async create(e,n,i){const r=n.getContext("webgpu");if(!r)throw new Error("Canvas has no WebGPU context");const o=e.device,s=o.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),a=o.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),u=o.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:"write-only",format:"r32float",viewDimension:"2d"}}]}),d=o.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:"write-only",format:"r32float",viewDimension:"2d"}}]}),l=o.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}}]}),p=o.createShaderModule({code:i.gpu.computeWgsl}),g=o.createShaderModule({code:cn}),y=o.createShaderModule({code:un}),c=o.createShaderModule({code:ln}),x=o.createShaderModule({code:dn});await ot(p,"compute"),await ot(g,"reduce"),await ot(y,"colorize"),await ot(c,"median"),await ot(x,"blit");const b=o.createComputePipeline({layout:o.createPipelineLayout({bindGroupLayouts:[s]}),compute:{module:p,entryPoint:i.gpu.entryPoint}}),P=o.createComputePipeline({layout:o.createPipelineLayout({bindGroupLayouts:[a]}),compute:{module:g,entryPoint:"reduce_minmax"}}),f=o.createComputePipeline({layout:o.createPipelineLayout({bindGroupLayouts:[u]}),compute:{module:y,entryPoint:"colorize"}}),v=o.createComputePipeline({layout:o.createPipelineLayout({bindGroupLayouts:[d]}),compute:{module:c,entryPoint:"median"}}),E=o.createRenderPipeline({layout:o.createPipelineLayout({bindGroupLayouts:[l]}),vertex:{module:x,entryPoint:"blit_vs"},fragment:{module:x,entryPoint:"blit_fs",targets:[{format:e.format}]}});return new Mt(e,i,{canvas:n,context:r,configuredW:0,configuredH:0},b,P,f,v,E,{compute:s,reduce:a,color:u,median:d,blit:l})}enqueue(e){const n=this.gpuTail.then(e,e);return this.gpuTail=n.then(()=>{},()=>{}),n}async render(e,n,i,r,o,s,a=e){return this.enqueue(()=>this.renderLocked(e,n,i,r,o,s,a))}async renderLocked(e,n,i,r,o,s,a){const{device:u}=this.gpu;await this.ensureBuffers(i,r),this.configureCanvas(i,r);const d=this.map.gpu.packUniforms(e,i,r,n,{invert:o,median:s,normView:a});u.queue.writeBuffer(this.buffers.uniform,0,d);const l=Math.ceil(i/8),p=Math.ceil(r/8),g=u.createCommandEncoder(),y=g.beginComputePass();y.setPipeline(this.computePipeline),y.setBindGroup(0,this.bind(this.computeLayout,[{binding:0,resource:{buffer:this.buffers.uniform}},{binding:1,resource:{buffer:this.buffers.raw}}])),y.dispatchWorkgroups(l,p),y.end();const c=g.beginComputePass();c.setPipeline(this.reducePipeline),c.setBindGroup(0,this.bind(this.reduceLayout,[{binding:0,resource:{buffer:this.buffers.uniform}},{binding:1,resource:{buffer:this.buffers.raw}},{binding:2,resource:{buffer:this.buffers.minmax}}])),c.dispatchWorkgroups(1),c.end();const x=g.beginComputePass();x.setPipeline(this.colorPipeline),x.setBindGroup(0,this.bind(this.colorLayout,[{binding:0,resource:{buffer:this.buffers.uniform}},{binding:1,resource:{buffer:this.buffers.raw}},{binding:2,resource:{buffer:this.buffers.minmax}},{binding:3,resource:this.buffers.colorView}])),x.dispatchWorkgroups(l,p),x.end();const b=g.beginComputePass();b.setPipeline(this.medianPipeline),b.setBindGroup(0,this.bind(this.medianLayout,[{binding:0,resource:{buffer:this.buffers.uniform}},{binding:1,resource:this.buffers.colorView},{binding:2,resource:this.buffers.medianView}])),b.dispatchWorkgroups(l,p),b.end();const P=s>1?this.buffers.medianView:this.buffers.colorView,f=this.target.context.getCurrentTexture().createView(),v=g.beginRenderPass({colorAttachments:[{view:f,loadOp:"clear",storeOp:"store",clearValue:{r:0,g:0,b:0,a:1}}]});v.setPipeline(this.blitPipeline),v.setBindGroup(0,this.bind(this.blitLayout,[{binding:0,resource:P}])),v.draw(3),v.end(),u.pushErrorScope("validation"),u.pushErrorScope("internal");const E=performance.now();u.queue.submit([g.finish()]),await u.queue.onSubmittedWorkDone();const D=await u.popErrorScope(),O=await u.popErrorScope(),T=D??O;if(T)throw this.lastError=T.message,new Error(T.message);this.lastError=null,this.target.canvas.dataset.ready="1";const z=s>1?this.buffers.median:this.buffers.color;return this.lastGray={tex:z,width:i,height:r},await this.refreshScale(),performance.now()-E}grayForSteps(e,n){const i=this.lastScale;if(!i)return null;const r=Math.log1p(Math.max(0,e));let o=i.hi>i.lo?(r-i.lo)/(i.hi-i.lo):0;return o=Math.min(1,Math.max(0,o)),n&&(o=1-o),o*255}async sampleGray(e,n){return this.enqueue(()=>this.sampleGrayLocked(e,n))}async sampleGrayLocked(e,n){const i=this.lastGray;if(!i)return null;const r=Math.min(i.width-1,Math.max(0,Math.round(e*(i.width-1)))),o=Math.min(i.height-1,Math.max(0,Math.round(n*(i.height-1)))),{device:s}=this.gpu,a=s.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),u=s.createCommandEncoder();u.copyTextureToBuffer({texture:i.tex,origin:{x:r,y:o}},{buffer:a,bytesPerRow:256},{width:1,height:1}),s.queue.submit([u.finish()]),await s.queue.onSubmittedWorkDone(),await a.mapAsync(GPUMapMode.READ);const d=new Float32Array(a.getMappedRange().slice(0,4))[0];return a.unmap(),a.destroy(),Number.isFinite(d)?Math.round(Math.min(1,Math.max(0,d))*255):null}async refreshScale(){const e=this.buffers;if(!e)return;const{device:n}=this.gpu,i=n.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),r=n.createCommandEncoder();r.copyBufferToBuffer(e.minmax,0,i,0,8),n.queue.submit([r.finish()]),await i.mapAsync(GPUMapMode.READ);const[o,s]=new Float32Array(i.getMappedRange().slice(0,8));i.unmap(),i.destroy(),Number.isFinite(o)&&Number.isFinite(s)&&(this.lastScale={lo:o,hi:s})}setCanvas(e){if(this.target.canvas===e)return;const n=e.getContext("webgpu");if(!n)throw new Error("Canvas has no WebGPU context");const i=this.canvasPx.get(e);this.target={canvas:e,context:n,configuredW:i?.w??0,configuredH:i?.h??0}}bind(e,n){return this.gpu.device.createBindGroup({layout:e,entries:n})}configureCanvas(e,n){const{canvas:i,context:r}=this.target;this.target.configuredW===e&&this.target.configuredH===n&&i.width===e&&i.height===n||(i.width=e,i.height=n,r.configure({device:this.gpu.device,format:this.gpu.format,alphaMode:"opaque"}),this.target.configuredW=e,this.target.configuredH=n,this.canvasPx.set(i,{w:e,h:n}))}destroyBuffers(e){e.color.destroy(),e.median.destroy(),e.raw.destroy(),e.minmax.destroy(),e.uniform.destroy()}async ensureBuffers(e,n){if(this.buffers?.width===e&&this.buffers.height===n)return;const i=this.cache.find(l=>l.width===e&&l.height===n);if(i){this.buffers=i;return}const{device:r}=this.gpu,o=e*n,s={size:{width:e,height:n},format:"r32float",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC},a=r.createTexture(s),u=r.createTexture(s);this.buffers={width:e,height:n,uniform:r.createBuffer({size:this.map.gpu.uniformBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),raw:r.createBuffer({size:o*4,usage:GPUBufferUsage.STORAGE}),minmax:r.createBuffer({size:8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),color:a,median:u,colorView:a.createView(),medianView:u.createView()},this.cache.push(this.buffers);const d=[];for(;this.cache.length>2;){const l=this.cache.shift();!l||l===this.buffers||(this.lastGray&&(this.lastGray.tex===l.color||this.lastGray.tex===l.median)&&(this.lastGray=null),d.push(l))}if(d.length){await r.queue.onSubmittedWorkDone();for(const l of d)this.destroyBuffers(l)}}}async function ot(t,e){const i=(await t.getCompilationInfo()).messages.filter(r=>r.type==="error");if(i.length)throw new Error(`${e}: ${i.map(r=>`${r.lineNum}: ${r.message}`).join("; ")}`)}function S(t){return t.xMax-t.xMin}function L(t){return t.yMax-t.yMin}function at(t){return{x:(t.xMin+t.xMax)/2,y:(t.yMin+t.yMax)/2}}function U(t){return{xMin:t.xMin,xMax:t.xMax,yMin:t.yMin,yMax:t.yMax}}function mn(t,e,n){return{xMin:t.xMin+(e.xMin-t.xMin)*n,xMax:t.xMax+(e.xMax-t.xMax)*n,yMin:t.yMin+(e.yMin-t.yMin)*n,yMax:t.yMax+(e.yMax-t.yMax)*n}}function se(t,e,n=1e-12){return Math.abs(t.xMin-e.xMin)<n&&Math.abs(t.xMax-e.xMax)<n&&Math.abs(t.yMin-e.yMin)<n&&Math.abs(t.yMax-e.yMax)<n}function fn(t,e){const n=S(t),i=L(t);return{xMin:t.xMin-n*e,xMax:t.xMax+n*e,yMin:t.yMin-i*e,yMax:t.yMax+i*e}}function hn(t,e){if(!(e>0))return U(t);const n=e/(1+2*e),i=S(t),r=L(t);return{xMin:t.xMin+i*n,xMax:t.xMax-i*n,yMin:t.yMin+r*n,yMax:t.yMax-r*n}}function pn(t,e,n,i){const r=S(t),o=L(t);if(!(r>0)||!(o>0)||n<1||i<1)return{x0:0,y0:0,x1:Math.max(1,n),y1:Math.max(1,i)};const s=Math.max(n,2)-1,a=Math.max(i,2)-1,u=Math.min(n,Math.max(0,Math.round((e.xMin-t.xMin)/r*s))),d=Math.min(n,Math.max(u+1,Math.round((e.xMax-t.xMin)/r*s)+1)),l=Math.min(i,Math.max(0,Math.round((e.yMin-t.yMin)/o*a))),p=Math.min(i,Math.max(l+1,Math.round((e.yMax-t.yMin)/o*a)+1));return{x0:u,y0:l,x1:d,y1:p}}function ae(t,e){const n=S(t),i=L(t);if(!(n>0)||!(i>0))return-1;const r=Math.min(t.xMin-e.xMin,e.xMax-t.xMax)/n,o=Math.min(t.yMin-e.yMin,e.yMax-t.yMax)/i;return Math.min(r,o)}function we(t,e,n,i){return{xMin:t-n/2,xMax:t+n/2,yMin:e-i/2,yMax:e+i/2}}function gn(t){const e={};for(const n of t.params)e[n.key]=n.default;return e}const yn=`// Double-pendulum escape-time map. Pixel = initial (theta1, theta2), omega = 0.
// Brightness is how many Euler steps until |theta1| > 2pi.

struct Uniforms {
  view: vec4f,   // x_min, x_max, y_min, y_max
  phys: vec4f,   // L1, L2, M1, M2
  step: vec4f,   // G, DT, unused, unused
  size: vec4u,   // max_iter, width, height, invert
  extra: vec4u,  // median, pad, pad, pad
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> raw: array<f32>;

const TWO_PI: f32 = 6.283185307179586;
const SINGULAR: f32 = 1e-9;

@compute @workgroup_size(8, 8)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let width = u.size.y;
  let height = u.size.z;
  if (gid.x >= width || gid.y >= height) {
    return;
  }
  let id = gid.y * width + gid.x;
  let x_den = max(width, 2u) - 1u;
  let y_den = max(height, 2u) - 1u;
  let th1 = u.view.x + (u.view.y - u.view.x) * f32(gid.x) / f32(x_den);
  let th2 = u.view.z + (u.view.w - u.view.z) * f32(gid.y) / f32(y_den);
  raw[id] = integrate(th1, th2);
}

fn integrate(start_th1: f32, start_th2: f32) -> f32 {
  var th1 = start_th1;
  var th2 = start_th2;
  var w1 = 0.0;
  var w2 = 0.0;
  var cycles = 0u;
  let L1 = u.phys.x;
  let L2 = u.phys.y;
  let M1 = u.phys.z;
  let M2 = u.phys.w;
  let G = u.step.x;
  let DT = u.step.y;
  let g_m1_plus_m2 = G * (M1 + M2);
  let two_m1_plus_m2 = 2.0 * M1 + M2;
  let max_iter = u.size.x;

  for (var i = 0u; i < max_iter; i++) {
    let sin_th1 = sin(th1);
    let cos_th1 = cos(th1);
    let sin_th1_minus_th2 = sin(th1 - th2);
    let cos_th1_minus_th2 = cos(th1 - th2);
    let cos_2th1_minus_2th2 = cos(2.0 * (th1 - th2));
    let den_factor = two_m1_plus_m2 - M2 * cos_2th1_minus_2th2;

    var alpha1 = 0.0;
    let den1 = L1 * den_factor;
    if (abs(den1) >= SINGULAR) {
      let num1_1 = -G * two_m1_plus_m2 * sin_th1;
      let sin_th1_minus_2th2 = sin(th1 - 2.0 * th2);
      let num1_3_and_4 = -2.0 * sin_th1_minus_th2 * M2
        * (w2 * w2 * L2 + w1 * w1 * L1 * cos_th1_minus_th2);
      alpha1 = (num1_1 + (-M2 * G * sin_th1_minus_2th2) + num1_3_and_4) / den1;
    }

    var alpha2 = 0.0;
    let den2 = L2 * den_factor;
    if (abs(den2) >= SINGULAR) {
      let term_sum = w1 * w1 * L1 * (M1 + M2)
        + g_m1_plus_m2 * cos_th1
        + w2 * w2 * L2 * M2 * cos_th1_minus_th2;
      alpha2 = (2.0 * sin_th1_minus_th2 * term_sum) / den2;
    }

    w1 += alpha1 * DT;
    w2 += alpha2 * DT;
    th1 += w1 * DT;
    th2 += w2 * DT;
    cycles += 1u;
    if (abs(th1) > TWO_PI) {
      break;
    }
  }
  return f32(cycles);
}
`;function Q(t,e){return getComputedStyle(document.documentElement).getPropertyValue(t).trim()||e}function Et(){return{th1:Q("--th1","#ff2d2d"),th2:Q("--th2","#2d7bff"),pivot:Q("--pivot","#fff"),previewAxis:Q("--preview-axis","#8a8a8a"),zoomFrame:Q("--zoom-frame","#ffe600"),axisShadow:Q("--shadow","#000")}}const xn="modulepreload",Mn=function(t,e){return new URL(t,e).href},ce={},ue=function(e,n,i){let r=Promise.resolve();if(n&&n.length>0){let d=function(l){return Promise.all(l.map(p=>Promise.resolve(p).then(g=>({status:"fulfilled",value:g}),g=>({status:"rejected",reason:g}))))};const s=document.getElementsByTagName("link"),a=document.querySelector("meta[property=csp-nonce]"),u=a?.nonce||a?.getAttribute("nonce");r=d(n.map(l=>{if(l=Mn(l,i),l in ce)return;ce[l]=!0;const p=l.endsWith(".css"),g=p?'[rel="stylesheet"]':"";if(i)for(let c=s.length-1;c>=0;c--){const x=s[c];if(x.href===l&&(!p||x.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${l}"]${g}`))return;const y=document.createElement("link");if(y.rel=p?"stylesheet":xn,p||(y.as="script"),y.crossOrigin="",y.href=l,u&&y.setAttribute("nonce",u),document.head.appendChild(y),p)return new Promise((c,x)=>{y.addEventListener("load",c),y.addEventListener("error",()=>x(new Error(`Unable to preload CSS for ${l}`)))})}))}function o(s){const a=new Event("vite:preloadError",{cancelable:!0});if(a.payload=s,window.dispatchEvent(a),!a.defaultPrevented)throw s}return r.then(s=>{for(const a of s||[])a.status==="rejected"&&o(a.reason);return e().catch(o)})},bn=Math.PI*2;function ve(t,e){t.steps+=1;const n=Math.max(1,Math.round(e.MAX_ITERATIONS??3e3));(Math.abs(t.th1)>bn||t.steps>=n)&&(t.done=!0)}let bt=null;async function wn(){try{const t=await ue(()=>import("./explorer-map_core.js"),[],import.meta.url),e=(await ue(async()=>{const{default:n}=await import("./explorer-map_core_bg.js");return{default:n}},[],import.meta.url)).default;await t.default(e),bt=t.Pendulum}catch(t){console.warn("map_core WASM failed to load; preview uses the TS integrator",t),bt=null}}function _e(t,e){if(bt){const n=new bt(t,e),i={startTh1:t,startTh2:e,steps:0,done:!1,get th1(){return n.th1},get th2(){return n.th2},step(r,o){i.done||(n.step(r.L1,r.L2,r.M1,r.M2,r.G,o),ve(i,r))}};return i}return new vn(t,e)}class vn{th1;th2;startTh1;startTh2;steps=0;done=!1;w1=0;w2=0;constructor(e,n){this.th1=e,this.th2=n,this.startTh1=e,this.startTh2=n}step(e,n){if(this.done)return;const{L1:i,L2:r,M1:o,M2:s,G:a}=e,u=a*(o+s),d=2*o+s,l=Math.sin(this.th1),p=Math.cos(this.th1),g=Math.sin(this.th1-this.th2),y=Math.cos(this.th1-this.th2),c=Math.cos(2*(this.th1-this.th2)),x=d-s*c,b=i*x;let P=0;Math.abs(b)>=1e-9&&(P=(-a*d*l+-s*a*Math.sin(this.th1-2*this.th2)+-2*g*s*(this.w2*this.w2*r+this.w1*this.w1*i*y))/b);const f=r*x;let v=0;if(Math.abs(f)>=1e-9){const E=this.w1*this.w1*i*(o+s)+u*p+this.w2*this.w2*r*s*y;v=2*g*E/f}this.w1+=P*n,this.w2+=v*n,this.th1+=this.w1*n,this.th2+=this.w2*n,ve(this,e)}}function _n(t,e){const n=_e(t.x,t.y),i=e.DT;for(;!n.done;)n.step(e,i);return n.steps}function le(t,e,n,i){t.save(),t.strokeStyle=Et().previewAxis,t.globalAlpha=.7,t.lineWidth=1,t.setLineDash([2,3]),t.beginPath(),t.moveTo(e,n),t.lineTo(e,n+i),t.stroke(),t.restore()}function Pe(t,e){return{x:t/2,y:e/2+8}}function de(t,e,n,i){const r=Et(),{width:o,height:s}=t.canvas;t.clearRect(0,0,o,s);const a=i.L1,u=i.L2,d=Math.max(a+u,1e-6),l=Math.min(o,s)*.4/d,{x:p,y:g}=Pe(o,s),y=p+Math.sin(e)*a*l,c=g+Math.cos(e)*a*l,x=y+Math.sin(n)*u*l,b=c+Math.cos(n)*u*l,P=Math.min(a,u)*l*.65;le(t,p,g,P),le(t,y,c,P*.85),t.lineCap="round",t.lineJoin="round",t.lineWidth=3,t.strokeStyle=r.th1,t.beginPath(),t.moveTo(p,g),t.lineTo(y,c),t.stroke(),t.strokeStyle=r.th2,t.beginPath(),t.moveTo(y,c),t.lineTo(x,b),t.stroke(),t.fillStyle=r.th1,Bt(t,y,c,6),t.fillStyle=r.th2,Bt(t,x,b,6),t.fillStyle=r.pivot,Bt(t,p,g,4)}function Bt(t,e,n,i){t.beginPath(),t.arc(e,n,i,0,Math.PI*2),t.fill()}const Pn={draw(t,e,n){de(t,e.x,e.y,n)},anchor(t){return Pe(t.width,t.height)},createState(t){return _e(t.x,t.y)},step(t,e,n){const i=t;return i.step(e,n),i},drawState(t,e,n){const i=e;de(t,i.th1,i.th2,n)},replayDt(t){return t.DT},replayDone(t){return t.done},replaySteps(t){return t.steps},replayLength:_n};function En(t,e,n,i,r){const o=new ArrayBuffer(80),s=new Float32Array(o),a=new Uint32Array(o);s[0]=t.xMin,s[1]=t.xMax,s[2]=t.yMin,s[3]=t.yMax,s[4]=i.L1,s[5]=i.L2,s[6]=i.M1,s[7]=i.M2,s[8]=i.G,s[9]=i.DT,s[10]=0,s[11]=0,a[12]=Math.max(1,Math.round(i.MAX_ITERATIONS)),a[13]=e,a[14]=n,a[15]=r.invert?1:0,a[16]=Math.max(0,Math.round(r.median));const u=pn(t,r.normView??t,e,n);return a[17]=u.y0<<16|u.x0,a[18]=u.y1<<16|u.x1,a[19]=0,o}const Sn={computeWgsl:yn,entryPoint:"simulate",uniformBytes:80,packUniforms:En},Ln={id:"pendulum",title:"Double pendulum",defaultView:{xMin:-st,xMax:st,yMin:-st,yMax:st},params:[{key:"L1",label:"L1",kind:"float",min:.2,max:3,step:.01,default:Je},{key:"L2",label:"L2",kind:"float",min:.2,max:3,step:.01,default:Qe},{key:"M1",label:"M1",kind:"float",min:.2,max:5,step:.01,default:tn},{key:"M2",label:"M2",kind:"float",min:.2,max:5,step:.01,default:en},{key:"G",label:"G",kind:"float",min:.5,max:25,step:.01,default:nn},{key:"DT",label:"DT",kind:"float",min:.01,max:.5,step:.01,default:rn},{key:"MAX_ITERATIONS",label:"Iterations",kind:"int",min:100,max:8e3,step:50,default:on}],gpu:Sn,pointView:Pn},kn=[Ln];function Tn(){return kn[0]}function Ot(t){const e=Math.round(t/8)*8;return Math.min(Gt,Math.max(ct,e))}function wt(t){return Math.round(t/8)*8}function Cn(t,e,n){const i=Math.max(e,1),r=n/i,o=t*Math.sqrt(r),s=t*(1-ee)+o*ee;return Ot(s)}function me(t){const e=getComputedStyle(t),n=parseFloat(e.paddingLeft)+parseFloat(e.paddingRight),i=parseFloat(e.paddingTop)+parseFloat(e.paddingBottom);return{width:Math.max(te,Math.floor(t.clientWidth-n)),height:Math.max(te,Math.floor(t.clientHeight-i))}}function Un(t,e,n=Ve){let i=t.width*e,r=t.height*e;const o=Math.max(i,r);if(o>n){const s=n/o;i*=s,r*=s}return{width:Math.max(ct,wt(i)),height:Math.max(ct,wt(r))}}function Bn(t,e){const n=Math.max(Math.min(t.width,t.height),1),i=e/n;let r=t.width*i,o=t.height*i;const s=Math.max(r,o);if(s>Gt){const a=Gt/s;r*=a,o*=a}return{width:Math.max(ct,wt(r)),height:Math.max(ct,wt(o))}}function yt(t){return typeof t=="number"&&Number.isFinite(t)?t:null}function An(){const t=new URLSearchParams(window.location.search);if(t.get("reset")!=="1")return!1;try{localStorage.removeItem(Dt)}catch{}t.delete("reset");const e=t.toString();return history.replaceState(null,"",`${location.pathname}${e?`?${e}`:""}${location.hash}`),!0}function In(){try{const t=localStorage.getItem(Dt);if(!t)return null;const e=JSON.parse(t);return!e||typeof e!="object"?null:Gn(e)}catch{return null}}function Gn(t){const e={};if(t.params&&typeof t.params=="object"){const o=t.params,s={};for(const[a,u]of Object.entries(o)){const d=yt(u);d!==null&&(s[a]=d)}Object.keys(s).length&&(e.params=s)}typeof t.invert=="boolean"&&(e.invert=t.invert);const n=yt(t.median);n!==null&&(e.median=n);const i=yt(t.targetFrameMs);i!==null&&(e.targetFrameMs=i),typeof t.animatePreview=="boolean"&&(e.animatePreview=t.animatePreview);const r=yt(t.lastComputePx);return r!==null&&(e.lastComputePx=r),e}let vt=null,_t=0;function On(t){vt=t,window.addEventListener("pagehide",zt),document.addEventListener("visibilitychange",()=>{document.hidden&&zt()})}function W(){vt&&(window.clearTimeout(_t),_t=window.setTimeout(zt,sn))}function zt(){if(vt){window.clearTimeout(_t),_t=0;try{localStorage.setItem(Dt,JSON.stringify(vt()))}catch{}}}function At(t,e){return t==="int"?String(Math.round(e)):Number(e).toFixed(2)}let Ee=null;function fe(){Ee?.()}function zn(t,e,n){const i=document.getElementById("menu-toggle"),r=document.getElementById("menu-backdrop"),o=document.getElementById("ui-container"),s=document.getElementById("map-params");if(!i||!r||!o||!s)throw new Error("Menu DOM is incomplete");const a=[];s.replaceChildren();for(const f of t.params){const v=document.createElement("label");v.className="slider-label";const E=document.createElement("span");E.className="row";const D=document.createElement("span");D.textContent=f.label;const O=document.createElement("span");O.dataset.paramValue=f.key,O.textContent=At(f.kind,e.params[f.key]??f.default),E.append(D,O);const T=document.createElement("input");T.type="range",T.min=String(f.min),T.max=String(f.max),T.step=String(f.step),T.value=String(e.params[f.key]??f.default),T.addEventListener("input",()=>{const z=Number(T.value);e.params[f.key]=f.kind==="int"?Math.round(z):z,O.textContent=At(f.kind,e.params[f.key]),W(),n()}),v.append(E,T),s.append(v),a.push({key:f.key,input:T,readout:O})}const u=document.getElementById("invertCheck"),d=document.getElementById("medianSlider"),l=document.getElementById("medianValue"),p=document.getElementById("targetSlider"),g=document.getElementById("targetValue"),y=document.getElementById("animateCheck"),c=document.getElementById("resetParams");function x(){for(const f of t.params){const v=a.find(D=>D.key===f.key);if(!v)continue;const E=e.params[f.key]??f.default;v.input.value=String(E),v.readout.textContent=At(f.kind,E)}}function b(){u.checked=e.invert,d.max=String(Ze),d.value=String(e.median),l&&(l.textContent=String(e.median)),p.min=String(Fe),p.max=String(We),p.value=String(e.targetFrameMs),g&&(g.textContent=`${Math.round(e.targetFrameMs)} ms`),y.checked=e.animatePreview}u.addEventListener("change",()=>{e.invert=u.checked,W(),n()}),d.addEventListener("input",()=>{const f=Math.round(Number(d.value));e.median=f<=0?0:f<=3?3:5,d.value=String(e.median),l&&(l.textContent=String(e.median)),W(),n()}),p.addEventListener("input",()=>{e.targetFrameMs=Number(p.value),g&&(g.textContent=`${Math.round(e.targetFrameMs)} ms`),W(),n()}),y.addEventListener("change",()=>{e.animatePreview=y.checked,W()}),c?.addEventListener("click",()=>{for(const f of t.params)e.params[f.key]=f.default;e.invert=Ke,e.median=be,x(),b(),W(),n()});function P(f){o.classList.toggle("is-open",f),i.classList.toggle("is-open",f),r.classList.toggle("is-on",f),i.setAttribute("aria-expanded",String(f))}Ee=()=>P(!1),i.addEventListener("click",f=>{f.stopPropagation(),P(!o.classList.contains("is-open"))}),r.addEventListener("click",()=>P(!1)),b(),P(!1)}function Rn(t,e,n,i,r){return{x:t.xMin+e/i*S(t),y:t.yMin+n/r*L(t)}}function he(t,e,n=st){const i=Math.max(Math.min(t,e),1),r=n*2;return we(0,0,r*(t/i),r*(e/i))}function pe(t,e,n,i){const r=at(t),o=Math.max(Math.min(e,n),1),s=Math.min(S(t),L(t)),a=s*(e/o),u=s*(n/o);return a>=S(i)*.99&&u>=L(i)*.99?U(i):we(r.x,r.y,a,u)}function Rt(t){return Math.min(S(t),L(t))}function xt(t,e,n,i,r){const o=S(t)*i,s=L(t)*i,a=S(r),u=L(r);if(i>1&&(o>=a||s>=u))return U(r);const d=ge(o,a),l=ge(s,u),p=(e-t.xMin)/S(t),g=(n-t.yMin)/L(t);return{xMin:e-p*d,xMax:e+(1-p)*d,yMin:n-g*l,yMax:n+(1-g)*l}}function Dn(t){return t<.5?4*t*t*t:1-(-2*t+2)**3/2}function Vn(t,e,n,i,r){const o=e/i*S(t),s=n/r*L(t);return{xMin:t.xMin-o,xMax:t.xMax-o,yMin:t.yMin-s,yMax:t.yMax-s}}function ge(t,e){return Math.min(Math.max(t,Me),e)}function Nn(t){return Rt(t)>Me*1.01}function It(t,e){return Rt(t)<Rt(e)*.99}function Fn(t){return t.target instanceof Element&&!!(t.target.closest("#ui-container")||t.target.closest("#menu-toggle")||t.target.closest("#menu-backdrop")||t.target.closest("#sidebar")||t.target.closest("#zoom-bar")||t.target.closest("#map-hud"))}function Wn(t,e){const n=new Map;let i=!1,r=!1,o=0,s={x:0,y:0},a={x:0,y:0},u=2,d=0,l={x:0,y:0};function p(c,x){const b=t.getBoundingClientRect();return Rn(e.getView(),c-b.left,x-b.top,b.width,b.height)}function g(c,x){e.hoverPoint&&(l={x:c,y:x},!d&&(d=requestAnimationFrame(()=>{d=0;const b=p(l.x,l.y);e.hoverPoint?.(b.x,b.y,l.x,l.y)})))}t.addEventListener("contextmenu",c=>c.preventDefault()),t.addEventListener("pointerdown",c=>{if(!Fn(c)){fe();try{t.setPointerCapture(c.pointerId)}catch{}n.set(c.pointerId,{x:c.clientX,y:c.clientY}),s={x:c.clientX,y:c.clientY},a={x:c.clientX,y:c.clientY},u=c.pointerType==="touch"?12:2,r=!1,i=c.button===0&&n.size===1,c.button===2&&e.popHistory(),g(c.clientX,c.clientY)}}),t.addEventListener("pointermove",c=>{if(n.size===0){g(c.clientX,c.clientY);return}if(n.set(c.pointerId,{x:c.clientX,y:c.clientY}),n.size>=2){const f=[...n.values()],v=Math.hypot(f[0].x-f[1].x,f[0].y-f[1].y);if(o>0&&v>0){const E=p((f[0].x+f[1].x)/2,(f[0].y+f[1].y)/2);e.setView(xt(e.getView(),E.x,E.y,(o/v)**He,e.getWorld()),{navigating:!0})}o=v,i=!1;return}if(!i)return;const x=c.clientX-s.x,b=c.clientY-s.y;Math.hypot(c.clientX-a.x,c.clientY-a.y)>u&&(r=!0),s={x:c.clientX,y:c.clientY};const P=t.getBoundingClientRect();e.setView(Vn(e.getView(),x,b,P.width,P.height),{navigating:!0}),t.classList.add("is-dragging"),g(c.clientX,c.clientY)});function y(c){if(n.has(c.pointerId)){if(n.delete(c.pointerId),n.size<2&&(o=0),c.button===0&&i&&!r){const x=p(c.clientX,c.clientY);e.pickPoint(x.x,x.y,c.clientX,c.clientY),c.pointerType!=="touch"&&e.setView(xt(e.getView(),x.x,x.y,Ye,e.getWorld()),{pushHistory:!0,animate:!0})}i=!1,t.classList.remove("is-dragging")}}t.addEventListener("pointerup",y),t.addEventListener("pointercancel",y),t.addEventListener("pointerleave",c=>{n.size||c.pointerType!=="touch"&&e.hoverEnd?.()}),t.addEventListener("wheel",c=>{c.preventDefault(),fe();const x=p(c.clientX,c.clientY);e.setView(xt(e.getView(),x.x,x.y,Math.exp(c.deltaY*$e),e.getWorld()),{navigating:!0}),g(c.clientX,c.clientY)},{passive:!1})}const Pt=180/Math.PI,Xn=[1,2,5];function qn(t,e){const n=t.clientWidth,i=t.clientHeight;if(n<8||i<8)return;const r=Math.min(window.devicePixelRatio||1,2),o=Math.round(n*r),s=Math.round(i*r);(t.width!==o||t.height!==s)&&(t.width=o,t.height=s);const a=t.getContext("2d");if(!a)return;a.setTransform(r,0,0,r,0,0),a.clearRect(0,0,n,i);const u=Et();a.font="11px Rubik, sans-serif",a.lineWidth=1,a.shadowColor=u.axisShadow,a.shadowBlur=3;const d=ye(e.xMin,e.xMax,n/160),l=ye(e.yMin,e.yMax,i/150),p=i-8,g=n-8;a.fillStyle=u.th1,a.strokeStyle=u.th1,a.textAlign="center",a.textBaseline="bottom";for(const y of d){const c=(y/Pt-e.xMin)/(e.xMax-e.xMin)*n;c<88||c>n-44||(a.beginPath(),a.moveTo(c,i),a.lineTo(c,i-5),a.stroke(),a.fillText(xe(y),c,p))}a.fillStyle=u.th2,a.strokeStyle=u.th2,a.textAlign="right",a.textBaseline="middle";for(const y of l){const c=(y/Pt-e.yMin)/(e.yMax-e.yMin)*i;c<44||c>i-28||(a.beginPath(),a.moveTo(n,c),a.lineTo(n-5,c),a.stroke(),a.fillText(xe(y),g,c))}}function ye(t,e,n){const i=t*Pt,r=e*Pt,o=r-i;if(!(o>0)||!Number.isFinite(o))return[];const s=Yn(o/Math.max(2,n)),a=Math.ceil((i-1e-9)/s)*s,u=[];for(let d=a;d<=r+1e-6&&(u.push(Math.abs(d)<s*1e-9?0:d),!(u.length>16));d+=s);return u}function Yn(t){if(!(t>0)||!Number.isFinite(t))return 1;const e=Math.floor(Math.log10(t));let n=10**e,i=1/0;for(const r of Xn)for(const o of[e-1,e,e+1]){const s=r*10**o,a=Math.abs(Math.log(s/t));a<i&&(n=s,i=a)}return n}function xe(t){if(Math.abs(t)<1e-9)return"0°";const e=Math.abs(t),n=e>=.01?String(Number(e.toPrecision(3))):e.toExponential(0);return`${t<0?"−":""}${n}°`}function $n(t,e,n){const i=t.getContext("2d");if(!i)return;const r=t.width,o=t.height;i.clearRect(0,0,r,o);const s=(n.xMin-e.xMin)/(e.xMax-e.xMin)*r,a=(n.yMin-e.yMin)/(e.yMax-e.yMin)*o,u=(n.xMax-n.xMin)/(e.xMax-e.xMin)*r,d=(n.yMax-n.yMin)/(e.yMax-e.yMin)*o;i.strokeStyle=Et().zoomFrame,i.lineWidth=2,i.strokeRect(s+.5,a+.5,Math.max(u,2),Math.max(d,2))}const I=Tn();function Hn(){return new Promise(t=>{requestAnimationFrame(()=>{requestAnimationFrame(()=>t())})})}async function jn(){const t=document.getElementById("gpu-missing"),e=document.getElementById("map"),n=document.getElementById("map-back"),i=document.getElementById("map-clip"),r=document.getElementById("stage"),o=document.getElementById("sidebar"),s=document.getElementById("minimap"),a=document.getElementById("minimap-overlay"),u=document.getElementById("preview"),d=document.getElementById("preview-steps"),l=document.getElementById("preview-meta"),p=document.getElementById("preview-swatch"),g=document.getElementById("map-axes"),y=document.getElementById("map-shift"),c=document.getElementById("pointer-link-line"),x=document.getElementById("zoom-out"),b=document.getElementById("zoom-in"),P=document.getElementById("zoom-reset");if(!e||!n||!i||!r||!o||!s||!a||!u||!d||!l||!p||!g||!y||!c||!b||!x||!P)throw new Error("Explorer DOM is incomplete");const f=b,v=x,E=P,D=y,O=i,T=r,z=c,Vt=d,Nt=l,Se=p,Le=g,Ft=await an();if(!Ft){t&&(t.hidden=!1);return}const Wt=Ft;await wn(),An();const tt=In(),R={...gn(I),...tt?.params};let k=me(r),B=he(k.width,k.height),M=U(B),A=U(M);const V=[U(M)];let j=Ot(Math.min(k.width,k.height)),et=!1,N=at(M);I.pointView?.createState?.(N,R);let ut=!1,lt=!1,Z=null,Xt=0,dt=!1,K=!0,X=!1,mt=0,nt=1/0,ft="",St=0,Lt={width:0,height:0},ht=0;const G={params:R,invert:tt?.invert??!1,median:tt?.median??be,targetFrameMs:tt?.targetFrameMs??Ne,animatePreview:tt?.animatePreview??!1};let $=e,F=n,it;try{it=await Mt.create(Wt,F,I)}catch(m){t&&(t.hidden=!1,t.textContent=m instanceof Error?m.message:String(m)),console.error(m);return}let qt=null;On(()=>({params:{...R},invert:G.invert,median:G.median,targetFrameMs:G.targetFrameMs,animatePreview:G.animatePreview,lastComputePx:j}));let Yt=0;function rt(){f.disabled=!Nn(M),v.disabled=!It(M,B),E.disabled=!It(M,B)&&se(M,B)}function ke(){const m=Math.max(1e-6,1+2*ht),h=S(A)/S(M),w=L(A)/L(M);return Math.max(Math.abs(h/m-1),Math.abs(w/m-1))}function Te(){return Ot(Math.min(k.width,k.height))}function $t(){Number.isFinite(nt)&&(j=Math.min(Te(),Cn(j,nt,G.targetFrameMs)))}function J(){X=!1,K=!0,mt+=1}function kt(m){if(window.clearTimeout(Yt),pt(),q(),rt(),m.immediate){J();return}const h=ke()>.04,w=ae(M,A);if(h){Yt=window.setTimeout(()=>J(),je);return}if(w<0){J();return}w<re&&ht>0&&(X=!0)}function Ce(){ft="",I.pointView?.createState?.(N,R),(ut||lt)&&(Tt(),Ct()),$t(),J()}function pt(){const m=S(A)/S(M),h=L(A)/L(M),w=at(A),_=at(M),C=O.getBoundingClientRect(),Y=(w.x-_.x)/S(M)*C.width,H=(w.y-_.y)/L(M)*C.height;D.style.transform=`translate(${Y}px, ${H}px) scale(${m}, ${h})`}function q(){qn(Le,M),$n(a,I.defaultView,M),Ue();const m=u.getContext("2d");!m||!I.pointView||I.pointView.draw(m,N,R)}function Ue(){if(!Z){z.setAttribute("visibility","hidden");return}const m=T.getBoundingClientRect(),h=u.getBoundingClientRect(),w=I.pointView?.anchor?.(u,R)??{x:u.width/2,y:u.height/2},_=Math.max(u.width,1),C=Math.max(u.height,1);z.setAttribute("visibility","visible"),z.setAttribute("x1",String(Z.x-m.left)),z.setAttribute("y1",String(Z.y-m.top)),z.setAttribute("x2",String(h.left+w.x/_*h.width-m.left)),z.setAttribute("y2",String(h.top+w.y/C*h.height-m.top))}function Ht(m){const h=Math.round(Math.min(255,Math.max(0,m)));Se.style.backgroundColor=`rgb(${h}, ${h}, ${h})`}function Tt(){u.classList.add("is-live");const m=I.pointView?.replayLength?.(N,R)??0;Vt.textContent=String(m);const h=it.grayForSteps(m,G.invert);Ht(h??0),Nt.hidden=!1,Ie()}function Be(){Vt.textContent="",Nt.hidden=!0,u.classList.remove("is-live")}function Ae(){u.classList.remove("is-settled"),u.classList.add("is-live")}function Ct(){window.clearTimeout(Xt),Ae()}async function Ie(){const m=(N.x-A.xMin)/S(A),h=(N.y-A.yMin)/L(A);if(m<0||m>1||h<0||h>1)return;const w=await it.sampleGray(m,h);w!=null&&Ht(w)}function jt(){St+=1,et=!1}function Ge(m,h){const w=U(M),_=St,C=performance.now();et=!0,nt<Xe*2&&J();const Y=H=>{if(_!==St)return;const gt=Math.min(1,(H-C)/qe);if(M=mn(w,m,Dn(gt)),pt(),q(),rt(),gt<1){requestAnimationFrame(Y);return}M=U(m),et=!1,h()};requestAnimationFrame(Y)}function Ut(m,h){if(jt(),h?.pushHistory&&!se(m,M)&&V.push(U(M)),W(),h?.animate){Ge(m,()=>kt({immediate:!0}));return}M=m,kt({immediate:h?.immediate,navigating:h?.navigating})}zn(I,G,Ce),Wn(O,{getView:()=>M,getWorld:()=>B,setView(m,h){Ut(m,h)},popHistory(){V.length<=1||(jt(),V.pop(),M=U(V[V.length-1]),W(),kt({immediate:!0}))},pickPoint(m,h,w,_){N={x:m,y:h},ut=!1,lt=!0,Z={x:w,y:_},Tt(),Ct(),q()},hoverPoint(m,h,w,_){ut=!0,lt=!1,N={x:m,y:h},Z={x:w,y:_},Tt(),Ct(),q()},hoverEnd(){lt||(ut=!1,Z=null,window.clearTimeout(Xt),Be(),I.pointView?.createState?.(N,R),q())}});function Zt(m){const h=at(M);Ut(xt(M,h.x,h.y,m,B),{pushHistory:!0,animate:!0})}v.addEventListener("click",()=>Zt(1/ne)),f.addEventListener("click",()=>Zt(ne)),E.addEventListener("click",()=>{Ut(U(B),{pushHistory:!0,animate:!0})}),rt();const Kt=()=>{const m=me(r),h=m.width!==k.width||m.height!==k.height;k=m;const w=!It(M,B);B=he(k.width,k.height),M=w?U(B):pe(M,k.width,k.height,B);for(let _=0;_<V.length;_++)V[_]=pe(V[_],k.width,k.height,B);w&&(V[0]=U(B)),h&&(J(),ft=""),pt(),q(),rt()};Kt(),new ResizeObserver(Kt).observe(r);async function Oe(){if(dt||!K&&!X)return;const m=et,h=!K&&X&&!m,w=mt;dt=!0,K=!1,X=!1;try{const _=Bn(k,j),C=m?ht:h?ie:0,Y=m&&Lt.width?Lt:h?Un(_,1+2*ie):_,H=U(m?A:fn(M,C)),gt=hn(H,C);it.setCanvas(F);const ze=await it.render(H,R,Y.width,Y.height,G.invert,G.median,gt);if(h&&w!==mt||(h||(nt=ze),await Hn(),h&&w!==mt))return;D.appendChild(F),F.classList.remove("map-pending"),F.classList.add("is-front"),F.setAttribute("aria-label","Map"),F.removeAttribute("aria-hidden"),$.classList.remove("is-front"),$.classList.add("map-pending"),$.removeAttribute("aria-label"),$.setAttribute("aria-hidden","true"),O.appendChild($);const Re=$;if($=F,F=Re,A=H,Lt=Y,ht=C,!m&&!h){const De=j;$t(),W(),j>De&&nt<G.targetFrameMs*.85?K=!0:X=!0}!m&&h&&ae(M,A)<re&&(X=!0),pt();const Qt=JSON.stringify(R);!et&&Qt!==ft&&(qt??=await Mt.create(Wt,s,I),await qt.render(I.defaultView,R,oe,oe,G.invert,G.median),ft=Qt),rt(),q()}catch(_){console.error(_);const C=document.getElementById("gpu-missing");C&&(C.hidden=!1,C.textContent=_ instanceof Error?_.message:String(_))}finally{dt=!1}}function Jt(){(K||X)&&!dt&&Oe(),requestAnimationFrame(Jt)}q(),requestAnimationFrame(Jt)}jn();
