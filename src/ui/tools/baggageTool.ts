import { BAGGAGE } from '@data/index';
import { nodeCells, nodeSize, rampCell, type BagKind, type BagNodeSpec } from '@shared/baggageNodes';

export type BagRot = 0 | 1 | 2 | 3;

export function nextBagRot(r: BagRot): BagRot {
  return ((r + 1) % 4) as BagRot;
}

/**
 * Footprint origin that keeps the footprint under the cursor cell: the middle cell of the footprint
 * lands on the cursor, whatever the rotation. Null for a bay width the data does not list.
 */
export function bagOrigin(cursor: { cx: number; cy: number }, kind: BagKind, rot: BagRot, widthCells: number): { cx: number; cy: number } | null {
  const size = nodeSize({ kind, cx: 0, cy: 0, rot, widthCells });
  if (!size) return null;
  const at = nodeCells({ kind, cx: 0, cy: 0, rot, widthCells });
  const mid = at[Math.floor((size.d - 1) / 2) * size.w + Math.floor((size.w - 1) / 2)];
  return { cx: cursor.cx - mid[0], cy: cursor.cy - mid[1] };
}

/** Footprint cells and the ramp cells of a node, in logical cells, for the ghost. */
export function bagGhostCells(spec: BagNodeSpec): { cells: [number, number][]; rampIn: [number, number] | null; rampOut: [number, number] | null } {
  return { cells: nodeCells(spec), rampIn: rampCell(spec, 'in'), rampOut: rampCell(spec, 'out') };
}

/** Price of one node in cash, from the baggage data. */
export function bagCost(kind: BagKind, widthCells: number): number {
  const c = BAGGAGE.costs;
  if (kind === 'machine') return c.machine;
  if (kind === 'carousel') return c.carousel;
  return c.bayPerCell * widthCells;
}
