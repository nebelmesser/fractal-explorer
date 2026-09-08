import './style.css';
import { bindHighlight, bindUnhighlight, mountNarrator } from '@nebelmesser/narration';
import { bootViewer } from '../../viewer/runtime';
import type { ViewerSignals } from '../../viewer/presentation';
import { pendulumPresentation } from './presentation';
import { pendulumMap } from './spec';

function narrationEnabled(): boolean {
  return new URLSearchParams(location.search).get('narration') === '1';
}

async function main(): Promise<void> {
  let signals: ViewerSignals | undefined;
  if (narrationEnabled()) {
    const narrator = await mountNarrator();
    const targets = {
      'menu-toggle': '#menu-toggle',
      'settings-panel': '#ui-container',
      'zoom-in': '#zoom-in',
      map: '#map-clip',
      probe: '#probe-overlay',
    };
    narrator.on('highlight', bindHighlight(targets));
    narrator.on('unhighlight', bindUnhighlight(targets));
    signals = {
      emit: (name) => narrator.emit(name),
      set: (key, value) => narrator.store.set(key, value),
    };
  }
  await bootViewer(pendulumMap, pendulumPresentation, signals);
}

void main();
