import { describe, expect, it } from 'vitest';
import { BAGGAGE } from '@data/index';
import { FIXTURE_KEYS, WALL, ZONE, isBaggageFixture, type TerminalGrid } from '../src/shared/business';
import { bagKey, nodeCells, nodeSize, rampCell, screeningRoomOk, truckEdge, validateBagNode, type BagNodeSpec } from '../src/shared/baggageNodes';
import { cellIndex, ensureCells, hEdgeIndex, newGrid, planEdit, vEdgeIndex } from '../src/shared/terminalOps';

const grid = (): TerminalGrid => {
  const g = newGrid(1, 0, 0, 0);
  ensureCells(g, 0, 0, 32, 32);
  return g;
};

const setFloor = (g: TerminalGrid, x0: number, y0: number, x1: number, y1: number, zone = 0): void => {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      g.floor[cellIndex(g, x, y)] = 1;
      g.zone[cellIndex(g, x, y)] = zone;
    }
  }
};

/** Walls the outline of the cell rectangle [x0, x1) by [y0, y1). */
const outline = (g: TerminalGrid, x0: number, y0: number, x1: number, y1: number, kind: number = WALL.Wall): void => {
  for (let x = x0; x < x1; x++) {
    g.hWall[hEdgeIndex(g, x, y0)] = kind;
    g.hWall[hEdgeIndex(g, x, y1)] = kind;
  }
  for (let y = y0; y < y1; y++) {
    g.vWall[vEdgeIndex(g, x0, y)] = kind;
    g.vWall[vEdgeIndex(g, x1, y)] = kind;
  }
};

const spec = (kind: BagNodeSpec['kind'], rot: BagNodeSpec['rot'] = 0, widthCells = 4, cx = 10, cy = 10): BagNodeSpec => ({ kind, cx, cy, rot, widthCells });

describe('baggage fixture keys', () => {
  it('appends the three keys with ids 17 to 19', () => {
    expect(FIXTURE_KEYS.slice(16, 19)).toEqual(['screeningMachine', 'baggageBay', 'carousel']);
    expect([16, 17, 18, 19, 20].map(isBaggageFixture)).toEqual([false, true, true, true, false]);
    expect([bagKey('machine'), bagKey('bay'), bagKey('carousel')]).toEqual(['screeningMachine', 'baggageBay', 'carousel']);
  });

  it('refuses the fixture tool for a baggage key', () => {
    const g = grid();
    setFloor(g, 0, 0, 4, 4);
    const plan = planEdit(g, { op: 'fixture', x0: 0, y0: 0, x1: 1, y1: 1, variant: 17 }, {} as never);
    expect(plan.problem?.code).toBe('baggageNodeTool');
    expect(g.fixture[cellIndex(g, 0, 0)]).toBe(0);
  });
});

describe('footprints', () => {
  it('lists cells row major and ramps for each rotation', () => {
    const expectIn = { 0: [10, 10], 1: [10, 10], 2: [10, 10], 3: [10, 10] };
    for (const rot of [0, 1, 2, 3] as const) {
      expect(rampCell(spec('machine', rot), 'in')).toEqual(expectIn[rot]);
    }
    const machineOut = { 0: [13, 10], 1: [10, 13], 2: [7, 10], 3: [10, 7] };
    for (const rot of [0, 1, 2, 3] as const) {
      expect(rampCell(spec('machine', rot), 'out')).toEqual(machineOut[rot]);
      expect(nodeCells(spec('machine', rot))).toHaveLength(4);
    }
    expect(nodeCells(spec('machine', 0))).toEqual([[10, 10], [11, 10], [12, 10], [13, 10]]);
    expect(nodeCells(spec('machine', 1))).toEqual([[10, 10], [10, 11], [10, 12], [10, 13]]);
  });

  it('places a carousel with an input ramp and no output', () => {
    const carouselIn = { 0: [10, 11], 1: [9, 10], 2: [10, 9], 3: [11, 10] };
    for (const rot of [0, 1, 2, 3] as const) {
      expect(rampCell(spec('carousel', rot), 'in')).toEqual(carouselIn[rot]);
      expect(rampCell(spec('carousel', rot), 'out')).toBeNull();
      expect(nodeCells(spec('carousel', rot))).toHaveLength(22);
    }
    expect(nodeCells(spec('carousel', 0)).slice(0, 12).at(-1)).toEqual([10, 11]);
  });

  it('places bay ramps and truck edge for each rotation', () => {
    const bayOut = { 0: [13, 10], 1: [10, 13], 2: [7, 10], 3: [10, 7] };
    const outStep = { 0: [0, 1], 1: [-1, 0], 2: [0, -1], 3: [1, 0] };
    for (const rot of [0, 1, 2, 3] as const) {
      const s = spec('bay', rot, 4);
      expect(nodeCells(s)).toHaveLength(4 * BAGGAGE.footprints.bay.d);
      expect(rampCell(s, 'in')).toEqual([10, 10]);
      expect(rampCell(s, 'out')).toEqual(bayOut[rot]);
      const edge = truckEdge(s);
      expect(edge.out).toEqual(outStep[rot]);
      expect(edge.cells).toHaveLength(4);
    }
    expect(truckEdge(spec('bay', 0, 2)).cells).toEqual([[10, 13], [11, 13]]);
  });

  it('refuses a bay width the data does not list', () => {
    expect(nodeSize(spec('bay', 0, 3))).toBeNull();
    expect(nodeCells(spec('bay', 0, 3))).toEqual([]);
    expect(nodeSize(spec('bay', 0, 6))).toEqual({ w: 6, d: 4 });
    expect(validateBagNode(grid(), spec('bay', 0, 3))).toBe('bagBadWidth');
  });
});

