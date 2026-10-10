import '../../viewer/style.css';
import './style.css';
import { applyUi, loadUi } from '../../i18n';
import { bindAskPrompt } from '../../viewer/ask';
import { bootViewer } from '../../viewer/runtime';
import { mandelbrotPresentation } from './presentation';
import { mandelbrotMap } from './spec';

async function main(): Promise<void> {
  await loadUi();
  await bootViewer(mandelbrotMap, mandelbrotPresentation);
  bindAskPrompt();
  applyUi();
}

void main();
