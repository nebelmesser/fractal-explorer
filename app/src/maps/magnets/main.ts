import '../../viewer/style.css';
import './style.css';
import { applyUi, loadUi } from '../../i18n';
import { bootViewer } from '../../viewer/runtime';
import { magnetsPresentation } from './presentation';
import { magnetsMap } from './spec';
import { bindAskPrompt } from '../../viewer/ask';

async function main(): Promise<void> {
  await loadUi();
  await bootViewer(magnetsMap, magnetsPresentation);
  bindAskPrompt();
  applyUi();
}

void main();
