(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))n(o);new MutationObserver(o=>{for(const r of o)if(r.type==="childList")for(const s of r.addedNodes)s.tagName==="LINK"&&s.rel==="modulepreload"&&n(s)}).observe(document,{childList:!0,subtree:!0});function i(o){const r={};return o.integrity&&(r.integrity=o.integrity),o.referrerPolicy&&(r.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?r.credentials="include":o.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function n(o){if(o.ep)return;o.ep=!0;const r=i(o);fetch(o.href,r)}})();const Oe=160,Ut=64,me=2048,kn=4096,Ue=1e3,pe=200,on=4e3,Ge=.7,An=90,Cn=840,In=.5,De=.5,Bn=.004,Rn=.01,On=1,Un=.05,Gn=64,ce=48,Yt=.06,Dn=140,rn=1e-5,Ne=.5,ze=.2,sn=3,Nn=5,zn=!1,Bt=Math.PI,Vn=1,Fn=1,Wn=1,Xn=1,$n=9.81,Yn=.2,Q=1e3,an=8e3,Ve=160,qn=320,jn=36,be="fractal-explorer",Hn=250;async function Zn(){const t=navigator.gpu;if(!t)return null;const e=await t.requestAdapter({powerPreference:"high-performance"});if(!e)return null;const i=await e.requestDevice();return i.lost.then(n=>{console.warn("WebGPU device lost:",n.message)}),i.addEventListener("uncapturederror",n=>{console.error("WebGPU:",n.error.message)}),{adapter:e,device:i,format:t.getPreferredCanvasFormat()}}const Kn=`// Min/max of log1p(raw) over the on-screen rect (not the halo). One workgroup.

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
`,Jn=`// Stretch log1p(raw) to grayscale using the GPU min/max.

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
`,Qn=`// Spatial median on the grayscale map — knocks out single-pixel fireflies.

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
`,ti=`// Copy the compute texture onto the canvas. textureLoad keeps pixels crisp
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
`;class Ht{constructor(e,i,n,o,r,s,a,c,u){this.gpu=e,this.map=i,this.target=n,this.computePipeline=o,this.reducePipeline=r,this.colorPipeline=s,this.medianPipeline=a,this.blitPipeline=c,this.computeLayout=u.compute,this.reduceLayout=u.reduce,this.colorLayout=u.color,this.medianLayout=u.median,this.blitLayout=u.blit}gpu;map;target;computePipeline;reducePipeline;colorPipeline;medianPipeline;blitPipeline;lastError=null;lastScale=null;buffers=null;cache=[];lastGray=null;lastCounts=null;countRead=null;countReadSize=0;gpuTail=Promise.resolve();canvasPx=new WeakMap;computeLayout;reduceLayout;colorLayout;medianLayout;blitLayout;static async create(e,i,n){const o=i.getContext("webgpu");if(!o)throw new Error("Canvas has no WebGPU context");const r=e.device,s=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),a=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),c=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:"write-only",format:"r32float",viewDimension:"2d"}}]}),u=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:"write-only",format:"r32float",viewDimension:"2d"}}]}),f=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"unfilterable-float"}}]}),g=r.createShaderModule({code:n.gpu.computeWgsl}),y=r.createShaderModule({code:Kn}),M=r.createShaderModule({code:Jn}),w=r.createShaderModule({code:Qn}),p=r.createShaderModule({code:ti});await At(g,"compute"),await At(y,"reduce"),await At(M,"colorize"),await At(w,"median"),await At(p,"blit");const d=r.createComputePipeline({layout:r.createPipelineLayout({bindGroupLayouts:[s]}),compute:{module:g,entryPoint:n.gpu.entryPoint}}),_=r.createComputePipeline({layout:r.createPipelineLayout({bindGroupLayouts:[a]}),compute:{module:y,entryPoint:"reduce_minmax"}}),b=r.createComputePipeline({layout:r.createPipelineLayout({bindGroupLayouts:[c]}),compute:{module:M,entryPoint:"colorize"}}),P=r.createComputePipeline({layout:r.createPipelineLayout({bindGroupLayouts:[u]}),compute:{module:w,entryPoint:"median"}}),L=r.createRenderPipeline({layout:r.createPipelineLayout({bindGroupLayouts:[f]}),vertex:{module:p,entryPoint:"blit_vs"},fragment:{module:p,entryPoint:"blit_fs",targets:[{format:e.format}]}});return new Ht(e,n,{canvas:i,context:o,configuredW:0,configuredH:0},d,_,b,P,L,{compute:s,reduce:a,color:c,median:u,blit:f})}enqueue(e){const i=this.gpuTail.then(e,e);return this.gpuTail=i.then(()=>{},()=>{}),i}async render(e,i,n,o,r,s,a=e){return this.enqueue(()=>this.renderLocked(e,i,n,o,r,s,a))}async renderLocked(e,i,n,o,r,s,a){const{device:c}=this.gpu;await this.ensureBuffers(n,o),this.configureCanvas(n,o);const u=this.map.gpu.packUniforms(e,n,o,i,{invert:r,median:s,normView:a});c.queue.writeBuffer(this.buffers.uniform,0,u);const f=Math.ceil(n/8),g=Math.ceil(o/8),y=c.createCommandEncoder(),M=y.beginComputePass();M.setPipeline(this.computePipeline),M.setBindGroup(0,this.bind(this.computeLayout,[{binding:0,resource:{buffer:this.buffers.uniform}},{binding:1,resource:{buffer:this.buffers.raw}}])),M.dispatchWorkgroups(f,g),M.end();const w=y.beginComputePass();w.setPipeline(this.reducePipeline),w.setBindGroup(0,this.bind(this.reduceLayout,[{binding:0,resource:{buffer:this.buffers.uniform}},{binding:1,resource:{buffer:this.buffers.raw}},{binding:2,resource:{buffer:this.buffers.minmax}}])),w.dispatchWorkgroups(1),w.end();const p=y.beginComputePass();p.setPipeline(this.colorPipeline),p.setBindGroup(0,this.bind(this.colorLayout,[{binding:0,resource:{buffer:this.buffers.uniform}},{binding:1,resource:{buffer:this.buffers.raw}},{binding:2,resource:{buffer:this.buffers.minmax}},{binding:3,resource:this.buffers.colorView}])),p.dispatchWorkgroups(f,g),p.end();const d=y.beginComputePass();d.setPipeline(this.medianPipeline),d.setBindGroup(0,this.bind(this.medianLayout,[{binding:0,resource:{buffer:this.buffers.uniform}},{binding:1,resource:this.buffers.colorView},{binding:2,resource:this.buffers.medianView}])),d.dispatchWorkgroups(f,g),d.end();const _=s>1?this.buffers.medianView:this.buffers.colorView,b=this.target.context.getCurrentTexture().createView(),P=y.beginRenderPass({colorAttachments:[{view:b,loadOp:"clear",storeOp:"store",clearValue:{r:0,g:0,b:0,a:1}}]});P.setPipeline(this.blitPipeline),P.setBindGroup(0,this.bind(this.blitLayout,[{binding:0,resource:_}])),P.draw(3),P.end();const L=this.countReadBuffer(n,o);y.copyBufferToBuffer(this.buffers.minmax,0,L,0,8),y.copyBufferToBuffer(this.buffers.raw,0,L,256,n*o*4),c.pushErrorScope("validation"),c.pushErrorScope("internal");const T=performance.now();c.queue.submit([y.finish()]),await c.queue.onSubmittedWorkDone();const F=await c.popErrorScope(),q=await c.popErrorScope(),j=F??q;if(j)throw this.lastError=j.message,new Error(j.message);this.lastError=null,this.target.canvas.dataset.ready="1";const tt=s>1?this.buffers.median:this.buffers.color;return this.lastGray={tex:tt,width:n,height:o},await this.pullCounts(n,o),performance.now()-T}grayForSteps(e,i){const n=this.lastScale;if(!n)return null;const o=Math.log1p(Math.max(0,e));let r=n.hi>n.lo?(o-n.lo)/(n.hi-n.lo):0;return r=Math.min(1,Math.max(0,r)),i&&(r=1-r),r*255}mapSize(){const e=this.lastCounts;return e?{width:e.width,height:e.height}:null}mapTexel(e,i){const n=this.lastCounts;if(!n)return null;const o=Math.max(n.width-1,1),r=Math.max(n.height-1,1);return{ix:Math.min(n.width-1,Math.max(0,Math.round(e*o))),iy:Math.min(n.height-1,Math.max(0,Math.round(i*r))),width:n.width,height:n.height}}mapSteps(e,i){const n=this.lastCounts,o=this.mapTexel(e,i);if(!n||!o||n.width!==o.width||n.height!==o.height)return null;const r=n.data[o.iy*n.width+o.ix];return Number.isFinite(r)?r:null}async sampleGray(e,i){return this.enqueue(()=>this.sampleGrayLocked(e,i))}async sampleGrayLocked(e,i){const n=this.lastGray;if(!n)return null;const o=Math.min(n.width-1,Math.max(0,Math.round(e*(n.width-1)))),r=Math.min(n.height-1,Math.max(0,Math.round(i*(n.height-1)))),{device:s}=this.gpu,a=s.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),c=s.createCommandEncoder();c.copyTextureToBuffer({texture:n.tex,origin:{x:o,y:r}},{buffer:a,bytesPerRow:256},{width:1,height:1}),s.queue.submit([c.finish()]),await s.queue.onSubmittedWorkDone(),await a.mapAsync(GPUMapMode.READ);const u=new Float32Array(a.getMappedRange().slice(0,4))[0];return a.unmap(),a.destroy(),Number.isFinite(u)?Math.round(Math.min(1,Math.max(0,u))*255):null}countReadBuffer(e,i){const n=256+e*i*4;return this.countRead&&this.countReadSize===n?this.countRead:(this.countRead?.destroy(),this.countRead=this.gpu.device.createBuffer({size:n,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),this.countReadSize=n,this.countRead)}async pullCounts(e,i){const n=this.countRead;if(!n)return;await n.mapAsync(GPUMapMode.READ);const o=n.getMappedRange(),[r,s]=new Float32Array(o.slice(0,8)),a=e*i;!this.lastCounts||this.lastCounts.data.length!==a?this.lastCounts={data:new Float32Array(a),width:e,height:i}:(this.lastCounts.width=e,this.lastCounts.height=i),this.lastCounts.data.set(new Float32Array(o,256,a)),n.unmap(),Number.isFinite(r)&&Number.isFinite(s)&&(this.lastScale={lo:r,hi:s})}setCanvas(e){if(this.target.canvas===e)return;const i=e.getContext("webgpu");if(!i)throw new Error("Canvas has no WebGPU context");const n=this.canvasPx.get(e);this.target={canvas:e,context:i,configuredW:n?.w??0,configuredH:n?.h??0}}bind(e,i){return this.gpu.device.createBindGroup({layout:e,entries:i})}configureCanvas(e,i){const{canvas:n,context:o}=this.target;this.target.configuredW===e&&this.target.configuredH===i&&n.width===e&&n.height===i||(n.width=e,n.height=i,o.configure({device:this.gpu.device,format:this.gpu.format,alphaMode:"opaque"}),this.target.configuredW=e,this.target.configuredH=i,this.canvasPx.set(n,{w:e,h:i}))}destroyBuffers(e){e.color.destroy(),e.median.destroy(),e.raw.destroy(),e.minmax.destroy(),e.uniform.destroy()}async ensureBuffers(e,i){if(this.buffers?.width===e&&this.buffers.height===i)return;const n=this.cache.find(f=>f.width===e&&f.height===i);if(n){this.buffers=n;return}const{device:o}=this.gpu,r=e*i,s={size:{width:e,height:i},format:"r32float",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC},a=o.createTexture(s),c=o.createTexture(s);this.buffers={width:e,height:i,uniform:o.createBuffer({size:this.map.gpu.uniformBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),raw:o.createBuffer({size:r*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),minmax:o.createBuffer({size:8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),color:a,median:c,colorView:a.createView(),medianView:c.createView()},this.cache.push(this.buffers);const u=[];for(;this.cache.length>2;){const f=this.cache.shift();!f||f===this.buffers||(this.lastGray&&(this.lastGray.tex===f.color||this.lastGray.tex===f.median)&&(this.lastGray=null),u.push(f))}if(u.length){await o.queue.onSubmittedWorkDone();for(const f of u)this.destroyBuffers(f)}}}async function At(t,e){const n=(await t.getCompilationInfo()).messages.filter(o=>o.type==="error");if(n.length)throw new Error(`${e}: ${n.map(o=>`${o.lineNum}: ${o.message}`).join("; ")}`)}function B(t){return t.xMax-t.xMin}function R(t){return t.yMax-t.yMin}function bt(t){return{x:(t.xMin+t.xMax)/2,y:(t.yMin+t.yMax)/2}}function D(t){return{xMin:t.xMin,xMax:t.xMax,yMin:t.yMin,yMax:t.yMax}}function ei(t,e,i){return{xMin:t.xMin+(e.xMin-t.xMin)*i,xMax:t.xMax+(e.xMax-t.xMax)*i,yMin:t.yMin+(e.yMin-t.yMin)*i,yMax:t.yMax+(e.yMax-t.yMax)*i}}function Ct(t,e,i=1e-12){return Math.abs(t.xMin-e.xMin)<i&&Math.abs(t.xMax-e.xMax)<i&&Math.abs(t.yMin-e.yMin)<i&&Math.abs(t.yMax-e.yMax)<i}function ni(t,e){const i=B(t),n=R(t);return{xMin:t.xMin-i*e,xMax:t.xMax+i*e,yMin:t.yMin-n*e,yMax:t.yMax+n*e}}function ii(t,e){if(!(e>0))return D(t);const i=e/(1+2*e),n=B(t),o=R(t);return{xMin:t.xMin+n*i,xMax:t.xMax-n*i,yMin:t.yMin+o*i,yMax:t.yMax-o*i}}function oi(t,e,i,n){const o=B(t),r=R(t);if(!(o>0)||!(r>0)||i<1||n<1)return{x0:0,y0:0,x1:Math.max(1,i),y1:Math.max(1,n)};const s=Math.max(i,2)-1,a=Math.max(n,2)-1,c=Math.min(i,Math.max(0,Math.round((e.xMin-t.xMin)/o*s))),u=Math.min(i,Math.max(c+1,Math.round((e.xMax-t.xMin)/o*s)+1)),f=Math.min(n,Math.max(0,Math.round((e.yMin-t.yMin)/r*a))),g=Math.min(n,Math.max(f+1,Math.round((e.yMax-t.yMin)/r*a)+1));return{x0:c,y0:f,x1:u,y1:g}}function Fe(t,e){const i=B(t),n=R(t);if(!(i>0)||!(n>0))return-1;const o=Math.min(t.xMin-e.xMin,e.xMax-t.xMax)/i,r=Math.min(t.yMin-e.yMin,e.yMax-t.yMax)/n;return Math.min(o,r)}function cn(t,e,i,n){return{xMin:t-i/2,xMax:t+i/2,yMin:e-n/2,yMax:e+n/2}}function ri(t){const e={};for(const i of t.params)e[i.key]=i.default;return e}const si=`// Double-pendulum escape-time map. Pixel = initial (theta1, theta2), omega = 0.
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
`;function ct(t,e){return getComputedStyle(document.documentElement).getPropertyValue(t).trim()||e}function Gt(){return{th1:ct("--th1","#ff2d2d"),th2:ct("--th2","#2d7bff"),pivot:ct("--pivot","#fff"),previewAxis:ct("--preview-axis","#8a8a8a"),pieTrack:ct("--pie-track","rgba(255, 255, 255, 0.08)"),pieZero:ct("--pie-zero","rgba(255, 255, 255, 0.55)"),zoomFrame:ct("--zoom-frame","#ffe600"),axisShadow:ct("--shadow","#000")}}const ai="modulepreload",ci=function(t,e){return new URL(t,e).href},We={},Xe=function(e,i,n){let o=Promise.resolve();if(i&&i.length>0){let u=function(f){return Promise.all(f.map(g=>Promise.resolve(g).then(y=>({status:"fulfilled",value:y}),y=>({status:"rejected",reason:y}))))};const s=document.getElementsByTagName("link"),a=document.querySelector("meta[property=csp-nonce]"),c=a?.nonce||a?.getAttribute("nonce");o=u(i.map(f=>{if(f=ci(f,n),f in We)return;We[f]=!0;const g=f.endsWith(".css"),y=g?'[rel="stylesheet"]':"";if(n)for(let w=s.length-1;w>=0;w--){const p=s[w];if(p.href===f&&(!g||p.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${f}"]${y}`))return;const M=document.createElement("link");if(M.rel=g?"stylesheet":ai,g||(M.as="script"),M.crossOrigin="",M.href=f,c&&M.setAttribute("nonce",c),document.head.appendChild(M),g)return new Promise((w,p)=>{M.addEventListener("load",w),M.addEventListener("error",()=>p(new Error(`Unable to preload CSS for ${f}`)))})}))}function r(s){const a=new Event("vite:preloadError",{cancelable:!0});if(a.payload=s,window.dispatchEvent(a),!a.defaultPrevented)throw s}return o.then(s=>{for(const a of s||[])a.status==="rejected"&&r(a.reason);return e().catch(r)})},ui=Math.PI*2;function un(t,e){t.steps+=1;const i=Math.max(Q,Math.round(e.MAX_ITERATIONS??Q));(Math.abs(t.th1)>ui||t.steps>=i)&&(t.done=!0)}let Zt=null;async function li(){try{const t=await Xe(()=>import("./explorer-map_core.js"),[],import.meta.url),e=(await Xe(async()=>{const{default:i}=await import("./explorer-map_core_bg.js");return{default:i}},[],import.meta.url)).default;await t.default(e),Zt=t.Pendulum}catch(t){console.warn("map_core WASM failed to load; preview uses the TS integrator",t),Zt=null}}function ln(t,e){if(Zt){const i=new Zt(t,e),n={startTh1:t,startTh2:e,steps:0,done:!1,get th1(){return i.th1},get th2(){return i.th2},step(o,r){n.done||(i.step(o.L1,o.L2,o.M1,o.M2,o.G,r),un(n,o))}};return n}return new di(t,e)}class di{th1;th2;startTh1;startTh2;steps=0;done=!1;w1=0;w2=0;constructor(e,i){this.th1=e,this.th2=i,this.startTh1=e,this.startTh2=i}step(e,i){if(this.done)return;const{L1:n,L2:o,M1:r,M2:s,G:a}=e,c=a*(r+s),u=2*r+s,f=Math.sin(this.th1),g=Math.cos(this.th1),y=Math.sin(this.th1-this.th2),M=Math.cos(this.th1-this.th2),w=Math.cos(2*(this.th1-this.th2)),p=u-s*w,d=n*p;let _=0;Math.abs(d)>=1e-9&&(_=(-a*u*f+-s*a*Math.sin(this.th1-2*this.th2)+-2*y*s*(this.w2*this.w2*o+this.w1*this.w1*n*M))/d);const b=o*p;let P=0;if(Math.abs(b)>=1e-9){const L=this.w1*this.w1*n*(r+s)+c*g+this.w2*this.w2*o*s*M;P=2*y*L/b}this.w1+=_*i,this.w2+=P*i,this.th1+=this.w1*i,this.th2+=this.w2*i,un(this,e)}}function hi(t,e){const i=ln(t.x,t.y),n=e.DT;for(;!i.done;)i.step(e,n);return i.steps}function fi(t){let e=t%(Math.PI*2);return e>Math.PI&&(e-=Math.PI*2),e<-Math.PI&&(e+=Math.PI*2),e}function mi(t,e,i,n,o,r){const s=Gt(),a=fi(o);t.save(),t.beginPath(),t.arc(e,i,n,0,Math.PI*2),t.fillStyle=s.pieTrack,t.fill(),t.strokeStyle=s.previewAxis,t.lineWidth=1,t.stroke();const c=Math.max(6,Math.round(Math.abs(a)/.07));t.beginPath(),t.moveTo(e,i),t.lineTo(e,i+n);for(let u=1;u<=c;u++){const f=a*(u/c);t.lineTo(e+Math.sin(f)*n,i+Math.cos(f)*n)}t.closePath(),t.fillStyle=r,t.globalAlpha=.88,t.fill(),t.globalAlpha=1,t.beginPath(),t.moveTo(e,i),t.lineTo(e,i+n),t.strokeStyle=s.pieZero,t.stroke(),t.beginPath(),t.moveTo(e,i),t.lineTo(e+Math.sin(a)*n,i+Math.cos(a)*n),t.strokeStyle=r,t.stroke(),t.restore()}const ue=6,Kt=8,pi=6;function $e(t,e,i,n,o){mi(t,e+Kt,i,Kt,n,o)}function Ye(t,e,i,n){t.save(),t.strokeStyle=Gt().previewAxis,t.globalAlpha=.7,t.lineWidth=1,t.setLineDash([2,3]),t.beginPath(),t.moveTo(e,i),t.lineTo(e,i+n),t.stroke(),t.restore()}function dn(t,e){return{x:t/2,y:e/2+8}}function gi(t){return{width:Math.max(1,t.clientWidth),height:Math.max(1,t.clientHeight)}}function qe(t,e,i,n,o,r){const s=Gt(),{width:a,height:c}=gi(t.canvas),u=t.canvas.width/a,f=t.canvas.height/c;t.setTransform(u,0,0,f,0,0),t.clearRect(0,0,a,c);const g=n.L1,y=n.L2,M=Math.max(g+y,1e-6),w=Math.min(a,c)*.4/M,{x:p,y:d}=dn(a,c),_=p+Math.sin(e)*g*w,b=d+Math.cos(e)*g*w,P=_+Math.sin(i)*y*w,L=b+Math.cos(i)*y*w,T=Math.min(g,y)*w*.65;Ye(t,p,d,T),Ye(t,_,b,T*.85),t.lineCap="round",t.lineJoin="round",t.lineWidth=3,t.strokeStyle=s.th1,t.beginPath(),t.moveTo(p,d),t.lineTo(_,b),t.stroke(),t.strokeStyle=s.th2,t.beginPath(),t.moveTo(_,b),t.lineTo(P,L),t.stroke(),t.fillStyle=s.th1,le(t,_,b,6),t.fillStyle=s.th2,le(t,P,L,6),t.fillStyle=s.pivot,le(t,p,d,4);const F=ue+Kt,q=F+Kt*2+pi;$e(t,ue,F,o.th1,s.th1),$e(t,ue,q,o.th2,s.th2)}function le(t,e,i,n){t.beginPath(),t.arc(e,i,n,0,Math.PI*2),t.fill()}const yi={draw(t,e,i,n=1){qe(t,e.x,e.y,i,{th1:e.x,th2:e.y})},anchor(t){return dn(t.width,t.height)},createState(t){return ln(t.x,t.y)},step(t,e,i){const n=t;return n.step(e,i),n},drawState(t,e,i,n=1){const o=e;qe(t,o.th1,o.th2,i,{th1:o.startTh1,th2:o.startTh2})},replayDt(t){return t.DT},replayDone(t){return t.done},replaySteps(t){return t.steps},replayLength:hi};function Mi(t,e,i,n,o){const r=new ArrayBuffer(80),s=new Float32Array(r),a=new Uint32Array(r);s[0]=t.xMin,s[1]=t.xMax,s[2]=t.yMin,s[3]=t.yMax,s[4]=n.L1,s[5]=n.L2,s[6]=n.M1,s[7]=n.M2,s[8]=n.G,s[9]=n.DT,s[10]=0,s[11]=0,a[12]=Math.max(Q,Math.round(n.MAX_ITERATIONS??Q)),a[13]=e,a[14]=i,a[15]=o.invert?1:0,a[16]=Math.max(0,Math.round(o.median));const c=oi(t,o.normView??t,e,i);return a[17]=c.y0<<16|c.x0,a[18]=c.y1<<16|c.x1,a[19]=0,r}const xi={computeWgsl:si,entryPoint:"simulate",uniformBytes:80,packUniforms:Mi},wi={id:"pendulum",title:"Double pendulum",defaultView:{xMin:-Bt,xMax:Bt,yMin:-Bt,yMax:Bt},params:[{key:"L1",label:"L1",kind:"float",min:.2,max:3,step:.01,default:Vn},{key:"L2",label:"L2",kind:"float",min:.2,max:3,step:.01,default:Fn},{key:"M1",label:"M1",kind:"float",min:.2,max:5,step:.01,default:Wn},{key:"M2",label:"M2",kind:"float",min:.2,max:5,step:.01,default:Xn},{key:"G",label:"G",kind:"float",min:.5,max:25,step:.01,default:$n},{key:"DT",label:"DT",kind:"float",min:.01,max:.5,step:.01,default:Yn}],gpu:xi,pointView:yi},bi=[wi];function _i(){return bi[0]}function Ot(t){const e=Math.round(t/8)*8;return Math.min(me,Math.max(Ut,e))}function Jt(t){return Math.round(t/8)*8}function ge(t){const e=Math.round(t/50)*50;return Math.min(an,Math.max(Q,e))}function ye(t){const e=on-pe,i=Math.min(1,Math.max(0,(t-pe)/e));return ge(Q+i*(an-Q))}function Pi(t,e,i,n){const o=Me(n,t.shortPx),r=Math.max(1,o.width*o.height),s=ge(t.iters),a=i/Math.max(e,1),c=1-Ge+a*Ge,u=r*s*c,f=Me(n,Ot(Math.min(n.width,n.height))),g=Math.max(1,f.width*f.height),y=ye(i),M=u/g;if(M>=Q)return{shortPx:Ot(Math.min(n.width,n.height)),iters:ge(Math.min(y,Math.max(Q,M)))};const w=u/Q,p=Math.max(1,n.width*n.height),_=Math.max(1,Math.min(n.width,n.height))*Math.sqrt(w/p);return{shortPx:Ot(_),iters:Q}}function je(t){const e=getComputedStyle(t),i=parseFloat(e.paddingLeft)+parseFloat(e.paddingRight),n=parseFloat(e.paddingTop)+parseFloat(e.paddingBottom);return{width:Math.max(Oe,Math.floor(t.clientWidth-i)),height:Math.max(Oe,Math.floor(t.clientHeight-n))}}function vi(t,e,i=kn){let n=t.width*e,o=t.height*e;const r=Math.max(n,o);if(r>i){const s=i/r;n*=s,o*=s}return{width:Math.max(Ut,Jt(n)),height:Math.max(Ut,Jt(o))}}function Me(t,e){const i=Math.max(Math.min(t.width,t.height),1),n=e/i;let o=t.width*n,r=t.height*n;const s=Math.max(o,r);if(s>me){const a=me/s;o*=a,r*=a}return{width:Math.max(Ut,Jt(o)),height:Math.max(Ut,Jt(r))}}function qt(t){return typeof t=="number"&&Number.isFinite(t)?t:null}function Ei(){const t=new URLSearchParams(window.location.search);if(t.get("reset")!=="1")return!1;try{localStorage.removeItem(be)}catch{}t.delete("reset");const e=t.toString();return history.replaceState(null,"",`${location.pathname}${e?`?${e}`:""}${location.hash}`),!0}function Si(){try{const t=localStorage.getItem(be);if(!t)return null;const e=JSON.parse(t);return!e||typeof e!="object"?null:Ti(e)}catch{return null}}function Ti(t){const e={};if(t.params&&typeof t.params=="object"){const r=t.params,s={};for(const[a,c]of Object.entries(r)){const u=qt(c);u!==null&&(s[a]=u)}Object.keys(s).length&&(e.params=s)}typeof t.invert=="boolean"&&(e.invert=t.invert);const i=qt(t.median);i!==null&&(e.median=i);const n=qt(t.targetFrameMs);n!==null&&(e.targetFrameMs=n);const o=qt(t.lastComputePx);return o!==null&&(e.lastComputePx=o),e}let Qt=null,te=0;function Li(t){Qt=t,window.addEventListener("pagehide",xe),document.addEventListener("visibilitychange",()=>{document.hidden&&xe()})}function rt(){Qt&&(window.clearTimeout(te),te=window.setTimeout(xe,Hn))}function xe(){if(Qt){window.clearTimeout(te),te=0;try{localStorage.setItem(be,JSON.stringify(Qt()))}catch{}}}function de(t,e){return t==="int"?String(Math.round(e)):Number(e).toFixed(2)}let hn=null;function He(){hn?.()}function ee(t,e){const i=document.getElementById("targetValue");if(!i)return;const n=Math.max(0,Math.round(e||0));i.textContent=`${Math.round(t)} ms · ${n}`}function ki(t,e,i){const n=document.getElementById("menu-toggle"),o=document.getElementById("menu-backdrop"),r=document.getElementById("ui-container"),s=document.getElementById("map-params");if(!n||!o||!r||!s)throw new Error("Menu DOM is incomplete");const a=[];s.replaceChildren();for(const d of t.params){const _=document.createElement("label");_.className="slider-label";const b=document.createElement("span");b.className="row";const P=document.createElement("span");P.textContent=d.label;const L=document.createElement("span");L.dataset.paramValue=d.key,L.textContent=de(d.kind,e.params[d.key]??d.default),b.append(P,L);const T=document.createElement("input");T.type="range",T.min=String(d.min),T.max=String(d.max),T.step=String(d.step),T.value=String(e.params[d.key]??d.default),T.addEventListener("input",()=>{const F=Number(T.value);e.params[d.key]=d.kind==="int"?Math.round(F):F,L.textContent=de(d.kind,e.params[d.key]),rt(),i()}),_.append(b,T),s.append(_),a.push({key:d.key,input:T,readout:L})}const c=document.getElementById("invertCheck"),u=document.getElementById("medianSlider"),f=document.getElementById("medianValue"),g=document.getElementById("targetSlider"),y=document.getElementById("resetParams");function M(){for(const d of t.params){const _=a.find(P=>P.key===d.key);if(!_)continue;const b=e.params[d.key]??d.default;_.input.value=String(b),_.readout.textContent=de(d.kind,b)}}function w(){c.checked=e.invert,u.max=String(Nn),u.value=String(e.median),f&&(f.textContent=String(e.median)),g.min=String(pe),g.max=String(on),g.value=String(e.targetFrameMs),ee(e.targetFrameMs,e.params.MAX_ITERATIONS)}c.addEventListener("change",()=>{e.invert=c.checked,rt(),i()}),u.addEventListener("input",()=>{const d=Math.round(Number(u.value));e.median=d<=0?0:d<=3?3:5,u.value=String(e.median),f&&(f.textContent=String(e.median)),rt(),i()}),g.addEventListener("input",()=>{e.targetFrameMs=Number(g.value),ee(e.targetFrameMs,e.params.MAX_ITERATIONS),rt(),i()}),y?.addEventListener("click",()=>{for(const d of t.params)e.params[d.key]=d.default;e.invert=zn,e.median=sn,M(),w(),rt(),i()});function p(d){r.classList.toggle("is-open",d),n.classList.toggle("is-open",d),o.classList.toggle("is-on",d),n.setAttribute("aria-expanded",String(d))}hn=()=>p(!1),n.addEventListener("click",d=>{d.stopPropagation(),p(!r.classList.contains("is-open"))}),o.addEventListener("click",()=>p(!1)),w(),p(!1)}function Ai(t,e,i,n,o){return{x:t.xMin+e/n*B(t),y:t.yMin+i/o*R(t)}}function Ze(t,e,i=Bt){const n=Math.max(Math.min(t,e),1),o=i*2;return cn(0,0,o*(t/n),o*(e/n))}function Ke(t,e,i,n){const o=bt(t),r=Math.max(Math.min(e,i),1),s=Math.min(B(t),R(t)),a=s*(e/r),c=s*(i/r);return a>=B(n)*.99&&c>=R(n)*.99?D(n):cn(o.x,o.y,a,c)}function we(t){return Math.min(B(t),R(t))}function Rt(t,e,i,n,o){const r=B(t)*n,s=R(t)*n,a=B(o),c=R(o);if(n>1&&(r>=a||s>=c))return D(o);const u=Je(r,a),f=Je(s,c),g=(e-t.xMin)/B(t),y=(i-t.yMin)/R(t);return{xMin:e-g*u,xMax:e+(1-g)*u,yMin:i-y*f,yMax:i+(1-y)*f}}function Ci(t){return t<.5?4*t*t*t:1-(-2*t+2)**3/2}function he(t,e,i,n,o){const r=e/n*B(t),s=i/o*R(t);return{xMin:t.xMin-r,xMax:t.xMax-r,yMin:t.yMin-s,yMax:t.yMax-s}}function Je(t,e){return Math.min(Math.max(t,rn),e)}function fn(t){return we(t)>rn*1.01}function jt(t,e){return we(t)<we(e)*.99}function Ii(t){return t.target instanceof Element&&!!(t.target.closest("#ui-container")||t.target.closest("#menu-toggle")||t.target.closest("#menu-backdrop")||t.target.closest("#sidebar")||t.target.closest("#zoom-bar")||t.target.closest("#map-hud"))}function It(){return window.matchMedia("(hover: none)").matches}function Bi(t,e){const i=new Map;let n=!1,o=!1,r=0,s=null,a=null,c=!1,u={x:0,y:0},f={x:0,y:0},g=2,y=0,M={x:0,y:0},w=null,p=0,d=0,_=0,b=0,P=0,L=[],T=[],F=0;function q(l,E){const S=t.getBoundingClientRect();return Ai(e.getView(),l-S.left,E-S.top,S.width,S.height)}function j(l,E){e.hoverPoint&&(M={x:l,y:E},!y&&(y=requestAnimationFrame(()=>{y=0;const S=q(M.x,M.y);e.hoverPoint?.(S.x,S.y,M.x,M.y)})))}function tt(){F&&cancelAnimationFrame(F),F=0}function _t(l=performance.now()){_=0,b=0,P=0,L=[],T=[],d=0,a=null,c=!1,p=l}function Dt(l,E,S,G){const k=(G-p)/1e3;if(k<=0||k>.12){k>0&&(p=G);return}p=G;const N=1-Math.exp(-k/Un);_+=(l/k-_)*N,b+=(E/k-b)*N,P+=(S/k-P)*N}function ne(l,E){for(L.push(l),T.push(E);T.length&&E-T[0]>140;)L.shift(),T.shift()}function ie(l){if(T.length<2)return P;const E=(T[T.length-1]-T[0])/1e3;if(E<.02)return P;let S=0;for(const G of L)S+=G;return S/E}function Nt(l){tt(),performance.now()-p>Gn&&(_=0,b=0,(!l||Math.abs(P)<Yt)&&(P=0));const E=l??a;if(E&&(P=ie(performance.now())),Math.hypot(_,b)<ce&&Math.abs(P)<Yt)return;let S=performance.now()-16;const G=k=>{const N=Math.min(.05,(k-S)/1e3);S=k;const H=Math.exp(-3.2*N);_*=H,b*=H,P*=H;const Z=e.getWorld();let $=e.getView();if(Math.abs(P)>=Yt&&E&&(P>0&&!jt($,Z)||P<0&&!fn($)?P=0:$=Rt($,E.x,E.y,Math.exp(P*N),Z)),Math.hypot(_,b)>=ce){const nt=t.getBoundingClientRect();$=he($,_*N,b*N,nt.width,nt.height)}if(e.setView($,{navigating:!0,coasting:!0}),Math.hypot(_,b)<ce&&Math.abs(P)<Yt){F=0;return}F=requestAnimationFrame(G)};G(performance.now())}t.addEventListener("contextmenu",l=>l.preventDefault()),t.addEventListener("pointerdown",l=>{if(!Ii(l)){He(),i.size===0?(tt(),_t(),o=!1):(tt(),_=0,b=0,P=0,L=[],T=[],d=0);try{t.setPointerCapture(l.pointerId)}catch{}i.set(l.pointerId,{x:l.clientX,y:l.clientY}),u={x:l.clientX,y:l.clientY},f={x:l.clientX,y:l.clientY},g=l.pointerType==="touch"?12:2,n=l.button===0&&i.size===1,l.button===2&&e.popHistory(),j(l.clientX,l.clientY)}}),t.addEventListener("pointermove",l=>{if(i.size===0){j(l.clientX,l.clientY);return}if(i.set(l.pointerId,{x:l.clientX,y:l.clientY}),i.size>=2){const k=[...i.values()],N={x:(k[0].x+k[1].x)/2,y:(k[0].y+k[1].y)/2},H=Math.hypot(k[0].x-k[1].x,k[0].y-k[1].y);if(s&&r>0&&H>0){const Z=performance.now(),$=t.getBoundingClientRect(),nt=q(s.x,s.y);a=nt;const vt=(r/H)**On,st=Math.log(vt);let O=Rt(e.getView(),nt.x,nt.y,vt,e.getWorld());O=he(O,N.x-s.x,N.y-s.y,$.width,$.height);const U=d?(Z-d)/1e3:0;U>0&&U<=.2?(Dt(N.x-s.x,N.y-s.y,st,Z),ne(st,Z)):p=Z,d=Z,e.setView(O,{navigating:!0})}r=H,s=N,n=!1,o=!0,t.classList.add("is-dragging");return}if(!n)return;const E=l.clientX-u.x,S=l.clientY-u.y;if(c&&Math.hypot(l.clientX-f.x,l.clientY-f.y)<36)return;c=!1,Math.hypot(l.clientX-f.x,l.clientY-f.y)>g&&(o=!0),u={x:l.clientX,y:l.clientY},Dt(E,S,0,performance.now());const G=t.getBoundingClientRect();e.setView(he(e.getView(),E,S,G.width,G.height),{navigating:!0}),t.classList.add("is-dragging"),j(l.clientX,l.clientY)});function Pt(l){if(i.has(l.pointerId)){if(i.delete(l.pointerId),i.size<2&&(r=0,s=null),i.size===1){const E=[...i.values()][0];u={x:E.x,y:E.y},f={x:E.x,y:E.y},n=!0,o=!0,p=performance.now(),c=!0,Nt(a);return}if(o&&Nt(a),l.button===0&&n&&!o){const E=q(l.clientX,l.clientY);e.pickPoint(E.x,E.y,l.clientX,l.clientY);const S=performance.now(),G=!!(l.pointerType==="touch"&&w&&S-w.t<qn&&Math.hypot(l.clientX-w.x,l.clientY-w.y)<jn);w=l.pointerType==="touch"&&!G?{t:S,x:l.clientX,y:l.clientY}:null,(l.pointerType!=="touch"||G)&&e.setView(Rt(e.getView(),E.x,E.y,In,e.getWorld()),{pushHistory:!0,animate:!0})}n=!1,t.classList.remove("is-dragging")}}return t.addEventListener("pointerup",Pt),t.addEventListener("pointercancel",Pt),t.addEventListener("pointerleave",l=>{i.size||l.pointerType!=="touch"&&e.hoverEnd?.()}),t.addEventListener("wheel",l=>{l.preventDefault(),He(),tt(),_t();const E=q(l.clientX,l.clientY),S=l.ctrlKey?Rn:Bn;e.setView(Rt(e.getView(),E.x,E.y,Math.exp(l.deltaY*S),e.getWorld()),{navigating:!0}),j(l.clientX,l.clientY)},{passive:!1}),{stopCoast:tt}}const mt=180/Math.PI,Ri=[1,2,5],fe=6,Qe=18,tn=4;function Oi(t,e,i,n){const o=t.clientWidth,r=t.clientHeight;if(o<8||r<8)return;const s=Math.min(window.devicePixelRatio||1,2),a=Math.round(o*s),c=Math.round(r*s);(t.width!==a||t.height!==c)&&(t.width=a,t.height=c);const u=t.getContext("2d");if(!u)return;u.setTransform(s,0,0,s,0,0),u.clearRect(0,0,o,r);const f=Gt();u.lineWidth=1,u.shadowColor=f.axisShadow,u.shadowBlur=2;const g=en(e.xMin,e.xMax,o,88),y=en(e.yMin,e.yMax,r,88);u.strokeStyle=f.th1;const M=[];for(const p of g){const d=(p.deg/mt-e.xMin)/(e.xMax-e.xMin)*o;if(d<2||d>o-2)continue;const _=p.major?Qe:tn;if(u.globalAlpha=p.major?1:.6,u.lineWidth=p.major?1.25:1,u.beginPath(),u.moveTo(d,r),u.lineTo(d,r-_),u.stroke(),!p.major||d<40||d>o-36)continue;const b=document.createElement("span");b.textContent=p.label,b.style.left=`${d}px`,M.push(b)}u.globalAlpha=1,i.replaceChildren(...M),u.strokeStyle=f.th2;const w=[];for(const p of y){const d=(p.deg/mt-e.yMin)/(e.yMax-e.yMin)*r;if(d<2||d>r-2)continue;const _=p.major?Qe:tn;if(u.globalAlpha=p.major?1:.6,u.lineWidth=p.major?1.25:1,u.beginPath(),u.moveTo(o,d),u.lineTo(o-_,d),u.stroke(),!p.major||d<16||d>r-18)continue;const b=document.createElement("span");b.textContent=p.label,b.style.top=`${d}px`,w.push(b)}u.globalAlpha=1,n.replaceChildren(...w)}function en(t,e,i,n){const o=t*mt,r=e*mt,s=r-o;if(!(s>0)||!Number.isFinite(s))return[];const a=Math.max(2,Math.floor(i/n));let c=Gi(s/a);for(;s/c.step>a;)c=Ui(c);const u=c.step/fe,f=Math.ceil(o/u-1e-12),g=Math.floor(r/u+1e-12),y=[];for(let M=f;M<=g;M++){const w=M%fe===0,p=M/fe;y.push({deg:w?Di(p,c):M*u,major:w,label:w?Ni(p,c):""})}return y}function Ui(t){return t.coeff===1?{coeff:2,exp:t.exp,step:2*10**t.exp}:t.coeff===2?{coeff:5,exp:t.exp,step:5*10**t.exp}:{coeff:1,exp:t.exp+1,step:10**(t.exp+1)}}function Gi(t){if(!(t>0)||!Number.isFinite(t))return{coeff:1,exp:0,step:1};const e=Math.floor(Math.log10(t));let i=1,n=e,o=1/0;for(const r of Ri)for(const s of[e-1,e,e+1]){const a=r*10**s,c=Math.abs(Math.log(a/t));c<o&&(i=r,n=s,o=c)}return{coeff:i,exp:n,step:i*10**n}}function Di(t,e){return t*e.coeff*10**e.exp}function Ni(t,e){const i=t*e.coeff;if(i===0)return e.exp>=0?"0°":`0.${"0".repeat(-e.exp)}°`;const n=i<0,o=String(Math.abs(i));if(e.exp>=0)return`${n?"−":""}${o}${"0".repeat(e.exp)}°`;const r=o.padStart(-e.exp+1,"0"),s=r.length+e.exp;return`${n?"−":""}${r.slice(0,s)}.${r.slice(s)}°`}function zi(t,e,i){const n=Math.min(B(t)*mt/Math.max(e,1),R(t)*mt/Math.max(i,1));return!(n>0)||!Number.isFinite(n)?1:Math.min(12,Math.max(0,Math.ceil(-Math.log10(n))))}function nn(t,e){const i=t*mt,n=Number(i.toFixed(e));return Object.is(n,-0)||n===0?e>0?`0.${"0".repeat(e)}°`:"0°":`${n<0?"−":""}${Math.abs(n).toFixed(e)}°`}function Vi(t,e,i){const n=t.getContext("2d");if(!n)return;const o=t.width,r=t.height;n.clearRect(0,0,o,r);const s=(i.xMin-e.xMin)/(e.xMax-e.xMin)*o,a=(i.yMin-e.yMin)/(e.yMax-e.yMin)*r,c=(i.xMax-i.xMin)/(e.xMax-e.xMin)*o,u=(i.yMax-i.yMin)/(e.yMax-e.yMin)*r;n.strokeStyle=Gt().zoomFrame,n.lineWidth=2,n.strokeRect(s+.5,a+.5,Math.max(c,2),Math.max(u,2))}const J=_i();function Fi(){return new Promise(t=>{requestAnimationFrame(()=>{requestAnimationFrame(()=>t())})})}async function Wi(){const t=document.getElementById("gpu-missing"),e=document.getElementById("map"),i=document.getElementById("map-back"),n=document.getElementById("map-clip"),o=document.getElementById("stage"),r=document.getElementById("sidebar"),s=document.getElementById("minimap"),a=document.getElementById("minimap-overlay"),c=document.getElementById("preview"),u=document.getElementById("preview-steps"),f=document.getElementById("preview-meta"),g=document.getElementById("preview-swatch"),y=document.getElementById("preview-th1"),M=document.getElementById("preview-th2"),w=document.getElementById("map-axes"),p=document.getElementById("map-scale-x"),d=document.getElementById("map-scale-y"),_=document.getElementById("map-shift"),b=document.getElementById("pointer-link-line"),P=document.getElementById("pointer-link-hole"),L=document.getElementById("pointer-link-mask-bg"),T=document.getElementById("zoom-out"),F=document.getElementById("zoom-in"),q=document.getElementById("zoom-reset");if(!e||!i||!n||!o||!r||!s||!a||!c||!u||!f||!g||!y||!M||!w||!p||!d||!_||!b||!P||!L||!F||!T||!q)throw new Error("Explorer DOM is incomplete");const j=F,tt=T,_t=q,Dt=p,ne=d,ie=y,Nt=M,Pt=_,l=n,E=o,S=b,G=P,k=L,N=u,H=f,Z=g,$=w,nt=await Zn();if(!nt){t&&(t.hidden=!1);return}const vt=nt;await li(),Ei();const st=Si(),O={...ri(J),...st?.params};O.MAX_ITERATIONS=ye(st?.targetFrameMs??Ue);let U=je(o),z=Ze(U.width,U.height),x=D(z),A=D(x);const et=[D(x)];let pt=Ot(Math.min(U.width,U.height)),Et=!1,V=bt(x);J.pointView?.createState?.(V,O);let ut=!1,lt=!1,dt=null,zt="",St=()=>{},_e=0,Vt=!1,gt=!0,it=!1,Ft=0,Tt=1/0,Wt="",Lt=0,oe={width:0,height:0},Xt=0,Pe=0,yt=null,at=null;const W={params:O,invert:st?.invert??!1,median:st?.median??sn,targetFrameMs:st?.targetFrameMs??Ue};let ht=e,ot=i,Mt;try{Mt=await Ht.create(vt,ot,J)}catch(h){t&&(t.hidden=!1,t.textContent=h instanceof Error?h.message:String(h)),console.error(h);return}let ve=null;Li(()=>{const h={...O};return delete h.MAX_ITERATIONS,{params:h,invert:W.invert,median:W.median,targetFrameMs:W.targetFrameMs,lastComputePx:pt}});let Ee=0;function xt(){j.disabled=!fn(x),tt.disabled=!jt(x,z),_t.disabled=!jt(x,z)&&Ct(x,z)}function mn(){const h=Math.max(1e-6,1+2*Xt),m=B(A)/B(x),v=R(A)/R(x);return Math.max(Math.abs(m/h-1),Math.abs(v/h-1))}function pn(){return Ot(Math.min(U.width,U.height))}function Se(){if(!Number.isFinite(Tt)){O.MAX_ITERATIONS=ye(W.targetFrameMs),ee(W.targetFrameMs,O.MAX_ITERATIONS);return}const h=Pi({shortPx:pt,iters:O.MAX_ITERATIONS},Tt,W.targetFrameMs,U);pt=Math.min(pn(),h.shortPx),O.MAX_ITERATIONS=h.iters,ee(W.targetFrameMs,O.MAX_ITERATIONS)}function ft(){it=!1,gt=!0,Ft+=1}function $t(h){if(window.clearTimeout(Ee),kt(),K(),xt(),h.immediate){ft();return}const m=mn()>.04,v=Fe(x,A);if(m){Ee=window.setTimeout(()=>ft(),Dn);return}if(v<0){ft();return}v<ze&&Xt>0&&(it=!0)}function gn(){Wt="",zt="",J.pointView?.createState?.(V,O),(ut||lt)&&(Te(),re()),Se(),ft()}function kt(){const h=B(A)/B(x),m=R(A)/R(x),v=bt(A),C=bt(x),I=l.getBoundingClientRect(),X=(v.x-C.x)/B(x)*I.width,Y=(v.y-C.y)/R(x)*I.height;Pt.style.transform=`translate(${X}px, ${Y}px) scale(${h}, ${m})`}function K(){if(It()){const Y=bt(x);V={x:Y.x,y:Y.y},lt=!0,ut=!0}(ut||lt)&&Te();const h=l.getBoundingClientRect(),m=zi(x,h.width,h.height);ie.textContent=nn(V.x,m),Nt.textContent=nn(V.y,m);const v=Math.max(1,Math.round(c.clientWidth)),C=Math.min(window.devicePixelRatio||1,2),I=Math.round(v*C);(c.width!==I||c.height!==I)&&(c.width=I,c.height=I);const X=c.getContext("2d");X&&J.pointView&&J.pointView.draw(X,V,O,m),Oi($,x,Dt,ne),Vi(a,J.defaultView,x),yn()}function yn(){if(!dt||H.hidden){S.setAttribute("visibility","hidden");return}const h=E.getBoundingClientRect(),m=Z.getBoundingClientRect();k.setAttribute("width",String(Math.ceil(h.width))),k.setAttribute("height",String(Math.ceil(h.height))),G.setAttribute("x",String(m.left-h.left)),G.setAttribute("y",String(m.top-h.top)),G.setAttribute("width",String(m.width)),G.setAttribute("height",String(m.height)),S.setAttribute("visibility","visible"),S.setAttribute("x1",String(dt.x-h.left)),S.setAttribute("y1",String(dt.y-h.top)),S.setAttribute("x2",String(m.left+m.width/2-h.left)),S.setAttribute("y2",String(m.top+m.height/2-h.top))}function Mn(h){const m=l.getBoundingClientRect();return{x:m.left+(h.x-x.xMin)/B(x)*m.width,y:m.top+(h.y-x.yMin)/R(x)*m.height}}function xn(){const h=(V.x-A.xMin)/B(A),m=(V.y-A.yMin)/R(A),v=h>=0&&h<=1&&m>=0&&m<=1?Mt.mapTexel(h,m):null;if(v){const C=Math.max(v.width-1,1),I=Math.max(v.height-1,1);V={x:A.xMin+B(A)*v.ix/C,y:A.yMin+R(A)*v.iy/I}}dt=Mn(V)}function wn(h){const m=Math.round(Math.min(255,Math.max(0,h)));Z.style.backgroundColor=`rgb(${m}, ${m}, ${m})`}function Te(){c.classList.add("is-live"),xn(),H.hidden=!1;const h=(V.x-A.xMin)/B(A),m=(V.y-A.yMin)/R(A),v=Mt.mapSteps(h,m);if(v==null)return;const C=Math.round(v),I=`${Pe}:${V.x},${V.y},${C},${W.invert}`;I!==zt&&(zt=I,N.textContent=String(C),wn(Mt.grayForSteps(v,W.invert)??0))}function Le(){zt="",N.textContent="",H.hidden=!0,c.classList.remove("is-live")}function bn(){c.classList.remove("is-settled"),c.classList.add("is-live")}function re(){window.clearTimeout(_e),bn()}function se(){Lt+=1,Et=!1,yt=null,at&&(at(),at=null)}function _n(h){return new Promise(m=>{yt=D(h),at=m,ft()})}async function Pn(){if(Ct(x,z)&&Ct(A,z))return;St(),se();const h=Lt;Ct(x,z)||et.push(D(x)),rt();const m=D(x);await _n(D(z)),h===Lt&&(x=m,kt(),K(),xt(),ke(D(z),()=>{it=!0,$t({})}))}function ke(h,m){const v=D(x),C=Lt,I=performance.now();Et=!0,Tt<An*2&&ft();const X=Y=>{if(C!==Lt)return;const wt=Math.min(1,(Y-I)/Cn);if(x=ei(v,h,Ci(wt)),kt(),K(),xt(),wt<1){requestAnimationFrame(X);return}x=D(h),Et=!1,m()};requestAnimationFrame(X)}function Ae(h,m){if(m?.coasting||St(),se(),m?.pushHistory&&!Ct(h,x)&&et.push(D(x)),rt(),m?.animate){ke(h,()=>$t({immediate:!0}));return}x=h,$t({immediate:m?.immediate,navigating:m?.navigating})}ki(J,W,gn),window.matchMedia("(hover: none)").addEventListener("change",()=>{It()||(lt=!1,ut=!1,dt=null,Le()),K()}),St=Bi(l,{getView:()=>x,getWorld:()=>z,setView(h,m){Ae(h,m)},popHistory(){et.length<=1||(St(),se(),et.pop(),x=D(et[et.length-1]),rt(),$t({immediate:!0}))},pickPoint(h,m,v,C){if(It()){K();return}V={x:h,y:m},ut=!1,lt=!0,dt={x:v,y:C},re(),K()},hoverPoint(h,m,v,C){It()||(ut=!0,lt=!1,V={x:h,y:m},re(),K())},hoverEnd(){It()||lt||(ut=!1,dt=null,window.clearTimeout(_e),Le(),J.pointView?.createState?.(V,O),K())}}).stopCoast;function Ce(h){const m=bt(x);Ae(Rt(x,m.x,m.y,h,z),{pushHistory:!0,animate:!0})}tt.addEventListener("click",()=>Ce(1/De)),j.addEventListener("click",()=>Ce(De)),_t.addEventListener("click",()=>{Pn()}),xt();const Ie=()=>{St();const h=je(o),m=h.width!==U.width||h.height!==U.height;U=h;const v=!jt(x,z);z=Ze(U.width,U.height),x=v?D(z):Ke(x,U.width,U.height,z);for(let C=0;C<et.length;C++)et[C]=Ke(et[C],U.width,U.height,z);v&&(et[0]=D(z)),m&&(ft(),Wt=""),kt(),K(),xt()};Ie(),new ResizeObserver(Ie).observe(o);async function vn(){if(Vt||!gt&&!it)return;const h=Et,m=!h&&yt?D(yt):null,v=!gt&&it&&!h&&!m,C=Ft;Vt=!0,gt=!1,it=!1;try{const I=Me(U,pt),X=h?Xt:v?Ne:0,Y=h&&oe.width?oe:v?vi(I,1+2*Ne):I,wt=D(h?A:ni(m??x,X)),En=ii(wt,X);Mt.setCanvas(ot);const Sn=await Mt.render(wt,O,Y.width,Y.height,W.invert,W.median,En);if(v&&C!==Ft||(v||(Tt=Sn),await Fi(),v&&C!==Ft))return;Pt.appendChild(ot),ot.classList.remove("map-pending"),ot.classList.add("is-front"),ot.setAttribute("aria-label","Map"),ot.removeAttribute("aria-hidden"),ht.classList.remove("is-front"),ht.classList.add("map-pending"),ht.removeAttribute("aria-label"),ht.setAttribute("aria-hidden","true"),l.appendChild(ht);const Tn=ht;if(ht=ot,ot=Tn,A=wt,oe=Y,Pe+=1,Xt=X,m){yt=null;const ae=at;at=null,ae?.()}else if(!h&&!v){const ae=pt,Ln=O.MAX_ITERATIONS;Se(),rt(),(pt>ae||O.MAX_ITERATIONS>Ln)&&Tt<W.targetFrameMs*.85?gt=!0:it=!0}!h&&v&&Fe(x,A)<ze&&(it=!0),kt();const Re=JSON.stringify(O);!Et&&Re!==Wt&&(ve??=await Ht.create(vt,s,J),await ve.render(J.defaultView,O,Ve,Ve,W.invert,W.median),Wt=Re),xt(),K()}catch(I){if(m){yt=null;const Y=at;at=null,Y?.()}console.error(I);const X=document.getElementById("gpu-missing");X&&(X.hidden=!1,X.textContent=I instanceof Error?I.message:String(I))}finally{Vt=!1}}function Be(){(gt||it)&&!Vt&&vn(),requestAnimationFrame(Be)}K(),requestAnimationFrame(Be)}Wi();
