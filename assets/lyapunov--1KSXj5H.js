import{v as Y,a as z,b as Q,s as Z,n as ee,l as te,c as ne,d as oe,e as re}from"./menu-DKrfTKVe.js";function U(e){return getComputedStyle(document.documentElement).getPropertyValue(e).trim()}function ae(e,t){const o=e/Math.max(2,Math.floor(t/90)),n=10**Math.floor(Math.log10(Math.max(o,Number.MIN_VALUE))),r=o/n;return(r<=1?1:r<=2?2:r<=5?5:10)*n}function se(e,t){const o=Math.max(0,Math.min(8,-Math.floor(Math.log10(t)))),n=e.toFixed(o),r=o>0?n.replace(/\.?0+$/,""):n;return r==="-0"?"0":r.replace("-","−")}function F(e,t,o){const n=t-e;if(!(n>0))return[];const r=ae(n,o),s=Math.ceil(e/r-1e-10)*r,l=[];for(let i=s;i<=t+r*1e-10&&l.length<64;i+=r)l.push({value:i,label:se(i,r)});return l}function I(e,t){const o=Array.from(e.children);for(let n=0;n<t.length;n++){const r=t[n],s=o[n]??document.createElement("span");o[n]||e.append(s),s.textContent=r.textContent,s.style.left=r.style.left,s.style.top=r.style.top}for(let n=o.length-1;n>=t.length;n--)o[n].remove()}function ie(e,t,o,n,r){const s=e.clientWidth,l=e.clientHeight;if(s<8||l<8)return;const i=Math.min(window.devicePixelRatio||1,2),u=Math.round(s*i),c=Math.round(l*i);(e.width!==u||e.height!==c)&&(e.width=u,e.height=c);const a=e.getContext("2d");if(!a)return;a.setTransform(i,0,0,i,0,0),a.clearRect(0,0,s,l),a.strokeStyle=U("--lyapunov-axis"),a.shadowColor=U("--shadow"),a.shadowBlur=4,a.lineWidth=1;const h=[];for(const g of F(t.xMin,t.xMax,s)){const p=(g.value-t.xMin)/Y(t)*s;if(p<=2||p>=s-2||(a.beginPath(),a.moveTo(p,l),a.lineTo(p,l-6),a.stroke(),p<28||p>s-28))continue;const _=document.createElement("span");_.textContent=g.label,_.style.left=`${p}px`,h.push(_)}I(o,h);const m=[];for(const g of F(t.yMin,t.yMax,l)){const p=(g.value-t.yMin)/z(t)*l;if(p<=2||p>=l-2||(a.beginPath(),a.moveTo(s,p),a.lineTo(s-6,p),a.stroke(),p<16||p>l-18))continue;const _=document.createElement("span");_.textContent=g.label,_.style.top=`${p}px`,m.push(_)}if(I(n,m),!r)return;const d=(r.x-t.xMin)/Y(t)*s,x=(r.y-t.yMin)/z(t)*l;if(d<0||d>s||x<0||x>l)return;const b=10,w=3,f=()=>{a.beginPath(),a.moveTo(d-b,x),a.lineTo(d-w,x),a.moveTo(d+w,x),a.lineTo(d+b,x),a.moveTo(d,x-b),a.lineTo(d,x-w),a.moveTo(d,x+w),a.lineTo(d,x+b),a.stroke()};a.shadowBlur=0,a.lineCap="round",a.strokeStyle=U("--reticle-outline"),a.lineWidth=4,f(),a.strokeStyle=U("--reticle-core"),a.lineWidth=2,f()}const H=2,W=4,v=["AABAB","AB","AAB","ABB","AABB"],E=0;v[E];const S=.5,q=200,B=1e-7,j=-Math.log(B),T=200,$=1600,D=40,le=480,ce=4;function ue(e){const t=Math.max(0,Math.min(v.length-1,Math.round(e)));return v[t]??v[E]}function pe(e,t,o,n=E,r=S){const s=ue(n),l=s.length;let i=r;const u=Math.max(1,Math.floor(q/l));for(let h=0;h<u;h++){for(let m=0;m<l;m++)i=(s.charCodeAt(m)===66?t:e)*i*(1-i);if(!Number.isFinite(i)||Math.abs(i)>16)return 1.5}const c=Math.max(1,Math.floor(Math.round(o)/l));let a=0;for(let h=0;h<c;h++){for(let m=0;m<l;m++){const d=s.charCodeAt(m)===66?t:e;a+=Math.log(Math.max(B,Math.abs(d*(1-2*i)))),i=d*i*(1-i)}if(!Number.isFinite(i)||Math.abs(i)>16)return 1.5}return a/(c*l)}function de(e){return e-j}const fe=`// Gold marks negative (stable) exponents; blue marks positive (chaotic)
// exponents. The black shoreline is lambda = 0.

const LYAPUNOV_OFFSET: f32 = 16.11809565095832;

fn palette_gold(t: f32) -> vec3f {
  let dark = vec3f(0.010, 0.006, 0.002);
  let amber = vec3f(0.72, 0.27, 0.005);
  let gold = vec3f(1.0, 0.68, 0.035);
  let light = vec3f(1.0, 0.965, 0.68);
  var color = mix(dark, amber, smoothstep(0.02, 0.52, t));
  color = mix(color, gold, smoothstep(0.40, 0.82, t));
  return mix(color, light, smoothstep(0.84, 1.0, t));
}

fn palette_blue(t: f32) -> vec3f {
  let dark = vec3f(0.002, 0.006, 0.018);
  let navy = vec3f(0.018, 0.075, 0.21);
  let cobalt = vec3f(0.055, 0.25, 0.62);
  let light = vec3f(0.27, 0.50, 0.83);
  var color = mix(dark, navy, smoothstep(0.0, 0.36, t));
  color = mix(color, cobalt, smoothstep(0.22, 0.76, t));
  return mix(color, light, smoothstep(0.72, 1.0, t));
}

fn adaptive_strength(tone: f32, value: f32, range: f32) -> f32 {
  let zero_tone = (log(1.0 + LYAPUNOV_OFFSET) - exposure.range.x) / range;
  if (value < 0.0) {
    return clamp((zero_tone - tone) / max(0.08, zero_tone), 0.0, 1.0);
  }
  return clamp((tone - zero_tone) / max(0.08, 1.0 - zero_tone), 0.0, 1.0);
}

fn lyapunov_color(value: f32, tone: f32, range: f32) -> vec3f {
  let fixed_strength = select(
    pow(clamp(value / 0.72, 0.0, 1.0), 0.46),
    pow(clamp(-value / 2.4, 0.0, 1.0), 0.42),
    value < 0.0,
  );
  let adaptive = adaptive_strength(tone, value, range);
  // A broad overview retains the original absolute contrast. Histogram gain
  // fades in only when zoom has compressed the visible exponent range.
  let adaptive_mix = 1.0 - smoothstep(0.025, 0.18, range);
  // A power lift makes small local variations legible when the whole zoomed
  // view sits close to zero, without flattening the absolute overview scale.
  let adaptive_lift = pow(adaptive, 0.30);
  let strength = mix(fixed_strength, adaptive_lift, adaptive_mix * 0.90);
  let fixed_edge = smoothstep(0.0, 0.018, abs(value));
  let adaptive_edge = smoothstep(0.006, 0.045, adaptive);
  let edge = mix(fixed_edge, adaptive_edge, adaptive_mix);
  if (value < 0.0) {
    return palette_gold(strength) * edge;
  }
  return palette_blue(strength) * edge;
}

fn map_sample_color(uv: vec2f, inverted: bool) -> vec3f {
  // Filtering cannot cross storage-buffer tile boundaries. Using it here
  // clamps the 3x3 neighborhood at every edge and draws a visible grid.
  // The longer orbit now supplies temporal stability without spatial seams.
  let sample_log = log_sample(uv);
  let value = exp(sample_log) - 1.0 - LYAPUNOV_OFFSET;
  let range = max(1e-6, exposure.range.y - exposure.range.x);
  let tone = clamp(
    (sample_log - exposure.range.x) / range,
    0.0,
    1.0,
  );
  var color = lyapunov_color(value, tone, range);
  if (inverted) {
    color = vec3f(1.0) - color;
  }
  return color;
}
`;function N(e){return Math.min(1,Math.max(0,e))}function M(e,t,o){const n=N((o-e)/(t-e));return n*n*(3-2*n)}function L(e,t,o){return[e[0]+(t[0]-e[0])*o,e[1]+(t[1]-e[1])*o,e[2]+(t[2]-e[2])*o]}function me(e){let t=L([.01,.006,.002],[.72,.27,.005],M(.02,.52,e));return t=L(t,[1,.68,.035],M(.4,.82,e)),L(t,[1,.965,.68],M(.84,1,e))}function he(e){let t=L([.002,.006,.018],[.018,.075,.21],M(0,.36,e));return t=L(t,[.055,.25,.62],M(.22,.76,e)),L(t,[.27,.5,.83],M(.72,1,e))}function xe(e,t,o){if(!Number.isFinite(e))return[0,0,0];let r=e<0?N((-e/2.4)**.42):N((e/.72)**.46),s=M(0,.018,Math.abs(e));if(o){const i=Math.max(1e-6,o.hi-o.lo),u=(Math.log1p(-Math.log(1e-7))-o.lo)/i,c=e<0?N((u-t)/Math.max(.08,u)):N((t-u)/Math.max(.08,1-u)),a=1-M(.025,.18,i),h=c**.3;r+=(h-r)*a*.9;const m=M(.006,.045,c);s+=(m-s)*a}const l=e<0?me(r):he(r);return[l[0]*s,l[1]*s,l[2]*s]}const ge={gpuWgsl:fe,colorize(e,t,o,n){const r=xe(de(e),t,n);return o?[1-r[0],1-r[1],1-r[2]]:r},exposure:"quantile",initialMedian:1};function A(e){const t=document.getElementById(e);if(!t)throw new Error(`Lyapunov presentation is missing #${e}`);return t}function ye(e){return`${e<0?"−":"+"}${Math.abs(e).toFixed(4)}`}function be(e){const t=Math.max(0,Math.min(v.length-1,Math.round(e.RHYTHM??E)));return v[t]}function _e(e){const t=A("map-axes"),o=A("map-scale-x"),n=A("map-scale-y"),r=A("map-hud"),s=A("lyapunov-readout"),l=A("sidebar"),i=A("narration-locale"),u=A("menu-toggle");let c=null,a=null,h=0,m=null;function d(){const f=Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ctrl-gap"))||0,g=l.getBoundingClientRect().right+f,p=Math.min(i.getBoundingClientRect().left,u.getBoundingClientRect().left)-f,_=Math.max(0,p-g);r.style.setProperty("--lyapunov-hud-center-x",`${g+_/2}px`),r.style.setProperty("--lyapunov-hud-max-width",`${_}px`)}function x(){h=0,ie(t,e.getView(),o,n,a);const f=c?e.clientToWorld(c.x,c.y):a;if(!f){s.textContent=be(e.params);return}const g=Math.min(640,e.params.MAX_ITERATIONS??T),p=pe(f.x,f.y,g,e.params.RHYTHM??E,e.params.SEED??S);s.textContent=`A ${f.x.toFixed(5)} · B ${f.y.toFixed(5)} · λ ${ye(p)}`}function b(){h||(h=requestAnimationFrame(x))}e.clip.addEventListener("pointermove",f=>{f.buttons!==0?c=null:c={x:f.clientX,y:f.clientY},b()}),e.clip.addEventListener("pointerleave",()=>{c=null,b()});const w=new ResizeObserver(d);return w.observe(l),w.observe(i),w.observe(u),window.addEventListener("resize",d),d(),m=Q(e.map,e.controls,e.onParamsChange,e.resetTransition,e.signals),{draw:b,tick(){},reset(){c=null,b()},noteActivity(){},resize(){d(),b()},dismiss:()=>m?.setOpen(!1),pickPoint(f,g,p,_,K){const J=window.matchMedia("(max-width: 700px), (max-height: 500px)").matches;return K==="mouse"&&!J||(a={x:f,y:g},c=null,b()),!1},syncBudget:Z}}const ve={compositor:ge,mount:_e},Me=`// Lyapunov exponent of a periodically forced logistic map.
// Pixel coordinates are the two growth parameters A and B; the forcing word
// A selected A/B rhythm is repeated after a short transient. Negative values are stable and
// positive values are chaotic. gid.y = 0 is view.yMin (top of the tile).

struct Uniforms {
  view: vec4f,    // x_min, x_max, y_min, y_max
  orbit: vec4f,   // seed, derivative epsilon, transient steps, encode offset
  pad: vec4f,
  size: vec4u,    // measured steps, width, height, rhythm index
  extra: vec4u,   // unused, packed (x0,y0), packed (x1,y1), weight
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> raw: array<f32>;

fn orbit_step(x: f32, r: f32) -> f32 {
  return r * x * (1.0 - x);
}

fn sequence_length(rhythm: u32) -> u32 {
  switch rhythm {
    case 1u: { return 2u; }
    case 2u: { return 3u; }
    case 3u: { return 3u; }
    case 4u: { return 4u; }
    default: { return 5u; }
  }
}

fn orbit_cycle(x0: f32, a: f32, b: f32, rhythm: u32) -> f32 {
  var x = x0;
  switch rhythm {
    case 1u: { // AB
      x = orbit_step(x, a);
      x = orbit_step(x, b);
    }
    case 2u: { // AAB
      x = orbit_step(x, a);
      x = orbit_step(x, a);
      x = orbit_step(x, b);
    }
    case 3u: { // ABB
      x = orbit_step(x, a);
      x = orbit_step(x, b);
      x = orbit_step(x, b);
    }
    case 4u: { // AABB
      x = orbit_step(x, a);
      x = orbit_step(x, a);
      x = orbit_step(x, b);
      x = orbit_step(x, b);
    }
    default: { // AABAB
      x = orbit_step(x, a);
      x = orbit_step(x, a);
      x = orbit_step(x, b);
      x = orbit_step(x, a);
      x = orbit_step(x, b);
    }
  }
  return x;
}

fn measure_step(state: vec2f, r: f32) -> vec2f {
  let derivative = abs(r * (1.0 - 2.0 * state.x));
  return vec2f(
    r * state.x * (1.0 - state.x),
    state.y + log(max(u.orbit.y, derivative)),
  );
}

fn measure_cycle(state0: vec2f, a: f32, b: f32, rhythm: u32) -> vec2f {
  var state = state0;
  switch rhythm {
    case 1u: {
      state = measure_step(state, a);
      state = measure_step(state, b);
    }
    case 2u: {
      state = measure_step(state, a);
      state = measure_step(state, a);
      state = measure_step(state, b);
    }
    case 3u: {
      state = measure_step(state, a);
      state = measure_step(state, b);
      state = measure_step(state, b);
    }
    case 4u: {
      state = measure_step(state, a);
      state = measure_step(state, a);
      state = measure_step(state, b);
      state = measure_step(state, b);
    }
    default: {
      state = measure_step(state, a);
      state = measure_step(state, a);
      state = measure_step(state, b);
      state = measure_step(state, a);
      state = measure_step(state, b);
    }
  }
  return state;
}

/** WGSL has no portable isFinite builtin; NaN is the only value unequal to itself. */
fn orbit_escaped(x: f32) -> bool {
  return x != x || abs(x) > 16.0;
}

fn encoded_exponent(a: f32, b: f32) -> f32 {
  let rhythm = min(u.size.w, 4u);
  let length = sequence_length(rhythm);
  var x = u.orbit.x;
  let warm_cycles = max(1u, u32(u.orbit.z) / length);
  for (var i = 0u; i < warm_cycles; i++) {
    x = orbit_cycle(x, a, b, rhythm);
    if (orbit_escaped(x)) {
      return u.orbit.w + 1.5;
    }
  }

  let measured_cycles = max(1u, u.size.x / length);
  var state = vec2f(x, 0.0);
  for (var i = 0u; i < measured_cycles; i++) {
    state = measure_cycle(state, a, b, rhythm);
    if (orbit_escaped(state.x)) {
      return u.orbit.w + 1.5;
    }
  }
  return u.orbit.w + state.y / f32(measured_cycles * length);
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
  let a = mix(u.view.x, u.view.y, nx);
  let b = mix(u.view.z, u.view.w, ny);
  raw[gid.y * width + gid.x] = encoded_exponent(a, b);
}
`;function we(e){return new Worker(""+new URL("tile-worker-Dtc1dl78.js",import.meta.url).href,{type:"module",name:e?.name})}let y=null,Ae=1,R=0;const P=new Map,k=[],G=[];function O(){const e=typeof navigator>"u"?4:navigator.hardwareConcurrency??4;return Math.max(1,Math.min(ce,e-1))}function Ee(){return O()}function Te(){const e=k.pop();return e?Promise.resolve(e):new Promise(t=>G.push(t))}function C(e){if(!y?.includes(e))return;const t=G.shift();t?t(e):k.push(e)}function Pe(e){const t=P.get(e.data.id);if(t){if(P.delete(e.data.id),!e.data.buffer||e.data.error){t.reject(new Error(e.data.error??"Lyapunov CPU worker returned no buffer"));return}t.resolve(e.data.buffer)}}function V(){const e=new we;return e.onmessage=Pe,e.onerror=t=>X(e,new Error(t.message||"Lyapunov CPU worker failed")),e.onmessageerror=()=>X(e,new Error("Lyapunov CPU worker message error")),e}function X(e,t){for(const[s,l]of P)l.worker===e&&(P.delete(s),l.reject(t));const o=k.indexOf(e);if(o>=0&&k.splice(o,1),!y)return;const n=y.indexOf(e);if(n<0)return;y.splice(n,1);try{e.terminate()}catch{}const r=V();y.push(r),C(r)}function Le(){if(!y)return;R+=1;const e=new Set(y);y=[],k.length=0;const t=new Error("Lyapunov CPU tile superseded by a newer camera");t.name="AbortError";for(const[o,n]of P)e.has(n.worker)&&(P.delete(o),n.reject(t));for(const o of e)try{o.terminate()}catch{}for(let o=0;o<O();o++){const n=V();y.push(n),C(n)}}function ke(){if(!y){y=[];for(let e=0;e<O();e++){const t=V();y.push(t),k.push(t)}}}function Ne(e,t){return new Promise((o,n)=>{P.set(t.id,{worker:e,resolve:o,reject:n}),e.postMessage(t)})}async function Se(e,t,o,n){ke();const r=R,s=await Te();try{if(r!==R){const i=new Error("Lyapunov CPU tile superseded before dispatch");throw i.name="AbortError",i}const l=await Ne(s,{id:Ae++,width:Math.max(1,Math.round(t)),height:Math.max(1,Math.round(o)),xMin:e.xMin,xMax:e.xMax,yMin:e.yMin,yMax:e.yMax,maxIter:Math.max(T,Math.round(n.MAX_ITERATIONS??T)),rhythm:Math.round(n.RHYTHM??E),seed:n.SEED??S});return new Float32Array(l)}finally{C(s)}}function Ue(e,t,o,n,r){const s=Math.max(T,Math.round(n.MAX_ITERATIONS??T)),l=new ArrayBuffer(80),i=new Float32Array(l),u=new Uint32Array(l);i[0]=e.xMin,i[1]=e.xMax,i[2]=e.yMin,i[3]=e.yMax,i[4]=n.SEED??S,i[5]=B,i[6]=q,i[7]=j,u[12]=s,u[13]=t,u[14]=o,u[15]=Math.max(0,Math.min(v.length-1,Math.round(n.RHYTHM??E)));const c=ee(e,r.normView??e,t,o);return u[17]=c.y0<<16|c.x0,u[18]=c.y1<<16|c.x1,u[19]=1,l}const Re={computeWgsl:Me,entryPoint:"simulate",uniformBytes:80,tileSize:128,dispatchBatch:1,packUniforms:Ue},Be={id:"lyapunov",title:"Lyapunov fractal",settledResolution:{gpu:"device",cpu:"device"},defaultView:{xMin:H,xMax:W,yMin:H,yMax:W},workBudget:{param:"MAX_ITERATIONS",min:T,max:$,step:D,adaptive:!1},params:[{key:"RHYTHM",label:"param.lyapunov.rhythm",kind:"int",min:0,max:v.length-1,step:1,default:E,choices:v,section:"primary"},{key:"MAX_ITERATIONS",label:"param.lyapunov.accuracy",kind:"int",min:T,max:$,step:D,default:le,section:"primary"},{key:"SEED",label:"param.lyapunov.seed",kind:"float",min:.05,max:.95,step:.01,default:S,digits:2,section:"primary"}],gpu:Re,cpu:{fillTile:Se,cancelPending:Le,concurrency:Ee()}};async function Oe(){await te(),await ne(Be,ve),oe(),re()}Oe();
