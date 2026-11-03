import '../../viewer/style.css';
import './style.css';
import { applyUi, loadUi } from '../../i18n';
import { bindAskPrompt } from '../../viewer/ask';
import { bootViewer } from '../../viewer/runtime';
import { shipPresentation } from './presentation';
import { shipMap } from './spec';

async function main(): Promise<void> {
  await loadUi();
  await bootViewer(shipMap, shipPresentation);
  bindAskPrompt();
  applyUi();
}

void main();
