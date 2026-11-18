import { describe, expect, it } from 'vitest';
import { STAND_UPGRADE, type AirfieldPayload, type Stand } from '@shared/airfield';
import { paintStands } from '@render/markings/standPaint';
import { ownedSim, run } from './helpers';

/** The bus bay upgrade draws the stairs walkway and the bus bay box, nothing else changes (T66 slice 4). */

type Command = Parameters<typeof run>[1];

function scene(): AirfieldPayload {
  const sim = ownedSim();
  const errors: string[] = [];
  const go = (c: Command): void => {
    errors.push(...run(sim, c));
  };
  go({ type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2600, code: 'C', approach: 'precision', surface: 'asphalt', tier: 2 });
  go({ type: 'buildTaxiway', points: [{ x: 3000, y: 5190 }, { x: 5000, y: 5190 }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 2 });
  go({ type: 'buildApron', polygon: [{ x: 3400, y: 5196 }, { x: 4200, y: 5196 }, { x: 4200, y: 5320 }, { x: 3400, y: 5320 }], surface: 'concrete', tier: 2 });
  go({ type: 'buildStands', x: 3600, y: 5290, headingDeg: 180, count: 1, spacingM: 60, standType: 'remote', size: 'medium', surface: 'concrete' });
  if (errors.length > 0) throw new Error(`scene failed: ${errors.join(', ')}`);
  return sim.airfield.data;
}

/** Counts the drawing calls the painter makes for one stand. */
function counts(af: AirfieldPayload, stand: Stand): { calls: number } {
  const state: Record<string, unknown> = { fillStyle: '#000', strokeStyle: '#000' };
  let calls = 0;
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (): { width: number } => ({ width: 1 });
      return (): void => {
        calls++;
      };
    },
    set(target, prop, value: unknown) {
      if (typeof prop === 'string') target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  paintStands(ctx, af, [stand], { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6, scale: 4 });
  return { calls };
}

describe('bus bay markings', () => {
  const af = scene();
  const stand = af.stands[0];

  it('draw the bay and walkway only with the bus bay bit', () => {
    expect(stand).toBeDefined();
    const without = counts(af, { ...stand, upgrades: 0 });
    const withBay = counts(af, { ...stand, upgrades: STAND_UPGRADE.busBay });
    expect(withBay.calls).toBeGreaterThan(without.calls);
  });

  it('other upgrades do not draw them', () => {
    const base = counts(af, { ...stand, upgrades: 0 });
    const other = counts(af, { ...stand, upgrades: STAND_UPGRADE.hydrantPit | STAND_UPGRADE.fixedPower });
    expect(other).toEqual(base);
  });
});
