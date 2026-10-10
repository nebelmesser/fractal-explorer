import { coordinateToString, COORDINATE_ONE, coordinateFromNumber, type CoordinateOrigin } from '../../viewer/coordinates';
import { ORBIT_COORDINATE_MIN_DIGITS, ORBIT_COORDINATE_MAX_DIGITS, ORBIT_COORDINATE_DISPLAY_CHARS } from './constants';
import type { MapParams, ViewRect } from '../types';
import { MANDELBROT_VIEW, ORBIT_JULIA_EXTENT } from './constants';
import type { ComplexPoint } from './cycles';

export type OrbitProjection = (point: ComplexPoint) => ComplexPoint;

/** Keep the full family visible as the parameter plane becomes the Julia plane. */
export function orbitOverviewView(params: MapParams): ViewRect {
  const t = params.MORPH ?? 0, v = MANDELBROT_VIEW, r = ORBIT_JULIA_EXTENT;
  return {
    xMin: v.xMin*(1-t)-r*t, xMax: v.xMax*(1-t)+r*t,
    yMin: v.yMin*(1-t)-r*t, yMax: v.yMax*(1-t)+r*t,
  };
}

export function orbitStart(point: CoordinateOrigin, morph: number): CoordinateOrigin {
  const scale = coordinateFromNumber(morph);
  return {x: point.x*scale/COORDINATE_ONE, y: point.y*scale/COORDINATE_ONE};
}

export function onScreen(p: ComplexPoint, width: number, height: number): boolean {
  return Number.isFinite(p.r+p.i) && p.r>=0 && p.r<=width && p.i>=0 && p.i<=height;
}

export function orbitCoordinates(point: CoordinateOrigin, pitch: number) {
  const digits = Math.min(ORBIT_COORDINATE_MAX_DIGITS,Math.max(ORBIT_COORDINATE_MIN_DIGITS,Math.ceil(-Math.log10(pitch))+1));
  const x=coordinateToString(point.x,digits), y=coordinateToString(-point.y,digits);
  const compact=(value:string)=>value.length>ORBIT_COORDINATE_DISPLAY_CHARS
    ? `${value.slice(0,12)}…${value.slice(-8)}` : value;
  const negative=y.startsWith('-'), magnitude=negative?y.slice(1):y;
  return {x,y,complex:`${x} ${negative?'−':'+'} ${magnitude}i`,
    shortX:compact(x),shortY:compact(y),shortComplex:`${compact(x)} ${negative?'−':'+'} ${compact(magnitude)}i`};
}

/** Clip before sending deep-zoom coordinates to Canvas, which may use f32 internally. */
export function clipOrbitSegment(a: ComplexPoint, b: ComplexPoint, width: number, height: number): [ComplexPoint,ComplexPoint] | null {
  a={...a}; b={...b};
  const code=(p:ComplexPoint)=>(p.r<0?1:p.r>width?2:0)|(p.i<0?4:p.i>height?8:0);
  const intersect=(a0:number,b0:number,a1:number,b1:number,edge:number)=>Math.abs(edge-a1)<Math.abs(edge-b1)
    ? a0+(b0-a0)*((edge-a1)/(b1-a1)) : b0+(a0-b0)*((edge-b1)/(a1-b1));
  for(let n=0;n<8;n++) {
    const ca=code(a),cb=code(b);
    if(!(ca|cb))return [a,b];
    if(ca&cb)return null;
    const outside=ca||cb;
    let p:ComplexPoint;
    if(outside&12) {
      const i=outside&4?0:height;
      p={r:intersect(a.r,b.r,a.i,b.i,i),i};
    } else {
      const r=outside&1?0:width;
      p={r,i:intersect(a.i,b.i,a.r,b.r,r)};
    }
    if(!Number.isFinite(p.r+p.i))return null;
    if(ca)a=p;else b=p;
  }
  return null;
}
