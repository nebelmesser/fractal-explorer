import{v as J,a as Z,b as cn,s as ln,n as un,l as fn,c as dn,d as pn,e as mn}from"./explorer-menu.js";const hn=[1,2,5],G=5,B=6,X=4/3;function L(n){const e=getComputedStyle(document.documentElement).getPropertyValue(n).trim();if(!e)throw new Error(`Missing magnets color ${n}`);return e}function K(n,e,r,o,i,s,a,c){n.lineCap="butt",n.strokeStyle=a,n.lineWidth=c+2,n.beginPath(),n.moveTo(e,r),n.lineTo(o,i),n.stroke(),n.strokeStyle=s,n.lineWidth=c,n.beginPath(),n.moveTo(e,r),n.lineTo(o,i),n.stroke()}function xn(n){return n.coeff===1?{coeff:2,exp:n.exp,step:2*10**n.exp}:n.coeff===2?{coeff:5,exp:n.exp,step:5*10**n.exp}:{coeff:1,exp:n.exp+1,step:10**(n.exp+1)}}function Mn(n){if(!(n>0)||!Number.isFinite(n))return{coeff:1,exp:0,step:1};const e=Math.floor(Math.log10(n));let r=1,o=e,i=1/0;for(const s of hn)for(const a of[e-1,e,e+1]){const c=s*10**a,u=Math.abs(Math.log(c/n));u<i&&(r=s,o=a,i=u)}return{coeff:r,exp:o,step:r*10**o}}function gn(n){return n==="0"||/^0(\.0+)?$/.test(n)?n:n.startsWith("−")?n.slice(1):`−${n}`}function yn(n,e){const r=n*e.coeff,o=r<0;if(r===0)return e.exp>=0?"0":`0.${"0".repeat(-e.exp)}`;const i=String(Math.abs(r));if(e.exp>=0)return`${o?"−":""}${i}${"0".repeat(e.exp)}`;const s=i.padStart(-e.exp+1,"0"),a=s.length+e.exp;return`${o?"−":""}${s.slice(0,a)}.${s.slice(a)}`}function $(n,e,r,o){const i=e-n;if(!(i>0)||!Number.isFinite(i))return[];const s=Math.max(2,Math.floor(r/o));let a=Mn(i/s);for(;i/a.step>s;)a=xn(a);const c=a.step/G,u=Math.ceil(n/c-1e-12),l=Math.floor(e/c+1e-12),p=Math.min(Math.max(0,Math.floor(l-u)+1),G*(s+4)),m=[];for(let x=0;x<p;x++){const y=u+x,d=y%G===0,M=y/G;m.push({value:d?M*a.coeff*10**a.exp:y*c,major:d,label:d?yn(M,a):""})}return m}function V(n,e){const r=Array.from(n.children);for(let o=0;o<e.length;o++){const i=e[o],s=r[o]??document.createElement("span");r[o]||n.append(s),s.textContent!==i.textContent&&(s.textContent=i.textContent),s.className!==i.className&&(s.className=i.className),s.style.left!==i.style.left&&(s.style.left=i.style.left),s.style.top!==i.style.top&&(s.style.top=i.style.top)}for(let o=r.length-1;o>=e.length;o--)r[o].remove()}function wn(n,e,r,o){const i=n.clientWidth,s=n.clientHeight;if(i<8||s<8)return;const a=Math.min(window.devicePixelRatio||1,2),c=Math.round(i*a),u=Math.round(s*a);(n.width!==c||n.height!==u)&&(n.width=c,n.height=u);const l=n.getContext("2d");if(!l)return;l.setTransform(a,0,0,a,0,0),l.clearRect(0,0,i,s);const p=L("--muted"),m=L("--axis-outline");l.shadowColor=L("--shadow"),l.shadowBlur=4;const x=J(e),y=Z(e),d=$(e.xMin,e.xMax,i,72),M=$(e.yMin,e.yMax,s,72),f=[];for(const h of d){const g=(h.value-e.xMin)/x*i;if(g<2||g>i-2||(l.globalAlpha=h.major?1:.6,K(l,g,s,g,s-(h.major?B:X),p,m,h.major?1.25:1),!h.major||g<28||g>i-28))continue;const _=document.createElement("span");_.textContent=h.label,_.style.left=`${g}px`,f.push(_)}V(r,f);const T=[];for(const h of M){const g=(h.value-e.yMin)/y*s;if(g<2||g>s-2||(l.globalAlpha=h.major?1:.6,K(l,i,g,i-(h.major?B:X),g,p,m,h.major?1.25:1),!h.major||g<16||g>s-18))continue;const _=document.createElement("span");_.textContent=gn(h.label),_.style.top=`${g}px`,T.push(_)}l.globalAlpha=1,V(o,T)}const _n=`// Magnetic-pendulum samples store three normalized dwell weights in 10 bits
// each. This presentation owns their translation to RGB; the map engine only
// transports the opaque f32 sample.

fn unpack_dwell(sample: f32) -> vec3f {
  let packed = bitcast<u32>(sample);
  return vec3f(
    f32(packed & 1023u),
    f32((packed >> 10u) & 1023u),
    f32((packed >> 20u) & 1023u),
  ) / 1023.0;
}

fn map_sample_color(uv: vec2f, inverted: bool) -> vec3f {
  let dims = vec2f(f32(draw.size.x), f32(draw.size.y));
  let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * dims - vec2f(0.5);
  var color = unpack_dwell(raw_at(i32(round(p.x)), i32(round(p.y))));
  if (inverted) {
    color = vec3f(1.0) - color;
  }
  return color;
}
`;function Tn(n){const e=new ArrayBuffer(4);new Float32Array(e)[0]=n;const r=new Uint32Array(e)[0];return[(r&1023)/1023,(r>>>10&1023)/1023,(r>>>20&1023)/1023]}const En={gpuWgsl:_n,colorize(n,e,r){const o=Tn(n);return r?[1-o[0],1-o[1],1-o[2]]:o},exposure:"none",initialMedian:1},R=1,An=Math.sqrt(3)/2;function vn(n=R){const e=Math.max(1e-6,n),r=e*An;return[{x:0,y:-e},{x:-r,y:e/2},{x:r,y:e/2}]}const bn=["#ff2020","#22c55e","#3b82f6"],C=96,nn=1.5,en=1,kn=.25,Rn=2.5,tn=.22,on=.28,rn=.02,D=.03,Sn=.22,Pn=.4,Nn=4,q=6,Gn=.1,Cn=8,In=4,P=1200,Un=8e3,Y=.05,Ln=1600,On=8,Dn=5,t=Math.fround,Fn=t(.8660254037844386),zn=t(1e-12);function U(n){const e=t(Math.max(t(1e-6),n)),r=t(e*Fn);return[{x:0,y:t(-e)},{x:t(-r),y:t(e*t(.5))},{x:r,y:t(e*t(.5))}]}function Hn(n){return{K:t(n.K),G:t(n.G),F:t(n.F),H:t(n.H),R:t(n.R??R),DT:t(n.DT),maxIter:Math.max(1,Math.round(n.MAX_ITERATIONS??1))}}function Wn(n){return t(Math.max(t(Sn),t(t(Pn)*n.R)+n.H))}function jn(n,e,r,o,i){let s=t(t(-i.G*n)-t(i.F*r)),a=t(t(-i.G*e)-t(i.F*o));const c=t(i.H*i.H);for(const u of U(i.R)){const l=t(u.x-n),p=t(u.y-e),m=t(t(l*l)+t(p*p)),x=t(m+c),y=t(x*t(Math.sqrt(x))),d=t(i.K/Math.max(y,zn));s=t(s+t(l*d)),a=t(a+t(p*d))}return{ax:s,ay:a}}function Bn(n,e,r,o,i){const s=t(t(n*n)+t(e*e)),a=t(t(q)*t(q));if(s>a)return 1;const c=t(Math.sqrt(t(t(r*r)+t(o*o)))),u=t(c*i),l=t(Gn);return u<=l?1:Math.min(Cn,1+Math.floor(t(u/l)))}function Xn(n,e,r,o,i){const s=t(D),a=t(s*s);if(t(t(r*r)+t(o*o))>=a)return!1;const c=Wn(i),u=t(c*c);for(const l of U(i.R)){const p=t(l.x-n),m=t(l.y-e);if(t(t(p*p)+t(m*m))<u)return!0}return!1}function Kn(n,e,r,o,i){const s=t(Math.max(t(i.H*i.H),t(1e-4))),a=U(i.R),c=[0,0,0];for(let l=0;l<a.length;l++){const p=t(a[l].x-e),m=t(a[l].y-r),x=t(t(t(p*p)+t(m*m))+s);c[l]=t(1/x)}const u=t(Math.min(c[0],c[1],c[2]));for(let l=0;l<n.length;l++)n[l]=t(n[l]+t(o*t(c[l]-u)))}function $n(n,e,r=R){const o=U(t(r)),i=t(n),s=t(e);let a=0,c=Number.POSITIVE_INFINITY;for(let u=0;u<o.length;u++){const l=t(o[u].x-i),p=t(o[u].y-s),m=t(t(l*l)+t(p*p));m<c&&(c=m,a=u)}return a}function Vn(n,e,r,o){let i=t(n),s=t(e),a=0,c=0,u=0;const l=[0,0,0];for(let p=0;p<r.maxIter;p++){const m=Bn(i,s,a,c,r.DT),x=t(r.DT/t(m));for(let y=0;y<m;y++){const{ax:d,ay:M}=jn(i,s,a,c,r);a=t(a+t(d*x)),c=t(c+t(M*x)),i=t(i+t(a*x)),s=t(s+t(c*x)),Kn(l,i,s,x,r)}if(o?.(i,s),Xn(i,s,a,c,r)){if(u+=1,u>=Nn)break}else u=0}return{x:i,y:s,dwell:l}}function qn(n,e,r){const o=[{x:t(n),y:t(e)}];let i=o[0];const s=Vn(n,e,r,(u,l)=>{const p=u-i.x,m=l-i.y;p*p+m*m<Y*Y||(o.length<Ln?(i={x:u,y:l},o.push(i)):(i={x:u,y:l},o[o.length-1]=i))}),a=o[o.length-1];return(!a||a.x!==s.x||a.y!==s.y)&&o.push({x:s.x,y:s.y}),{magnet:$n(s.x,s.y,r.R),dwell:s.dwell,path:o}}function I(n){const e=document.getElementById(n);if(!e)throw new Error(`Magnetic-pendulum presentation is missing #${n}`);return e}function S(n,e,r,o){return{x:(e.x-n.xMin)/J(n)*r,y:(e.y-n.yMin)/Z(n)*o}}function Yn(n,e,r){return n.clientToWorld(e,r)}const O=bn,Qn="#fff",Jn="#000";function Zn(n){const e=I("map-axes"),r=I("probe-overlay"),o=I("map-scale-x"),i=I("map-scale-y");r.getContext("2d",{alpha:!0,desynchronized:!0});let s=null,a=0,c=null;function u(){const d=r.clientWidth,M=r.clientHeight,f=Math.min(window.devicePixelRatio||1,2),T=Math.round(d*f),h=Math.round(M*f);return(r.width!==T||r.height!==h)&&(r.width=T,r.height=h),{width:d,height:M}}function l(d,M,f,T,h){d.beginPath(),d.arc(M,f,T,0,Math.PI*2),d.fillStyle=h,d.fill(),d.lineWidth=1.5,d.strokeStyle="#000",d.stroke()}function p(){const{width:d,height:M}=u(),f=r.getContext("2d");if(!f||d<8||M<8)return;const T=r.width/Math.max(d,1);f.setTransform(T,0,0,T,0,0),f.clearRect(0,0,d,M);const h=n.getView(),g=Hn(n.params),_=vn(g.R);if(f.lineJoin="round",f.lineCap="round",f.strokeStyle="rgba(255, 255, 255, 0.22)",f.lineWidth=1,f.beginPath(),_.forEach((E,A)=>{const b=S(h,E,d,M);A===0?f.moveTo(b.x,b.y):f.lineTo(b.x,b.y)}),f.closePath(),f.stroke(),s){const E=qn(s.x,s.y,g);f.beginPath(),E.path.forEach((b,an)=>{const N=S(h,b,d,M);an===0?f.moveTo(N.x,N.y):f.lineTo(N.x,N.y)}),f.strokeStyle=Jn,f.lineWidth=3.25,f.stroke(),f.strokeStyle=Qn,f.lineWidth=1.7,f.stroke();const A=S(h,s,d,M);l(f,A.x,A.y,Dn,O[E.magnet]??O[0])}const j=S(h,{x:0,y:0},d,M);f.beginPath(),f.arc(j.x,j.y,2.5,0,Math.PI*2),f.fillStyle="#fff",f.fill();for(let E=0;E<_.length;E++){const A=S(h,_[E],d,M);l(f,A.x,A.y,On,O[E])}}function m(){a=0,wn(e,n.getView(),o,i),p()}function x(){a||(a=requestAnimationFrame(m))}function y(d){if(d.buttons!==0){s=null,x();return}s=n.snapToRenderedPixel(Yn(n,d.clientX,d.clientY)),x()}return n.clip.addEventListener("pointermove",y),n.clip.addEventListener("pointerleave",()=>{s=null,x()}),c=cn(n.map,n.controls,n.onParamsChange,n.resetTransition,n.signals),{draw:x,tick(){},reset(){s=null,x()},noteActivity(){},resize:x,dismiss:()=>c?.setOpen(!1),pickPoint(){return!1},syncBudget:ln}}const ne={compositor:En,mount:Zn},ee=`// Magnetic pendulum basins. Pixel = bob released from rest at (x, y).
// The semantic sample is normalized inverse-square dwell near each magnet,
// packed as three 10-bit weights in one f32. Presentation decides how those
// channels become colors. The weakest magnet is subtracted each step so a far
// swing does not wash the weights toward an even mix.
// gid.y = 0 is view.yMin (top of the tile).
//
// Capture is low speed AND near a magnet. Speed-only settle stops at the
// first turning point and paints concentric rings. Keep MAGNET_* numbers
// in sync with constants.ts.

struct Uniforms {
  view: vec4f,   // x_min, x_max, y_min, y_max
  phys: vec4f,   // K, G, F, H
  step: vec4f,   // DT, settle_speed^2, R, unused
  size: vec4u,   // max_iter, width, height, unused
  extra: vec4u,  // unused, packed (x0,y0), packed (x1,y1), weight
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> raw: array<f32>;

const SQRT3_2: f32 = 0.8660254037844386;
const SINGULAR: f32 = 1e-12;
const CAPTURE_FLOOR: f32 = 0.22;
const CAPTURE_PAD: f32 = 0.4;
const SETTLE_HOLD: u32 = 4u;
const CLOSE_RADIUS: f32 = 6.0;
const MAX_STEP: f32 = 0.1;
const SUBSTEP_MAX: u32 = 8u;

fn magnet(i: u32) -> vec2f {
  let r = max(u.step.z, 1e-6);
  if (i == 0u) {
    return vec2f(0.0, -r);
  }
  if (i == 1u) {
    return vec2f(-r * SQRT3_2, r * 0.5);
  }
  return vec2f(r * SQRT3_2, r * 0.5);
}

fn accel(p: vec2f, v: vec2f) -> vec2f {
  let k = u.phys.x;
  let g = u.phys.y;
  let f = u.phys.z;
  let h2 = u.phys.w * u.phys.w;
  var a = -g * p - f * v;
  for (var i = 0u; i < 3u; i++) {
    let d = magnet(i) - p;
    let r2 = dot(d, d) + h2;
    let r3 = r2 * sqrt(r2);
    a += k * d / max(r3, SINGULAR);
  }
  return a;
}

fn nearest(p: vec2f) -> u32 {
  var best = 0u;
  var best_d = 1e20;
  for (var i = 0u; i < 3u; i++) {
    let d = magnet(i) - p;
    let dist = dot(d, d);
    if (dist < best_d) {
      best_d = dist;
      best = i;
    }
  }
  return best;
}

fn capture_radius() -> f32 {
  return max(CAPTURE_FLOOR, CAPTURE_PAD * u.step.z + u.phys.w);
}

fn captured(p: vec2f, v: vec2f) -> bool {
  if (dot(v, v) >= u.step.y) {
    return false;
  }
  let cap2 = capture_radius() * capture_radius();
  for (var i = 0u; i < 3u; i++) {
    let d = magnet(i) - p;
    if (dot(d, d) < cap2) {
      return true;
    }
  }
  return false;
}

fn substeps(p: vec2f, v: vec2f, dt: f32) -> u32 {
  if (dot(p, p) > CLOSE_RADIUS * CLOSE_RADIUS) {
    return 1u;
  }
  let hop = length(v) * dt;
  if (hop <= MAX_STEP) {
    return 1u;
  }
  return min(SUBSTEP_MAX, 1u + u32(hop / MAX_STEP));
}

fn pack_dwell(dwell: vec3f) -> f32 {
  let m0 = u32(clamp(dwell.x, 0.0, 1.0) * 1023.0 + 0.5);
  let m1 = u32(clamp(dwell.y, 0.0, 1.0) * 1023.0 + 0.5);
  let m2 = u32(clamp(dwell.z, 0.0, 1.0) * 1023.0 + 0.5);
  return bitcast<f32>(m0 | (m1 << 10u) | (m2 << 20u));
}

fn fallback_dwell(p: vec2f) -> vec3f {
  let n = nearest(p);
  if (n == 0u) {
    return vec3f(1.0, 0.0, 0.0);
  }
  if (n == 1u) {
    return vec3f(0.0, 1.0, 0.0);
  }
  return vec3f(0.0, 0.0, 1.0);
}

fn normalized_dwell(dwell: vec3f, p: vec2f) -> vec3f {
  let sum = dwell.x + dwell.y + dwell.z;
  if (sum <= 1e-12) {
    return fallback_dwell(p);
  }
  return dwell / sum;
}

/** Inverse-square proximity, minus the weakest magnet so far-field stays saturated. */
fn dwell_step(p: vec2f, h: f32) -> vec3f {
  let eps = max(u.phys.w * u.phys.w, 1e-4);
  var w = vec3f(0.0);
  for (var m = 0u; m < 3u; m++) {
    let d = magnet(m) - p;
    w[m] = 1.0 / (dot(d, d) + eps);
  }
  let floor = min(w.x, min(w.y, w.z));
  return h * (w - vec3f(floor));
}

fn integrate(start: vec2f) -> f32 {
  var p = start;
  var v = vec2f(0.0);
  var dwell = vec3f(0.0);
  let dt = u.step.x;
  let max_iter = u.size.x;
  var hold = 0u;
  for (var i = 0u; i < max_iter; i++) {
    let n = substeps(p, v, dt);
    let h = dt / f32(n);
    for (var s = 0u; s < SUBSTEP_MAX; s++) {
      if (s >= n) {
        break;
      }
      let a = accel(p, v);
      v += a * h;
      p += v * h;
      dwell += dwell_step(p, h);
    }
    if (captured(p, v)) {
      hold += 1u;
      if (hold >= SETTLE_HOLD) {
        break;
      }
    } else {
      hold = 0u;
    }
  }
  return pack_dwell(normalized_dwell(dwell, p));
}

@compute @workgroup_size(8, 8)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let width = u.size.y;
  let height = u.size.z;
  if (gid.x >= width || gid.y >= height) {
    return;
  }
  let id = gid.y * width + gid.x;
  let nx = (f32(gid.x) + 0.5) / f32(width);
  let ny = (f32(gid.y) + 0.5) / f32(height);
  let x = mix(u.view.x, u.view.y, nx);
  let y = mix(u.view.z, u.view.w, ny);
  raw[id] = integrate(vec2f(x, y));
}
`;function te(n){return new Worker(""+new URL("tile-worker-BEPpdRrw.js",import.meta.url).href,{type:"module",name:n?.name})}let w=null,oe=1,F=0;const v=new Map,k=[],sn=[];function z(){const n=typeof navigator>"u"?4:navigator.hardwareConcurrency??4;return Math.max(1,Math.min(In,n-1))}function re(){return z()}function se(){const n=k.pop();return n?Promise.resolve(n):new Promise(e=>sn.push(e))}function H(n){if(!w?.includes(n))return;const e=sn.shift();e?e(n):k.push(n)}function ie(n){const e=v.get(n.data.id);if(e){if(v.delete(n.data.id),!n.data.buffer||n.data.error){e.reject(new Error(n.data.error??"Magnets CPU worker returned no buffer"));return}e.resolve(n.data.buffer)}}function W(){const n=new te;return n.onmessage=ie,n.onerror=e=>Q(n,new Error(e.message||"Magnets CPU worker failed")),n.onmessageerror=()=>Q(n,new Error("Magnets CPU worker message error")),n}function Q(n,e){for(const[s,a]of v)a.worker===n&&(v.delete(s),a.reject(e));const r=k.indexOf(n);if(r>=0&&k.splice(r,1),!w)return;const o=w.indexOf(n);if(o<0)return;w.splice(o,1);try{n.terminate()}catch{}const i=W();w.push(i),H(i)}function ae(){if(!w)return;F+=1;const n=new Set(w);w=[],k.length=0;const e=new Error("Magnets CPU tile superseded by a newer camera");e.name="AbortError";for(const[r,o]of v)n.has(o.worker)&&(v.delete(r),o.reject(e));for(const r of n)try{r.terminate()}catch{}for(let r=0;r<z();r++){const o=W();w.push(o),H(o)}}function ce(){if(!w){w=[];for(let n=0;n<z();n++){const e=W();w.push(e),k.push(e)}}}function le(n,e){return new Promise((r,o)=>{v.set(e.id,{worker:n,resolve:r,reject:o}),n.postMessage(e)})}async function ue(n,e,r,o){ce();const i=F,s=await se();try{if(i!==F){const c=new Error("Magnets CPU tile superseded before dispatch");throw c.name="AbortError",c}const a=await le(s,{id:oe++,width:Math.max(1,Math.round(e)),height:Math.max(1,Math.round(r)),xMin:n.xMin,xMax:n.xMax,yMin:n.yMin,yMax:n.yMax,K:o.K??nn,G:o.G??en,F:o.F??tn,H:o.H??on,R:o.R??R,DT:o.DT??rn,maxIter:Math.max(P,Math.round(o.MAX_ITERATIONS??P))});return new Float32Array(a)}finally{H(s)}}function fe(n,e,r,o,i){const s=new ArrayBuffer(80),a=new Float32Array(s),c=new Uint32Array(s);a[0]=n.xMin,a[1]=n.xMax,a[2]=n.yMin,a[3]=n.yMax,a[4]=o.K,a[5]=o.G,a[6]=o.F,a[7]=o.H,a[8]=o.DT,a[9]=D*D,a[10]=o.R??R,a[11]=0,c[12]=Math.max(P,Math.round(o.MAX_ITERATIONS??P)),c[13]=e,c[14]=r,c[15]=0,c[16]=0;const u=un(n,i.normView??n,e,r);return c[17]=u.y0<<16|u.x0,c[18]=u.y1<<16|u.x1,c[19]=1,s}const de={computeWgsl:ee,entryPoint:"simulate",uniformBytes:80,packUniforms:fe},pe={id:"magnets",title:"Magnetic pendulum",defaultView:{xMin:-C,xMax:C,yMin:-C,yMax:C},workBudget:{param:"MAX_ITERATIONS",min:P,max:Un,step:50},params:[{key:"R",label:"param.R",kind:"float",min:kn,max:Rn,step:.01,default:R},{key:"K",label:"param.K",kind:"float",min:.1,max:3,step:.01,default:nn},{key:"G",label:"param.G",kind:"float",min:.05,max:2,step:.01,default:en},{key:"F",label:"param.F",kind:"float",min:0,max:.8,step:.01,default:tn},{key:"H",label:"param.H",kind:"float",min:.08,max:.8,step:.01,default:on},{key:"DT",label:"param.DT",kind:"float",min:.005,max:.05,step:.001,default:rn,invert:!0,digits:3}],gpu:de,cpu:{fillTile:ue,cancelPending:ae,concurrency:re()}};async function me(){await fn(),await dn(pe,ne),pn(),mn()}me();
