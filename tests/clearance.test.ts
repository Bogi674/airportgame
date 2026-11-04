import { describe, expect, it } from 'vitest';
import { AIRFIELD } from '@data/index';
import { EMPTY_AIRFIELD, type AirfieldPayload, type Taxiway } from '@shared/airfield';
import { envelopeType, taxiClashes } from '@shared/clearance';

const taxiway = (pts: { x: number; y: number }[]): Taxiway => ({
  id: 1, cost: 0, kind: 'taxiway', points: pts, code: 'C', widthM: 15, surface: 'asphalt', pcr: 40, condition: 100,
  oneWay: false, closed: false, userMaxCode: 'C', maxCode: 'C', speedKmh: 30, name: 'A',
});
const af = (extra: Partial<AirfieldPayload> = {}): AirfieldPayload => ({ ...EMPTY_AIRFIELD, taxiways: [taxiway([{ x: 0, y: 0 }, { x: 1000, y: 0 }])], ...extra });
const none = { buildings: [] };

describe('wingtip envelope', () => {
  it('uses the largest roster type of the code', () => {
    expect(envelopeType('C')?.dimensions.wingspanM).toBeLessThanOrEqual(36);
    expect(envelopeType('E')?.dimensions.wingspanM).toBeGreaterThan(52);
  });

  it('flags an arm beside a taxiway closer than the separation, not one far enough', () => {
    const sep = AIRFIELD.codes.C.taxiSepM;
    const close = taxiClashes([{ x: 100, y: sep - 10 }, { x: 600, y: sep - 10 }], 'C', af(), none);
    expect(close.taxiway).toBe(true);
    expect(close.runs.length).toBe(1);
    expect(taxiClashes([{ x: 100, y: sep + 2 }, { x: 600, y: sep + 2 }], 'C', af(), none).runs).toEqual([]);
  });

  it('does not flag a connector that crosses or joins a taxiway', () => {
    expect(taxiClashes([{ x: 300, y: 200 }, { x: 300, y: 0 }], 'C', af(), none).runs).toEqual([]);
    expect(taxiClashes([{ x: 300, y: 200 }, { x: 300, y: -200 }], 'C', af(), none).runs).toEqual([]);
  });

  it('flags stands and buildings inside the taxiway to object distance', () => {
    const d = AIRFIELD.codes.C.taxiObjectM;
    const stand = { id: 1, cost: 0, number: '1', x: 300, y: 300, headingDeg: 0, type: 'remote' as const, size: 'medium' as const, code: 'C' as const, surface: 'concrete' as const, pushback: 'auto' as const };
    const arm = [{ x: 0, y: 300 - 22.5 - d + 3 }, { x: 600, y: 300 - 22.5 - d + 3 }];
    expect(taxiClashes(arm, 'C', af({ taxiways: [], stands: [stand] }), none).object).toBe(true);
    const building = [{ x: 200, y: 500 }, { x: 400, y: 500 }, { x: 400, y: 600 }, { x: 200, y: 600 }];
    expect(taxiClashes([{ x: 0, y: 500 - d + 2 }, { x: 600, y: 500 - d + 2 }], 'C', af({ taxiways: [] }), { buildings: [building] }).object).toBe(true);
    expect(taxiClashes([{ x: 0, y: 500 - d - 2 }, { x: 600, y: 500 - d - 2 }], 'C', af({ taxiways: [] }), { buildings: [building] }).runs).toEqual([]);
  });
});
