import './style.css';
import { bindHighlight, bindUnhighlight, mountNarrator, type Narrator } from '@nebelmesser/narration';
import { applyUi, loadUi, onUiChange, t, uiLocale } from '../../i18n';
import { bootViewer } from '../../viewer/runtime';
import type { ViewerSignals } from '../../viewer/presentation';
import { pendulumPresentation } from './presentation';
import { pendulumMap } from './spec';

function narrationEnabled(): boolean {
  return new URLSearchParams(location.search).get('narration') === '1';
}

function retrigger(narrator: Narrator, key: string): void {
  const value = narrator.store.get(key);
  if (value === undefined) return;
  narrator.store.delete(key);
  narrator.store.set(key, value);
}

function restartNarration(narrator: Narrator): void {
  narrator.reset();
  narrator.setUi({ enableSound: t('enable_sound') });
  narrator.setLocale(uiLocale());
  if (narrator.store.get('map_ready') === true) narrator.emit('map-ready');
  retrigger(narrator, 'zoom_deg');
  retrigger(narrator, 'page_sec');
  if (narrator.store.get('simulation_running') === true) retrigger(narrator, 'simulation_sec');
}

async function main(): Promise<void> {
  await loadUi();
  let signals: ViewerSignals | undefined;
  if (narrationEnabled()) {
    const narrator = await mountNarrator({ ui: { enableSound: t('enable_sound') } });
    const targets = {
      'menu-toggle': '#menu-toggle',
      'settings-panel': '#ui-container',
      'zoom-in': '#zoom-in',
      map: '#map-clip',
      probe: '#probe-overlay',
    };
    narrator.on('highlight', bindHighlight(targets));
    narrator.on('unhighlight', bindUnhighlight(targets));
    onUiChange(() => restartNarration(narrator));
    signals = {
      emit: (name) => narrator.emit(name),
      set: (key, value) => narrator.store.set(key, value),
    };
  }
  await bootViewer(pendulumMap, pendulumPresentation, signals);
  applyUi();
}

void main();
