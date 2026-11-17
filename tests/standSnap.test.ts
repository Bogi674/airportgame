import { describe, expect, it } from 'vitest';
import { AIRFIELD, STAND_PLACEMENT, STAND_SIZES } from '@data/index';
import { ACCEPT_COMMERCIAL, STAND_SIZES_ORDER, type Stand, type StandSize, type Taxiway } from '@shared/airfield';
import { standBox, standTaxiwayClash } from '@shared/clearance';
import { standFork } from '@shared/standFork';
import { leadInGapM, leadInTargetGapM, standSlot } from '@shared/standGeom';
import { snapStand, snapStandRow } from '@shared/standSnap';
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

describe('snapStandRow', () => {
  const built = (size: StandSize, x: number, id = 1): Stand => {
    const s = snapStand({ x, y: 60 }, size, [taxi()], null);
    if (!s) throw new Error('no snap');
    return { ...asStand(size, s.x, s.y, s.headingDeg), id };
  };
  const top = (s: { x: number; y: number }, size: StandSize): number => {
    const slot = standSlot(size);
    if (!slot) throw new Error('no slot');
    // Facing south (heading 180), the stand top is slot.far further along +y.
    return s.y + slot.far;
  };

  it('abuts a built stand of the same size edge to edge with the roads lined up', () => {
    const o = built('large', 0);
    const w = STAND_SIZES.large.widthM;
    const s = snapStandRow({ x: w + 7, y: 64 }, 'large', [taxi()], [o], null);
    expect(s?.neighbourId).toBe(1);
    expect(s?.x).toBeCloseTo(w, 6);
    expect(s && top(s, 'large')).toBeCloseTo(top(o, 'large'), 6);
  });

  it('snaps on the other side too', () => {
    const o = built('medium', 0);
    const s = snapStandRow({ x: -STAND_SIZES.medium.widthM + 5, y: 60 }, 'medium', [taxi()], [o], null);
    expect(s?.x).toBeCloseTo(-STAND_SIZES.medium.widthM, 6);
  });

  it('slides a smaller stand away from the taxiway so its road meets the larger neighbour road', () => {
    const o = built('large', 0);
    const x = (STAND_SIZES.large.widthM + STAND_SIZES.medium.widthM) / 2;
    const s = snapStandRow({ x: x + 3, y: 60 }, 'medium', [taxi()], [o], null);
    if (!s) throw new Error('no snap');
    expect(s.x).toBeCloseTo(x, 6);
    expect(top(s, 'medium')).toBeCloseTo(top(o, 'large'), 6);
    const slot = standSlot('medium');
    if (!slot) throw new Error('no slot');
    expect(leadInGapM(asStand('medium', s.x, s.y, s.headingDeg), s.join, slot)).toBeGreaterThanOrEqual(leadInTargetGapM('medium', 'C') - 1e-6);
  });

  it('keeps its own lead in depth beside a smaller neighbour rather than crowd the taxiway', () => {
    const o = built('medium', 0);
    const x = (STAND_SIZES.large.widthM + STAND_SIZES.medium.widthM) / 2;
    const s = snapStandRow({ x: x + 3, y: 60 }, 'large', [taxi()], [o], null);
    const own = snapStand({ x, y: 60 }, 'large', [taxi()], null);
    expect(s?.x).toBeCloseTo(x, 6);
    expect(s?.y).toBeCloseTo(own?.y ?? NaN, 6);
  });

  it('ignores stands too far away or facing another way', () => {
    const o = built('large', 0);
    expect(snapStandRow({ x: 200, y: 60 }, 'large', [taxi()], [o], null)?.neighbourId).toBeUndefined();
    const turned = { ...o, headingDeg: 90 };
    expect(snapStandRow({ x: STAND_SIZES.large.widthM, y: 60 }, 'large', [taxi()], [turned], null)?.neighbourId).toBeUndefined();
  });
});
