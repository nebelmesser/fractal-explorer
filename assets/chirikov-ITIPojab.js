import{v as N,a as B,b as W,s as z,n as L,l as F,c as $,d as D,e as X}from"./menu-DEf-9Ab7.js";function T(e){return getComputedStyle(document.documentElement).getPropertyValue(e).trim()}function j(e,t){const o=e/Math.max(2,Math.floor(t/90)),n=10**Math.floor(Math.log10(Math.max(o,Number.MIN_VALUE))),r=o/n;return(r<=1?1:r<=2?2:r<=5?5:10)*n}function q(e,t){const o=Math.max(0,Math.min(8,-Math.floor(Math.log10(t)))),n=e.toFixed(o),r=o>0?n.replace(/\.?0+$/,""):n;return r==="-0"?"0":r.replace("-","−")}function O(e,t,o){const n=t-e;if(!(n>0))return[];const r=j(n,o),i=Math.ceil(e/r-1e-10)*r,a=[];for(let c=i;c<=t+r*1e-10&&a.length<64;c+=r)a.push({value:c,label:q(c,r)});return a}function P(e,t){const o=Array.from(e.children);for(let n=0;n<t.length;n++){const r=t[n],i=o[n]??document.createElement("span");o[n]||e.append(i),i.textContent=r.textContent,i.style.left=r.style.left,i.style.top=r.style.top}for(let n=o.length-1;n>=t.length;n--)o[n].remove()}function Y(e,t,o,n){const r=e.clientWidth,i=e.clientHeight;if(r<8||i<8)return;const a=Math.min(window.devicePixelRatio||1,2),c=Math.round(r*a),h=Math.round(i*a);(e.width!==c||e.height!==h)&&(e.width=c,e.height=h);const s=e.getContext("2d");if(!s)return;s.setTransform(a,0,0,a,0,0),s.clearRect(0,0,r,i),s.strokeStyle=T("--chirikov-axis"),s.shadowColor=T("--shadow"),s.shadowBlur=4,s.lineWidth=1;const p=[];for(const l of O(t.xMin,t.xMax,r)){const u=(l.value-t.xMin)/N(t)*r;if(u<=2||u>=r-2||(s.beginPath(),s.moveTo(u,i),s.lineTo(u,i-6),s.stroke(),u<28||u>r-28))continue;const m=document.createElement("span");m.textContent=l.label,m.style.left=`${u}px`,p.push(m)}P(o,p);const d=[];for(const l of O(t.yMin,t.yMax,i)){const u=(l.value-t.yMin)/B(t)*i;if(u<=2||u>=i-2||(s.beginPath(),s.moveTo(r,u),s.lineTo(r-6,u),s.stroke(),u<16||u>i-18))continue;const m=document.createElement("span");m.textContent=l.label,m.style.top=`${u}px`,d.push(m)}P(n,d)}const M=Math.PI*2,y=Math.PI,v=.971635,G=0,J=4,Q=.005,k=48,E=512,K=16,I=160,Z=4,ee=24,te=34,ne=6,oe=`// Cyclic high-chroma phase palette over a black orbit portrait.

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
`;function V(e){return Math.min(1,Math.max(0,e))}function re(e,t,o){const n=V((o-e)/(t-e));return n*n*(3-2*n)}function ie(e,t,o){return[e[0]+(t[0]-e[0])*o,e[1]+(t[1]-e[1])*o,e[2]+(t[2]-e[2])*o]}function ae(e){const t=new ArrayBuffer(4);new Float32Array(t)[0]=e;const o=new Uint32Array(t)[0];return{phase:(o&1023)/1023,coherence:(o>>>10&1023)/1023,contourPhase:(o>>>20&1023)/1023}}function ce(e){const t=(e%1+1)%1,o=[[0,[1,.035,.005]],[.16,[1,.72,0]],[.34,[.08,.92,.025]],[.52,[0,.72,.9]],[.69,[.015,.16,1]],[.84,[.72,0,.68]],[1,[1,.035,.005]]];for(let n=1;n<o.length;n++){if(t>o[n][0])continue;const[r,i]=o[n-1],[a,c]=o[n];return ie(i,c,(t-r)/(a-r))}return o[0][1]}function se(e){const t=ae(e),o=t.phase*te+t.contourPhase*ne,n=.5+.5*Math.cos(Math.PI*2*o),r=re(.76,.997,n)**1.5,i=Math.sqrt(t.coherence),a=V(r*(.22+.86*i)+t.coherence**4*.02),c=ce((t.phase+t.contourPhase*.08)%1);return[c[0]*a,c[1]*a,c[2]*a]}const ue={gpuWgsl:oe,colorize(e,t,o){const n=se(e);return o?[1-n[0],1-n[1],1-n[2]]:n},exposure:"none",initialMedian:1};function g(e){return e-M*Math.floor((e+y)/M)}function le(e,t,o,n){let r=g(e),i=g(t),a=0,c=0,h=r;const s=Math.max(1,Math.round(n)),p=Math.min(ee,s);for(let u=0;u<s;u++){const m=Math.sin(r);i=g(i+o*m),r=g(r+i),u+1===p&&(h=r),a+=Math.cos(i),c+=Math.sin(i)}a/=s,c/=s;const d=Math.atan2(c,a)/M+.5,l=h/M+.5;return{theta:r,momentum:i,phase:d-Math.floor(d),coherence:Math.min(1,Math.hypot(a,c)),contourPhase:l-Math.floor(l)}}function w(e){const t=document.getElementById(e);if(!t)throw new Error(`Chirikov presentation is missing #${e}`);return t}function U(e,t){return`${e<0?"−":"+"}${Math.abs(e).toFixed(t)}`}function he(e){const t=w("map-axes"),o=w("map-scale-x"),n=w("map-scale-y"),r=w("chirikov-readout");let i=null,a=0,c=null;function h(){a=0,Y(t,e.getView(),o,n);const p=e.params.K??v,d=e.params.MAX_ITERATIONS??I;if(!i){r.textContent=`K ${p.toFixed(3)} · ${Math.round(d)}`;return}const l=e.clientToWorld(i.x,i.y),u=le(l.x,l.y,p,Math.min(256,d));r.textContent=[`θ ${U(l.x,4)}`,`p ${U(l.y,4)}`,`C ${u.coherence.toFixed(3)}`].join(" · ")}function s(){a||(a=requestAnimationFrame(h))}return e.clip.addEventListener("pointermove",p=>{p.buttons!==0?i=null:i={x:p.clientX,y:p.clientY},s()}),e.clip.addEventListener("pointerleave",()=>{i=null,s()}),c=W(e.map,e.controls,e.onParamsChange,e.resetTransition,e.signals),{draw:s,tick(){},reset(){i=null,s()},noteActivity(){},resize:s,dismiss:()=>c?.setOpen(!1),pickPoint(){return!1},syncBudget:z}}const fe={compositor:ue,mount:he},pe=`// Chirikov-Taylor standard map on a 2π × 2π torus.
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
`;function me(e){return new Worker(""+new URL("tile-worker-Bhn0iWqD.js",import.meta.url).href,{type:"module",name:e?.name})}let f=null,de=1,C=0;const x=new Map,_=[],H=[];function b(){const e=typeof navigator>"u"?4:navigator.hardwareConcurrency??4;return Math.max(1,Math.min(Z,e-1))}function xe(){return b()}function Me(){const e=_.pop();return e?Promise.resolve(e):new Promise(t=>H.push(t))}function R(e){if(!f?.includes(e))return;const t=H.shift();t?t(e):_.push(e)}function _e(e){const t=x.get(e.data.id);if(t){if(x.delete(e.data.id),!e.data.buffer||e.data.error){t.reject(new Error(e.data.error??"Chirikov CPU worker returned no buffer"));return}t.resolve(e.data.buffer)}}function A(){const e=new me;return e.onmessage=_e,e.onerror=t=>S(e,new Error(t.message||"Chirikov CPU worker failed")),e.onmessageerror=()=>S(e,new Error("Chirikov CPU worker message error")),e}function S(e,t){for(const[i,a]of x)a.worker===e&&(x.delete(i),a.reject(t));const o=_.indexOf(e);if(o>=0&&_.splice(o,1),!f)return;const n=f.indexOf(e);if(n<0)return;f.splice(n,1);try{e.terminate()}catch{}const r=A();f.push(r),R(r)}function ye(){if(!f)return;C+=1;const e=new Set(f);f=[],_.length=0;const t=new Error("Chirikov CPU tile superseded by a newer camera");t.name="AbortError";for(const[o,n]of x)e.has(n.worker)&&(x.delete(o),n.reject(t));for(const o of e)try{o.terminate()}catch{}for(let o=0;o<b();o++){const n=A();f.push(n),R(n)}}function ge(){if(!f){f=[];for(let e=0;e<b();e++){const t=A();f.push(t),_.push(t)}}}function we(e,t){return new Promise((o,n)=>{x.set(t.id,{worker:e,resolve:o,reject:n}),e.postMessage(t)})}async function ke(e,t,o,n){ge();const r=C,i=await Me();try{if(r!==C){const c=new Error("Chirikov CPU tile superseded before dispatch");throw c.name="AbortError",c}const a=await we(i,{id:de++,width:Math.max(1,Math.round(t)),height:Math.max(1,Math.round(o)),xMin:e.xMin,xMax:e.xMax,yMin:e.yMin,yMax:e.yMax,k:n.K??v,iterations:Math.max(k,Math.round(n.MAX_ITERATIONS??I))});return new Float32Array(a)}finally{R(i)}}function ve(e,t,o,n,r){const i=new ArrayBuffer(80),a=new Float32Array(i),c=new Uint32Array(i);a[0]=e.xMin,a[1]=e.xMax,a[2]=e.yMin,a[3]=e.yMax,a[4]=n.K??v,c[12]=Math.max(k,Math.round(n.MAX_ITERATIONS??I)),c[13]=t,c[14]=o,c[15]=0,c[16]=0;const h=L(e,r.normView??e,t,o);return c[17]=h.y0<<16|h.x0,c[18]=h.y1<<16|h.x1,c[19]=1,i}const Ie={computeWgsl:pe,entryPoint:"simulate",uniformBytes:80,tileSize:128,dispatchBatch:1,packUniforms:ve},Ce={id:"chirikov",title:"Chirikov–Taylor map",settledResolution:"device",settledResolutionIdleMs:0,defaultView:{xMin:-y,xMax:y,yMin:-y,yMax:y},navigation:{xPeriod:{period:M,center:0},yPeriod:{period:M,center:0}},workBudget:{param:"MAX_ITERATIONS",min:k,max:E,step:K,adaptive:!1},params:[{key:"K",label:"K",kind:"float",min:G,max:J,step:Q,default:v,digits:3,section:"primary"},{key:"MAX_ITERATIONS",label:"N",kind:"int",min:k,max:E,step:K,default:I,section:"primary"}],gpu:Ie,cpu:{fillTile:ke,cancelPending:ye,concurrency:xe(),handoffPx:.5}};async function be(){await F(),await $(Ce,fe),D(),X()}be();
