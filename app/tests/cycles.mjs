import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const directory = await mkdtemp(join(tmpdir(),'cycles-test-'));
try {
  async function module(path) {
    const file = join(directory,path.split('/').pop()+'.mjs');
    await build({entryPoints:[path],outfile:file,bundle:true,platform:'node',format:'esm'});
    return import(pathToFileURL(file).href);
  }
  const m = await module('src/maps/mandelbrot/cycles.ts');
  const d = await module('src/maps/mandelbrot/deep-math.ts');
  const c = await module('src/viewer/coordinates.ts');
  const o = await module('src/maps/mandelbrot/orbit-job.ts');
  const p = await module('src/maps/mandelbrot/physics.ts');
  const layout = await module('src/maps/mandelbrot/orbit-layout.ts');
  const overview = await module('src/maps/mandelbrot/orbit-overview.ts');
  const palette = await module('src/maps/mandelbrot/compositor.ts');
  assert.deepEqual(palette.mandelbrotColor(0),[0,0,0]);
  assert.deepEqual(palette.mandelbrotColor(NaN),[0,0,0]);
  for(let period=1;period<=256;period++) assert.deepEqual(palette.mandelbrotColor(m.cycleSample(period,0)),[0,0,0],'no interior tint');
  const centers = [[0,0,1],[-1,0,2],[-.1225611668766536,.744861766619744,3],[-1.3107026413368328,0,4]];
  for (const [r,i,period] of centers) for (const f32 of [false,true]) {
    const sample = m.orbitSample(r,i,4096,0,-.8,.156,f32);
    assert.equal(m.cyclePeriod(sample),period,`period at ${r},${i} f32=${f32}: ${sample}`);
    const trace = m.traceOrbit(r,i,4096,0,-.8,.156,f32);
    assert.equal(m.cyclePeriod(trace.sample),period);
    assert.equal(trace.cycle.length,period);
    assert.ok(trace.path[0].r === 0 && trace.path[0].i === 0);
    for(let n=0;n<period;n++) {
      const z=trace.cycle[n],next=trace.cycle[(n+1)%period];
      assert.ok(Math.hypot(z.r*z.r-z.i*z.i+r-next.r,2*z.r*z.i+i-next.i)<(f32?2e-5:1e-10),'cycle closes');
    }
  }
  for (const r of [.25,-.75,-2]) for(const f32 of [false,true]) {
    assert.equal(m.orbitSample(r,0,262144,0,-.8,.156,f32),0,`neutral/repelling ${r} f32=${f32}`);
  }
  let points=0;
  for(let y=0;y<31;y++)for(let x=0;x<41;x++)for(const morph of [0,.5,1]) {
    const r=-2.2+(x+.5)*3.4/41,i=-1.3+(y+.5)*2.6/31;
    const actual=m.orbitSample(r,i,2048,morph,-.8,.156);
    const expected=p.escapeTime(r,i,2048,morph,-.8,.156);
    assert.equal(actual>0,expected>0,`membership ${r},${i} t=${morph}`);
    if(expected>0)assert.ok(Math.abs(actual-expected)<1e-6,'exterior palette input unchanged');
    points++;
  }
  for(const [r,i,period] of centers)for(const span of [1e-30,1e-80]) {
    const point={x:c.coordinateFromNumber(r),y:c.coordinateFromNumber(-i)};
    const view=c.preciseView(point,span,span),params={MAX_ITERATIONS:4096};
    const ref=d.makeReference(view,params);
    assert.ok(d.fillDeepTile(ref,view,2,2).every(value => value === 0),'map interior remains black');
    const trace=o.calculateOrbit({point,span,params,f32:false});
    assert.equal(trace.cycle.length,period,'exact orbit');
  }
  const escaping=m.traceOrbit(1,.5,2048,0,0,0,false);
  assert.ok(escaping.sample>0 && escaping.cycle.length===0 && escaping.steps<2048);
  assert.equal(m.traceOrbit(.8,.1,2048,1,0,0,false).cycle.length,1,'Julia zero');
  assert.deepEqual(m.analyticCycle({r:-1.1,i:0},2).map(z=>z.i),[0,-0]);
  for(const morph of [0,.5,1])for(const jr of [-.8,0]) {
    const params={MORPH:morph,JULIA_REAL:jr,JULIA_IMAG:.156,MAX_ITERATIONS:128};
    const view=layout.orbitOverviewView(params),w=19,h=17;
    const samples=overview.sampleOverview(view,w,h,params);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const r=view.xMin+(x+.5)/w*(view.xMax-view.xMin),i=-(view.yMin+(y+.5)/h*(view.yMax-view.yMin));
      assert.equal(samples[y*w+x],Math.fround(p.escapeTime(r,i,128,morph,jr,.156)),'inset must use the current map parameters');
    }
  }
  const neutralView={xMin:.26,xMax:.26,yMin:0,yMax:0};
  assert.equal(overview.sampleOverview(neutralView,1,1,{MAX_ITERATIONS:1})[0],0);
  assert.ok(overview.sampleOverview(neutralView,1,1,{MAX_ITERATIONS:768})[0]>0,'inset must honor iteration changes');
  const exactPoint={x:c.coordinateFromString('0.01986826382561667300000000000000000001'),y:c.coordinateFromString('0.08603614835648674000000000000000000002')};
  assert.deepEqual(layout.orbitStart(exactPoint,1),exactPoint,'Julia z0 must stay on the hovered pixel even beyond f64');
  assert.deepEqual(layout.orbitStart(exactPoint,0),{x:0n,y:0n});
  const coords=layout.orbitCoordinates(exactPoint,1e-40);
  assert.ok(coords.y.startsWith('-0.086036')&&coords.complex.includes(' − '),'positive screen y is negative imaginary y');
  assert.ok(coords.shortX.includes('…')&&coords.x.endsWith('001'),'retain exact digits in the coordinate readout');
  const nextCoords=layout.orbitCoordinates({x:exactPoint.x+c.coordinateFromString('1e-40'),y:exactPoint.y},1e-40);
  assert.notEqual(coords.x,nextCoords.x,'adjacent exact pixels must have distinct coordinate text');
  assert.ok(layout.onScreen({r:0,i:0},640,480)&&!layout.onScreen({r:-1,i:0},640,480));
  assert.deepEqual(layout.clipOrbitSegment({r:50,i:50},{r:1e280,i:50},100,100),[{r:50,i:50},{r:100,i:50}]);
  assert.deepEqual(layout.clipOrbitSegment({r:-1e280,i:50},{r:50,i:50},100,100),[{r:0,i:50},{r:50,i:50}]);
  assert.deepEqual(layout.clipOrbitSegment({r:50,i:50},{r:50,i:-1e280},100,100),[{r:50,i:50},{r:50,i:0}]);
  assert.equal(layout.clipOrbitSegment({r:-20,i:-20},{r:120,i:-20},100,100),null);
  console.log(`Cycles: periods 1–4, neutral boundaries, orbit closure, ${points} escape comparisons, Julia, black interiors, exact trajectories, automatic overlay layout and matching overview parameters passed.`);
} finally { await rm(directory,{recursive:true,force:true}); }
