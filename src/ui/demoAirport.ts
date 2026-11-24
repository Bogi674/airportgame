import type { Command } from '@sim/commands';
import type { Preset } from '@shared/site';

/** The demo airport behind the main menu (T35): a fixed seed, the camera over its apron and the slow drift of that camera. */
export const DEMO = {
  seed: 'GOLDEN-0001',
  preset: 'flatCoastal' as Preset,
  camera: { x: 4100, y: 5250, zoom: 0.9 },
  /** Meters the camera drifts east and west of its start, and the seconds of one sweep there and back. */
  driftM: 260,
  driftS: 120,
};

/** A runway, a parallel taxiway, an apron with six stands, a tower and light test traffic, laid on the demo seed. */
export const DEMO_COMMANDS: Command[] = [
  { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2600, code: 'C', approach: 'precision', surface: 'asphalt', tier: 2 },
  { type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 190, code: 'C', connectors: 4, surface: 'asphalt', tier: 2 },
  { type: 'buildApron', polygon: [{ x: 3800, y: 5205 }, { x: 4400, y: 5205 }, { x: 4400, y: 5420 }, { x: 3800, y: 5420 }], surface: 'concrete', tier: 2 },
  { type: 'buildStands', x: 4350, y: 5330, headingDeg: 180, count: 6, spacingM: 45, standType: 'remote', size: 'medium' },
  { type: 'buildTower', x: 2700, y: 4800, level: 5 },
  { type: 'setTestTraffic', perHour: 20, turnScale: 0.3 },
];
