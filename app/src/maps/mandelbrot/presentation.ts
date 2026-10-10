import { bindMenu, syncBudgetReadout } from '../../viewer/menu';
import { emptyPresentation, type MapPresentationFactory } from '../../viewer/presentation';
import { mountOrbitOverlay } from './orbit-overlay';
import { mandelbrotCompositor } from './compositor';
import { ORBIT_PREFERENCE_KEY } from './constants';

export const mandelbrotPresentation: MapPresentationFactory = {
  compositor: mandelbrotCompositor,
  mount(host) {
    const orbit = mountOrbitOverlay(host);
    const showOrbit = document.querySelector<HTMLInputElement>('#show-orbit')!;
    try { showOrbit.checked = localStorage.getItem(ORBIT_PREFERENCE_KEY) !== 'false'; } catch { /* Storage may be unavailable. */ }
    orbit.setEnabled(showOrbit.checked);
    showOrbit.addEventListener('change', () => {
      orbit.setEnabled(showOrbit.checked);
      try { localStorage.setItem(ORBIT_PREFERENCE_KEY, String(showOrbit.checked)); } catch { /* Keep the in-memory preference. */ }
    });
    const menu = bindMenu(host.map, host.controls, host.onParamsChange, host.resetTransition, host.signals);
    const juliaControls = ['JULIA_REAL', 'JULIA_IMAG'].map((key) =>
      document.querySelector(`[data-param-value="${key}"]`)?.closest('label'));
    let lastMorph = -1;
    function sync(): void {
      const morph = host.params.MORPH ?? 0;
      if (morph === lastMorph) return;
      lastMorph = morph;
      for (const label of juliaControls) {
        label?.classList.toggle('is-inactive', morph === 0);
        const input = label?.querySelector('input');
        if (input) input.disabled = morph === 0;
      }
    }
    sync();
    return {
      ...emptyPresentation,
      draw() { sync(); orbit.draw(); },
      tick(now) { sync(); orbit.tick(now); },
      reset() { sync(); orbit.clear(); },
      noteActivity: orbit.clear,
      resize: orbit.draw,
      pickPoint: orbit.pickPoint,
      dismiss: () => menu.setOpen(false),
      syncBudget: syncBudgetReadout,
    };
  },
};
