import '../../viewer/style.css';
import './style.css';
import { applyUi, loadUi } from '../../i18n';
import { bindAskPrompt } from '../../viewer/ask';
import { bootViewer } from '../../viewer/runtime';
import { lyapunovPresentation } from './presentation';
import { lyapunovMap } from './spec';

async function main(): Promise<void> {
  await loadUi();
  await bootViewer(lyapunovMap, lyapunovPresentation);
  bindAskPrompt();
  applyUi();
}

void main();

