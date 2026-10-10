import{q as Ye,x as Z,C as Ke,o as vt,t as Me,v as de,a as Ee,y as J,b as wt,s as Et,z as Tt,A as ct,B as Rt,n as It,l as At,c as Pt,d as zt,e as St}from"./menu-CzDvZvqG.js";const ut={xMin:-2.25,xMax:1.25,yMin:-1.35,yMax:1.35},Ot={xMin:-3,xMax:3,yMin:-3,yMax:3},Te=128,Qe=262144,me=768,Ze=64,Ct=4,kt=.25,Bt=256,Ue=-.8,Fe=.156,_e=2,et=.001,Nt=.001,dt=64,mt=4,V=[0,.16,.36,.44,.56,.76,1],Lt=1e-280,Wt=.01,Dt=4,Ut=8,tt=65,K=3,Ft=4,$t=2,Le=20,ve=8,Ht=500,jt=128,Jt=320,Vt=247,Xt=2.25,nt="mandelbrot-show-orbit",ue=[0,.35,.7,1],Gt=.75,rt=3,qt=4,Yt=300,Kt=24,it=180,ot=100,We=.5,Qt=.3,Zt=e=>Number.isFinite(e)&&e<=-2?Math.floor(-e)-1:0;let we=null;function ft(){if(we)return we;const e=getComputedStyle(document.documentElement);return we=V.map((n,a)=>{const o=e.getPropertyValue(`--mandelbrot-color-${a}`).trim();if(!/^#[\da-f]{6}$/i.test(o))throw new Error(`Missing Mandelbrot palette color ${a}`);return[1,3,5].map(m=>parseInt(o.slice(m,m+2),16)/255)}),we}function pt(e){if(!(e>0)||!Number.isFinite(e))return[0,0,0];const n=Math.max(0,e-mt)/dt%1,a=ft();for(let o=1;o<V.length;o++){if(n>V[o])continue;const m=(n-V[o-1])/(V[o]-V[o-1]),d=m*m*(3-2*m);return a[o-1].map((u,c)=>u+d*(a[o][c]-u))}return a[0]}const en={get gpuWgsl(){const e=ft(),n=o=>`vec3f(${o.map(m=>m.toFixed(9)).join(", ")})`,a=V.slice(1).map((o,m)=>`
      if (t <= ${o.toFixed(6)}) {
        return mix(${n(e[m])}, ${n(e[m+1])},
          smoothstep(${V[m].toFixed(6)}, ${o.toFixed(6)}, t));
      }`).join(`
`);return`
      fn mandelbrot_color(sample: f32) -> vec3f {
        if (sample <= 0.0) { return vec3f(0.0); }
        let t = fract(max(0.0, sample - ${mt.toFixed(1)}) / ${dt.toFixed(1)});
        ${a}
        return ${n(e[0])};
      }
      fn map_sample_color(uv: vec2f, inverted: bool) -> vec3f {
        let pixel = vec2i(round(uv * vec2f(draw.size) - vec2f(0.5)));
        let color = mandelbrot_color(raw_at(pixel.x, pixel.y));
        return select(color, vec3f(1.0) - color, inverted);
      }
    `},colorize(e,n,a){const o=pt(e);return a?[1-o[0],1-o[1],1-o[2]]:o},exposure:"none",initialMedian:1};function at(e){const n=e.MORPH??0,a=ut,o=Xt;return{xMin:a.xMin*(1-n)-o*n,xMax:a.xMax*(1-n)+o*n,yMin:a.yMin*(1-n)-o*n,yMax:a.yMax*(1-n)+o*n}}function tn(e,n){const a=Z(n);return{x:e.x*a/Ke,y:e.y*a/Ke}}function Q(e,n,a){return Number.isFinite(e.r+e.i)&&e.r>=0&&e.r<=n&&e.i>=0&&e.i<=a}function nn(e,n){const a=Math.min(Yt,Math.max(qt,Math.ceil(-Math.log10(n))+1)),o=Ye(e.x,a),m=Ye(-e.y,a),d=b=>b.length>Kt?`${b.slice(0,12)}…${b.slice(-8)}`:b,u=m.startsWith("-"),c=u?m.slice(1):m;return{x:o,y:m,complex:`${o} ${u?"−":"+"} ${c}i`,shortX:d(o),shortY:d(m),shortComplex:`${d(o)} ${u?"−":"+"} ${d(c)}i`}}function rn(e,n,a,o){e={...e},n={...n};const m=u=>(u.r<0?1:u.r>a?2:0)|(u.i<0?4:u.i>o?8:0),d=(u,c,b,f,x)=>Math.abs(x-b)<Math.abs(x-f)?u+(c-u)*((x-b)/(f-b)):c+(u-c)*((x-f)/(b-f));for(let u=0;u<8;u++){const c=m(e),b=m(n);if(!(c|b))return[e,n];if(c&b)return null;const f=c||b;let x;if(f&12){const w=f&4?0:o;x={r:d(e.r,n.r,e.i,n.i,w),i:w}}else{const w=f&1?0:a;x={r:w,i:d(e.i,n.i,e.r,n.r,w)}}if(!Number.isFinite(x.r+x.i))return null;c?e=x:n=x}return null}function lt(e){return new Worker(""+new URL("orbit-worker--t5hRNdS.js",import.meta.url).href,{type:"module",name:e?.name})}function on(e){const n=document.createElement("canvas");n.id="probe-overlay",n.setAttribute("aria-hidden","true");const a=document.createElement("div");a.className="mandelbrot-orbit-inset",a.hidden=!0;const o=document.createElement("div");o.className="mandelbrot-orbit-title";const m=document.createElement("div");m.className="mandelbrot-orbit-label";const d=document.createElement("canvas");d.setAttribute("aria-hidden","true");const u=document.createElement("div");u.className="mandelbrot-orbit-legend";const c=document.createElement("span");c.textContent="z₀";const b=document.createElement("span");b.className="mandelbrot-orbit-ramp";const f=document.createElement("span");f.textContent="zₙ";const x=document.createElement("div");x.className="mandelbrot-orbit-coordinates";const w=document.createElement("em");x.append(w),u.append(c,b,f),a.append(o,d,x,u,m),e.clip.append(a,n);const N=document.getElementById("site-credit"),X=document.getElementById("ask-bar"),_=getComputedStyle(document.documentElement),M=t=>_.getPropertyValue(`--orbit-${t}`).trim(),y=M("line"),S=M("outline"),T=M("dot"),ie=M("connector"),fe=M("axis"),pe=M("axis-text"),ge=t=>[1,3,5].map(r=>parseInt(t.slice(r,r+2),16)),he=ue.map((t,r)=>ge(M(`gradient-${r}`))),L=document.createElement("canvas");let Re="",W=null,be=!1,oe=!0,D=null,U=null,G=null,Ie=0,q=0,te=!1,Ae=!1,ae=!1,O=null,I=null,F=null,xe=0,Pe=-1,ze=0,Se=0,$=null;function Oe(t){const r=Math.max(0,Math.min(1,t));let i=1;for(;i<ue.length-1&&r>ue[i];)i++;const s=ue[i-1],l=ue[i],g=(r-s)/(l-s);return`rgb(${he[i-1].map((h,v)=>Math.round(h+g*(he[i][v]-h))).join(" ")})`}function ne(){const t=I?Zt(I.sample):0;if(m.textContent=I?t?Me("mandelbrot.orbit.period").replace("{period}",String(t)):Me(I.sample>0?"mandelbrot.orbit.escape":"mandelbrot.orbit.unknown").replace("{steps}",String(I.steps)):Me(O?ae?"mandelbrot.orbit.error":"mandelbrot.orbit.loading":"mandelbrot.orbit.idle"),o.textContent=Me("mandelbrot.orbit.title"),m.dataset.period=String(t),O){const r=e.getView(),i=nn(O,de(r)/Math.max(1,e.clip.clientWidth));w.textContent=i.shortComplex.replace(/-/g,"−"),w.title=i.complex.replace(/-/g,"−")}else w.textContent="—",w.title="";a.dataset.animating=n.dataset.animating=String(te)}vt(()=>{ne(),j(performance.now())});function ht(){if(D)return D;const t=new lt;return D=t,t.onmessage=r=>{if(D!==t)return;const i=r.data;if(i.kind==="trace"){if(U=null,i.id===q&&O){const s=performance.now();i.trace&&(I?($=I,Se=s):ze=s,I=i.trace),ae=!i.trace,ne(),j(s)}Ce()}},t.onerror=()=>{D===t&&(t.terminate(),D=null,U=null,G=null,ae=!0,ne())},t}function bt(){const t={...e.params},r=JSON.stringify(t);if(Re===r&&(be||W))return;W?.terminate(),be=!1,Re=r;const i=new lt;W=i,i.onmessage=s=>{const l=s.data;if(W!==i||l.kind!=="overview"||l.key!==Re)return;L.width=l.width,L.height=l.height;const g=L.getContext("2d"),p=g.createImageData(l.width,l.height);for(let h=0;h<l.samples.length;h++){const v=pt(l.samples[h]);p.data.set([...v.map(A=>Math.round(A*255)),255],h*4)}g.putImageData(p,0,0),be=!0,d.dataset.overviewParams=r,i.terminate(),W=null,j(performance.now())},i.onerror=()=>{W===i&&(i.terminate(),W=null)},i.postMessage({kind:"overview",key:r,width:Jt,height:Vt,view:at(t),params:t})}function Ce(){U||!G||(U=G,G=null,ht().postMessage({kind:"trace",id:U.id,job:U.job}))}function le(){q++,window.clearTimeout(Ie),D?.terminate(),D=null,U=null,G=null,O=null,I=null,$=null,F=null,ae=!1,te=!1,a.dataset.animating=n.dataset.animating="false",n.dataset.mode="hidden",!oe&&W&&(W.terminate(),W=null),ne(),j(performance.now())}function Je(t,r){if(!oe)return;const i=e.snapToRenderedPixel(e.clientToWorld(t,r)),s=e.getView(),l={x:(s.origin?.x??0n)+Z(i.x),y:(s.origin?.y??0n)+Z(i.y)};if(O?.x===l.x&&O?.y===l.y)return;q++,window.clearTimeout(Ie),te=!1,ae=!1,U?.full&&(D?.terminate(),D=null,U=null),O=l,F={point:l,span:Math.min(de(s),Ee(s)),params:{...e.params},f32:!(e.samplesF64?.()??!1)},G={id:q,job:{...F,params:{...F.params,MAX_ITERATIONS:Math.min(jt,F.params.MAX_ITERATIONS??me)}},full:!1},Ce(),ne(),j(performance.now());const g=q;Ie=window.setTimeout(()=>{g!==q||!F||(te=!0,xe=performance.now(),Pe=-1,G={id:q,job:F,full:!0},Ce(),ne(),j(xe))},Ht)}function Ve(t){const r=Math.min(devicePixelRatio||1,$t),i=Math.round(t.clientWidth*r),s=Math.round(t.clientHeight*r);(t.width!==i||t.height!==s)&&(t.width=i,t.height=s);const l=t.getContext("2d");return l&&(l.setTransform(r,0,0,r,0,0),l.clearRect(0,0,t.clientWidth,t.clientHeight)),l}function se(t,r,i,s){Number.isFinite(r.r+r.i)&&(t.beginPath(),t.arc(r.r,r.i,i,0,Math.PI*2),t.fillStyle=s,t.fill(),t.lineWidth=1.5,t.strokeStyle=S,t.stroke())}function ke(t,r,i){t.font="italic 12px Georgia, serif",t.lineWidth=3,t.strokeStyle=S,t.fillStyle=y,t.strokeText(i,r.r+7,r.i-7),t.fillText(i,r.r+7,r.i-7)}function xt(t,r){const i=t.path,s=t.cycle.length;if(s)for(let l=s;l+s<=i.length;l++){let g=!0;for(let p=0;p<s;p++){const h=r(i[l+p]),v=r(i[l-s+p]);if(Math.hypot(h.r-v.r,h.i-v.i)>Gt){g=!1;break}}if(g)return i.slice(0,l+1)}return i}function Xe(t,r,i,s,l,g){if(l<=0)return;t.save(),t.globalAlpha=l;const p=xt(r,i),h=Math.max(1,p.length-1),v=p.slice(1).map((E,P)=>rn(i(p[P]),i(E),t.canvas.clientWidth,t.canvas.clientHeight));t.lineJoin="round",t.lineCap="round";const A=t.canvas===n;if(v.forEach((E,P)=>{if(!E)return;const[C,B]=E,z=t.createLinearGradient(C.r,C.i,B.r,B.i);z.addColorStop(0,Oe(P/h)),z.addColorStop(1,Oe((P+1)/h)),t.beginPath(),t.moveTo(C.r,C.i),t.lineTo(B.r,B.i),t.strokeStyle=z,t.lineWidth=A?We:Qt,t.stroke()}),r.cycle.forEach(E=>{const P=i(E);Q(P,t.canvas.clientWidth,t.canvas.clientHeight)&&(t.beginPath(),t.arc(P.r,P.i,Ft,0,Math.PI*2),t.strokeStyle=y,t.lineWidth=1,t.stroke())}),g&&te){const E=Math.floor((s-xe)/tt),P=r.cycle.length;for(let C=rt-1;C>=0;C--){const B=E-C;if(B<0)continue;const z=B<p.length?B:P?p.length-P+(B-p.length)%P:p.length-1,H=p[z];if(!H)continue;const Y=i(H);Q(Y,t.canvas.clientWidth,t.canvas.clientHeight)&&(t.globalAlpha=l*(1-C/rt),se(t,Y,K,Oe(z/h)))}}t.restore()}function Ge(t,r,i){if(!I)return;const s=(p,h)=>{const v=Math.max(0,Math.min(1,p/h));return v*v*(3-2*v)},l=s(i-ze,it),g=$?s(i-Se,ot):1;$&&Xe(t,$,r,i,l*(1-g),!1),Xe(t,I,r,i,l*g,!0),n.dataset.orbitOpacity=String(l)}function yt(t,r){const i=r({r:0,i:0}),s=d.clientWidth,l=d.clientHeight,g=Le;t.beginPath(),t.moveTo(g,i.i),t.lineTo(s-g,i.i),t.moveTo(i.r,g),t.lineTo(i.r,l-g),t.strokeStyle=fe,t.lineWidth=1,t.stroke(),t.font="10px system-ui",t.lineWidth=3,t.strokeStyle=S,t.fillStyle=pe;const p=(h,v,A)=>{t.strokeText(h,v,A),t.fillText(h,v,A)};for(let h=-2;h<=2;h++){const v=r({r:h,i:0}).r,A=r({r:0,i:h}).i;v>=g&&v<=s-g&&p(String(h),v+3,i.i+12),h&&A>=g&&A<=l-g&&(t.font="italic 12px Georgia, serif",p(h===1?"i":h===-1?"−i":`${h<0?"−":""}${Math.abs(h)}i`,i.r+4,A-3),t.font="10px system-ui")}}function Mt(){const t=e.clip.getBoundingClientRect(),r=a.getBoundingClientRect(),i=N?.getBoundingClientRect(),s=X?.getBoundingClientRect();let l=ve;i?.height&&(l=Math.max(l,t.bottom-i.top+ve)),s?.height&&r.left<s.right&&r.right>s.left&&t.bottom-l>s.top-ve&&t.bottom-l-r.height<s.bottom&&(l=Math.max(l,t.bottom-s.top+ve));const g=`${Math.ceil(l)}px`;a.style.bottom!==g&&(a.style.bottom=g)}function j(t){const r=Ve(n);if(a.hidden=!oe,!r||!oe){n.dataset.mode="hidden";return}Mt(),bt();const i=Ve(d);if(!i)return;const s=e.getView(),l=n.clientWidth,g=n.clientHeight,p=at(e.params),h=Math.min((d.clientWidth-2*Le)/(p.xMax-p.xMin),(d.clientHeight-2*Le)/(p.yMax-p.yMin)),v=R=>({r:d.clientWidth/2+(R.r-(p.xMin+p.xMax)/2)*h,i:d.clientHeight/2+(-R.i-(p.yMin+p.yMax)/2)*h});if(be){const R=v({r:p.xMin,i:-p.yMin}),ce=v({r:p.xMax,i:-p.yMax});i.drawImage(L,R.r,R.i,ce.r-R.r,ce.i-R.i)}if(yt(i,v),!O||!F){n.dataset.mode="preview",n.dataset.connector="false";return}const A=R=>({r:(J(R.x-(s.origin?.x??0n))-s.xMin)/de(s)*l,i:(J(R.y-(s.origin?.y??0n))-s.yMin)/Ee(s)*g}),E=A(O),P={r:J(O.x),i:-J(O.y)},C=tn(O,F.params.MORPH??0),B={r:J(C.x),i:-J(C.y)},z=A(C),H=v(B),Y=v(P),_t=R=>R===I?.path[0]||R===$?.path[0]?z:A({x:Z(R.r),y:Z(-R.i)}),Be=Q(z,l,g);n.dataset.mode=Be?"map":"inset",Ge(i,v,t);const Ne=Be&&Q(E,l,g);if(n.dataset.connector=String(Ne),!Ne&&Q(E,l,g)){const R=d.getBoundingClientRect(),ce=e.clip.getBoundingClientRect();r.beginPath(),r.moveTo(R.left-ce.left+H.r,R.top-ce.top+H.i),r.lineTo(E.r,E.i),r.strokeStyle=ie,r.lineWidth=We,r.stroke()}const ye=a.getBoundingClientRect(),qe=n.getBoundingClientRect();r.save(),r.beginPath(),r.rect(0,0,l,g),r.rect(ye.left-qe.left,ye.top-qe.top,ye.width,ye.height),r.clip("evenodd"),Be&&Ge(r,_t,t),$&&t-Se>=ot&&($=null),Ne&&(r.setLineDash([4,4]),r.beginPath(),r.moveTo(z.r,z.i),r.lineTo(E.r,E.i),r.strokeStyle=ie,r.lineWidth=We,r.stroke(),r.setLineDash([])),Q(E,l,g)&&(se(r,E,K,y),r.beginPath(),r.arc(E.r,E.i,K+4,0,Math.PI*2),r.strokeStyle=y,r.lineWidth=1,r.stroke()),Q(z,l,g)&&(se(r,z,K,T),ke(r,z,"z₀")),r.restore(),se(i,Y,K,y),Math.hypot(Y.r-H.r,Y.i-H.i)>K*2&&ke(i,Y,"p"),se(i,H,K,T),ke(i,H,"z₀"),a.dataset.pathPoints=n.dataset.pathPoints=String(I?.path.length??0)}return e.clip.addEventListener("pointermove",t=>{if(t.buttons||t.pointerType==="touch"){t.buttons&&le();return}Ae=!1,Je(t.clientX,t.clientY)}),e.clip.addEventListener("pointerdown",le),e.clip.addEventListener("pointerleave",()=>{Ae||le()}),{clear:le,setEnabled(t){oe=t,le()},draw:()=>j(performance.now()),tick(t){const r=Math.floor((t-xe)/tt);I&&(t-ze<it||$||Number(n.dataset.orbitOpacity)<1||te&&r!==Pe)&&(Pe=r,j(t))},pickPoint(t,r,i,s,l){return l==="touch"&&(Ae=!0,Je(i,s)),!1}}}const an={compositor:en,mount(e){const n=on(e),a=document.querySelector("#show-orbit");try{a.checked=localStorage.getItem(nt)!=="false"}catch{}n.setEnabled(a.checked),a.addEventListener("change",()=>{n.setEnabled(a.checked);try{localStorage.setItem(nt,String(a.checked))}catch{}});const o=wt(e.map,e.controls,e.onParamsChange,e.resetTransition,e.signals),m=["JULIA_REAL","JULIA_IMAG"].map(c=>document.querySelector(`[data-param-value="${c}"]`)?.closest("label"));let d=-1;function u(){const c=e.params.MORPH??0;if(c!==d){d=c;for(const b of m){b?.classList.toggle("is-inactive",c===0);const f=b?.querySelector("input");f&&(f.disabled=c===0)}}}return u(),{...Tt,draw(){u(),n.draw()},tick(c){u(),n.tick(c)},reset(){u(),n.clear()},noteActivity:n.clear,resize:n.draw,pickPoint:n.pickPoint,dismiss:()=>o.setOpen(!1),syncBudget:Et}}};function ln(e,n,a,o,m,d){const u=new ArrayBuffer(64),c=new Float32Array(u),b=new Int32Array(u),f=new Uint32Array(u),x=ct(e),w=de(e),N=Ee(e),X=J(x.x-o.x),_=J(x.y-o.y),M=Math.floor(Math.log2(Math.max(w,N,Math.abs(X),Math.abs(_)))),y=2**M,S=[X/y,_/y,w/y,N/y];for(let T=0;T<S.length;T++)c[T]=S[T],c[T+4]=S[T]-c[T];return b[8]=M,f[9]=Math.round(d.MAX_ITERATIONS??me),f[10]=n,f[11]=a,f[12]=m,c[13]=d.MORPH??0,c[14]=(d.MORPH??0)-c[13],u}function sn(e){return new Worker(""+new URL("deep-worker-CmkTMtmv.js",import.meta.url).href,{type:"module",name:e?.name})}const cn=`struct Uniforms { offset: vec4f, tail: vec4f, size: vec4u, extra: vec4u }
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
`,un={minSpan:Lt,threshold:Wt,gpu:{computeWgsl:cn,entryPoint:"simulate",uniformBytes:64},async begin(e,n,a){if(a.aborted)throw new DOMException("Superseded","AbortError");const o=new sn;let m=0;const d=new Map,u=f=>{o.terminate();for(const x of d.values())x.reject(f);d.clear()};a.addEventListener("abort",()=>u(new DOMException("Superseded","AbortError")),{once:!0}),o.onerror=f=>u(new Error(f.message)),o.onmessageerror=()=>u(new Error("Deep worker message failed")),o.onmessage=f=>{const x=d.get(f.data.id);x&&(d.delete(f.data.id),f.data.error?x.reject(new Error(f.data.error)):x.resolve(f.data))};const c=f=>new Promise((x,w)=>{if(a.aborted){w(new DOMException("Superseded","AbortError"));return}const N=m++;d.set(N,{resolve:x,reject:w}),o.postMessage({...f,id:N})}),b=(f,x=0)=>{const w=f.center,N=f.storage,X=async(_,M,y,S)=>(await c({view:_,width:M,height:y,samples:S,referenceId:f.id})).samples;return{needsRefinement:_=>_.some(M=>M<0||!Number.isFinite(M)),mergeRefinement(_,M){for(let y=0;y<_.length;y++)(_[y]<0||!Number.isFinite(_[y]))&&(_[y]=M[y]);return _},gpu:{storage:N,packUniforms:(_,M,y)=>ln(_,M,y,w,N.length/8,n)},async refineTile(_,M,y,S){if(x>=Dt)return null;const T=[];for(let L=0;L<_.length;L++)(_[L]<0||!Number.isFinite(_[L]))&&T.push(L);if(T.length<Ut)return null;const ie=T[Math.floor(T.length/2)],fe=ct(M),pe=de(M),ge=Ee(M),he={x:fe.x+Z(((ie%y+.5)/y-.5)*pe),y:fe.y+Z(((Math.floor(ie/y)+.5)/S-.5)*ge)};return b(await c({view:Rt(he,pe,ge),params:n}),x+1)},fillTile:(_,M,y)=>X(_,M,y),repairTile:(_,M,y,S)=>_.some(T=>T<0||!Number.isFinite(T))?X(M,y,S,_):Promise.resolve(_)}};return b(await c({view:e,params:n}))}};function dn(e){return new Worker(""+new URL("tile-worker-CLTabr7K.js",import.meta.url).href,{type:"module",name:e?.name})}let k=null,mn=1,De=0;const ee=new Map,re=[],gt=[];function $e(){const e=typeof navigator>"u"?4:navigator.hardwareConcurrency??4;return Math.max(1,Math.min(Ct,e-1))}function fn(){return $e()}function pn(){const e=re.pop();return e?Promise.resolve(e):new Promise(n=>gt.push(n))}function He(e){if(!k?.includes(e))return;const n=gt.shift();n?n(e):re.push(e)}function gn(e){const n=ee.get(e.data.id);if(n){if(ee.delete(e.data.id),!e.data.buffer||e.data.error){n.reject(new Error(e.data.error??"Mandelbrot CPU worker returned no buffer"));return}n.resolve(e.data.buffer)}}function je(){const e=new dn;return e.onmessage=gn,e.onerror=n=>st(e,new Error(n.message||"Mandelbrot CPU worker failed")),e.onmessageerror=()=>st(e,new Error("Mandelbrot CPU worker message error")),e}function st(e,n){for(const[d,u]of ee)u.worker===e&&(ee.delete(d),u.reject(n));const a=re.indexOf(e);if(a>=0&&re.splice(a,1),!k)return;const o=k.indexOf(e);if(o<0)return;k.splice(o,1);try{e.terminate()}catch{}const m=je();k.push(m),He(m)}function hn(){if(!k)return;De+=1;const e=new Set(k);k=[],re.length=0;const n=new Error("Mandelbrot CPU tile superseded by a newer camera");n.name="AbortError";for(const[a,o]of ee)e.has(o.worker)&&(ee.delete(a),o.reject(n));for(const a of e)try{a.terminate()}catch{}for(let a=0;a<$e();a++){const o=je();k.push(o),He(o)}}function bn(){if(!k){k=[];for(let e=0;e<$e();e++){const n=je();k.push(n),re.push(n)}}}function xn(e,n){return new Promise((a,o)=>{ee.set(n.id,{worker:e,resolve:a,reject:o}),e.postMessage(n)})}async function yn(e,n,a,o){bn();const m=De,d=await pn();try{if(m!==De){const c=new Error("Mandelbrot CPU tile superseded before dispatch");throw c.name="AbortError",c}const u=await xn(d,{id:mn++,width:Math.max(1,Math.round(n)),height:Math.max(1,Math.round(a)),xMin:e.xMin,xMax:e.xMax,yMin:e.yMin,yMax:e.yMax,maxIter:Math.max(Te,Math.round(o.MAX_ITERATIONS??me)),morph:o.MORPH??0,juliaReal:o.JULIA_REAL??Ue,juliaImag:o.JULIA_IMAG??Fe});return new Float32Array(u)}finally{He(d)}}const Mn=`struct Uniforms {
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
`;function _n(e,n,a,o,m){const d=new ArrayBuffer(80),u=new Float32Array(d),c=new Uint32Array(d);u.set([e.xMin,e.xMax,e.yMin,e.yMax]),u.set([o.MORPH??0,o.JULIA_REAL??Ue,o.JULIA_IMAG??Fe,Bt],4),c[12]=Math.max(Te,Math.round(o.MAX_ITERATIONS??me)),c[13]=n,c[14]=a;const b=It(e,m.normView??e,n,a);return c[17]=b.y0<<16|b.x0,c[18]=b.y1<<16|b.x1,c[19]=1,d}const vn={id:"mandelbrot",precision:un,title:"Mandelbrot & Julia",settledResolution:{gpu:"device",cpu:"device"},defaultView:ut,worldView:Ot,workBudget:{param:"MAX_ITERATIONS",min:Te,max:Qe,step:Ze,adaptive:!1},params:[{key:"MORPH",label:"param.mandelbrot.morph",kind:"float",min:0,max:1,step:Nt,default:0,digits:3,section:"primary"},{key:"JULIA_REAL",label:"param.mandelbrot.real",kind:"float",min:-_e,max:_e,step:et,default:Ue,digits:3,section:"primary"},{key:"JULIA_IMAG",label:"param.mandelbrot.imag",kind:"float",min:-_e,max:_e,step:et,default:Fe,digits:3,section:"primary"},{key:"MAX_ITERATIONS",label:"param.mandelbrot.iterations",kind:"int",min:Te,max:Qe,step:Ze,default:me,scale:"log",section:"secondary"}],gpu:{computeWgsl:Mn,entryPoint:"simulate",uniformBytes:80,tileSize:128,dispatchBatch:1,packUniforms:_n},cpu:{fillTile:yn,cancelPending:hn,concurrency:fn(),handoffPx:kt}};async function wn(){await At(),await Pt(vn,an),zt(),St()}wn();
