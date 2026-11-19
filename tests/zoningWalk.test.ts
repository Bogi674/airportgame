import { describe, expect, it } from 'vitest';
import type { TerminalGrid } from '@shared/business';
import { cellIndex } from '@shared/terminalOps';
import { buildWalkGraph, updateWalkGraph, type WalkGraph } from '@sim/terminal/walkGraph';
import { nearestNode, walkDistance } from '@sim/terminal/walkDistance';
import { buildServiceNodes } from '@sim/terminal/serviceNodes';
import { AUD } from '@shared/terminalZones';
import { grid, paint, put, wall } from './zoningGrid';

/** Public floor on the left of x = 10, secure on the right, a wall between them except where fixtures go. */
function hall(): TerminalGrid {
  const g = grid(20, 10);
  paint(g, 0, 0, 10, 10, 1);
  paint(g, 10, 0, 20, 10, 3);
  return g;
}

function wallOff(g: TerminalGrid, rows: number[]): void {
  for (let y = 0; y < 10; y++) if (!rows.includes(y)) wall(g, false, 10, y, 1);
}

const nodeAt = (g: TerminalGrid, wg: WalkGraph, x: number, y: number): number => nearestNode(wg, cellIndex(g, x, y));

describe('walk graph and zones', () => {
  it('blocks every breach', () => {
    const g = hall();
    const wg = buildWalkGraph(g);
    const pub = nodeAt(g, wg, 5, 5);
    const sec = nodeAt(g, wg, 15, 5);
    expect(walkDistance(wg, pub, sec)).toBe(Infinity);
    expect(walkDistance(wg, sec, pub)).toBe(Infinity);
  });

  it('goes public to secure only through a lane', () => {
    const g = hall();
    wallOff(g, [4]);
    put(g, 'security', 10, 4, 1);
    const wg = buildWalkGraph(g);
    const pub = nodeAt(g, wg, 5, 5);
    const sec = nodeAt(g, wg, 15, 5);
    expect(Number.isFinite(walkDistance(wg, pub, sec))).toBe(true);
    expect(walkDistance(wg, sec, pub)).toBe(Infinity);
  });

  it('goes secure to public only through an exit', () => {
    const g = hall();
    wallOff(g, [4, 8, 9]);
    put(g, 'security', 10, 4, 1);
    put(g, 'securityExit', 10, 9, 3);
    const wg = buildWalkGraph(g);
    const pub = nodeAt(g, wg, 5, 5);
    const sec = nodeAt(g, wg, 15, 5);
    expect(Number.isFinite(walkDistance(wg, pub, sec))).toBe(true);
    expect(Number.isFinite(walkDistance(wg, sec, pub))).toBe(true);
  });

  it('carries no one through a backwards exit', () => {
    const g = hall();
    wallOff(g, [8, 9]);
    put(g, 'securityExit', 10, 8, 1);
    const wg = buildWalkGraph(g);
    const pub = nodeAt(g, wg, 5, 5);
    const sec = nodeAt(g, wg, 15, 5);
    expect(walkDistance(wg, pub, sec)).toBe(Infinity);
    expect(walkDistance(wg, sec, pub)).toBe(Infinity);
  });

  it('reaches the curb from a gate desk only through an exit', () => {
    const open = hall();
    wallOff(open, [8, 9]);
    put(open, 'gateDesk', 14, 2, 0);
    wall(open, true, 3, 5, 3);
    const noExit = buildWalkGraph(open);
    const desk = nodeAt(open, noExit, 14, 2);
    const curb = nodeAt(open, noExit, 3, 5);
    expect(walkDistance(noExit, desk, curb)).toBe(Infinity);
    put(open, 'securityExit', 10, 9, 3);
    const withExit = buildWalkGraph(open);
    expect(Number.isFinite(walkDistance(withExit, nodeAt(open, withExit, 14, 2), nodeAt(open, withExit, 3, 5)))).toBe(true);
  });
});

