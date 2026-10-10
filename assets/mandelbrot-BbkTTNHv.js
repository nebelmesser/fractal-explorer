import{q as Ge,x as Z,C as qe,o as _t,t as ye,v as ue,a as we,y as J,b as vt,s as wt,z as Et,A as lt,B as Tt,n as Rt,l as It,c as At,d as Pt,e as zt}from"./menu-CzDvZvqG.js";const st={xMin:-2.25,xMax:1.25,yMin:-1.35,yMax:1.35},St={xMin:-3,xMax:3,yMin:-3,yMax:3},Ee=128,Ye=262144,de=768,Ke=64,Ot=4,Ct=.25,kt=256,Le=-.8,We=.156,Me=2,Qe=.001,Bt=.001,ct=64,ut=4,V=[0,.16,.36,.44,.56,.76,1],Nt=1e-280,Lt=.01,Wt=4,Dt=8,Ze=65,K=3,Ut=4,Ft=2,ke=20,_e=8,$t=500,Ht=128,jt=320,Jt=247,Vt=2.25,et="mandelbrot-show-orbit",ce=[0,.35,.7,1],Xt=.75,tt=3,Gt=4,qt=300,Yt=24,nt=180,rt=100,Be=.5,Kt=.3,Qt=e=>Number.isFinite(e)&&e<=-2?Math.floor(-e)-1:0;let ve=null;function dt(){if(ve)return ve;const e=getComputedStyle(document.documentElement);return ve=V.map((n,a)=>{const i=e.getPropertyValue(`--mandelbrot-color-${a}`).trim();if(!/^#[\da-f]{6}$/i.test(i))throw new Error(`Missing Mandelbrot palette color ${a}`);return[1,3,5].map(m=>parseInt(i.slice(m,m+2),16)/255)}),ve}function mt(e){if(!(e>0)||!Number.isFinite(e))return[0,0,0];const n=Math.max(0,e-ut)/ct%1,a=dt();for(let i=1;i<V.length;i++){if(n>V[i])continue;const m=(n-V[i-1])/(V[i]-V[i-1]),d=m*m*(3-2*m);return a[i-1].map((u,c)=>u+d*(a[i][c]-u))}return a[0]}const Zt={get gpuWgsl(){const e=dt(),n=i=>`vec3f(${i.map(m=>m.toFixed(9)).join(", ")})`,a=V.slice(1).map((i,m)=>`
      if (t <= ${i.toFixed(6)}) {
        return mix(${n(e[m])}, ${n(e[m+1])},
          smoothstep(${V[m].toFixed(6)}, ${i.toFixed(6)}, t));
      }`).join(`
`);return`
      fn mandelbrot_color(sample: f32) -> vec3f {
        if (sample <= 0.0) { return vec3f(0.0); }
        let t = fract(max(0.0, sample - ${ut.toFixed(1)}) / ${ct.toFixed(1)});
        ${a}
        return ${n(e[0])};
      }
      fn map_sample_color(uv: vec2f, inverted: bool) -> vec3f {
        let pixel = vec2i(round(uv * vec2f(draw.size) - vec2f(0.5)));
        let color = mandelbrot_color(raw_at(pixel.x, pixel.y));
        return select(color, vec3f(1.0) - color, inverted);
      }
    `},colorize(e,n,a){const i=mt(e);return a?[1-i[0],1-i[1],1-i[2]]:i},exposure:"none",initialMedian:1};function ot(e){const n=e.MORPH??0,a=st,i=Vt;return{xMin:a.xMin*(1-n)-i*n,xMax:a.xMax*(1-n)+i*n,yMin:a.yMin*(1-n)-i*n,yMax:a.yMax*(1-n)+i*n}}function en(e,n){const a=Z(n);return{x:e.x*a/qe,y:e.y*a/qe}}function Q(e,n,a){return Number.isFinite(e.r+e.i)&&e.r>=0&&e.r<=n&&e.i>=0&&e.i<=a}function tn(e,n){const a=Math.min(qt,Math.max(Gt,Math.ceil(-Math.log10(n))+1)),i=Ge(e.x,a),m=Ge(-e.y,a),d=b=>b.length>Yt?`${b.slice(0,12)}…${b.slice(-8)}`:b,u=m.startsWith("-"),c=u?m.slice(1):m;return{x:i,y:m,complex:`${i} ${u?"−":"+"} ${c}i`,shortX:d(i),shortY:d(m),shortComplex:`${d(i)} ${u?"−":"+"} ${d(c)}i`}}function nn(e,n,a,i){e={...e},n={...n};const m=u=>(u.r<0?1:u.r>a?2:0)|(u.i<0?4:u.i>i?8:0),d=(u,c,b,f,x)=>Math.abs(x-b)<Math.abs(x-f)?u+(c-u)*((x-b)/(f-b)):c+(u-c)*((x-f)/(b-f));for(let u=0;u<8;u++){const c=m(e),b=m(n);if(!(c|b))return[e,n];if(c&b)return null;const f=c||b;let x;if(f&12){const w=f&4?0:i;x={r:d(e.r,n.r,e.i,n.i,w),i:w}}else{const w=f&1?0:a;x={r:w,i:d(e.i,n.i,e.r,n.r,w)}}if(!Number.isFinite(x.r+x.i))return null;c?e=x:n=x}return null}function it(e){return new Worker(""+new URL("orbit-worker--t5hRNdS.js",import.meta.url).href,{type:"module",name:e?.name})}function rn(e){const n=document.createElement("canvas");n.id="probe-overlay",n.setAttribute("aria-hidden","true");const a=document.createElement("div");a.className="mandelbrot-orbit-inset",a.hidden=!0;const i=document.createElement("div");i.className="mandelbrot-orbit-title";const m=document.createElement("div");m.className="mandelbrot-orbit-label";const d=document.createElement("canvas");d.setAttribute("aria-hidden","true");const u=document.createElement("div");u.className="mandelbrot-orbit-legend";const c=document.createElement("span");c.textContent="z₀";const b=document.createElement("span");b.className="mandelbrot-orbit-ramp";const f=document.createElement("span");f.textContent="zₙ";const x=document.createElement("div");x.className="mandelbrot-orbit-coordinates";const w=document.createElement("em");x.append(w),u.append(c,b,f),a.append(i,d,x,u,m),e.clip.append(a,n);const N=document.getElementById("site-credit"),X=document.getElementById("ask-bar"),_=getComputedStyle(document.documentElement),M=t=>_.getPropertyValue(`--orbit-${t}`).trim(),y=M("line"),S=M("outline"),T=M("dot"),oe=M("connector"),me=M("axis"),fe=M("axis-text"),pe=t=>[1,3,5].map(r=>parseInt(t.slice(r,r+2),16)),ge=ce.map((t,r)=>pe(M(`gradient-${r}`))),L=document.createElement("canvas");let Te="",W=null,he=!1,ie=!0,D=null,U=null,G=null,Re=0,q=0,te=!1,ae=!1,O=null,I=null,F=null,be=0,Ie=-1,Ae=0,Pe=0,$=null;function ze(t){const r=Math.max(0,Math.min(1,t));let o=1;for(;o<ce.length-1&&r>ce[o];)o++;const s=ce[o-1],l=ce[o],g=(r-s)/(l-s);return`rgb(${ge[o-1].map((h,v)=>Math.round(h+g*(ge[o][v]-h))).join(" ")})`}function ne(){const t=I?Qt(I.sample):0;if(m.textContent=I?t?ye("mandelbrot.orbit.period").replace("{period}",String(t)):ye(I.sample>0?"mandelbrot.orbit.escape":"mandelbrot.orbit.unknown").replace("{steps}",String(I.steps)):ye(O?ae?"mandelbrot.orbit.error":"mandelbrot.orbit.loading":"mandelbrot.orbit.idle"),i.textContent=ye("mandelbrot.orbit.title"),m.dataset.period=String(t),O){const r=e.getView(),o=tn(O,ue(r)/Math.max(1,e.clip.clientWidth));w.textContent=o.shortComplex.replace(/-/g,"−"),w.title=o.complex.replace(/-/g,"−")}else w.textContent="—",w.title="";a.dataset.animating=n.dataset.animating=String(te)}_t(()=>{ne(),j(performance.now())});function pt(){if(D)return D;const t=new it;return D=t,t.onmessage=r=>{if(D!==t)return;const o=r.data;if(o.kind==="trace"){if(U=null,o.id===q&&O){const s=performance.now();o.trace&&(I?($=I,Pe=s):Ae=s,I=o.trace),ae=!o.trace,ne(),j(s)}Se()}},t.onerror=()=>{D===t&&(t.terminate(),D=null,U=null,G=null,ae=!0,ne())},t}function gt(){const t={...e.params},r=JSON.stringify(t);if(Te===r&&(he||W))return;W?.terminate(),he=!1,Te=r;const o=new it;W=o,o.onmessage=s=>{const l=s.data;if(W!==o||l.kind!=="overview"||l.key!==Te)return;L.width=l.width,L.height=l.height;const g=L.getContext("2d"),p=g.createImageData(l.width,l.height);for(let h=0;h<l.samples.length;h++){const v=mt(l.samples[h]);p.data.set([...v.map(A=>Math.round(A*255)),255],h*4)}g.putImageData(p,0,0),he=!0,d.dataset.overviewParams=r,o.terminate(),W=null,j(performance.now())},o.onerror=()=>{W===o&&(o.terminate(),W=null)},o.postMessage({kind:"overview",key:r,width:jt,height:Jt,view:ot(t),params:t})}function Se(){U||!G||(U=G,G=null,pt().postMessage({kind:"trace",id:U.id,job:U.job}))}function $e(){q++,window.clearTimeout(Re),D?.terminate(),D=null,U=null,G=null,O=null,I=null,$=null,F=null,ae=!1,te=!1,a.dataset.animating=n.dataset.animating="false",n.dataset.mode="hidden",!ie&&W&&(W.terminate(),W=null),ne(),j(performance.now())}function He(t,r){if(!ie)return;const o=e.snapToRenderedPixel(e.clientToWorld(t,r)),s=e.getView(),l={x:(s.origin?.x??0n)+Z(o.x),y:(s.origin?.y??0n)+Z(o.y)};if(O?.x===l.x&&O?.y===l.y)return;q++,window.clearTimeout(Re),te=!1,ae=!1,U?.full&&(D?.terminate(),D=null,U=null),O=l,F={point:l,span:Math.min(ue(s),we(s)),params:{...e.params},f32:!(e.samplesF64?.()??!1)},G={id:q,job:{...F,params:{...F.params,MAX_ITERATIONS:Math.min(Ht,F.params.MAX_ITERATIONS??de)}},full:!1},Se(),ne(),j(performance.now());const g=q;Re=window.setTimeout(()=>{g!==q||!F||(te=!0,be=performance.now(),Ie=-1,G={id:q,job:F,full:!0},Se(),ne(),j(be))},$t)}function je(t){const r=Math.min(devicePixelRatio||1,Ft),o=Math.round(t.clientWidth*r),s=Math.round(t.clientHeight*r);(t.width!==o||t.height!==s)&&(t.width=o,t.height=s);const l=t.getContext("2d");return l&&(l.setTransform(r,0,0,r,0,0),l.clearRect(0,0,t.clientWidth,t.clientHeight)),l}function le(t,r,o,s){Number.isFinite(r.r+r.i)&&(t.beginPath(),t.arc(r.r,r.i,o,0,Math.PI*2),t.fillStyle=s,t.fill(),t.lineWidth=1.5,t.strokeStyle=S,t.stroke())}function Oe(t,r,o){t.font="italic 12px Georgia, serif",t.lineWidth=3,t.strokeStyle=S,t.fillStyle=y,t.strokeText(o,r.r+7,r.i-7),t.fillText(o,r.r+7,r.i-7)}function ht(t,r){const o=t.path,s=t.cycle.length;if(s)for(let l=s;l+s<=o.length;l++){let g=!0;for(let p=0;p<s;p++){const h=r(o[l+p]),v=r(o[l-s+p]);if(Math.hypot(h.r-v.r,h.i-v.i)>Xt){g=!1;break}}if(g)return o.slice(0,l+1)}return o}function Je(t,r,o,s,l,g){if(l<=0)return;t.save(),t.globalAlpha=l;const p=ht(r,o),h=Math.max(1,p.length-1),v=p.slice(1).map((E,P)=>nn(o(p[P]),o(E),t.canvas.clientWidth,t.canvas.clientHeight));t.lineJoin="round",t.lineCap="round";const A=t.canvas===n;if(v.forEach((E,P)=>{if(!E)return;const[C,B]=E,z=t.createLinearGradient(C.r,C.i,B.r,B.i);z.addColorStop(0,ze(P/h)),z.addColorStop(1,ze((P+1)/h)),t.beginPath(),t.moveTo(C.r,C.i),t.lineTo(B.r,B.i),t.strokeStyle=z,t.lineWidth=A?Be:Kt,t.stroke()}),r.cycle.forEach(E=>{const P=o(E);Q(P,t.canvas.clientWidth,t.canvas.clientHeight)&&(t.beginPath(),t.arc(P.r,P.i,Ut,0,Math.PI*2),t.strokeStyle=y,t.lineWidth=1,t.stroke())}),g&&te){const E=Math.floor((s-be)/Ze),P=r.cycle.length;for(let C=tt-1;C>=0;C--){const B=E-C;if(B<0)continue;const z=B<p.length?B:P?p.length-P+(B-p.length)%P:p.length-1,H=p[z];if(!H)continue;const Y=o(H);Q(Y,t.canvas.clientWidth,t.canvas.clientHeight)&&(t.globalAlpha=l*(1-C/tt),le(t,Y,K,ze(z/h)))}}t.restore()}function Ve(t,r,o){if(!I)return;const s=(p,h)=>{const v=Math.max(0,Math.min(1,p/h));return v*v*(3-2*v)},l=s(o-Ae,nt),g=$?s(o-Pe,rt):1;$&&Je(t,$,r,o,l*(1-g),!1),Je(t,I,r,o,l*g,!0),n.dataset.orbitOpacity=String(l)}function bt(t,r){const o=r({r:0,i:0}),s=d.clientWidth,l=d.clientHeight,g=ke;t.beginPath(),t.moveTo(g,o.i),t.lineTo(s-g,o.i),t.moveTo(o.r,g),t.lineTo(o.r,l-g),t.strokeStyle=me,t.lineWidth=1,t.stroke(),t.font="10px system-ui",t.lineWidth=3,t.strokeStyle=S,t.fillStyle=fe;const p=(h,v,A)=>{t.strokeText(h,v,A),t.fillText(h,v,A)};for(let h=-2;h<=2;h++){const v=r({r:h,i:0}).r,A=r({r:0,i:h}).i;v>=g&&v<=s-g&&p(String(h),v+3,o.i+12),h&&A>=g&&A<=l-g&&(t.font="italic 12px Georgia, serif",p(h===1?"i":h===-1?"−i":`${h<0?"−":""}${Math.abs(h)}i`,o.r+4,A-3),t.font="10px system-ui")}}function xt(){const t=e.clip.getBoundingClientRect(),r=a.getBoundingClientRect(),o=N?.getBoundingClientRect(),s=X?.getBoundingClientRect();let l=_e;o?.height&&(l=Math.max(l,t.bottom-o.top+_e)),s?.height&&r.left<s.right&&r.right>s.left&&t.bottom-l>s.top-_e&&t.bottom-l-r.height<s.bottom&&(l=Math.max(l,t.bottom-s.top+_e));const g=`${Math.ceil(l)}px`;a.style.bottom!==g&&(a.style.bottom=g)}function j(t){const r=je(n);if(a.hidden=!ie,!r||!ie){n.dataset.mode="hidden";return}xt(),gt();const o=je(d);if(!o)return;const s=e.getView(),l=n.clientWidth,g=n.clientHeight,p=ot(e.params),h=Math.min((d.clientWidth-2*ke)/(p.xMax-p.xMin),(d.clientHeight-2*ke)/(p.yMax-p.yMin)),v=R=>({r:d.clientWidth/2+(R.r-(p.xMin+p.xMax)/2)*h,i:d.clientHeight/2+(-R.i-(p.yMin+p.yMax)/2)*h});if(he){const R=v({r:p.xMin,i:-p.yMin}),se=v({r:p.xMax,i:-p.yMax});o.drawImage(L,R.r,R.i,se.r-R.r,se.i-R.i)}if(bt(o,v),!O||!F){n.dataset.mode="preview",n.dataset.connector="false";return}const A=R=>({r:(J(R.x-(s.origin?.x??0n))-s.xMin)/ue(s)*l,i:(J(R.y-(s.origin?.y??0n))-s.yMin)/we(s)*g}),E=A(O),P={r:J(O.x),i:-J(O.y)},C=en(O,F.params.MORPH??0),B={r:J(C.x),i:-J(C.y)},z=A(C),H=v(B),Y=v(P),yt=R=>R===I?.path[0]||R===$?.path[0]?z:A({x:Z(R.r),y:Z(-R.i)}),Mt=Q(z,l,g);n.dataset.mode="map",Ve(o,v,t);const Ce=Mt&&Q(E,l,g);if(n.dataset.connector=String(Ce),!Ce&&Q(E,l,g)){const R=d.getBoundingClientRect(),se=e.clip.getBoundingClientRect();r.beginPath(),r.moveTo(R.left-se.left+H.r,R.top-se.top+H.i),r.lineTo(E.r,E.i),r.strokeStyle=oe,r.lineWidth=Be,r.stroke()}const xe=a.getBoundingClientRect(),Xe=n.getBoundingClientRect();r.save(),r.beginPath(),r.rect(0,0,l,g),r.rect(xe.left-Xe.left,xe.top-Xe.top,xe.width,xe.height),r.clip("evenodd"),Ve(r,yt,t),$&&t-Pe>=rt&&($=null),Ce&&(r.setLineDash([4,4]),r.beginPath(),r.moveTo(z.r,z.i),r.lineTo(E.r,E.i),r.strokeStyle=oe,r.lineWidth=Be,r.stroke(),r.setLineDash([])),Q(E,l,g)&&(le(r,E,K,y),r.beginPath(),r.arc(E.r,E.i,K+4,0,Math.PI*2),r.strokeStyle=y,r.lineWidth=1,r.stroke()),Q(z,l,g)&&(le(r,z,K,T),Oe(r,z,"z₀")),r.restore(),le(o,Y,K,y),Math.hypot(Y.r-H.r,Y.i-H.i)>K*2&&Oe(o,Y,"p"),le(o,H,K,T),Oe(o,H,"z₀"),a.dataset.pathPoints=n.dataset.pathPoints=String(I?.path.length??0)}return e.clip.addEventListener("pointermove",t=>{t.buttons||t.pointerType==="touch"||He(t.clientX,t.clientY)}),{clear:$e,setEnabled(t){ie=t,$e()},draw:()=>j(performance.now()),tick(t){const r=Math.floor((t-be)/Ze);I&&(t-Ae<nt||$||Number(n.dataset.orbitOpacity)<1||te&&r!==Ie)&&(Ie=r,j(t))},pickPoint(t,r,o,s,l){return l==="touch"&&He(o,s),!1}}}const on={compositor:Zt,mount(e){const n=rn(e),a=document.querySelector("#show-orbit");try{a.checked=localStorage.getItem(et)!=="false"}catch{}n.setEnabled(a.checked),a.addEventListener("change",()=>{n.setEnabled(a.checked);try{localStorage.setItem(et,String(a.checked))}catch{}});const i=vt(e.map,e.controls,e.onParamsChange,e.resetTransition,e.signals),m=["JULIA_REAL","JULIA_IMAG"].map(c=>document.querySelector(`[data-param-value="${c}"]`)?.closest("label"));let d=-1;function u(){const c=e.params.MORPH??0;if(c!==d){d=c;for(const b of m){b?.classList.toggle("is-inactive",c===0);const f=b?.querySelector("input");f&&(f.disabled=c===0)}}}return u(),{...Et,draw(){u(),n.draw()},tick(c){u(),n.tick(c)},reset(){u(),n.clear()},resize:n.draw,pickPoint:n.pickPoint,dismiss:()=>i.setOpen(!1),syncBudget:wt}}};function an(e,n,a,i,m,d){const u=new ArrayBuffer(64),c=new Float32Array(u),b=new Int32Array(u),f=new Uint32Array(u),x=lt(e),w=ue(e),N=we(e),X=J(x.x-i.x),_=J(x.y-i.y),M=Math.floor(Math.log2(Math.max(w,N,Math.abs(X),Math.abs(_)))),y=2**M,S=[X/y,_/y,w/y,N/y];for(let T=0;T<S.length;T++)c[T]=S[T],c[T+4]=S[T]-c[T];return b[8]=M,f[9]=Math.round(d.MAX_ITERATIONS??de),f[10]=n,f[11]=a,f[12]=m,c[13]=d.MORPH??0,c[14]=(d.MORPH??0)-c[13],u}function ln(e){return new Worker(""+new URL("deep-worker-CmkTMtmv.js",import.meta.url).href,{type:"module",name:e?.name})}const sn=`struct Uniforms { offset: vec4f, tail: vec4f, size: vec4u, extra: vec4u }
// Each real component is the unevaluated sum of two f32 values.
struct Complex { m: vec4f, e: i32 }
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> raw: array<f32>;
@group(0) @binding(2) var<storage, read> reference: array<vec4f>;

fn ds_sum(a: vec2f, b: vec2f) -> vec2f {
  let s = a.x + b.x;
  let v = s - a.x;
  let err = (a.x - (s - v)) + (b.x - v) + a.y + b.y;
  let hi = s + err;
  return vec2f(hi, err - (hi - s));
}
fn ds_mul(a: vec2f, b: vec2f) -> vec2f {
  let p = a.x * b.x;
  let ac = 4097.0 * a.x; let ah = ac - (ac - a.x); let al = a.x - ah;
  let bc = 4097.0 * b.x; let bh = bc - (bc - b.x); let bl = b.x - bh;
  let err = ((ah * bh - p) + ah * bl + al * bh) + al * bl + a.x * b.y + a.y * b.x;
  let hi = p + err;
  return vec2f(hi, err - (hi - p));
}
fn norm(m: vec4f, e: i32) -> Complex {
  let size = max(abs(m.x), abs(m.z));
  if (size == 0.0) { return Complex(vec4f(0.0), 0); }
  let shift = i32(floor(log2(size)));
  return Complex(ldexp(m, vec4i(-shift)), e + shift);
}
fn scalar(value: f32) -> Complex { return norm(vec4f(value, 0.0, 0.0, 0.0), 0); }
fn add(a: Complex, b: Complex) -> Complex {
  if (all(a.m == vec4f(0.0))) { return b; }
  if (all(b.m == vec4f(0.0))) { return a; }
  if (a.e - b.e > 100) { return a; }
  if (b.e - a.e > 100) { return b; }
  let e = max(a.e, b.e);
  let av = ldexp(a.m, vec4i(a.e - e)); let bv = ldexp(b.m, vec4i(b.e - e));
  return norm(vec4f(ds_sum(av.xy, bv.xy), ds_sum(av.zw, bv.zw)), e);
}
fn mul(a: Complex, b: Complex) -> Complex {
  return norm(vec4f(ds_sum(ds_mul(a.m.xy, b.m.xy), -ds_mul(a.m.zw, b.m.zw)), ds_sum(ds_mul(a.m.xy, b.m.zw), ds_mul(a.m.zw, b.m.xy))), a.e + b.e);
}
fn log_size(z: Complex) -> f32 {
  if (all(z.m == vec4f(0.0))) { return -1e20; }
  return f32(z.e) + 0.5 * log2(dot(z.m.xz, z.m.xz));
}
fn log_sum(a: f32, b: f32) -> f32 {
  return max(a, b) + log2(1.0 + exp2(-min(120.0, abs(a - b))));
}
fn reference_at(index: u32) -> Complex {
  return Complex(reference[2u * index], i32(reference[2u * index + 1u].x));
}
fn sample(point: Complex) -> f32 {
  let morph = vec2f(bitcast<f32>(u.extra.y), bitcast<f32>(u.extra.z));
  let dc = mul(point, norm(vec4f(ds_sum(vec2f(1.0, 0.0), -morph), 0.0, 0.0), 0));
  var delta = mul(point, norm(vec4f(morph, 0.0, 0.0), 0));
  var m = 0u;
  let initial = reference_at(0u);
  let dc_size = log_size(dc);
  var error_log = -1e20;
  for (var n = 0u; n < u.size.y; n++) {
    let z = reference_at(m);
    let zs = log_size(z); let ds = log_size(delta);
    let propagated = error_log + 1.0 + log_sum(zs, ds);
    let rounding = max(max(zs + ds + 1.0, ds * 2.0), dc_size) - 42.0;
    error_log = log_sum(propagated, rounding);
    delta = add(add(mul(Complex(z.m, z.e + 1), delta), mul(delta, delta)), dc);
    m++;
    let next = reference_at(m);
    let actual = add(next, delta);
    let size = log_size(actual);
    if (max(error_log, log_size(next) - 44.0) > size - 16.0) { return -1.0; }
    if (size > 4.0) { return max(1e-7, f32(n) + 2.0 - log2(size * 0.6931471805599453)); }
    // Near cancellation, recompute this pixel in the CPU's higher precision.
    if (size < log_size(next) - 36.0) { return -1.0; }
    if (size < log_size(delta) || m + 1u >= u.extra.x) {
      delta = add(actual, Complex(-initial.m, initial.e)); m = 0u;
      error_log = log_sum(error_log, log_size(next) - 43.0);
    }
  }
  return 0.0;
}
fn fraction(a: f32, b: f32) -> vec2f {
  let hi = a / b;
  let remainder = ds_sum(vec2f(a, 0.0), -ds_mul(vec2f(hi, 0.0), vec2f(b, 0.0)));
  return ds_sum(vec2f(hi, 0.0), vec2f((remainder.x + remainder.y) / b, 0.0));
}
@compute @workgroup_size(8, 8)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.size.z || gid.y >= u.size.w) { return; }
  let px = fraction(f32(2u * gid.x + 1u) - f32(u.size.z), 2.0 * f32(u.size.z));
  let py = fraction(f32(2u * gid.y + 1u) - f32(u.size.w), 2.0 * f32(u.size.w));
  let r = ds_sum(vec2f(u.offset.x, u.tail.x), ds_mul(px, vec2f(u.offset.z, u.tail.z)));
  let i = ds_sum(vec2f(u.offset.y, u.tail.y), ds_mul(py, vec2f(u.offset.w, u.tail.w)));
  raw[gid.y * u.size.z + gid.x] = sample(norm(vec4f(r, -i), bitcast<i32>(u.size.x)));
}
`,cn={minSpan:Nt,threshold:Lt,gpu:{computeWgsl:sn,entryPoint:"simulate",uniformBytes:64},async begin(e,n,a){if(a.aborted)throw new DOMException("Superseded","AbortError");const i=new ln;let m=0;const d=new Map,u=f=>{i.terminate();for(const x of d.values())x.reject(f);d.clear()};a.addEventListener("abort",()=>u(new DOMException("Superseded","AbortError")),{once:!0}),i.onerror=f=>u(new Error(f.message)),i.onmessageerror=()=>u(new Error("Deep worker message failed")),i.onmessage=f=>{const x=d.get(f.data.id);x&&(d.delete(f.data.id),f.data.error?x.reject(new Error(f.data.error)):x.resolve(f.data))};const c=f=>new Promise((x,w)=>{if(a.aborted){w(new DOMException("Superseded","AbortError"));return}const N=m++;d.set(N,{resolve:x,reject:w}),i.postMessage({...f,id:N})}),b=(f,x=0)=>{const w=f.center,N=f.storage,X=async(_,M,y,S)=>(await c({view:_,width:M,height:y,samples:S,referenceId:f.id})).samples;return{needsRefinement:_=>_.some(M=>M<0||!Number.isFinite(M)),mergeRefinement(_,M){for(let y=0;y<_.length;y++)(_[y]<0||!Number.isFinite(_[y]))&&(_[y]=M[y]);return _},gpu:{storage:N,packUniforms:(_,M,y)=>an(_,M,y,w,N.length/8,n)},async refineTile(_,M,y,S){if(x>=Wt)return null;const T=[];for(let L=0;L<_.length;L++)(_[L]<0||!Number.isFinite(_[L]))&&T.push(L);if(T.length<Dt)return null;const oe=T[Math.floor(T.length/2)],me=lt(M),fe=ue(M),pe=we(M),ge={x:me.x+Z(((oe%y+.5)/y-.5)*fe),y:me.y+Z(((Math.floor(oe/y)+.5)/S-.5)*pe)};return b(await c({view:Tt(ge,fe,pe),params:n}),x+1)},fillTile:(_,M,y)=>X(_,M,y),repairTile:(_,M,y,S)=>_.some(T=>T<0||!Number.isFinite(T))?X(M,y,S,_):Promise.resolve(_)}};return b(await c({view:e,params:n}))}};function un(e){return new Worker(""+new URL("tile-worker-CLTabr7K.js",import.meta.url).href,{type:"module",name:e?.name})}let k=null,dn=1,Ne=0;const ee=new Map,re=[],ft=[];function De(){const e=typeof navigator>"u"?4:navigator.hardwareConcurrency??4;return Math.max(1,Math.min(Ot,e-1))}function mn(){return De()}function fn(){const e=re.pop();return e?Promise.resolve(e):new Promise(n=>ft.push(n))}function Ue(e){if(!k?.includes(e))return;const n=ft.shift();n?n(e):re.push(e)}function pn(e){const n=ee.get(e.data.id);if(n){if(ee.delete(e.data.id),!e.data.buffer||e.data.error){n.reject(new Error(e.data.error??"Mandelbrot CPU worker returned no buffer"));return}n.resolve(e.data.buffer)}}function Fe(){const e=new un;return e.onmessage=pn,e.onerror=n=>at(e,new Error(n.message||"Mandelbrot CPU worker failed")),e.onmessageerror=()=>at(e,new Error("Mandelbrot CPU worker message error")),e}function at(e,n){for(const[d,u]of ee)u.worker===e&&(ee.delete(d),u.reject(n));const a=re.indexOf(e);if(a>=0&&re.splice(a,1),!k)return;const i=k.indexOf(e);if(i<0)return;k.splice(i,1);try{e.terminate()}catch{}const m=Fe();k.push(m),Ue(m)}function gn(){if(!k)return;Ne+=1;const e=new Set(k);k=[],re.length=0;const n=new Error("Mandelbrot CPU tile superseded by a newer camera");n.name="AbortError";for(const[a,i]of ee)e.has(i.worker)&&(ee.delete(a),i.reject(n));for(const a of e)try{a.terminate()}catch{}for(let a=0;a<De();a++){const i=Fe();k.push(i),Ue(i)}}function hn(){if(!k){k=[];for(let e=0;e<De();e++){const n=Fe();k.push(n),re.push(n)}}}function bn(e,n){return new Promise((a,i)=>{ee.set(n.id,{worker:e,resolve:a,reject:i}),e.postMessage(n)})}async function xn(e,n,a,i){hn();const m=Ne,d=await fn();try{if(m!==Ne){const c=new Error("Mandelbrot CPU tile superseded before dispatch");throw c.name="AbortError",c}const u=await bn(d,{id:dn++,width:Math.max(1,Math.round(n)),height:Math.max(1,Math.round(a)),xMin:e.xMin,xMax:e.xMax,yMin:e.yMin,yMax:e.yMax,maxIter:Math.max(Ee,Math.round(i.MAX_ITERATIONS??de)),morph:i.MORPH??0,juliaReal:i.JULIA_REAL??Le,juliaImag:i.JULIA_IMAG??We});return new Float32Array(u)}finally{Ue(d)}}const yn=`struct Uniforms {
  view: vec4f,
  orbit: vec4f, // morph, Julia real, Julia imaginary, escape radius squared
  pad: vec4f,
  size: vec4u,
  extra: vec4u,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> raw: array<f32>;

fn escape_time(point: vec2f) -> f32 {
  let morph = u.orbit.x;
  if (morph == 0.0) {
    let x = point.x - 0.25;
    let y2 = point.y * point.y;
    let q = x * x + y2;
    if (q * (q + x) <= 0.25 * y2 || (point.x + 1.0) * (point.x + 1.0) + y2 <= 0.0625) { return 0.0; }
  }
  let c = (1.0 - morph) * point + morph * u.orbit.yz;
  var z = morph * point;
  for (var n = 0u; n < u.size.x; n++) {
    z = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    let r2 = dot(z, z);
    if (r2 > u.orbit.w) {
      return max(1e-7, f32(n) + 2.0 - log2(0.5 * log(r2)));
    }

  }
  return 0.0;
}

@compute @workgroup_size(8, 8)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.size.y || gid.y >= u.size.z) { return; }
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / vec2f(u.size.yz);
  let point = vec2f(mix(u.view.x, u.view.y, uv.x), -mix(u.view.z, u.view.w, uv.y));
  raw[gid.y * u.size.y + gid.x] = escape_time(point);
}
`;function Mn(e,n,a,i,m){const d=new ArrayBuffer(80),u=new Float32Array(d),c=new Uint32Array(d);u.set([e.xMin,e.xMax,e.yMin,e.yMax]),u.set([i.MORPH??0,i.JULIA_REAL??Le,i.JULIA_IMAG??We,kt],4),c[12]=Math.max(Ee,Math.round(i.MAX_ITERATIONS??de)),c[13]=n,c[14]=a;const b=Rt(e,m.normView??e,n,a);return c[17]=b.y0<<16|b.x0,c[18]=b.y1<<16|b.x1,c[19]=1,d}const _n={id:"mandelbrot",precision:cn,title:"Mandelbrot & Julia",settledResolution:{gpu:"device",cpu:"device"},defaultView:st,worldView:St,workBudget:{param:"MAX_ITERATIONS",min:Ee,max:Ye,step:Ke,adaptive:!1},params:[{key:"MORPH",label:"param.mandelbrot.morph",kind:"float",min:0,max:1,step:Bt,default:0,digits:3,section:"primary"},{key:"JULIA_REAL",label:"param.mandelbrot.real",kind:"float",min:-Me,max:Me,step:Qe,default:Le,digits:3,section:"primary"},{key:"JULIA_IMAG",label:"param.mandelbrot.imag",kind:"float",min:-Me,max:Me,step:Qe,default:We,digits:3,section:"primary"},{key:"MAX_ITERATIONS",label:"param.mandelbrot.iterations",kind:"int",min:Ee,max:Ye,step:Ke,default:de,scale:"log",section:"secondary"}],gpu:{computeWgsl:yn,entryPoint:"simulate",uniformBytes:80,tileSize:128,dispatchBatch:1,packUniforms:Mn},cpu:{fillTile:xn,cancelPending:gn,concurrency:mn(),handoffPx:Ct}};async function vn(){await It(),await At(_n,on),Pt(),zt()}vn();
