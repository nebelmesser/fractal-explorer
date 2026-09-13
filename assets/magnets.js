import{v as $,d as W,f as K,s as q,n as Y,l as Q,i as J,j as Z,k as nn}from"./explorer-menu.js";const tn=[1,2,5],S=5,O=6,U=4/3;function G(n){const e=getComputedStyle(document.documentElement).getPropertyValue(n).trim();if(!e)throw new Error(`Missing magnets color ${n}`);return e}function F(n,e,o,i,r,s,a,c){n.lineCap="butt",n.strokeStyle=a,n.lineWidth=c+2,n.beginPath(),n.moveTo(e,o),n.lineTo(i,r),n.stroke(),n.strokeStyle=s,n.lineWidth=c,n.beginPath(),n.moveTo(e,o),n.lineTo(i,r),n.stroke()}function en(n){return n.coeff===1?{coeff:2,exp:n.exp,step:2*10**n.exp}:n.coeff===2?{coeff:5,exp:n.exp,step:5*10**n.exp}:{coeff:1,exp:n.exp+1,step:10**(n.exp+1)}}function on(n){if(!(n>0)||!Number.isFinite(n))return{coeff:1,exp:0,step:1};const e=Math.floor(Math.log10(n));let o=1,i=e,r=1/0;for(const s of tn)for(const a of[e-1,e,e+1]){const c=s*10**a,f=Math.abs(Math.log(c/n));f<r&&(o=s,i=a,r=f)}return{coeff:o,exp:i,step:o*10**i}}function sn(n){return n==="0"||/^0(\.0+)?$/.test(n)?n:n.startsWith("−")?n.slice(1):`−${n}`}function rn(n,e){const o=n*e.coeff,i=o<0;if(o===0)return e.exp>=0?"0":`0.${"0".repeat(-e.exp)}`;const r=String(Math.abs(o));if(e.exp>=0)return`${i?"−":""}${r}${"0".repeat(e.exp)}`;const s=r.padStart(-e.exp+1,"0"),a=s.length+e.exp;return`${i?"−":""}${s.slice(0,a)}.${s.slice(a)}`}function z(n,e,o,i){const r=e-n;if(!(r>0)||!Number.isFinite(r))return[];const s=Math.max(2,Math.floor(o/i));let a=on(r/s);for(;r/a.step>s;)a=en(a);const c=a.step/S,f=Math.ceil(n/c-1e-12),l=Math.floor(e/c+1e-12),m=Math.min(Math.max(0,Math.floor(l-f)+1),S*(s+4)),h=[];for(let x=0;x<m;x++){const M=f+x,d=M%S===0,g=M/S;h.push({value:d?g*a.coeff*10**a.exp:M*c,major:d,label:d?rn(g,a):""})}return h}function H(n,e){const o=Array.from(n.children);for(let i=0;i<e.length;i++){const r=e[i],s=o[i]??document.createElement("span");o[i]||n.append(s),s.textContent!==r.textContent&&(s.textContent=r.textContent),s.className!==r.className&&(s.className=r.className),s.style.left!==r.style.left&&(s.style.left=r.style.left),s.style.top!==r.style.top&&(s.style.top=r.style.top)}for(let i=o.length-1;i>=e.length;i--)o[i].remove()}function an(n,e,o,i){const r=n.clientWidth,s=n.clientHeight;if(r<8||s<8)return;const a=Math.min(window.devicePixelRatio||1,2),c=Math.round(r*a),f=Math.round(s*a);(n.width!==c||n.height!==f)&&(n.width=c,n.height=f);const l=n.getContext("2d");if(!l)return;l.setTransform(a,0,0,a,0,0),l.clearRect(0,0,r,s);const m=G("--muted"),h=G("--axis-outline");l.shadowColor=G("--shadow"),l.shadowBlur=4;const x=$(e),M=W(e),d=z(e.xMin,e.xMax,r,72),g=z(e.yMin,e.yMax,s,72),u=[];for(const p of d){const y=(p.value-e.xMin)/x*r;if(y<2||y>r-2||(l.globalAlpha=p.major?1:.6,F(l,y,s,y,s-(p.major?O:U),m,h,p.major?1.25:1),!p.major||y<28||y>r-28))continue;const _=document.createElement("span");_.textContent=p.label,_.style.left=`${y}px`,u.push(_)}H(o,u);const w=[];for(const p of g){const y=(p.value-e.yMin)/M*s;if(y<2||y>s-2||(l.globalAlpha=p.major?1:.6,F(l,r,y,r-(p.major?O:U),y,m,h,p.major?1.25:1),!p.major||y<16||y>s-18))continue;const _=document.createElement("span");_.textContent=sn(p.label),_.style.top=`${y}px`,w.push(_)}l.globalAlpha=1,H(i,w)}const cn=`// Magnetic-pendulum samples store three normalized dwell weights in 10 bits
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
`;function ln(n,e){const o=n[0]+n[1]+n[2];return o<=1e-12?{r:e===0?1:0,g:e===1?1:0,b:e===2?1:0}:{r:n[0]/o,g:n[1]/o,b:n[2]/o}}function un(n){return`rgb(${Math.round(n.r*255)} ${Math.round(n.g*255)} ${Math.round(n.b*255)})`}function fn(n){const e=new ArrayBuffer(4);new Float32Array(e)[0]=n;const o=new Uint32Array(e)[0];return[(o&1023)/1023,(o>>>10&1023)/1023,(o>>>20&1023)/1023]}const dn={gpuWgsl:cn,colorize(n,e,o){const i=fn(n);return o?[1-i[0],1-i[1],1-i[2]]:i},exposure:"none",initialMedian:1},b=1,pn=Math.sqrt(3)/2;function mn(n=b){const e=Math.max(1e-6,n),o=e*pn;return[{x:0,y:-e},{x:-o,y:e/2},{x:o,y:e/2}]}const hn=["#ff2020","#22c55e","#3b82f6"],R=96,xn=1.5,gn=1,yn=.25,Mn=2.5,_n=.22,Tn=.28,wn=.02,I=.03,vn=.22,En=.4,An=4,B=6,bn=.1,kn=8,C=1200,Sn=8e3,X=.05,Rn=1600,Nn=8,Pn=5,t=Math.fround,Gn=t(.8660254037844386),In=t(1e-12);function P(n){const e=t(Math.max(t(1e-6),n)),o=t(e*Gn);return[{x:0,y:t(-e)},{x:t(-o),y:t(e*t(.5))},{x:o,y:t(e*t(.5))}]}function Cn(n){return{K:t(n.K),G:t(n.G),F:t(n.F),H:t(n.H),R:t(n.R??b),DT:t(n.DT),maxIter:Math.max(1,Math.round(n.MAX_ITERATIONS??1))}}function Dn(n){return t(Math.max(t(vn),t(t(En)*n.R)+n.H))}function Ln(n,e,o,i,r){let s=t(t(-r.G*n)-t(r.F*o)),a=t(t(-r.G*e)-t(r.F*i));const c=t(r.H*r.H);for(const f of P(r.R)){const l=t(f.x-n),m=t(f.y-e),h=t(t(l*l)+t(m*m)),x=t(h+c),M=t(x*t(Math.sqrt(x))),d=t(r.K/Math.max(M,In));s=t(s+t(l*d)),a=t(a+t(m*d))}return{ax:s,ay:a}}function On(n,e,o,i,r){const s=t(t(n*n)+t(e*e)),a=t(t(B)*t(B));if(s>a)return 1;const c=t(Math.sqrt(t(t(o*o)+t(i*i)))),f=t(c*r),l=t(bn);return f<=l?1:Math.min(kn,1+Math.floor(t(f/l)))}function Un(n,e,o,i,r){const s=t(I),a=t(s*s);if(t(t(o*o)+t(i*i))>=a)return!1;const c=Dn(r),f=t(c*c);for(const l of P(r.R)){const m=t(l.x-n),h=t(l.y-e);if(t(t(m*m)+t(h*h))<f)return!0}return!1}function Fn(n,e,o,i,r){const s=t(Math.max(t(r.H*r.H),t(1e-4))),a=P(r.R),c=[0,0,0];for(let l=0;l<a.length;l++){const m=t(a[l].x-e),h=t(a[l].y-o),x=t(t(t(m*m)+t(h*h))+s);c[l]=t(1/x)}const f=t(Math.min(c[0],c[1],c[2]));for(let l=0;l<n.length;l++)n[l]=t(n[l]+t(i*t(c[l]-f)))}function zn(n,e,o=b){const i=P(t(o)),r=t(n),s=t(e);let a=0,c=Number.POSITIVE_INFINITY;for(let f=0;f<i.length;f++){const l=t(i[f].x-r),m=t(i[f].y-s),h=t(t(l*l)+t(m*m));h<c&&(c=h,a=f)}return a}function Hn(n,e,o,i){let r=t(n),s=t(e),a=0,c=0,f=0;const l=[0,0,0];for(let m=0;m<o.maxIter;m++){const h=On(r,s,a,c,o.DT),x=t(o.DT/t(h));for(let M=0;M<h;M++){const{ax:d,ay:g}=Ln(r,s,a,c,o);a=t(a+t(d*x)),c=t(c+t(g*x)),r=t(r+t(a*x)),s=t(s+t(c*x)),Fn(l,r,s,x,o)}if(i?.(r,s),Un(r,s,a,c,o)){if(f+=1,f>=An)break}else f=0}return{x:r,y:s,dwell:l}}function Bn(n,e,o){const i=[{x:t(n),y:t(e)}];let r=i[0];const s=Hn(n,e,o,(f,l)=>{const m=f-r.x,h=l-r.y;m*m+h*h<X*X||(i.length<Rn?(r={x:f,y:l},i.push(r)):(r={x:f,y:l},i[i.length-1]=r))}),a=i[i.length-1];return(!a||a.x!==s.x||a.y!==s.y)&&i.push({x:s.x,y:s.y}),{magnet:zn(s.x,s.y,o.R),dwell:s.dwell,path:i}}function N(n){const e=document.getElementById(n);if(!e)throw new Error(`Magnetic-pendulum presentation is missing #${n}`);return e}function A(n,e,o,i){return{x:(e.x-n.xMin)/$(n)*o,y:(e.y-n.yMin)/W(n)*i}}function Xn(n,e,o){return n.clientToWorld(e,o)}const $n=hn,Wn="#fff",Vn="#000",jn="rgba(255, 255, 255, 0.5)";function Kn(n){const e=N("map-axes"),o=N("probe-overlay"),i=N("map-scale-x"),r=N("map-scale-y");o.getContext("2d",{alpha:!0,desynchronized:!0});let s=null,a=0,c=null;function f(){const d=o.clientWidth,g=o.clientHeight,u=Math.min(window.devicePixelRatio||1,2),w=Math.round(d*u),p=Math.round(g*u);return(o.width!==w||o.height!==p)&&(o.width=w,o.height=p),{width:d,height:g}}function l(d,g,u,w,p){d.beginPath(),d.arc(g,u,w,0,Math.PI*2),d.fillStyle=p,d.fill(),d.lineWidth=1.5,d.strokeStyle="#000",d.stroke()}function m(){const{width:d,height:g}=f(),u=o.getContext("2d");if(!u||d<8||g<8)return;const w=o.width/Math.max(d,1);u.setTransform(w,0,0,w,0,0),u.clearRect(0,0,d,g);const p=n.getView(),y=Cn(n.params),_=mn(y.R);if(u.lineJoin="round",u.lineCap="round",u.strokeStyle="rgba(255, 255, 255, 0.22)",u.lineWidth=1,u.beginPath(),_.forEach((T,v)=>{const E=A(p,T,d,g);v===0?u.moveTo(E.x,E.y):u.lineTo(E.x,E.y)}),u.closePath(),u.stroke(),s){const T=Bn(s.x,s.y,y),v=A(p,{x:0,y:0},d,g),E=A(p,T.path[0],d,g);u.strokeStyle=jn,u.lineWidth=1.25,u.beginPath(),u.moveTo(v.x,v.y),u.lineTo(E.x,E.y),u.stroke(),u.beginPath(),T.path.forEach((V,j)=>{const k=A(p,V,d,g);j===0?u.moveTo(k.x,k.y):u.lineTo(k.x,k.y)}),u.strokeStyle=Vn,u.lineWidth=3.25,u.stroke(),u.strokeStyle=Wn,u.lineWidth=1.7,u.stroke();const L=A(p,s,d,g);l(u,L.x,L.y,Pn,un(ln(T.dwell,T.magnet)))}const D=A(p,{x:0,y:0},d,g);u.beginPath(),u.arc(D.x,D.y,2.5,0,Math.PI*2),u.fillStyle="#fff",u.fill();for(let T=0;T<_.length;T++){const v=A(p,_[T],d,g);l(u,v.x,v.y,Nn,$n[T])}}function h(){a=0,an(e,n.getView(),i,r),m()}function x(){a||(a=requestAnimationFrame(h))}function M(d){if(d.buttons!==0){s=null,x();return}s=n.snapToRenderedPixel(Xn(n,d.clientX,d.clientY)),x()}return n.clip.addEventListener("pointermove",M),n.clip.addEventListener("pointerleave",()=>{s=null,x()}),c=K(n.map,n.controls,n.onParamsChange,n.resetTransition,n.signals),{draw:x,tick(){},reset(){s=null,x()},noteActivity(){},resize:x,dismiss:()=>c?.setOpen(!1),pickPoint(){return!1},syncBudget:q}}const qn={compositor:dn,mount:Kn},Yn=`// Magnetic pendulum basins. Pixel = bob released from rest at (x, y).
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
`;function Qn(n,e,o,i,r){const s=new ArrayBuffer(80),a=new Float32Array(s),c=new Uint32Array(s);a[0]=n.xMin,a[1]=n.xMax,a[2]=n.yMin,a[3]=n.yMax,a[4]=i.K,a[5]=i.G,a[6]=i.F,a[7]=i.H,a[8]=i.DT,a[9]=I*I,a[10]=i.R??b,a[11]=0,c[12]=Math.max(C,Math.round(i.MAX_ITERATIONS??C)),c[13]=e,c[14]=o,c[15]=0,c[16]=0;const f=Y(n,r.normView??n,e,o);return c[17]=f.y0<<16|f.x0,c[18]=f.y1<<16|f.x1,c[19]=1,s}const Jn={computeWgsl:Yn,entryPoint:"simulate",uniformBytes:80,packUniforms:Qn},Zn={id:"magnets",title:"Magnetic pendulum",defaultView:{xMin:-R,xMax:R,yMin:-R,yMax:R},workBudget:{param:"MAX_ITERATIONS",min:C,max:Sn,step:50},params:[{key:"R",label:"param.R",kind:"float",min:yn,max:Mn,step:.01,default:b},{key:"K",label:"param.K",kind:"float",min:.1,max:3,step:.01,default:xn},{key:"G",label:"param.G",kind:"float",min:.05,max:2,step:.01,default:gn},{key:"F",label:"param.F",kind:"float",min:0,max:.8,step:.01,default:_n},{key:"H",label:"param.H",kind:"float",min:.08,max:.8,step:.01,default:Tn},{key:"DT",label:"param.DT",kind:"float",min:.005,max:.05,step:.001,default:wn,invert:!0,digits:3}],gpu:Jn};async function nt(){await Q(),await J(Zn,qn),Z(),nn()}nt();
