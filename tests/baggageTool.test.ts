import { describe, expect, it } from 'vitest';
import { BAGGAGE } from '@data/index';
import { nodeCells, nodeSize, type BagKind } from '@shared/baggageNodes';
import { bagCost, bagGhostCells, bagOrigin, nextBagRot, type BagRot } from '../src/ui/tools/baggageTool';
import en from '../src/ui/strings/en.json';

const ROTS: BagRot[] = [0, 1, 2, 3];
const KINDS: { kind: BagKind; width: number }[] = [
  { kind: 'machine', width: 0 },
  { kind: 'bay', width: 2 },
  { kind: 'bay', width: 8 },
  { kind: 'carousel', width: 0 },
];

describe('baggage tool', () => {
  it('keeps the footprint under the cursor for every rotation', () => {
    for (const { kind, width } of KINDS) {
      for (const rot of ROTS) {
        const cursor = { cx: 30, cy: 17 };
        const o = bagOrigin(cursor, kind, rot, width);
        expect(o).not.toBeNull();
        const cells = nodeCells({ kind, cx: o?.cx ?? 0, cy: o?.cy ?? 0, rot, widthCells: width });
        expect(cells.some(([x, y]) => x === cursor.cx && y === cursor.cy)).toBe(true);
        expect(cells.length).toBe((nodeSize({ kind, cx: 0, cy: 0, rot, widthCells: width })?.w ?? 0) * (nodeSize({ kind, cx: 0, cy: 0, rot, widthCells: width })?.d ?? 0));
      }
    }
  });

  it('has no origin for an unlisted bay width', () => {
    expect(bagOrigin({ cx: 0, cy: 0 }, 'bay', 0, 3)).toBeNull();
  });

  it('gives the ramp cells of the ghost', () => {
    const g = bagGhostCells({ kind: 'machine', cx: 5, cy: 5, rot: 0, widthCells: 0 });
    expect(g.cells.length).toBe(BAGGAGE.footprints.machine.w * BAGGAGE.footprints.machine.d);
    expect(g.rampIn).toEqual([5, 5]);
    expect(g.rampOut).toEqual([8, 5]);
    expect(bagGhostCells({ kind: 'carousel', cx: 0, cy: 0, rot: 0, widthCells: 0 }).rampOut).toBeNull();
  });

  it('cycles the rotation', () => {
    expect(nextBagRot(3)).toBe(0);
    expect(nextBagRot(0)).toBe(1);
  });

  it('has a string for every validation code', () => {
    for (const code of ['bagBadWidth', 'bagOffFloor', 'bagCellTaken', 'bagWrongZone', 'bagWallInside', 'bayNoExteriorWall']) {
      expect(Object.keys(en)).toContain(`notice.${code}`);
    }
  });

  it('prices a bay per cell', () => {
    expect(bagCost('bay', 4)).toBe(4 * BAGGAGE.costs.bayPerCell);
    expect(bagCost('machine', 0)).toBe(BAGGAGE.costs.machine);
    expect(bagCost('carousel', 0)).toBe(BAGGAGE.costs.carousel);
  });
});
