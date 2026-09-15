import{v as H,a as W,b as D,s as X,n as $,l as q,c as j,d as G,e as K}from"./menu-CQcaK0is.js";function U(e){return getComputedStyle(document.documentElement).getPropertyValue(e).trim()}function J(e,t){const o=e/Math.max(2,Math.floor(t/90)),n=10**Math.floor(Math.log10(Math.max(o,Number.MIN_VALUE))),r=o/n;return(r<=1?1:r<=2?2:r<=5?5:10)*n}function Q(e,t){const o=Math.max(0,Math.min(8,-Math.floor(Math.log10(t)))),n=e.toFixed(o),r=o>0?n.replace(/\.?0+$/,""):n;return r==="-0"?"0":r.replace("-","−")}function S(e,t,o){const n=t-e;if(!(n>0))return[];const r=J(n,o),a=Math.ceil(e/r-1e-10)*r,c=[];for(let s=a;s<=t+r*1e-10&&c.length<64;s+=r)c.push({value:s,label:Q(s,r)});return c}function O(e,t){const o=Array.from(e.children);for(let n=0;n<t.length;n++){const r=t[n],a=o[n]??document.createElement("span");o[n]||e.append(a),a.textContent=r.textContent,a.style.left=r.style.left,a.style.top=r.style.top}for(let n=o.length-1;n>=t.length;n--)o[n].remove()}function Z(e,t,o,n){const r=e.clientWidth,a=e.clientHeight;if(r<8||a<8)return;const c=Math.min(window.devicePixelRatio||1,2),s=Math.round(r*c),l=Math.round(a*c);(e.width!==s||e.height!==l)&&(e.width=s,e.height=l);const i=e.getContext("2d");if(!i)return;i.setTransform(c,0,0,c,0,0),i.clearRect(0,0,r,a),i.strokeStyle=U("--lyapunov-axis"),i.shadowColor=U("--shadow"),i.shadowBlur=4,i.lineWidth=1;const p=[];for(const f of S(t.xMin,t.xMax,r)){const u=(f.value-t.xMin)/H(t)*r;if(u<=2||u>=r-2||(i.beginPath(),i.moveTo(u,a),i.lineTo(u,a-6),i.stroke(),u<28||u>r-28))continue;const y=document.createElement("span");y.textContent=f.label,y.style.left=`${u}px`,p.push(y)}O(o,p);const m=[];for(const f of S(t.yMin,t.yMax,a)){const u=(f.value-t.yMin)/W(t)*a;if(u<=2||u>=a-2||(i.beginPath(),i.moveTo(r,u),i.lineTo(r-6,u),i.stroke(),u<16||u>a-18))continue;const y=document.createElement("span");y.textContent=f.label,y.style.top=`${u}px`,m.push(y)}O(n,m)}const R=2,B=4,h=["AABAB","AB","AAB","ABB","AABB"],g=0;h[g];const A=.5,I=200,T=1e-7,F=-Math.log(T),b=200,C=1600,V=40,ee=480,te=4;function ne(e){const t=Math.max(0,Math.min(h.length-1,Math.round(e)));return h[t]??h[g]}function oe(e,t,o,n=g,r=A){const a=ne(n),c=a.length;let s=r;const l=Math.max(1,Math.floor(I/c));for(let m=0;m<l;m++){for(let f=0;f<c;f++)s=(a.charCodeAt(f)===66?t:e)*s*(1-s);if(!Number.isFinite(s)||Math.abs(s)>16)return 1.5}const i=Math.max(1,Math.floor(Math.round(o)/c));let p=0;for(let m=0;m<i;m++){for(let f=0;f<c;f++){const u=a.charCodeAt(f)===66?t:e;p+=Math.log(Math.max(T,Math.abs(u*(1-2*s)))),s=u*s*(1-s)}if(!Number.isFinite(s)||Math.abs(s)>16)return 1.5}return p/(i*c)}function re(e){return e-F}const ae=`// Gold marks negative (stable) exponents; blue marks positive (chaotic)
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
`;function w(e){return Math.min(1,Math.max(0,e))}function x(e,t,o){const n=w((o-e)/(t-e));return n*n*(3-2*n)}function v(e,t,o){return[e[0]+(t[0]-e[0])*o,e[1]+(t[1]-e[1])*o,e[2]+(t[2]-e[2])*o]}function se(e){let t=v([.01,.006,.002],[.72,.27,.005],x(.02,.52,e));return t=v(t,[1,.68,.035],x(.4,.82,e)),v(t,[1,.965,.68],x(.84,1,e))}function ie(e){let t=v([.002,.006,.018],[.018,.075,.21],x(0,.36,e));return t=v(t,[.055,.25,.62],x(.22,.76,e)),v(t,[.27,.5,.83],x(.72,1,e))}function ce(e,t,o){if(!Number.isFinite(e))return[0,0,0];let r=e<0?w((-e/2.4)**.42):w((e/.72)**.46),a=x(0,.018,Math.abs(e));if(o){const s=Math.max(1e-6,o.hi-o.lo),l=(Math.log1p(-Math.log(1e-7))-o.lo)/s,i=e<0?w((l-t)/Math.max(.08,l)):w((t-l)/Math.max(.08,1-l)),p=1-x(.025,.18,s),m=i**.3;r+=(m-r)*p*.9;const f=x(.006,.045,i);a+=(f-a)*p}const c=e<0?se(r):ie(r);return[c[0]*a,c[1]*a,c[2]*a]}const le={gpuWgsl:ae,colorize(e,t,o,n){const r=ce(re(e),t,n);return o?[1-r[0],1-r[1],1-r[2]]:r},exposure:"quantile",initialMedian:1};function E(e){const t=document.getElementById(e);if(!t)throw new Error(`Lyapunov presentation is missing #${e}`);return t}function ue(e){return`${e<0?"−":"+"}${Math.abs(e).toFixed(4)}`}function pe(e){const t=Math.max(0,Math.min(h.length-1,Math.round(e.RHYTHM??g)));return h[t]}function fe(e){const t=E("map-axes"),o=E("map-scale-x"),n=E("map-scale-y"),r=E("lyapunov-readout");let a=null,c=0,s=null;function l(){if(c=0,Z(t,e.getView(),o,n),!a){r.textContent=pe(e.params);return}const p=e.clientToWorld(a.x,a.y),m=Math.min(640,e.params.MAX_ITERATIONS??b),f=oe(p.x,p.y,m,e.params.RHYTHM??g,e.params.SEED??A);r.textContent=`A ${p.x.toFixed(5)} · B ${p.y.toFixed(5)} · λ ${ue(f)}`}function i(){c||(c=requestAnimationFrame(l))}return e.clip.addEventListener("pointermove",p=>{p.buttons!==0?a=null:a={x:p.clientX,y:p.clientY},i()}),e.clip.addEventListener("pointerleave",()=>{a=null,i()}),s=D(e.map,e.controls,e.onParamsChange,e.resetTransition,e.signals),{draw:i,tick(){},reset(){a=null,i()},noteActivity(){},resize:i,dismiss:()=>s?.setOpen(!1),pickPoint(){return!1},syncBudget:X}}const me={compositor:le,mount:fe},de=`// Lyapunov exponent of a periodically forced logistic map.
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
`;function he(e){return new Worker(""+new URL("tile-worker-Dtc1dl78.js",import.meta.url).href,{type:"module",name:e?.name})}let d=null,xe=1,P=0;const _=new Map,M=[],z=[];function L(){const e=typeof navigator>"u"?4:navigator.hardwareConcurrency??4;return Math.max(1,Math.min(te,e-1))}function ge(){return L()}function ye(){const e=M.pop();return e?Promise.resolve(e):new Promise(t=>z.push(t))}function k(e){if(!d?.includes(e))return;const t=z.shift();t?t(e):M.push(e)}function be(e){const t=_.get(e.data.id);if(t){if(_.delete(e.data.id),!e.data.buffer||e.data.error){t.reject(new Error(e.data.error??"Lyapunov CPU worker returned no buffer"));return}t.resolve(e.data.buffer)}}function N(){const e=new he;return e.onmessage=be,e.onerror=t=>Y(e,new Error(t.message||"Lyapunov CPU worker failed")),e.onmessageerror=()=>Y(e,new Error("Lyapunov CPU worker message error")),e}function Y(e,t){for(const[a,c]of _)c.worker===e&&(_.delete(a),c.reject(t));const o=M.indexOf(e);if(o>=0&&M.splice(o,1),!d)return;const n=d.indexOf(e);if(n<0)return;d.splice(n,1);try{e.terminate()}catch{}const r=N();d.push(r),k(r)}function _e(){if(!d)return;P+=1;const e=new Set(d);d=[],M.length=0;const t=new Error("Lyapunov CPU tile superseded by a newer camera");t.name="AbortError";for(const[o,n]of _)e.has(n.worker)&&(_.delete(o),n.reject(t));for(const o of e)try{o.terminate()}catch{}for(let o=0;o<L();o++){const n=N();d.push(n),k(n)}}function ve(){if(!d){d=[];for(let e=0;e<L();e++){const t=N();d.push(t),M.push(t)}}}function Me(e,t){return new Promise((o,n)=>{_.set(t.id,{worker:e,resolve:o,reject:n}),e.postMessage(t)})}async function we(e,t,o,n){ve();const r=P,a=await ye();try{if(r!==P){const s=new Error("Lyapunov CPU tile superseded before dispatch");throw s.name="AbortError",s}const c=await Me(a,{id:xe++,width:Math.max(1,Math.round(t)),height:Math.max(1,Math.round(o)),xMin:e.xMin,xMax:e.xMax,yMin:e.yMin,yMax:e.yMax,maxIter:Math.max(b,Math.round(n.MAX_ITERATIONS??b)),rhythm:Math.round(n.RHYTHM??g),seed:n.SEED??A});return new Float32Array(c)}finally{k(a)}}function Ae(e,t,o,n,r){const a=Math.max(b,Math.round(n.MAX_ITERATIONS??b)),c=new ArrayBuffer(80),s=new Float32Array(c),l=new Uint32Array(c);s[0]=e.xMin,s[1]=e.xMax,s[2]=e.yMin,s[3]=e.yMax,s[4]=n.SEED??A,s[5]=T,s[6]=I,s[7]=F,l[12]=a,l[13]=t,l[14]=o,l[15]=Math.max(0,Math.min(h.length-1,Math.round(n.RHYTHM??g)));const i=$(e,r.normView??e,t,o);return l[17]=i.y0<<16|i.x0,l[18]=i.y1<<16|i.x1,l[19]=1,c}const Ee={computeWgsl:de,entryPoint:"simulate",uniformBytes:80,tileSize:128,dispatchBatch:1,packUniforms:Ae},Pe={id:"lyapunov",title:"Lyapunov fractal",settledResolution:{gpu:"device",cpu:"device"},defaultView:{xMin:R,xMax:B,yMin:R,yMax:B},workBudget:{param:"MAX_ITERATIONS",min:b,max:C,step:V,adaptive:!1},params:[{key:"RHYTHM",label:"param.lyapunov.rhythm",kind:"int",min:0,max:h.length-1,step:1,default:g,choices:h,section:"primary"},{key:"MAX_ITERATIONS",label:"param.lyapunov.accuracy",kind:"int",min:b,max:C,step:V,default:ee,section:"primary"},{key:"SEED",label:"param.lyapunov.seed",kind:"float",min:.05,max:.95,step:.01,default:A,digits:2,section:"primary"}],gpu:Ee,cpu:{fillTile:we,cancelPending:_e,concurrency:ge()}};async function Te(){await q(),await j(Pe,me),G(),K()}Te();
