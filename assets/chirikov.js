import{v as N,a as B,b as W,s as z,n as L,l as F,c as $,d as D,e as X}from"./explorer-menu.js";function T(e){return getComputedStyle(document.documentElement).getPropertyValue(e).trim()}function j(e,n){const o=e/Math.max(2,Math.floor(n/90)),t=10**Math.floor(Math.log10(Math.max(o,Number.MIN_VALUE))),r=o/t;return(r<=1?1:r<=2?2:r<=5?5:10)*t}function q(e,n){const o=Math.max(0,Math.min(8,-Math.floor(Math.log10(n)))),t=e.toFixed(o),r=o>0?t.replace(/\.?0+$/,""):t;return r==="-0"?"0":r.replace("-","−")}function O(e,n,o){const t=n-e;if(!(t>0))return[];const r=j(t,o),i=Math.ceil(e/r-1e-10)*r,a=[];for(let c=i;c<=n+r*1e-10&&a.length<64;c+=r)a.push({value:c,label:q(c,r)});return a}function P(e,n){const o=Array.from(e.children);for(let t=0;t<n.length;t++){const r=n[t],i=o[t]??document.createElement("span");o[t]||e.append(i),i.textContent=r.textContent,i.style.left=r.style.left,i.style.top=r.style.top}for(let t=o.length-1;t>=n.length;t--)o[t].remove()}function Y(e,n,o,t){const r=e.clientWidth,i=e.clientHeight;if(r<8||i<8)return;const a=Math.min(window.devicePixelRatio||1,2),c=Math.round(r*a),h=Math.round(i*a);(e.width!==c||e.height!==h)&&(e.width=c,e.height=h);const s=e.getContext("2d");if(!s)return;s.setTransform(a,0,0,a,0,0),s.clearRect(0,0,r,i),s.strokeStyle=T("--chirikov-axis"),s.shadowColor=T("--shadow"),s.shadowBlur=4,s.lineWidth=1;const p=[];for(const l of O(n.xMin,n.xMax,r)){const u=(l.value-n.xMin)/N(n)*r;if(u<=2||u>=r-2||(s.beginPath(),s.moveTo(u,i),s.lineTo(u,i-6),s.stroke(),u<28||u>r-28))continue;const m=document.createElement("span");m.textContent=l.label,m.style.left=`${u}px`,p.push(m)}P(o,p);const d=[];for(const l of O(n.yMin,n.yMax,i)){const u=(l.value-n.yMin)/B(n)*i;if(u<=2||u>=i-2||(s.beginPath(),s.moveTo(r,u),s.lineTo(r-6,u),s.stroke(),u<16||u>i-18))continue;const m=document.createElement("span");m.textContent=l.label,m.style.top=`${u}px`,d.push(m)}P(t,d)}const _=Math.PI*2,M=Math.PI,v=.971635,G=0,J=4,Q=.005,k=48,E=512,K=16,I=160,Z=4,ee=24,ne=34,te=6,oe=`// Cyclic high-chroma phase palette over a black orbit portrait.

const CHIRIKOV_COLOR_BANDS: f32 = 34.0;
const CHIRIKOV_ORBIT_BANDS: f32 = 6.0;

fn phase_palette(phase: f32) -> vec3f {
  let h = fract(phase);
  if (h < 0.16) {
    return mix(vec3f(1.0, 0.035, 0.005), vec3f(1.0, 0.72, 0.0), h / 0.16);
  }
  if (h < 0.34) {
    return mix(vec3f(1.0, 0.72, 0.0), vec3f(0.08, 0.92, 0.025), (h - 0.16) / 0.18);
  }
  if (h < 0.52) {
    return mix(vec3f(0.08, 0.92, 0.025), vec3f(0.0, 0.72, 0.90), (h - 0.34) / 0.18);
  }
  if (h < 0.69) {
    return mix(vec3f(0.0, 0.72, 0.90), vec3f(0.015, 0.16, 1.0), (h - 0.52) / 0.17);
  }
  if (h < 0.84) {
    return mix(vec3f(0.015, 0.16, 1.0), vec3f(0.72, 0.0, 0.68), (h - 0.69) / 0.15);
  }
  return mix(vec3f(0.72, 0.0, 0.68), vec3f(1.0, 0.035, 0.005), (h - 0.84) / 0.16);
}

fn map_sample_color(uv: vec2f, inverted: bool) -> vec3f {
  let dims = vec2f(f32(draw.size.x), f32(draw.size.y));
  let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * dims - vec2f(0.5);
  let packed = bitcast<u32>(raw_at(i32(round(p.x)), i32(round(p.y))));
  let phase = f32(packed & 1023u) / 1023.0;
  let coherence = f32((packed >> 10u) & 1023u) / 1023.0;
  let orbit_phase = f32((packed >> 20u) & 1023u) / 1023.0;
  let contour_phase = phase * CHIRIKOV_COLOR_BANDS + orbit_phase * CHIRIKOV_ORBIT_BANDS;
  let wave = 0.5 + 0.5 * cos(6.283185307179586 * contour_phase);
  let filament = pow(smoothstep(0.76, 0.997, wave), 1.5);
  let order = sqrt(coherence);
  let intensity = clamp(
    filament * (0.22 + 0.86 * order)
      + pow(coherence, 4.0) * 0.02,
    0.0,
    1.0,
  );
  var color = phase_palette(fract(phase + orbit_phase * 0.08)) * intensity;
  if (inverted) {
    color = vec3f(1.0) - color;
  }
  return color;
}
`;function V(e){return Math.min(1,Math.max(0,e))}function re(e,n,o){const t=V((o-e)/(n-e));return t*t*(3-2*t)}function ie(e,n,o){return[e[0]+(n[0]-e[0])*o,e[1]+(n[1]-e[1])*o,e[2]+(n[2]-e[2])*o]}function ae(e){const n=new ArrayBuffer(4);new Float32Array(n)[0]=e;const o=new Uint32Array(n)[0];return{phase:(o&1023)/1023,coherence:(o>>>10&1023)/1023,contourPhase:(o>>>20&1023)/1023}}function ce(e){const n=(e%1+1)%1,o=[[0,[1,.035,.005]],[.16,[1,.72,0]],[.34,[.08,.92,.025]],[.52,[0,.72,.9]],[.69,[.015,.16,1]],[.84,[.72,0,.68]],[1,[1,.035,.005]]];for(let t=1;t<o.length;t++){if(n>o[t][0])continue;const[r,i]=o[t-1],[a,c]=o[t];return ie(i,c,(n-r)/(a-r))}return o[0][1]}function se(e){const n=ae(e),o=n.phase*ne+n.contourPhase*te,t=.5+.5*Math.cos(Math.PI*2*o),r=re(.76,.997,t)**1.5,i=Math.sqrt(n.coherence),a=V(r*(.22+.86*i)+n.coherence**4*.02),c=ce((n.phase+n.contourPhase*.08)%1);return[c[0]*a,c[1]*a,c[2]*a]}const ue={gpuWgsl:oe,colorize(e,n,o){const t=se(e);return o?[1-t[0],1-t[1],1-t[2]]:t},exposure:"none",initialMedian:1};function g(e){return e-_*Math.floor((e+M)/_)}function le(e,n,o,t){let r=g(e),i=g(n),a=0,c=0,h=r;const s=Math.max(1,Math.round(t)),p=Math.min(ee,s);for(let u=0;u<s;u++){const m=Math.sin(r);i=g(i+o*m),r=g(r+i),u+1===p&&(h=r),a+=Math.cos(i),c+=Math.sin(i)}a/=s,c/=s;const d=Math.atan2(c,a)/_+.5,l=h/_+.5;return{theta:r,momentum:i,phase:d-Math.floor(d),coherence:Math.min(1,Math.hypot(a,c)),contourPhase:l-Math.floor(l)}}function w(e){const n=document.getElementById(e);if(!n)throw new Error(`Chirikov presentation is missing #${e}`);return n}function U(e,n){return`${e<0?"−":"+"}${Math.abs(e).toFixed(n)}`}function he(e){const n=w("map-axes"),o=w("map-scale-x"),t=w("map-scale-y"),r=w("chirikov-readout");let i=null,a=0,c=null;function h(){a=0,Y(n,e.getView(),o,t);const p=e.params.K??v,d=e.params.MAX_ITERATIONS??I;if(!i){r.textContent=`K ${p.toFixed(3)} · ${Math.round(d)}`;return}const l=e.clientToWorld(i.x,i.y),u=le(l.x,l.y,p,Math.min(256,d));r.textContent=[`θ ${U(l.x,4)}`,`p ${U(l.y,4)}`,`C ${u.coherence.toFixed(3)}`].join(" · ")}function s(){a||(a=requestAnimationFrame(h))}return e.clip.addEventListener("pointermove",p=>{p.buttons!==0?i=null:i={x:p.clientX,y:p.clientY},s()}),e.clip.addEventListener("pointerleave",()=>{i=null,s()}),c=W(e.map,e.controls,e.onParamsChange,e.resetTransition,e.signals),{draw:s,tick(){},reset(){i=null,s()},noteActivity(){},resize:s,dismiss:()=>c?.setOpen(!1),pickPoint(){return!1},syncBudget:z}}const fe={compositor:ue,mount:he},pe=`// Chirikov-Taylor standard map on a 2π × 2π torus.
// Each sample packs mean orbit phase, circular coherence, and terminal phase.

const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;
const CONTOUR_ITER: u32 = 24u;

struct Uniforms {
  view: vec4f,    // theta_min, theta_max, p_min, p_max
  orbit: vec4f,   // K, unused, unused, unused
  pad: vec4f,
  size: vec4u,    // iterations, width, height, unused
  extra: vec4u,   // unused, packed (x0,y0), packed (x1,y1), weight
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> raw: array<f32>;

fn wrap_angle(value: f32) -> f32 {
  return value - TAU * floor((value + PI) / TAU);
}

fn packed_signature(theta0: f32, momentum0: f32) -> f32 {
  var theta = wrap_angle(theta0);
  var momentum = wrap_angle(momentum0);
  var mean = vec2f(0.0);
  var contour_theta = theta;
  let steps = max(1u, u.size.x);
  let contour_step = min(CONTOUR_ITER, steps);

  for (var i = 0u; i < steps; i++) {
    let kick = sin(theta);
    momentum = wrap_angle(momentum + u.orbit.x * kick);
    theta = wrap_angle(theta + momentum);
    if (i + 1u == contour_step) {
      contour_theta = theta;
    }
    mean += vec2f(cos(momentum), sin(momentum));
  }

  mean /= f32(steps);
  let phase = fract(atan2(mean.y, mean.x) / TAU + 0.5);
  let coherence = clamp(length(mean), 0.0, 1.0);
  let orbit_phase = fract(contour_theta / TAU + 0.5);
  let phase_bits = u32(round(phase * 1023.0));
  let coherence_bits = u32(round(coherence * 1023.0));
  let orbit_phase_bits = u32(round(orbit_phase * 1023.0));
  return bitcast<f32>(phase_bits | (coherence_bits << 10u) | (orbit_phase_bits << 20u));
}

@compute @workgroup_size(8, 8)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let width = u.size.y;
  let height = u.size.z;
  if (gid.x >= width || gid.y >= height) {
    return;
  }
  let nx = (f32(gid.x) + 0.5) / f32(width);
  let ny = (f32(gid.y) + 0.5) / f32(height);
  let theta = mix(u.view.x, u.view.y, nx);
  let momentum = mix(u.view.z, u.view.w, ny);
  raw[gid.y * width + gid.x] = packed_signature(theta, momentum);
}
`;function me(e){return new Worker(""+new URL("tile-worker-Bhn0iWqD.js",import.meta.url).href,{type:"module",name:e?.name})}let f=null,de=1,C=0;const x=new Map,y=[],H=[];function b(){const e=typeof navigator>"u"?4:navigator.hardwareConcurrency??4;return Math.max(1,Math.min(Z,e-1))}function xe(){return b()}function _e(){const e=y.pop();return e?Promise.resolve(e):new Promise(n=>H.push(n))}function R(e){if(!f?.includes(e))return;const n=H.shift();n?n(e):y.push(e)}function ye(e){const n=x.get(e.data.id);if(n){if(x.delete(e.data.id),!e.data.buffer||e.data.error){n.reject(new Error(e.data.error??"Chirikov CPU worker returned no buffer"));return}n.resolve(e.data.buffer)}}function A(){const e=new me;return e.onmessage=ye,e.onerror=n=>S(e,new Error(n.message||"Chirikov CPU worker failed")),e.onmessageerror=()=>S(e,new Error("Chirikov CPU worker message error")),e}function S(e,n){for(const[i,a]of x)a.worker===e&&(x.delete(i),a.reject(n));const o=y.indexOf(e);if(o>=0&&y.splice(o,1),!f)return;const t=f.indexOf(e);if(t<0)return;f.splice(t,1);try{e.terminate()}catch{}const r=A();f.push(r),R(r)}function Me(){if(!f)return;C+=1;const e=new Set(f);f=[],y.length=0;const n=new Error("Chirikov CPU tile superseded by a newer camera");n.name="AbortError";for(const[o,t]of x)e.has(t.worker)&&(x.delete(o),t.reject(n));for(const o of e)try{o.terminate()}catch{}for(let o=0;o<b();o++){const t=A();f.push(t),R(t)}}function ge(){if(!f){f=[];for(let e=0;e<b();e++){const n=A();f.push(n),y.push(n)}}}function we(e,n){return new Promise((o,t)=>{x.set(n.id,{worker:e,resolve:o,reject:t}),e.postMessage(n)})}async function ke(e,n,o,t){ge();const r=C,i=await _e();try{if(r!==C){const c=new Error("Chirikov CPU tile superseded before dispatch");throw c.name="AbortError",c}const a=await we(i,{id:de++,width:Math.max(1,Math.round(n)),height:Math.max(1,Math.round(o)),xMin:e.xMin,xMax:e.xMax,yMin:e.yMin,yMax:e.yMax,k:t.K??v,iterations:Math.max(k,Math.round(t.MAX_ITERATIONS??I))});return new Float32Array(a)}finally{R(i)}}function ve(e,n,o,t,r){const i=new ArrayBuffer(80),a=new Float32Array(i),c=new Uint32Array(i);a[0]=e.xMin,a[1]=e.xMax,a[2]=e.yMin,a[3]=e.yMax,a[4]=t.K??v,c[12]=Math.max(k,Math.round(t.MAX_ITERATIONS??I)),c[13]=n,c[14]=o,c[15]=0,c[16]=0;const h=L(e,r.normView??e,n,o);return c[17]=h.y0<<16|h.x0,c[18]=h.y1<<16|h.x1,c[19]=1,i}const Ie={computeWgsl:pe,entryPoint:"simulate",uniformBytes:80,tileSize:128,dispatchBatch:1,packUniforms:ve},Ce={id:"chirikov",title:"Chirikov–Taylor map",settledResolution:"device",defaultView:{xMin:-M,xMax:M,yMin:-M,yMax:M},navigation:{xPeriod:{period:_,center:0},yPeriod:{period:_,center:0}},workBudget:{param:"MAX_ITERATIONS",min:k,max:E,step:K,adaptive:!1},params:[{key:"K",label:"K",kind:"float",min:G,max:J,step:Q,default:v,digits:3,section:"primary"},{key:"MAX_ITERATIONS",label:"N",kind:"int",min:k,max:E,step:K,default:I,section:"primary"}],gpu:Ie,cpu:{fillTile:ke,cancelPending:Me,concurrency:xe(),handoffPx:.5}};async function be(){await F(),await $(Ce,fe),D(),X()}be();
