import '../../viewer/style.css';
import './style.css';
import { applyUi, loadUi } from '../../i18n';
import { bindAskPrompt } from '../../viewer/ask';
import { bootViewer } from '../../viewer/runtime';
import { chirikovPresentation } from './presentation';
import { chirikovMap } from './spec';

async function main(): Promise<void> {
  await loadUi();
  await bootViewer(chirikovMap, chirikovPresentation);
  bindAskPrompt();
  applyUi();
}

void main();
