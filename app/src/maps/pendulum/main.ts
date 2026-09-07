import './style.css';
import { bootViewer } from '../../viewer/runtime';
import { pendulumPresentation } from './presentation';
import { pendulumMap } from './spec';

void bootViewer(pendulumMap, pendulumPresentation);
