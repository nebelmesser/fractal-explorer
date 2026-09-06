import { pendulumMap } from './pendulum/spec';
import type { MapDefinition } from './types';

const maps: MapDefinition[] = [pendulumMap];

export function catalogEntries(): MapDefinition[] {
  return maps;
}

export function mapById(id: string): MapDefinition | undefined {
  return maps.find((entry) => entry.id === id);
}

export function defaultMap(): MapDefinition {
  return maps[0];
}