describe('walk graph audiences', () => {
  it('lets staff through a staff door and keeps passengers out', () => {
    const g = hall();
    wallOff(g, [4]);
    wall(g, false, 10, 4, 4);
    const wg = buildWalkGraph(g);
    const pub = nodeAt(g, wg, 5, 5);
    const sec = nodeAt(g, wg, 15, 5);
    expect(Number.isFinite(walkDistance(wg, pub, sec, AUD.Staff))).toBe(true);
    expect(Number.isFinite(walkDistance(wg, sec, pub, AUD.Staff))).toBe(true);
    expect(walkDistance(wg, pub, sec)).toBe(Infinity);
    expect(walkDistance(wg, sec, pub, AUD.Pax)).toBe(Infinity);
  });

  it('passes a staff lane for staff only', () => {
    const g = hall();
    wallOff(g, [4]);
    put(g, 'security', 10, 4, 1, 1, 1);
    const wg = buildWalkGraph(g);
    const pub = nodeAt(g, wg, 5, 5);
    const sec = nodeAt(g, wg, 15, 5);
    expect(Number.isFinite(walkDistance(wg, pub, sec, AUD.Staff))).toBe(true);
    expect(walkDistance(wg, pub, sec, AUD.Pax)).toBe(Infinity);
  });

  it('keeps a passenger queue out of a room part cut off by a staff door', () => {
    const g = hall();
    wallOff(g, [4]);
    put(g, 'security', 10, 4, 1);
    for (let y = 0; y < 10; y++) wall(g, false, 8, y, 4);
    const wg = buildWalkGraph(g);
    const sn = buildServiceNodes(g, wg);
    expect(sn.qCellLen[0]).toBeGreaterThan(0);
    for (let q = 0; q < sn.qCellLen[0]!; q++) expect(sn.qCellX[sn.qCellOffset[0]! + q]).toBeGreaterThanOrEqual(8);
  });

  it('queues a lane on its public side only', () => {
    const g = hall();
    wallOff(g, [4]);
    put(g, 'security', 10, 4, 1);
    const wg = buildWalkGraph(g);
    const sn = buildServiceNodes(g, wg);
    expect(sn.count).toBe(1);
    expect(sn.qCellLen[0]).toBeGreaterThan(0);
    for (let q = 0; q < sn.qCellLen[0]!; q++) {
      const i = sn.qCellOffset[0]! + q;
      expect(wg.effective[sn.qCellY[i]! * g.w + sn.qCellX[i]!]).toBe(1);
    }
  });
});

/** Every field a regional update must leave equal to a fresh build, including the audience masks and the access table. */
const fields = (wg: WalkGraph): unknown[] => [
  wg.nodeCount,
  Array.from(wg.cellKind), Array.from(wg.cellMain), Array.from(wg.cellNode),
  Array.from(wg.nodeCell), Array.from(wg.nodeKind), Array.from(wg.nodeRoom),
  Array.from(wg.edgeStart), Array.from(wg.edgeTo), Array.from(wg.edgeLen), Array.from(wg.edgeMask),
  Array.from(wg.access.h), Array.from(wg.access.v), Array.from(wg.effective),
];

describe('regional update with zones', () => {
  const base = (): TerminalGrid => {
    const g = grid(128, 64);
    paint(g, 100, 0, 128, 64, 3);
    for (let y = 0; y < 64; y++) if (y !== 4) wall(g, false, 100, y, 1);
    put(g, 'security', 100, 4, 1);
    return g;
  };

  const check = (edit: (g: TerminalGrid) => void, box: [number, number, number, number]): void => {
    const g = base();
    const wg = buildWalkGraph(g);
    edit(g);
    const next = updateWalkGraph(wg, g, ...box);
    expect(next).toBe(wg);
    expect(fields(next)).toEqual(fields(buildWalkGraph(g)));
  };

  it('matches a fresh build after a zone edit away from the first dirty rect', () => {
    check((g) => paint(g, 10, 30, 14, 34, 3), [10, 30, 13, 33]);
  });

  it('covers changed edges even when the reported edit box is too small', () => {
    check((g) => paint(g, 10, 30, 30, 34, 3), [10, 30, 10, 30]);
  });

  it('matches a fresh build after a commercial region changes zone across its length', () => {
    check((g) => paint(g, 10, 30, 31, 31, 2), [10, 30, 10, 30]);
  });

  it('matches a fresh build when a commercial region comes to touch both sides of a lane', () => {
    check((g) => paint(g, 80, 4, 100, 5, 2), [80, 4, 80, 4]);
  });

  it('matches a fresh build after a staff door', () => {
    check((g) => wall(g, false, 20, 30, 4), [19, 30, 20, 30]);
  });

  it('matches a fresh build after a transition fixture', () => {
    check((g) => {
      paint(g, 40, 40, 50, 50, 3);
      put(g, 'security', 40, 45, 1);
    }, [40, 40, 49, 49]);
  });
});