describe('validateBagNode', () => {
  it('returns bagOffFloor for a cell without floor or outside the grid', () => {
    const g = grid();
    setFloor(g, 10, 10, 13, 11, ZONE.Staff);
    expect(validateBagNode(g, spec('machine'))).toBe('bagOffFloor');
    expect(validateBagNode(g, spec('machine', 0, 4, 100, 100))).toBe('bagOffFloor');
  });

  it('returns bagCellTaken, bagWrongZone and bagWallInside in order', () => {
    const g = grid();
    setFloor(g, 10, 10, 14, 11, ZONE.Staff);
    expect(validateBagNode(g, spec('machine'))).toBeNull();
    g.zone[cellIndex(g, 11, 10)] = ZONE.Public;
    g.vWall[vEdgeIndex(g, 12, 10)] = WALL.Glass;
    expect(validateBagNode(g, spec('machine'))).toBe('bagWrongZone');
    g.zone[cellIndex(g, 11, 10)] = ZONE.Staff;
    expect(validateBagNode(g, spec('machine'))).toBe('bagWallInside');
    g.fixture[cellIndex(g, 13, 10)] = 1;
    expect(validateBagNode(g, spec('machine'))).toBe('bagCellTaken');
  });

  it('counts a door as a wall inside the footprint', () => {
    const g = grid();
    setFloor(g, 10, 10, 14, 11);
    g.vWall[vEdgeIndex(g, 11, 10)] = WALL.Door;
    expect(validateBagNode(g, spec('machine'))).toBe('bagWallInside');
  });

  it('lets a bay stand on the building edge and refuses one step inside', () => {
    const g = grid();
    setFloor(g, 8, 8, 20, 14, ZONE.Staff);
    outline(g, 8, 8, 20, 14);
    // Bay rows 10..13, truck edge on row 13, the outer wall below row 13 is at y = 14 only.
    const onEdge = spec('bay', 0, 4, 10, 10);
    expect(validateBagNode(g, onEdge)).toBeNull();
    expect(validateBagNode(g, spec('bay', 0, 4, 10, 9))).toBe('bayNoExteriorWall');
  });

  it('refuses a bay whose truck edge has no wall', () => {
    const g = grid();
    setFloor(g, 8, 8, 20, 14, ZONE.Staff);
    expect(validateBagNode(g, spec('bay', 0, 4, 10, 10))).toBe('bayNoExteriorWall');
  });
});

describe('screeningRoomOk', () => {
  const room = (w: number, h: number, zone: number, door: boolean): TerminalGrid => {
    const g = grid();
    setFloor(g, 10, 10, 10 + w, 10 + h, zone);
    outline(g, 10, 10, 10 + w, 10 + h);
    if (door) g.hWall[hEdgeIndex(g, 10, 10 + h)] = WALL.Door;
    return g;
  };

  it('accepts a closed staff room with a door', () => {
    expect(screeningRoomOk(room(4, 2, ZONE.Staff, true), spec('machine'))).toBe(true);
  });

  it('refuses a room without a door', () => {
    expect(screeningRoomOk(room(4, 2, ZONE.Staff, false), spec('machine'))).toBe(false);
  });

  it('refuses a room that is too small', () => {
    expect(screeningRoomOk(room(4, 1, ZONE.Staff, true), spec('machine'))).toBe(false);
  });

  it('refuses a room with a public cell', () => {
    const g = room(4, 2, ZONE.Staff, true);
    g.zone[cellIndex(g, 10, 11)] = ZONE.Public;
    expect(screeningRoomOk(g, spec('machine'))).toBe(false);
  });

  it('refuses a machine that spans two rooms', () => {
    const g = room(4, 2, ZONE.Staff, true);
    g.vWall[vEdgeIndex(g, 12, 10)] = WALL.Wall;
    g.vWall[vEdgeIndex(g, 12, 11)] = WALL.Wall;
    expect(screeningRoomOk(g, spec('machine'))).toBe(false);
  });
});
