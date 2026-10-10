import { bindMapInput } from '../src/viewer/input';
import { coordinateFromString, coordinateToNumber, exactCenter, preciseView, withPrecision } from '../src/viewer/coordinates';
import { shortSpan } from '../src/viewer/view';

export function checkDeepPinch(): string {
  const surface = document.createElement('div');
  surface.style.cssText = 'position:fixed;left:0;top:0;width:360px;height:640px;opacity:0;pointer-events:none';
  document.body.appendChild(surface);
  let view = preciseView({ x: coordinateFromString('-0.743643887037151'), y: coordinateFromString('-0.13182590420533') }, 1e-80, 1e-80);
  const before = exactCenter(view);
  const input = bindMapInput(surface, {
    getView: () => view, getWorld: () => withPrecision({ xMin:-3,xMax:3,yMin:-3,yMax:3 }),
    getNavigation: () => ({}), getMinSpan: () => 1e-280,
    setView: next => { view = next; }, popHistory() {}, pickPoint: () => false,
  });
  const event = (type: string, pointerId: number, x: number) => surface.dispatchEvent(new PointerEvent(type,{pointerId,pointerType:'touch',clientX:x,clientY:320,button:0,bubbles:true}));
  event('pointerdown',1,100); event('pointerdown',2,260); event('pointermove',2,260);
  event('pointermove',1,60); event('pointermove',2,300);
  const after=exactCenter(view);
  if(Math.abs(coordinateToNumber(after.x-before.x)/1e-80)>1e-12 || Math.abs(coordinateToNumber(after.y-before.y)/1e-80)>1e-12) throw new Error('Deep pinch moved its anchor');
  if(Math.abs(shortSpan(view)/1e-80-2/3)>1e-12)throw new Error('Deep pinch lost its scale');
  event('pointerup',1,60);event('pointerup',2,300);input.stopCoast();surface.remove();
  return 'Deep touch pinch: exact center and 2/3 scale PASS';
}
