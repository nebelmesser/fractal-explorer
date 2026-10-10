import { onUiChange, t } from '../../i18n';
import { coordinateFromNumber, coordinateToNumber, type CoordinateOrigin } from '../../viewer/coordinates';
import type { PresentationHost } from '../../viewer/presentation';
import { viewSpanX, viewSpanY } from '../types';
import { MANDELBROT_DEFAULT_ITER, ORBIT_APPEAR_MS, ORBIT_CROSSFADE_MS, ORBIT_CYCLE_RADIUS, ORBIT_DWELL_MS, ORBIT_GRADIENT_STOPS, ORBIT_INSET_PADDING, ORBIT_MAP_LINE_PX, ORBIT_INSET_LINE_PX, ORBIT_MARK_RADIUS, ORBIT_MAX_DPR, ORBIT_OVERVIEW_HEIGHT, ORBIT_OVERVIEW_WIDTH, ORBIT_PANEL_GAP, ORBIT_PREVIEW_ITER, ORBIT_REPEAT_PX, ORBIT_STEP_MS, ORBIT_TRAIL_DOTS } from './constants';
import { cyclePeriod, type ComplexPoint, type OrbitTrace } from './cycles';
import { mandelbrotColor } from './compositor';
import { clipOrbitSegment, orbitOverviewView, orbitStart, onScreen, orbitCoordinates, type OrbitProjection as Projection } from './orbit-layout';
import type { OrbitJob } from './orbit-job';
import type { OrbitReply, OrbitRequest } from './orbit-worker';
import OrbitWorker from './orbit-worker.ts?worker';

type PendingTrace = { id: number; job: OrbitJob; full: boolean };

