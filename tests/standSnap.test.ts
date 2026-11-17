import { describe, expect, it } from 'vitest';
import { AIRFIELD, STAND_PLACEMENT, STAND_SIZES } from '@data/index';
import { ACCEPT_COMMERCIAL, STAND_SIZES_ORDER, type Stand, type StandSize, type Taxiway } from '@shared/airfield';
import { standBox, standTaxiwayClash } from '@shared/clearance';
import { standFork } from '@shared/standFork';
import { leadInGapM, leadInTargetGapM, standSlot } from '@shared/standGeom';
import { snapStand } from '@shared/standSnap';
import { sizeCode } from '@shared/standSizes';

/** A code C taxiway along y = 0 from x = -500 to 500. */
const taxi = (code: Taxiway['code'] = 'C', y = 0): Taxiway => ({
  id: 7,
  cost: 0,
  kind: 'taxiway',
  points: [
    { x: -500, y },
    { x: 500, y },
  ],
  code,
  widthM: 23,
  surface: 'asphalt',
  pcr: 50,
  condition: 100,
  oneWay: false,
} as Taxiway);

const asStand = (size: StandSize, x: number, y: number, headingDeg: number): Stand => ({
  id: 1,
  cost: 0,
  number: '1',
  x,
  y,
  headingDeg,
  type: 'remote',
  size,
  code: sizeCode(size),
  surface: 'concrete',
  pushback: 'auto',
  accepts: ACCEPT_COMMERCIAL,
});

describe('snapStand', () => {
  it('faces away from the nearest centerline, square to it, and slides to the target gap', () => {
    const s = snapStand({ x: 40, y: 70 }, 'medium', [taxi()], null);
    expect(s).not.toBeNull();
    if (!s) return;
    // The pointer is south of the taxiway (y down), so the nose points south.
    expect(s.headingDeg).toBe(180);
    expect(s.x).toBeCloseTo(40, 6);
    const slot = standSlot('medium');
    if (!slot) throw new Error('no slot');
    expect(leadInGapM(asStand('medium', s.x, s.y, s.headingDeg), { x: 40, y: 0 }, slot)).toBeCloseTo(leadInTargetGapM('medium', 'C'), 6);
    expect(s.taxiwayId).toBe(7);
  });

  it('keeps the player heading and snaps only to a centerline straight behind', () => {
    const s = snapStand({ x: 0, y: 80 }, 'medium', [taxi()], 180);
    expect(s?.headingDeg).toBe(180);
    // Facing north, the centerline is ahead of the nose, not behind it.
    expect(snapStand({ x: 0, y: 80 }, 'medium', [taxi()], 0)).toBeNull();
  });

  it('gives up beyond the lead in reach of the tail edge', () => {
    const slot = standSlot('medium');
    if (!slot) throw new Error('no slot');
    const edge = STAND_PLACEMENT.leadInReachM - slot.near;
    expect(snapStand({ x: 0, y: edge - 1 }, 'medium', [taxi()], null)).not.toBeNull();
    expect(snapStand({ x: 0, y: edge + 1 }, 'medium', [taxi()], null)).toBeNull();
  });

  it('places every size where the sim clearance rule passes and the lead in fork is found', () => {
    for (const size of STAND_SIZES_ORDER) {
      for (const code of ['A', 'C', 'E'] as const) {
        const t = taxi(code);
        const s = snapStand({ x: 0, y: 60 }, size, [t], null);
        if (!s) throw new Error(`no snap for ${size}`);
        const stand = asStand(size, s.x, s.y, s.headingDeg);
        const fork = standFork(stand, [{ pts: t.points }]);
        expect(fork).not.toBeNull();
        const slot = standSlot(size);
        if (!slot) throw new Error('no slot');
        expect(standTaxiwayClash(standBox(stand, slot), [t.id], [t], AIRFIELD.codes, STAND_SIZES[size].wingtipClearanceM)).toBeNull();
      }
    }
  });
});
