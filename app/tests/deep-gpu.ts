import { checkDeepPinch } from './deep-input';
import { checkPrecisionRenderer } from './precision-renderer';
import { packReference } from '../src/maps/mandelbrot/deep-storage';
import shader from '../src/maps/mandelbrot/perturbation.wgsl?raw';
import { makeReference, fillDeepTile } from '../src/maps/mandelbrot/deep-math';
import { packPerturbationUniforms } from '../src/maps/mandelbrot/deep-uniforms';
import { coordinateFromString, preciseView } from '../src/viewer/coordinates';
const report = document.getElementById('report')!;
const log = (v: unknown) => { report.textContent += JSON.stringify(v) + '\n'; };
try {
  log(await checkPrecisionRenderer());
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();
  device.addEventListener('uncapturederror', (e) => log({error:e.error.message}));
  const module = device.createShaderModule({code:shader});
  const info = await module.getCompilationInfo();
  if(info.messages.some(m=>m.type==='error')) throw new Error(info.messages.map(m=>m.message).join('\n'));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'simulate'}});
  for (const [x,y,span,iterations,morph] of [
    ['0','0',1e-80,1024,0], ['-1','0',1e-80,1024,0],
    ['-2','0',1e-8,1024,0],['-2','0',1e-80,1024,0],['-2','0',1e-280,1024,0],
    ['0','-1',1e-80,1024,0],['0','-1',1e-280,2048,0],
    ['-0.743643887037151','-0.13182590420533',1e-10,4096,0],
    ['-0.743643887037151','-0.13182590420533',1e-10,4096,.5],
    ['-0.743643887037151','-0.13182590420533',1e-10,4096,1],
  ] as const) {
    const start=performance.now();
    const view=preciseView({x:coordinateFromString(x),y:coordinateFromString(y)},span,span),params={MAX_ITERATIONS:iterations,MORPH:morph};
    const ref=makeReference(view,params),data=packReference(ref.orbit),w=17,h=17;
    const packed=packPerturbationUniforms(view,w,h,ref.center,data.length/8,params);
    const uniform=device.createBuffer({size:packed.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const storage=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    const output=device.createBuffer({size:w*h*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    const read=device.createBuffer({size:w*h*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(uniform,0,packed);device.queue.writeBuffer(storage,0,data);
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:output}},{binding:2,resource:{buffer:storage}}]});
    const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(3,3);pass.end();encoder.copyBufferToBuffer(output,0,read,0,w*h*4);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
    const raw=new Float32Array(read.getMappedRange().slice(0)),flags=raw.filter(v=>v<0).length;
    const gpu=fillDeepTile(ref,view,w,h,raw),cpu=fillDeepTile(ref,view,w,h);
    let wrong=0,maxError=0;
    for(let i=0;i<raw.length;i++){if((gpu[i]>0)!==(cpu[i]>0)){wrong++;log({index:i,x:i%w,y:Math.floor(i/w),gpu:gpu[i],cpu:cpu[i]});}maxError=Math.max(maxError,Math.abs(gpu[i]-cpu[i]));}
    log({span,morph,flags,wrong,maxError,min:Math.min(...gpu),max:Math.max(...gpu),ms:Math.round(performance.now()-start)});
    for(const buffer of [uniform,storage,output,read])buffer.destroy();
    if(wrong||maxError>.08)throw new Error('GPU mismatch');
  }
  log(checkDeepPinch());
  log('PASS');
} catch(error) { log({error:String(error)}); }
