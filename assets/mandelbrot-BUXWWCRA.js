import{q as Xe,x as Z,C as Ge,o as xt,t as ye,v as fe,a as ve,y as J,b as yt,s as Mt,z as _t,A as at,B as vt,n as wt,l as Et,c as Tt,d as Rt,e as It}from"./menu-CzDvZvqG.js";const lt={xMin:-2.25,xMax:1.25,yMin:-1.35,yMax:1.35},At={xMin:-3,xMax:3,yMin:-3,yMax:3},we=128,qe=262144,me=768,Ye=64,zt=4,Pt=.25,St=256,Be=-.8,We=.156,Me=2,Ke=.001,Ot=.001,st=64,ct=4,V=[0,.16,.36,.44,.56,.76,1],Ct=1e-280,kt=.01,Nt=4,Lt=8,Qe=65,K=3,Bt=4,Wt=2,ke=20,Dt=500,Ut=128,Ft=320,$t=247,Ht=2.25,Ze="mandelbrot-show-orbit",de=[0,.35,.7,1],jt=.75,et=3,Jt=4,Vt=300,Xt=24,tt=180,nt=100,Ne=.5,Gt=.3,qt=e=>Number.isFinite(e)&&e<=-2?Math.floor(-e)-1:0;let _e=null;function ut(){if(_e)return _e;const e=getComputedStyle(document.documentElement);return _e=V.map((n,a)=>{const o=e.getPropertyValue(`--mandelbrot-color-${a}`).trim();if(!/^#[\da-f]{6}$/i.test(o))throw new Error(`Missing Mandelbrot palette color ${a}`);return[1,3,5].map(f=>parseInt(o.slice(f,f+2),16)/255)}),_e}function dt(e){if(!(e>0)||!Number.isFinite(e))return[0,0,0];const n=Math.max(0,e-ct)/st%1,a=ut();for(let o=1;o<V.length;o++){if(n>V[o])continue;const f=(n-V[o-1])/(V[o]-V[o-1]),u=f*f*(3-2*f);return a[o-1].map((c,s)=>c+u*(a[o][s]-c))}return a[0]}const Yt={get gpuWgsl(){const e=ut(),n=o=>`vec3f(${o.map(f=>f.toFixed(9)).join(", ")})`,a=V.slice(1).map((o,f)=>`
      if (t <= ${o.toFixed(6)}) {
        return mix(${n(e[f])}, ${n(e[f+1])},
          smoothstep(${V[f].toFixed(6)}, ${o.toFixed(6)}, t));
      }`).join(`
`);return`
      fn mandelbrot_color(sample: f32) -> vec3f {
        if (sample <= 0.0) { return vec3f(0.0); }
        let t = fract(max(0.0, sample - ${ct.toFixed(1)}) / ${st.toFixed(1)});
        ${a}
        return ${n(e[0])};
      }
      fn map_sample_color(uv: vec2f, inverted: bool) -> vec3f {
        let pixel = vec2i(round(uv * vec2f(draw.size) - vec2f(0.5)));
        let color = mandelbrot_color(raw_at(pixel.x, pixel.y));
        return select(color, vec3f(1.0) - color, inverted);
      }
    `},colorize(e,n,a){const o=dt(e);return a?[1-o[0],1-o[1],1-o[2]]:o},exposure:"none",initialMedian:1};function rt(e){const n=e.MORPH??0,a=lt,o=Ht;return{xMin:a.xMin*(1-n)-o*n,xMax:a.xMax*(1-n)+o*n,yMin:a.yMin*(1-n)-o*n,yMax:a.yMax*(1-n)+o*n}}function Kt(e,n){const a=Z(n);return{x:e.x*a/Ge,y:e.y*a/Ge}}function Q(e,n,a){return Number.isFinite(e.r+e.i)&&e.r>=0&&e.r<=n&&e.i>=0&&e.i<=a}function Qt(e,n){const a=Math.min(Vt,Math.max(Jt,Math.ceil(-Math.log10(n))+1)),o=Xe(e.x,a),f=Xe(-e.y,a),u=x=>x.length>Xt?`${x.slice(0,12)}…${x.slice(-8)}`:x,c=f.startsWith("-"),s=c?f.slice(1):f;return{x:o,y:f,complex:`${o} ${c?"−":"+"} ${s}i`,shortX:u(o),shortY:u(f),shortComplex:`${u(o)} ${c?"−":"+"} ${u(s)}i`}}function Zt(e,n,a,o){e={...e},n={...n};const f=c=>(c.r<0?1:c.r>a?2:0)|(c.i<0?4:c.i>o?8:0),u=(c,s,x,m,y)=>Math.abs(y-x)<Math.abs(y-m)?c+(s-c)*((y-x)/(m-x)):s+(c-s)*((y-m)/(x-m));for(let c=0;c<8;c++){const s=f(e),x=f(n);if(!(s|x))return[e,n];if(s&x)return null;const m=s||x;let y;if(m&12){const w=m&4?0:o;y={r:u(e.r,n.r,e.i,n.i,w),i:w}}else{const w=m&1?0:a;y={r:w,i:u(e.i,n.i,e.r,n.r,w)}}if(!Number.isFinite(y.r+y.i))return null;s?e=y:n=y}return null}function it(e){return new Worker(""+new URL("orbit-worker--t5hRNdS.js",import.meta.url).href,{type:"module",name:e?.name})}function en(e){const n=document.createElement("canvas");n.id="probe-overlay",n.setAttribute("aria-hidden","true");const a=document.createElement("div");a.className="mandelbrot-orbit-inset",a.hidden=!0;const o=document.createElement("div");o.className="mandelbrot-orbit-title";const f=document.createElement("div");f.className="mandelbrot-orbit-label";const u=document.createElement("canvas");u.setAttribute("aria-hidden","true");const c=document.createElement("div");c.className="mandelbrot-orbit-legend";const s=document.createElement("span");s.textContent="z₀";const x=document.createElement("span");x.className="mandelbrot-orbit-ramp";const m=document.createElement("span");m.textContent="zₙ";const y=document.createElement("div");y.className="mandelbrot-orbit-coordinates";const w=document.createElement("em");y.append(w),c.append(s,x,m),a.append(o,u,y,c,f),e.clip.append(a,n);const W=getComputedStyle(document.documentElement),O=t=>W.getPropertyValue(`--orbit-${t}`).trim(),b=O("line"),v=O("outline"),M=O("dot"),N=O("connector"),R=O("axis"),pe=O("axis-text"),ge=t=>[1,3,5].map(r=>parseInt(t.slice(r,r+2),16)),ie=de.map((t,r)=>ge(O(`gradient-${r}`))),X=document.createElement("canvas");let oe="",I=null,he=!1,ae=!0,D=null,U=null,G=null,Ee=0,q=0,te=!1,Te=!1,le=!1,C=null,A=null,F=null,be=0,Re=-1,Ie=0,Ae=0,$=null;function ze(t){const r=Math.max(0,Math.min(1,t));let i=1;for(;i<de.length-1&&r>de[i];)i++;const d=de[i-1],l=de[i],h=(r-d)/(l-d);return`rgb(${ie[i-1].map((g,_)=>Math.round(g+h*(ie[i][_]-g))).join(" ")})`}function ne(){const t=A?qt(A.sample):0;if(f.textContent=A?t?ye("mandelbrot.orbit.period").replace("{period}",String(t)):ye(A.sample>0?"mandelbrot.orbit.escape":"mandelbrot.orbit.unknown").replace("{steps}",String(A.steps)):ye(C?le?"mandelbrot.orbit.error":"mandelbrot.orbit.loading":"mandelbrot.orbit.idle"),o.textContent=ye("mandelbrot.orbit.title"),f.dataset.period=String(t),C){const r=e.getView(),i=Qt(C,fe(r)/Math.max(1,e.clip.clientWidth));w.textContent=i.shortComplex.replace(/-/g,"−"),w.title=i.complex.replace(/-/g,"−")}else w.textContent="—",w.title="";a.dataset.animating=n.dataset.animating=String(te)}xt(()=>{ne(),j(performance.now())});function mt(){if(D)return D;const t=new it;return D=t,t.onmessage=r=>{if(D!==t)return;const i=r.data;if(i.kind==="trace"){if(U=null,i.id===q&&C){const d=performance.now();i.trace&&(A?($=A,Ae=d):Ie=d,A=i.trace),le=!i.trace,ne(),j(d)}Pe()}},t.onerror=()=>{D===t&&(t.terminate(),D=null,U=null,G=null,le=!0,ne())},t}function pt(){const t={...e.params},r=JSON.stringify(t);if(oe===r&&(he||I))return;I?.terminate(),he=!1,oe=r;const i=new it;I=i,i.onmessage=d=>{const l=d.data;if(I!==i||l.kind!=="overview"||l.key!==oe)return;X.width=l.width,X.height=l.height;const h=X.getContext("2d"),p=h.createImageData(l.width,l.height);for(let g=0;g<l.samples.length;g++){const _=dt(l.samples[g]);p.data.set([..._.map(z=>Math.round(z*255)),255],g*4)}h.putImageData(p,0,0),he=!0,u.dataset.overviewParams=r,i.terminate(),I=null,j(performance.now())},i.onerror=()=>{I===i&&(i.terminate(),I=null)},i.postMessage({kind:"overview",key:r,width:Ft,height:$t,view:rt(t),params:t})}function Pe(){U||!G||(U=G,G=null,mt().postMessage({kind:"trace",id:U.id,job:U.job}))}function se(){q++,window.clearTimeout(Ee),D?.terminate(),D=null,U=null,G=null,C=null,A=null,$=null,F=null,le=!1,te=!1,a.dataset.animating=n.dataset.animating="false",n.dataset.mode="hidden",!ae&&I&&(I.terminate(),I=null),ne(),j(performance.now())}function $e(t,r){if(!ae)return;const i=e.snapToRenderedPixel(e.clientToWorld(t,r)),d=e.getView(),l={x:(d.origin?.x??0n)+Z(i.x),y:(d.origin?.y??0n)+Z(i.y)};if(C?.x===l.x&&C?.y===l.y)return;q++,window.clearTimeout(Ee),te=!1,le=!1,U?.full&&(D?.terminate(),D=null,U=null),C=l,F={point:l,span:Math.min(fe(d),ve(d)),params:{...e.params},f32:!(e.samplesF64?.()??!1)},G={id:q,job:{...F,params:{...F.params,MAX_ITERATIONS:Math.min(Ut,F.params.MAX_ITERATIONS??me)}},full:!1},Pe(),ne(),j(performance.now());const h=q;Ee=window.setTimeout(()=>{h!==q||!F||(te=!0,be=performance.now(),Re=-1,G={id:q,job:F,full:!0},Pe(),ne(),j(be))},Dt)}function He(t){const r=Math.min(devicePixelRatio||1,Wt),i=Math.round(t.clientWidth*r),d=Math.round(t.clientHeight*r);(t.width!==i||t.height!==d)&&(t.width=i,t.height=d);const l=t.getContext("2d");return l&&(l.setTransform(r,0,0,r,0,0),l.clearRect(0,0,t.clientWidth,t.clientHeight)),l}function ce(t,r,i,d){Number.isFinite(r.r+r.i)&&(t.beginPath(),t.arc(r.r,r.i,i,0,Math.PI*2),t.fillStyle=d,t.fill(),t.lineWidth=1.5,t.strokeStyle=v,t.stroke())}function Se(t,r,i){t.font="italic 12px Georgia, serif",t.lineWidth=3,t.strokeStyle=v,t.fillStyle=b,t.strokeText(i,r.r+7,r.i-7),t.fillText(i,r.r+7,r.i-7)}function gt(t,r){const i=t.path,d=t.cycle.length;if(d)for(let l=d;l+d<=i.length;l++){let h=!0;for(let p=0;p<d;p++){const g=r(i[l+p]),_=r(i[l-d+p]);if(Math.hypot(g.r-_.r,g.i-_.i)>jt){h=!1;break}}if(h)return i.slice(0,l+1)}return i}function je(t,r,i,d,l,h){if(l<=0)return;t.save(),t.globalAlpha=l;const p=gt(r,i),g=Math.max(1,p.length-1),_=p.slice(1).map((E,P)=>Zt(i(p[P]),i(E),t.canvas.clientWidth,t.canvas.clientHeight));t.lineJoin="round",t.lineCap="round";const z=t.canvas===n;if(_.forEach((E,P)=>{if(!E)return;const[k,B]=E,S=t.createLinearGradient(k.r,k.i,B.r,B.i);S.addColorStop(0,ze(P/g)),S.addColorStop(1,ze((P+1)/g)),t.beginPath(),t.moveTo(k.r,k.i),t.lineTo(B.r,B.i),t.strokeStyle=S,t.lineWidth=z?Ne:Gt,t.stroke()}),r.cycle.forEach(E=>{const P=i(E);Q(P,t.canvas.clientWidth,t.canvas.clientHeight)&&(t.beginPath(),t.arc(P.r,P.i,Bt,0,Math.PI*2),t.strokeStyle=b,t.lineWidth=1,t.stroke())}),h&&te){const E=Math.floor((d-be)/Qe),P=r.cycle.length;for(let k=et-1;k>=0;k--){const B=E-k;if(B<0)continue;const S=B<p.length?B:P?p.length-P+(B-p.length)%P:p.length-1,H=p[S];if(!H)continue;const Y=i(H);Q(Y,t.canvas.clientWidth,t.canvas.clientHeight)&&(t.globalAlpha=l*(1-k/et),ce(t,Y,K,ze(S/g)))}}t.restore()}function Je(t,r,i){if(!A)return;const d=(p,g)=>{const _=Math.max(0,Math.min(1,p/g));return _*_*(3-2*_)},l=d(i-Ie,tt),h=$?d(i-Ae,nt):1;$&&je(t,$,r,i,l*(1-h),!1),je(t,A,r,i,l*h,!0),n.dataset.orbitOpacity=String(l)}function ht(t,r){const i=r({r:0,i:0}),d=u.clientWidth,l=u.clientHeight,h=ke;t.beginPath(),t.moveTo(h,i.i),t.lineTo(d-h,i.i),t.moveTo(i.r,h),t.lineTo(i.r,l-h),t.strokeStyle=R,t.lineWidth=1,t.stroke(),t.font="10px system-ui",t.lineWidth=3,t.strokeStyle=v,t.fillStyle=pe;const p=(g,_,z)=>{t.strokeText(g,_,z),t.fillText(g,_,z)};for(let g=-2;g<=2;g++){const _=r({r:g,i:0}).r,z=r({r:0,i:g}).i;_>=h&&_<=d-h&&p(String(g),_+3,i.i+12),g&&z>=h&&z<=l-h&&(t.font="italic 12px Georgia, serif",p(g===1?"i":g===-1?"−i":`${g<0?"−":""}${Math.abs(g)}i`,i.r+4,z-3),t.font="10px system-ui")}}function j(t){const r=He(n);if(a.hidden=!ae,!r||!ae){n.dataset.mode="hidden";return}pt();const i=He(u);if(!i)return;const d=e.getView(),l=n.clientWidth,h=n.clientHeight,p=rt(e.params),g=Math.min((u.clientWidth-2*ke)/(p.xMax-p.xMin),(u.clientHeight-2*ke)/(p.yMax-p.yMin)),_=T=>({r:u.clientWidth/2+(T.r-(p.xMin+p.xMax)/2)*g,i:u.clientHeight/2+(-T.i-(p.yMin+p.yMax)/2)*g});if(he){const T=_({r:p.xMin,i:-p.yMin}),ue=_({r:p.xMax,i:-p.yMax});i.drawImage(X,T.r,T.i,ue.r-T.r,ue.i-T.i)}if(ht(i,_),!C||!F){n.dataset.mode="preview",n.dataset.connector="false";return}const z=T=>({r:(J(T.x-(d.origin?.x??0n))-d.xMin)/fe(d)*l,i:(J(T.y-(d.origin?.y??0n))-d.yMin)/ve(d)*h}),E=z(C),P={r:J(C.x),i:-J(C.y)},k=Kt(C,F.params.MORPH??0),B={r:J(k.x),i:-J(k.y)},S=z(k),H=_(B),Y=_(P),bt=T=>T===A?.path[0]||T===$?.path[0]?S:z({x:Z(T.r),y:Z(-T.i)}),Oe=Q(S,l,h);n.dataset.mode=Oe?"map":"inset",Je(i,_,t);const Ce=Oe&&Q(E,l,h);if(n.dataset.connector=String(Ce),!Ce&&Q(E,l,h)){const T=u.getBoundingClientRect(),ue=e.clip.getBoundingClientRect();r.beginPath(),r.moveTo(T.left-ue.left+H.r,T.top-ue.top+H.i),r.lineTo(E.r,E.i),r.strokeStyle=N,r.lineWidth=Ne,r.stroke()}const xe=a.getBoundingClientRect(),Ve=n.getBoundingClientRect();r.save(),r.beginPath(),r.rect(0,0,l,h),r.rect(xe.left-Ve.left,xe.top-Ve.top,xe.width,xe.height),r.clip("evenodd"),Oe&&Je(r,bt,t),$&&t-Ae>=nt&&($=null),Ce&&(r.setLineDash([4,4]),r.beginPath(),r.moveTo(S.r,S.i),r.lineTo(E.r,E.i),r.strokeStyle=N,r.lineWidth=Ne,r.stroke(),r.setLineDash([])),Q(E,l,h)&&(ce(r,E,K,b),r.beginPath(),r.arc(E.r,E.i,K+4,0,Math.PI*2),r.strokeStyle=b,r.lineWidth=1,r.stroke()),Q(S,l,h)&&(ce(r,S,K,M),Se(r,S,"z₀")),r.restore(),ce(i,Y,K,b),Math.hypot(Y.r-H.r,Y.i-H.i)>K*2&&Se(i,Y,"p"),ce(i,H,K,M),Se(i,H,"z₀"),a.dataset.pathPoints=n.dataset.pathPoints=String(A?.path.length??0)}return e.clip.addEventListener("pointermove",t=>{if(t.buttons||t.pointerType==="touch"){t.buttons&&se();return}Te=!1,$e(t.clientX,t.clientY)}),e.clip.addEventListener("pointerdown",se),e.clip.addEventListener("pointerleave",()=>{Te||se()}),{clear:se,setEnabled(t){ae=t,se()},draw:()=>j(performance.now()),tick(t){const r=Math.floor((t-be)/Qe);A&&(t-Ie<tt||$||Number(n.dataset.orbitOpacity)<1||te&&r!==Re)&&(Re=r,j(t))},pickPoint(t,r,i,d,l){return l==="touch"&&(Te=!0,$e(i,d)),!1}}}const tn={compositor:Yt,mount(e){const n=en(e),a=document.querySelector("#show-orbit");try{a.checked=localStorage.getItem(Ze)!=="false"}catch{}n.setEnabled(a.checked),a.addEventListener("change",()=>{n.setEnabled(a.checked);try{localStorage.setItem(Ze,String(a.checked))}catch{}});const o=yt(e.map,e.controls,e.onParamsChange,e.resetTransition,e.signals),f=["JULIA_REAL","JULIA_IMAG"].map(s=>document.querySelector(`[data-param-value="${s}"]`)?.closest("label"));let u=-1;function c(){const s=e.params.MORPH??0;if(s!==u){u=s;for(const x of f){x?.classList.toggle("is-inactive",s===0);const m=x?.querySelector("input");m&&(m.disabled=s===0)}}}return c(),{..._t,draw(){c(),n.draw()},tick(s){c(),n.tick(s)},reset(){c(),n.clear()},noteActivity:n.clear,resize:n.draw,pickPoint:n.pickPoint,dismiss:()=>o.setOpen(!1),syncBudget:Mt}}};function nn(e,n,a,o,f,u){const c=new ArrayBuffer(64),s=new Float32Array(c),x=new Int32Array(c),m=new Uint32Array(c),y=at(e),w=fe(e),W=ve(e),O=J(y.x-o.x),b=J(y.y-o.y),v=Math.floor(Math.log2(Math.max(w,W,Math.abs(O),Math.abs(b)))),M=2**v,N=[O/M,b/M,w/M,W/M];for(let R=0;R<N.length;R++)s[R]=N[R],s[R+4]=N[R]-s[R];return x[8]=v,m[9]=Math.round(u.MAX_ITERATIONS??me),m[10]=n,m[11]=a,m[12]=f,s[13]=u.MORPH??0,s[14]=(u.MORPH??0)-s[13],c}function rn(e){return new Worker(""+new URL("deep-worker-CmkTMtmv.js",import.meta.url).href,{type:"module",name:e?.name})}const on=`struct Uniforms { offset: vec4f, tail: vec4f, size: vec4u, extra: vec4u }
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
`,an={minSpan:Ct,threshold:kt,gpu:{computeWgsl:on,entryPoint:"simulate",uniformBytes:64},async begin(e,n,a){if(a.aborted)throw new DOMException("Superseded","AbortError");const o=new rn;let f=0;const u=new Map,c=m=>{o.terminate();for(const y of u.values())y.reject(m);u.clear()};a.addEventListener("abort",()=>c(new DOMException("Superseded","AbortError")),{once:!0}),o.onerror=m=>c(new Error(m.message)),o.onmessageerror=()=>c(new Error("Deep worker message failed")),o.onmessage=m=>{const y=u.get(m.data.id);y&&(u.delete(m.data.id),m.data.error?y.reject(new Error(m.data.error)):y.resolve(m.data))};const s=m=>new Promise((y,w)=>{if(a.aborted){w(new DOMException("Superseded","AbortError"));return}const W=f++;u.set(W,{resolve:y,reject:w}),o.postMessage({...m,id:W})}),x=(m,y=0)=>{const w=m.center,W=m.storage,O=async(b,v,M,N)=>(await s({view:b,width:v,height:M,samples:N,referenceId:m.id})).samples;return{needsRefinement:b=>b.some(v=>v<0||!Number.isFinite(v)),mergeRefinement(b,v){for(let M=0;M<b.length;M++)(b[M]<0||!Number.isFinite(b[M]))&&(b[M]=v[M]);return b},gpu:{storage:W,packUniforms:(b,v,M)=>nn(b,v,M,w,W.length/8,n)},async refineTile(b,v,M,N){if(y>=Nt)return null;const R=[];for(let I=0;I<b.length;I++)(b[I]<0||!Number.isFinite(b[I]))&&R.push(I);if(R.length<Lt)return null;const pe=R[Math.floor(R.length/2)],ge=at(v),ie=fe(v),X=ve(v),oe={x:ge.x+Z(((pe%M+.5)/M-.5)*ie),y:ge.y+Z(((Math.floor(pe/M)+.5)/N-.5)*X)};return x(await s({view:vt(oe,ie,X),params:n}),y+1)},fillTile:(b,v,M)=>O(b,v,M),repairTile:(b,v,M,N)=>b.some(R=>R<0||!Number.isFinite(R))?O(v,M,N,b):Promise.resolve(b)}};return x(await s({view:e,params:n}))}};function ln(e){return new Worker(""+new URL("tile-worker-CLTabr7K.js",import.meta.url).href,{type:"module",name:e?.name})}let L=null,sn=1,Le=0;const ee=new Map,re=[],ft=[];function De(){const e=typeof navigator>"u"?4:navigator.hardwareConcurrency??4;return Math.max(1,Math.min(zt,e-1))}function cn(){return De()}function un(){const e=re.pop();return e?Promise.resolve(e):new Promise(n=>ft.push(n))}function Ue(e){if(!L?.includes(e))return;const n=ft.shift();n?n(e):re.push(e)}function dn(e){const n=ee.get(e.data.id);if(n){if(ee.delete(e.data.id),!e.data.buffer||e.data.error){n.reject(new Error(e.data.error??"Mandelbrot CPU worker returned no buffer"));return}n.resolve(e.data.buffer)}}function Fe(){const e=new ln;return e.onmessage=dn,e.onerror=n=>ot(e,new Error(n.message||"Mandelbrot CPU worker failed")),e.onmessageerror=()=>ot(e,new Error("Mandelbrot CPU worker message error")),e}function ot(e,n){for(const[u,c]of ee)c.worker===e&&(ee.delete(u),c.reject(n));const a=re.indexOf(e);if(a>=0&&re.splice(a,1),!L)return;const o=L.indexOf(e);if(o<0)return;L.splice(o,1);try{e.terminate()}catch{}const f=Fe();L.push(f),Ue(f)}function fn(){if(!L)return;Le+=1;const e=new Set(L);L=[],re.length=0;const n=new Error("Mandelbrot CPU tile superseded by a newer camera");n.name="AbortError";for(const[a,o]of ee)e.has(o.worker)&&(ee.delete(a),o.reject(n));for(const a of e)try{a.terminate()}catch{}for(let a=0;a<De();a++){const o=Fe();L.push(o),Ue(o)}}function mn(){if(!L){L=[];for(let e=0;e<De();e++){const n=Fe();L.push(n),re.push(n)}}}function pn(e,n){return new Promise((a,o)=>{ee.set(n.id,{worker:e,resolve:a,reject:o}),e.postMessage(n)})}async function gn(e,n,a,o){mn();const f=Le,u=await un();try{if(f!==Le){const s=new Error("Mandelbrot CPU tile superseded before dispatch");throw s.name="AbortError",s}const c=await pn(u,{id:sn++,width:Math.max(1,Math.round(n)),height:Math.max(1,Math.round(a)),xMin:e.xMin,xMax:e.xMax,yMin:e.yMin,yMax:e.yMax,maxIter:Math.max(we,Math.round(o.MAX_ITERATIONS??me)),morph:o.MORPH??0,juliaReal:o.JULIA_REAL??Be,juliaImag:o.JULIA_IMAG??We});return new Float32Array(c)}finally{Ue(u)}}const hn=`struct Uniforms {
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
`;function bn(e,n,a,o,f){const u=new ArrayBuffer(80),c=new Float32Array(u),s=new Uint32Array(u);c.set([e.xMin,e.xMax,e.yMin,e.yMax]),c.set([o.MORPH??0,o.JULIA_REAL??Be,o.JULIA_IMAG??We,St],4),s[12]=Math.max(we,Math.round(o.MAX_ITERATIONS??me)),s[13]=n,s[14]=a;const x=wt(e,f.normView??e,n,a);return s[17]=x.y0<<16|x.x0,s[18]=x.y1<<16|x.x1,s[19]=1,u}const xn={id:"mandelbrot",precision:an,title:"Mandelbrot & Julia",settledResolution:{gpu:"device",cpu:"device"},defaultView:lt,worldView:At,workBudget:{param:"MAX_ITERATIONS",min:we,max:qe,step:Ye,adaptive:!1},params:[{key:"MORPH",label:"param.mandelbrot.morph",kind:"float",min:0,max:1,step:Ot,default:0,digits:3,section:"primary"},{key:"JULIA_REAL",label:"param.mandelbrot.real",kind:"float",min:-Me,max:Me,step:Ke,default:Be,digits:3,section:"primary"},{key:"JULIA_IMAG",label:"param.mandelbrot.imag",kind:"float",min:-Me,max:Me,step:Ke,default:We,digits:3,section:"primary"},{key:"MAX_ITERATIONS",label:"param.mandelbrot.iterations",kind:"int",min:we,max:qe,step:Ye,default:me,scale:"log",section:"secondary"}],gpu:{computeWgsl:hn,entryPoint:"simulate",uniformBytes:80,tileSize:128,dispatchBatch:1,packUniforms:bn},cpu:{fillTile:gn,cancelPending:fn,concurrency:cn(),handoffPx:Pt}};async function yn(){await Et(),await Tt(xn,tn),Rt(),It()}yn();
