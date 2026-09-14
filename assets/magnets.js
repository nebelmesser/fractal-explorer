import{v as W,d as $,f as j,s as K,n as q,l as Y,i as Q,j as J,k as Z}from"./explorer-menu.js";const nn=[1,2,5],S=5,O=6,U=4/3;function G(n){const e=getComputedStyle(document.documentElement).getPropertyValue(n).trim();if(!e)throw new Error(`Missing magnets color ${n}`);return e}function F(n,e,r,i,s,o,a,l){n.lineCap="butt",n.strokeStyle=a,n.lineWidth=l+2,n.beginPath(),n.moveTo(e,r),n.lineTo(i,s),n.stroke(),n.strokeStyle=o,n.lineWidth=l,n.beginPath(),n.moveTo(e,r),n.lineTo(i,s),n.stroke()}function tn(n){return n.coeff===1?{coeff:2,exp:n.exp,step:2*10**n.exp}:n.coeff===2?{coeff:5,exp:n.exp,step:5*10**n.exp}:{coeff:1,exp:n.exp+1,step:10**(n.exp+1)}}function en(n){if(!(n>0)||!Number.isFinite(n))return{coeff:1,exp:0,step:1};const e=Math.floor(Math.log10(n));let r=1,i=e,s=1/0;for(const o of nn)for(const a of[e-1,e,e+1]){const l=o*10**a,u=Math.abs(Math.log(l/n));u<s&&(r=o,i=a,s=u)}return{coeff:r,exp:i,step:r*10**i}}function on(n){return n==="0"||/^0(\.0+)?$/.test(n)?n:n.startsWith("−")?n.slice(1):`−${n}`}function sn(n,e){const r=n*e.coeff,i=r<0;if(r===0)return e.exp>=0?"0":`0.${"0".repeat(-e.exp)}`;const s=String(Math.abs(r));if(e.exp>=0)return`${i?"−":""}${s}${"0".repeat(e.exp)}`;const o=s.padStart(-e.exp+1,"0"),a=o.length+e.exp;return`${i?"−":""}${o.slice(0,a)}.${o.slice(a)}`}function z(n,e,r,i){const s=e-n;if(!(s>0)||!Number.isFinite(s))return[];const o=Math.max(2,Math.floor(r/i));let a=en(s/o);for(;s/a.step>o;)a=tn(a);const l=a.step/S,u=Math.ceil(n/l-1e-12),c=Math.floor(e/l+1e-12),p=Math.min(Math.max(0,Math.floor(c-u)+1),S*(o+4)),m=[];for(let x=0;x<p;x++){const M=u+x,d=M%S===0,y=M/S;m.push({value:d?y*a.coeff*10**a.exp:M*l,major:d,label:d?sn(y,a):""})}return m}function H(n,e){const r=Array.from(n.children);for(let i=0;i<e.length;i++){const s=e[i],o=r[i]??document.createElement("span");r[i]||n.append(o),o.textContent!==s.textContent&&(o.textContent=s.textContent),o.className!==s.className&&(o.className=s.className),o.style.left!==s.style.left&&(o.style.left=s.style.left),o.style.top!==s.style.top&&(o.style.top=s.style.top)}for(let i=r.length-1;i>=e.length;i--)r[i].remove()}function rn(n,e,r,i){const s=n.clientWidth,o=n.clientHeight;if(s<8||o<8)return;const a=Math.min(window.devicePixelRatio||1,2),l=Math.round(s*a),u=Math.round(o*a);(n.width!==l||n.height!==u)&&(n.width=l,n.height=u);const c=n.getContext("2d");if(!c)return;c.setTransform(a,0,0,a,0,0),c.clearRect(0,0,s,o);const p=G("--muted"),m=G("--axis-outline");c.shadowColor=G("--shadow"),c.shadowBlur=4;const x=W(e),M=$(e),d=z(e.xMin,e.xMax,s,72),y=z(e.yMin,e.yMax,o,72),f=[];for(const h of d){const g=(h.value-e.xMin)/x*s;if(g<2||g>s-2||(c.globalAlpha=h.major?1:.6,F(c,g,o,g,o-(h.major?O:U),p,m,h.major?1.25:1),!h.major||g<28||g>s-28))continue;const _=document.createElement("span");_.textContent=h.label,_.style.left=`${g}px`,f.push(_)}H(r,f);const w=[];for(const h of y){const g=(h.value-e.yMin)/M*o;if(g<2||g>o-2||(c.globalAlpha=h.major?1:.6,F(c,s,g,s-(h.major?O:U),g,p,m,h.major?1.25:1),!h.major||g<16||g>o-18))continue;const _=document.createElement("span");_.textContent=on(h.label),_.style.top=`${g}px`,w.push(_)}c.globalAlpha=1,H(i,w)}const an=`// Magnetic-pendulum samples store three normalized dwell weights in 10 bits
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
`;function ln(n){const e=new ArrayBuffer(4);new Float32Array(e)[0]=n;const r=new Uint32Array(e)[0];return[(r&1023)/1023,(r>>>10&1023)/1023,(r>>>20&1023)/1023]}const cn={gpuWgsl:an,colorize(n,e,r){const i=ln(n);return r?[1-i[0],1-i[1],1-i[2]]:i},exposure:"none",initialMedian:1},b=1,un=Math.sqrt(3)/2;function fn(n=b){const e=Math.max(1e-6,n),r=e*un;return[{x:0,y:-e},{x:-r,y:e/2},{x:r,y:e/2}]}const dn=["#ff2020","#22c55e","#3b82f6"],R=96,pn=1.5,mn=1,hn=.25,xn=2.5,yn=.22,gn=.28,Mn=.02,C=.03,_n=.22,wn=.4,Tn=4,B=6,vn=.1,En=8,L=1200,An=8e3,X=.05,bn=1600,kn=8,Sn=5,t=Math.fround,Rn=t(.8660254037844386),Nn=t(1e-12);function P(n){const e=t(Math.max(t(1e-6),n)),r=t(e*Rn);return[{x:0,y:t(-e)},{x:t(-r),y:t(e*t(.5))},{x:r,y:t(e*t(.5))}]}function Pn(n){return{K:t(n.K),G:t(n.G),F:t(n.F),H:t(n.H),R:t(n.R??b),DT:t(n.DT),maxIter:Math.max(1,Math.round(n.MAX_ITERATIONS??1))}}function Gn(n){return t(Math.max(t(_n),t(t(wn)*n.R)+n.H))}function In(n,e,r,i,s){let o=t(t(-s.G*n)-t(s.F*r)),a=t(t(-s.G*e)-t(s.F*i));const l=t(s.H*s.H);for(const u of P(s.R)){const c=t(u.x-n),p=t(u.y-e),m=t(t(c*c)+t(p*p)),x=t(m+l),M=t(x*t(Math.sqrt(x))),d=t(s.K/Math.max(M,Nn));o=t(o+t(c*d)),a=t(a+t(p*d))}return{ax:o,ay:a}}function Cn(n,e,r,i,s){const o=t(t(n*n)+t(e*e)),a=t(t(B)*t(B));if(o>a)return 1;const l=t(Math.sqrt(t(t(r*r)+t(i*i)))),u=t(l*s),c=t(vn);return u<=c?1:Math.min(En,1+Math.floor(t(u/c)))}function Ln(n,e,r,i,s){const o=t(C),a=t(o*o);if(t(t(r*r)+t(i*i))>=a)return!1;const l=Gn(s),u=t(l*l);for(const c of P(s.R)){const p=t(c.x-n),m=t(c.y-e);if(t(t(p*p)+t(m*m))<u)return!0}return!1}function Dn(n,e,r,i,s){const o=t(Math.max(t(s.H*s.H),t(1e-4))),a=P(s.R),l=[0,0,0];for(let c=0;c<a.length;c++){const p=t(a[c].x-e),m=t(a[c].y-r),x=t(t(t(p*p)+t(m*m))+o);l[c]=t(1/x)}const u=t(Math.min(l[0],l[1],l[2]));for(let c=0;c<n.length;c++)n[c]=t(n[c]+t(i*t(l[c]-u)))}function On(n,e,r=b){const i=P(t(r)),s=t(n),o=t(e);let a=0,l=Number.POSITIVE_INFINITY;for(let u=0;u<i.length;u++){const c=t(i[u].x-s),p=t(i[u].y-o),m=t(t(c*c)+t(p*p));m<l&&(l=m,a=u)}return a}function Un(n,e,r,i){let s=t(n),o=t(e),a=0,l=0,u=0;const c=[0,0,0];for(let p=0;p<r.maxIter;p++){const m=Cn(s,o,a,l,r.DT),x=t(r.DT/t(m));for(let M=0;M<m;M++){const{ax:d,ay:y}=In(s,o,a,l,r);a=t(a+t(d*x)),l=t(l+t(y*x)),s=t(s+t(a*x)),o=t(o+t(l*x)),Dn(c,s,o,x,r)}if(i?.(s,o),Ln(s,o,a,l,r)){if(u+=1,u>=Tn)break}else u=0}return{x:s,y:o,dwell:c}}function Fn(n,e,r){const i=[{x:t(n),y:t(e)}];let s=i[0];const o=Un(n,e,r,(u,c)=>{const p=u-s.x,m=c-s.y;p*p+m*m<X*X||(i.length<bn?(s={x:u,y:c},i.push(s)):(s={x:u,y:c},i[i.length-1]=s))}),a=i[i.length-1];return(!a||a.x!==o.x||a.y!==o.y)&&i.push({x:o.x,y:o.y}),{magnet:On(o.x,o.y,r.R),dwell:o.dwell,path:i}}function N(n){const e=document.getElementById(n);if(!e)throw new Error(`Magnetic-pendulum presentation is missing #${n}`);return e}function A(n,e,r,i){return{x:(e.x-n.xMin)/W(n)*r,y:(e.y-n.yMin)/$(n)*i}}function zn(n,e,r){return n.clientToWorld(e,r)}const I=dn,Hn="#fff",Bn="#000";function Xn(n){const e=N("map-axes"),r=N("probe-overlay"),i=N("map-scale-x"),s=N("map-scale-y");r.getContext("2d",{alpha:!0,desynchronized:!0});let o=null,a=0,l=null;function u(){const d=r.clientWidth,y=r.clientHeight,f=Math.min(window.devicePixelRatio||1,2),w=Math.round(d*f),h=Math.round(y*f);return(r.width!==w||r.height!==h)&&(r.width=w,r.height=h),{width:d,height:y}}function c(d,y,f,w,h){d.beginPath(),d.arc(y,f,w,0,Math.PI*2),d.fillStyle=h,d.fill(),d.lineWidth=1.5,d.strokeStyle="#000",d.stroke()}function p(){const{width:d,height:y}=u(),f=r.getContext("2d");if(!f||d<8||y<8)return;const w=r.width/Math.max(d,1);f.setTransform(w,0,0,w,0,0),f.clearRect(0,0,d,y);const h=n.getView(),g=Pn(n.params),_=fn(g.R);if(f.lineJoin="round",f.lineCap="round",f.strokeStyle="rgba(255, 255, 255, 0.22)",f.lineWidth=1,f.beginPath(),_.forEach((T,v)=>{const E=A(h,T,d,y);v===0?f.moveTo(E.x,E.y):f.lineTo(E.x,E.y)}),f.closePath(),f.stroke(),o){const T=Fn(o.x,o.y,g);f.beginPath(),T.path.forEach((E,V)=>{const k=A(h,E,d,y);V===0?f.moveTo(k.x,k.y):f.lineTo(k.x,k.y)}),f.strokeStyle=Bn,f.lineWidth=3.25,f.stroke(),f.strokeStyle=Hn,f.lineWidth=1.7,f.stroke();const v=A(h,o,d,y);c(f,v.x,v.y,Sn,I[T.magnet]??I[0])}const D=A(h,{x:0,y:0},d,y);f.beginPath(),f.arc(D.x,D.y,2.5,0,Math.PI*2),f.fillStyle="#fff",f.fill();for(let T=0;T<_.length;T++){const v=A(h,_[T],d,y);c(f,v.x,v.y,kn,I[T])}}function m(){a=0,rn(e,n.getView(),i,s),p()}function x(){a||(a=requestAnimationFrame(m))}function M(d){if(d.buttons!==0){o=null,x();return}o=n.snapToRenderedPixel(zn(n,d.clientX,d.clientY)),x()}return n.clip.addEventListener("pointermove",M),n.clip.addEventListener("pointerleave",()=>{o=null,x()}),l=j(n.map,n.controls,n.onParamsChange,n.resetTransition,n.signals),{draw:x,tick(){},reset(){o=null,x()},noteActivity(){},resize:x,dismiss:()=>l?.setOpen(!1),pickPoint(){return!1},syncBudget:K}}const Wn={compositor:cn,mount:Xn},$n=`// Magnetic pendulum basins. Pixel = bob released from rest at (x, y).
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
`;function Vn(n,e,r,i,s){const o=new ArrayBuffer(80),a=new Float32Array(o),l=new Uint32Array(o);a[0]=n.xMin,a[1]=n.xMax,a[2]=n.yMin,a[3]=n.yMax,a[4]=i.K,a[5]=i.G,a[6]=i.F,a[7]=i.H,a[8]=i.DT,a[9]=C*C,a[10]=i.R??b,a[11]=0,l[12]=Math.max(L,Math.round(i.MAX_ITERATIONS??L)),l[13]=e,l[14]=r,l[15]=0,l[16]=0;const u=q(n,s.normView??n,e,r);return l[17]=u.y0<<16|u.x0,l[18]=u.y1<<16|u.x1,l[19]=1,o}const jn={computeWgsl:$n,entryPoint:"simulate",uniformBytes:80,packUniforms:Vn},Kn={id:"magnets",title:"Magnetic pendulum",defaultView:{xMin:-R,xMax:R,yMin:-R,yMax:R},workBudget:{param:"MAX_ITERATIONS",min:L,max:An,step:50},params:[{key:"R",label:"param.R",kind:"float",min:hn,max:xn,step:.01,default:b},{key:"K",label:"param.K",kind:"float",min:.1,max:3,step:.01,default:pn},{key:"G",label:"param.G",kind:"float",min:.05,max:2,step:.01,default:mn},{key:"F",label:"param.F",kind:"float",min:0,max:.8,step:.01,default:yn},{key:"H",label:"param.H",kind:"float",min:.08,max:.8,step:.01,default:gn},{key:"DT",label:"param.DT",kind:"float",min:.005,max:.05,step:.001,default:Mn,invert:!0,digits:3}],gpu:jn};async function qn(){await Y(),await Q(Kn,Wn),J(),Z()}qn();