export function mountOrbitOverlay(host: PresentationHost) {
  const overlay = document.createElement('canvas');
  overlay.id = 'probe-overlay'; overlay.setAttribute('aria-hidden', 'true');
  const panel = document.createElement('div'); panel.className = 'mandelbrot-orbit-inset'; panel.hidden = true;
  const title = document.createElement('div'); title.className = 'mandelbrot-orbit-title';
  const label = document.createElement('div'); label.className = 'mandelbrot-orbit-label';
  const inset = document.createElement('canvas'); inset.setAttribute('aria-hidden', 'true');
  const legend = document.createElement('div'); legend.className = 'mandelbrot-orbit-legend';
  const first = document.createElement('span'); first.textContent = 'z₀';
  const ramp = document.createElement('span'); ramp.className = 'mandelbrot-orbit-ramp';
  const last = document.createElement('span'); last.textContent = 'zₙ';
  const coordinates = document.createElement('div'); coordinates.className = 'mandelbrot-orbit-coordinates';
  const complex = document.createElement('em');
  coordinates.append(complex);
  legend.append(first,ramp,last); panel.append(title,inset,coordinates,legend,label); host.clip.append(panel,overlay);
  const credit = document.getElementById('site-credit'), askBar = document.getElementById('ask-bar');
  const style = getComputedStyle(document.documentElement);
  const color = (name: string) => style.getPropertyValue(`--orbit-${name}`).trim();
  const line = color('line'), outline = color('outline'), dot = color('dot'), connector = color('connector'), axis = color('axis'), axisText = color('axis-text');
  const rgb = (hex: string) => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
  const gradient = ORBIT_GRADIENT_STOPS.map((_,i) => rgb(color(`gradient-${i}`)));
  const backdrop = document.createElement('canvas');
  let overviewKey = '', overviewWorker: Worker | null = null, overviewReady = false, enabled = true;
  let worker: Worker | null = null, busy: PendingTrace | null = null, queued: PendingTrace | null = null;
  let dwellTimer = 0, version = 0, resting = false, touch = false, failed = false;
  let point: CoordinateOrigin | null = null, trace: OrbitTrace | null = null, job: OrbitJob | null = null;
  let started = 0, lastStep = -1, appearedAt = 0, changedAt = 0;
  let previousTrace: OrbitTrace | null = null;

  function pathColor(unit: number): string {
    const t = Math.max(0,Math.min(1,unit));
    let stop = 1;
    while(stop < ORBIT_GRADIENT_STOPS.length-1 && t > ORBIT_GRADIENT_STOPS[stop]) stop++;
    const a = ORBIT_GRADIENT_STOPS[stop-1], b = ORBIT_GRADIENT_STOPS[stop], k = (t-a)/(b-a);
    const value = gradient[stop-1].map((v,c) => Math.round(v+k*(gradient[stop][c]-v)));
    return `rgb(${value.join(' ')})`;
  }
  function text(): void {
    const period = trace ? cyclePeriod(trace.sample) : 0;
    label.textContent = trace ? (period ? t('mandelbrot.orbit.period').replace('{period}',String(period))
      : t(trace.sample > 0 ? 'mandelbrot.orbit.escape' : 'mandelbrot.orbit.unknown').replace('{steps}',String(trace.steps)))
      : t(!point ? 'mandelbrot.orbit.idle' : failed ? 'mandelbrot.orbit.error' : 'mandelbrot.orbit.loading');
    title.textContent = t('mandelbrot.orbit.title');
    label.dataset.period = String(period);
    if(point) {
      const view=host.getView(),value=orbitCoordinates(point,viewSpanX(view)/Math.max(1,host.clip.clientWidth));
      complex.textContent=value.shortComplex.replace(/-/g,'−'); complex.title=value.complex.replace(/-/g,'−');
    } else { complex.textContent='—'; complex.title=''; }
    panel.dataset.animating = overlay.dataset.animating = String(resting);
  }
  onUiChange(() => { text(); draw(performance.now()); });

  function launchWorker(): Worker {
    if (worker) return worker;
    const current = new OrbitWorker(); worker = current;
    current.onmessage = (event: MessageEvent<OrbitReply>) => {
      if (worker !== current) return;
      const reply = event.data;
      if (reply.kind !== 'trace') return;
      busy = null;
      if (reply.id === version && point) {
        const now=performance.now();
        if(reply.trace) {
          if(trace){previousTrace=trace;changedAt=now;}else appearedAt=now;
          trace=reply.trace;
        }
        failed=!reply.trace;text();draw(now);
      }
      pump();
    };
    current.onerror = () => {
      if (worker !== current) return;
      current.terminate(); worker = null; busy = null; queued = null; failed = true; text();
    };
    return current;
  }
  function requestOverview(): void {
    const params = {...host.params}, key = JSON.stringify(params);
    if (overviewKey === key && (overviewReady || overviewWorker)) return;
    overviewWorker?.terminate(); overviewReady = false; overviewKey = key;
    // Overview work must not delay the live trajectory preview.
    const current = new OrbitWorker(); overviewWorker = current;
    current.onmessage = (event: MessageEvent<OrbitReply>) => {
      const reply = event.data;
      if (overviewWorker !== current || reply.kind !== 'overview' || reply.key !== overviewKey) return;
      backdrop.width = reply.width; backdrop.height = reply.height;
      const ink = backdrop.getContext('2d')!, image = ink.createImageData(reply.width,reply.height);
      for(let i=0;i<reply.samples.length;i++) {
        const shade = mandelbrotColor(reply.samples[i]);
        image.data.set([...shade.map(c=>Math.round(c*255)),255],i*4);
      }
      ink.putImageData(image,0,0); overviewReady = true;
      inset.dataset.overviewParams = key;
      current.terminate(); overviewWorker = null; draw(performance.now());
    };
    current.onerror = () => { if(overviewWorker === current){current.terminate();overviewWorker = null;} };
    current.postMessage({kind:'overview',key,width:ORBIT_OVERVIEW_WIDTH,height:ORBIT_OVERVIEW_HEIGHT,
      view:orbitOverviewView(params),params} satisfies OrbitRequest);
  }
  function pump(): void {
    if (busy || !queued) return;
    busy = queued; queued = null;
    launchWorker().postMessage({kind:'trace',id:busy.id,job:busy.job} satisfies OrbitRequest);
  }
  function clear(): void {
    version++; window.clearTimeout(dwellTimer); worker?.terminate(); worker = null; busy = null; queued = null;
    point = null; trace = null; previousTrace = null; job = null; failed = false; resting = false;
    panel.dataset.animating = overlay.dataset.animating = 'false';
    overlay.dataset.mode = 'hidden';
    if (!enabled && overviewWorker) { overviewWorker.terminate(); overviewWorker = null; }
    text(); draw(performance.now());
  }
  function select(clientX: number, clientY: number): void {
    if (!enabled) return;
    const selected = host.snapToRenderedPixel(host.clientToWorld(clientX,clientY)), view = host.getView();
    const next = {x:(view.origin?.x ?? 0n)+coordinateFromNumber(selected.x),y:(view.origin?.y ?? 0n)+coordinateFromNumber(selected.y)};
    if (point?.x === next.x && point?.y === next.y) return;
    version++; window.clearTimeout(dwellTimer); resting = false; failed = false;
    // Retain the last complete curve while the worker computes the next pointer position.
    // A long exact trace must never hold up the next live cursor preview.
    if (busy?.full) { worker?.terminate(); worker = null; busy = null; }
    point = next;
    job = {point:next,span:Math.min(viewSpanX(view),viewSpanY(view)),params:{...host.params},f32:!(host.samplesF64?.() ?? false)};
    queued = {id:version,job:{...job,params:{...job.params,MAX_ITERATIONS:Math.min(ORBIT_PREVIEW_ITER,job.params.MAX_ITERATIONS ?? MANDELBROT_DEFAULT_ITER)}},full:false};
    pump(); text(); draw(performance.now());
    const current = version;
    dwellTimer = window.setTimeout(() => {
      if (current !== version || !job) return;
      resting = true; started = performance.now(); lastStep = -1;
      queued = {id:version,job,full:true}; pump(); text(); draw(started);
    },ORBIT_DWELL_MS);
  }
  function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const dpr = Math.min(devicePixelRatio || 1,ORBIT_MAX_DPR);
    const width = Math.round(canvas.clientWidth*dpr), height = Math.round(canvas.clientHeight*dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d');
    if (ctx) { ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight); }
    return ctx;
  }
  function disk(ctx: CanvasRenderingContext2D,p: ComplexPoint,radius: number,fill: string): void {
    if (!Number.isFinite(p.r+p.i)) return;
    ctx.beginPath();ctx.arc(p.r,p.i,radius,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();
    ctx.lineWidth=1.5;ctx.strokeStyle=outline;ctx.stroke();
  }
  function caption(ctx: CanvasRenderingContext2D,p: ComplexPoint,value: string): void {
    ctx.font='italic 12px Georgia, serif';ctx.lineWidth=3;ctx.strokeStyle=outline;ctx.fillStyle=line;
    ctx.strokeText(value,p.r+7,p.i-7);ctx.fillText(value,p.r+7,p.i-7);
  }
  function visiblePath(orbit: OrbitTrace,project: Projection): ComplexPoint[] {
    const path = orbit.path, period = orbit.cycle.length;
    // Repeated cycles would paint over their own gradient. Keep one visible turn.
    if (period) for(let n=period;n+period<=path.length;n++) {
      let repeats = true;
      for(let k=0;k<period;k++) {
        const a=project(path[n+k]),b=project(path[n-period+k]);
        if(Math.hypot(a.r-b.r,a.i-b.i)>ORBIT_REPEAT_PX) { repeats=false;break; }
      }
      if(repeats)return path.slice(0,n+1);
    }
    return path;
  }
  function drawOrbit(ctx: CanvasRenderingContext2D,orbit: OrbitTrace,project: Projection,now: number,alpha: number,animate: boolean): void {
    if(alpha<=0)return;
    ctx.save();ctx.globalAlpha=alpha;
    const path=visiblePath(orbit,project),count=Math.max(1,path.length-1);
    const segments=path.slice(1).map((p,i)=>clipOrbitSegment(project(path[i]),project(p),ctx.canvas.clientWidth,ctx.canvas.clientHeight));
    ctx.lineJoin='round';ctx.lineCap='round';
    const main=ctx.canvas===overlay;
    segments.forEach((pair,i)=>{
      if(!pair)return;const [a,b]=pair;
      const ramp=ctx.createLinearGradient(a.r,a.i,b.r,b.i);
      ramp.addColorStop(0,pathColor(i/count));ramp.addColorStop(1,pathColor((i+1)/count));
      ctx.beginPath();ctx.moveTo(a.r,a.i);ctx.lineTo(b.r,b.i);ctx.strokeStyle=ramp;ctx.lineWidth=main?ORBIT_MAP_LINE_PX:ORBIT_INSET_LINE_PX;ctx.stroke();
    });
    orbit.cycle.forEach(p=>{
      const q=project(p);if(!onScreen(q,ctx.canvas.clientWidth,ctx.canvas.clientHeight))return;
      ctx.beginPath();ctx.arc(q.r,q.i,ORBIT_CYCLE_RADIUS,0,Math.PI*2);ctx.strokeStyle=line;ctx.lineWidth=1;ctx.stroke();
    });
    if(animate&&resting) {
      const step=Math.floor((now-started)/ORBIT_STEP_MS),period=orbit.cycle.length;
      for(let trail=ORBIT_TRAIL_DOTS-1;trail>=0;trail--) {
        const n=step-trail;if(n<0)continue;
        const index=n<path.length?n:period?path.length-period+(n-path.length)%period:path.length-1;
        const p=path[index];if(!p)continue;
        const q=project(p);if(!onScreen(q,ctx.canvas.clientWidth,ctx.canvas.clientHeight))continue;
        ctx.globalAlpha=alpha*(1-trail/ORBIT_TRAIL_DOTS);
        disk(ctx,q,ORBIT_MARK_RADIUS,pathColor(index/count));
      }
    }
    ctx.restore();
  }
  function drawTrajectory(ctx: CanvasRenderingContext2D,project: Projection,now: number): void {
    if(!trace)return;
    const ease=(elapsed:number,duration:number)=>{const t=Math.max(0,Math.min(1,elapsed/duration));return t*t*(3-2*t);};
    const opacity=ease(now-appearedAt,ORBIT_APPEAR_MS),blend=previousTrace?ease(now-changedAt,ORBIT_CROSSFADE_MS):1;
    if(previousTrace)drawOrbit(ctx,previousTrace,project,now,opacity*(1-blend),false);
    drawOrbit(ctx,trace,project,now,opacity*blend,true);
    overlay.dataset.orbitOpacity=String(opacity);
  }
  function drawAxes(ink: CanvasRenderingContext2D,project: Projection): void {
    const origin=project({r:0,i:0}),w=inset.clientWidth,h=inset.clientHeight,pad=ORBIT_INSET_PADDING;
    ink.beginPath();ink.moveTo(pad,origin.i);ink.lineTo(w-pad,origin.i);
    ink.moveTo(origin.r,pad);ink.lineTo(origin.r,h-pad);
    ink.strokeStyle=axis;ink.lineWidth=1;ink.stroke();
    ink.font='10px system-ui';ink.lineWidth=3;ink.strokeStyle=outline;ink.fillStyle=axisText;
    const write=(value:string,x:number,y:number)=>{ink.strokeText(value,x,y);ink.fillText(value,x,y);};
    for(let n=-2;n<=2;n++) {
      const px=project({r:n,i:0}).r,py=project({r:0,i:n}).i;
      if(px>=pad&&px<=w-pad)write(String(n),px+3,origin.i+12);
      if(n&&py>=pad&&py<=h-pad){ink.font='italic 12px Georgia, serif';write(n===1?'i':n===-1?'−i':`${n<0?'−':''}${Math.abs(n)}i`,origin.r+4,py-3);ink.font='10px system-ui';}
    }
  }
  function positionPanel(): void {
    const clipBox=host.clip.getBoundingClientRect(),panelBox=panel.getBoundingClientRect();
    const creditBox=credit?.getBoundingClientRect(),askBox=askBar?.getBoundingClientRect();
    let bottom=ORBIT_PANEL_GAP;
    if(creditBox?.height)bottom=Math.max(bottom,clipBox.bottom-creditBox.top+ORBIT_PANEL_GAP);
    // Raise the overview above Ask only when their actual rectangles would overlap.
    if(askBox?.height&&panelBox.left<askBox.right&&panelBox.right>askBox.left
      &&clipBox.bottom-bottom>askBox.top-ORBIT_PANEL_GAP
      &&clipBox.bottom-bottom-panelBox.height<askBox.bottom) {
      bottom=Math.max(bottom,clipBox.bottom-askBox.top+ORBIT_PANEL_GAP);
    }
    const value=`${Math.ceil(bottom)}px`;
    if(panel.style.bottom!==value)panel.style.bottom=value;
  }
  function draw(now: number): void {
    const ctx=context(overlay);panel.hidden=!enabled;
    if(!ctx||!enabled){overlay.dataset.mode='hidden';return;}
    positionPanel();
    requestOverview();
    const ink=context(inset);if(!ink)return;
    const view=host.getView(),width=overlay.clientWidth,height=overlay.clientHeight;
    const v=orbitOverviewView(host.params);
    const scale=Math.min((inset.clientWidth-2*ORBIT_INSET_PADDING)/(v.xMax-v.xMin),(inset.clientHeight-2*ORBIT_INSET_PADDING)/(v.yMax-v.yMin));
    const project: Projection=p=>({r:inset.clientWidth/2+(p.r-(v.xMin+v.xMax)/2)*scale,i:inset.clientHeight/2+(-p.i-(v.yMin+v.yMax)/2)*scale});
    if(overviewReady) {
      const a=project({r:v.xMin,i:-v.yMin}),b=project({r:v.xMax,i:-v.yMax});
      ink.drawImage(backdrop,a.r,a.i,b.r-a.r,b.i-a.i);
    }
    drawAxes(ink,project);
    if(!point||!job){overlay.dataset.mode='preview';overlay.dataset.connector='false';return;}
    const exactProject=(p:CoordinateOrigin):ComplexPoint=>({
      r:(coordinateToNumber(p.x-(view.origin?.x??0n))-view.xMin)/viewSpanX(view)*width,
      i:(coordinateToNumber(p.y-(view.origin?.y??0n))-view.yMin)/viewSpanY(view)*height,
    });
    const marker=exactProject(point),selected={r:coordinateToNumber(point.x),i:-coordinateToNumber(point.y)};
    const initial=orbitStart(point,job.params.MORPH??0),z0={r:coordinateToNumber(initial.x),i:-coordinateToNumber(initial.y)};
    const mainStart=exactProject(initial),start=project(z0),selectedMini=project(selected);
    const mainProject: Projection=p=>p===trace?.path[0]||p===previousTrace?.path[0]?mainStart
      :exactProject({x:coordinateFromNumber(p.r),y:coordinateFromNumber(-p.i)});
    const onMap=onScreen(mainStart,width,height);
    overlay.dataset.mode=onMap?'map':'inset';
    drawTrajectory(ink,project,now);
    const bothVisible=onMap&&onScreen(marker,width,height);
    overlay.dataset.connector=String(bothVisible);
    // The preview callout crosses the panel; only the main-map orbit stays behind it.
    if(!bothVisible&&onScreen(marker,width,height)) {
      const insetBox=inset.getBoundingClientRect(),clipBox=host.clip.getBoundingClientRect();
      ctx.beginPath();ctx.moveTo(insetBox.left-clipBox.left+start.r,insetBox.top-clipBox.top+start.i);ctx.lineTo(marker.r,marker.i);
      ctx.strokeStyle=connector;ctx.lineWidth=ORBIT_MAP_LINE_PX;ctx.stroke();
    }
    // Reserve the preview rectangle for its own orbit and labels.
    const previewBox=panel.getBoundingClientRect(),overlayBox=overlay.getBoundingClientRect();
    ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);
    ctx.rect(previewBox.left-overlayBox.left,previewBox.top-overlayBox.top,previewBox.width,previewBox.height);
    ctx.clip('evenodd');
    if(onMap)drawTrajectory(ctx,mainProject,now);
    if(previousTrace&&now-changedAt>=ORBIT_CROSSFADE_MS)previousTrace=null;
    // This callout is independent of whether the rest of the orbit fits the map.
    if(bothVisible) {
      ctx.setLineDash([4,4]);
      ctx.beginPath();ctx.moveTo(mainStart.r,mainStart.i);ctx.lineTo(marker.r,marker.i);
      ctx.strokeStyle=connector;ctx.lineWidth=ORBIT_MAP_LINE_PX;ctx.stroke();ctx.setLineDash([]);
    }
    if(onScreen(marker,width,height)) {
      disk(ctx,marker,ORBIT_MARK_RADIUS,line);
      ctx.beginPath();ctx.arc(marker.r,marker.i,ORBIT_MARK_RADIUS+4,0,Math.PI*2);ctx.strokeStyle=line;ctx.lineWidth=1;ctx.stroke();
    }
    if(onScreen(mainStart,width,height)){disk(ctx,mainStart,ORBIT_MARK_RADIUS,dot);caption(ctx,mainStart,'z₀');}
    ctx.restore();
    disk(ink,selectedMini,ORBIT_MARK_RADIUS,line);
    if(Math.hypot(selectedMini.r-start.r,selectedMini.i-start.i)>ORBIT_MARK_RADIUS*2)caption(ink,selectedMini,'p');
    disk(ink,start,ORBIT_MARK_RADIUS,dot);caption(ink,start,'z₀');
    panel.dataset.pathPoints=overlay.dataset.pathPoints=String(trace?.path.length??0);
  }
  host.clip.addEventListener('pointermove',event=>{
    if(event.buttons||event.pointerType==='touch'){if(event.buttons)clear();return;}
    touch=false;select(event.clientX,event.clientY);
  });
  host.clip.addEventListener('pointerdown',clear);
  host.clip.addEventListener('pointerleave',()=>{if(!touch)clear();});
  return {
    clear,setEnabled(value:boolean){enabled=value;clear();},draw:()=>draw(performance.now()),
    tick(now:number){
      const step=Math.floor((now-started)/ORBIT_STEP_MS);
      if(trace&&(now-appearedAt<ORBIT_APPEAR_MS||previousTrace||Number(overlay.dataset.orbitOpacity)<1||resting&&step!==lastStep)){
        lastStep=step;draw(now);
      }
    },
    pickPoint(_x:number,_y:number,clientX:number,clientY:number,pointerType:string){if(pointerType==='touch'){touch=true;select(clientX,clientY);}return false;},
  };
}
