import { carouselSize } from '@shared/baggageNodes';
import { describe, expect, it } from 'vitest';
import { BAGGAGE } from '@data/index';
import type { Sim } from '@sim/sim';
import catalogJson from '../src/data/fixtures/catalog.json';
import { WALL } from '../src/shared/business';
import { drawCenter, stagingLaneCenters, type BagDrawNode } from '../src/shared/baggageNodes';
import { hEdgeIndex, originFor, vEdgeIndex } from '../src/shared/terminalOps';
import { BAG_FIXED_ASSETS, bagAssetId, bagPlacement, TERMINAL_KIT_PACKS } from '../src/render/markings/airfieldPaint';
import { buildTestAirport, ownedSim, run } from './helpers';

const { ox, oy } = originFor(3960, 5440, 90);

interface Layout {
  sim: Sim;
  building: number;
}

/** A hall with a check in desk, a closed machine room with a door and one wall on the south edge for a bay. */
function layout(): Layout {
  const sim = ownedSim();
  buildTestAirport(sim);
  const edit = (building: number, e: { op: 'foundation' | 'floor' | 'zone' | 'fixture' | 'erase'; x0: number; y0: number; x1: number; y1: number; variant: number }): string[] =>
    run(sim, { type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e });
  expect(edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 70, y1: 53, variant: 0 })).toEqual([]);
  const building = sim.business.grids[0].id;
  expect(edit(building, { op: 'floor', x0: 40, y0: 40, x1: 70, y1: 53, variant: 2 })).toEqual([]);
  expect(edit(building, { op: 'zone', x0: 40, y0: 46, x1: 60, y1: 53, variant: 4 })).toEqual([]);
  const g = sim.business.grids[0];
  for (let x = 41; x <= 45; x++) {
    g.hWall[hEdgeIndex(g, x, 47)] = WALL.Wall;
    g.hWall[hEdgeIndex(g, x, 50)] = x === 43 ? WALL.Door : WALL.Wall;
  }
  for (let y = 47; y <= 49; y++) {
    g.vWall[vEdgeIndex(g, 41, y)] = WALL.Wall;
    g.vWall[vEdgeIndex(g, 46, y)] = WALL.Wall;
  }
  for (let x = 50; x <= 53; x++) g.hWall[hEdgeIndex(g, x, 53)] = WALL.Wall;
  expect(edit(building, { op: 'fixture', x0: 60, y0: 41, x1: 61, y1: 42, variant: 1 })).toEqual([]);
  return { sim, building };
}

const place = (l: Layout, kind: 'machine' | 'bay' | 'carousel', cx: number, cy: number, widthCells = 4): string[] =>
  run(l.sim, { type: 'placeBaggageNode', building: l.building, kind, cx, cy, rot: 0, widthCells });

const node = (kind: BagDrawNode['kind'], rot: BagDrawNode['rot'], cx = 10, cy = 10, widthCells = 4): BagDrawNode => ({ building: 1, kind, cx, cy, rot, widthCells, linked: false });

describe('baggage draw list', () => {
  it('lists an unlinked drop, then every node in id order with the drop linked once a machine exists', () => {
    const l = layout();
    expect(l.sim.baggage.drawList(l.building)).toEqual([{ building: l.building, kind: 'drop', cx: 60, cy: 41, rot: 0, widthCells: 1, linked: false }]);
    const before = l.sim.baggage.drawVersion();
    expect(place(l, 'machine', 42, 48)).toEqual([]);
    expect(place(l, 'carousel', 42, 42)).toEqual([]);
    expect(place(l, 'bay', 50, 49)).toEqual([]);
    expect(l.sim.baggage.drawVersion()).not.toBe(before);
    const list = l.sim.baggage.drawList(l.building);
    expect(list.map((n) => n.kind)).toEqual(['drop', 'machine', 'carousel', 'bay']);
    expect(list.map((n) => n.linked)).toEqual([true, false, false, false]);
    expect(list[1]).toMatchObject({ cx: 42, cy: 48, rot: 0, widthCells: BAGGAGE.footprints.machine.w });
    expect(list[2]).toMatchObject({ cx: 42, cy: 42, widthCells: carouselSize(0).w });
    expect(list[3]).toMatchObject({ cx: 50, cy: 49, widthCells: 4 });
  });

  it('sends the list on the grid copies and again when only the baggage changed', () => {
    const l = layout();
    expect(l.sim.takeTerminalGrids()?.[0].bagNodes).toHaveLength(1);
    expect(l.sim.takeTerminalGrids()).toBeNull();
    expect(place(l, 'machine', 42, 48)).toEqual([]);
    const grids = l.sim.takeTerminalGrids();
    expect(grids?.[0].bagNodes?.map((n) => n.kind)).toEqual(['drop', 'machine']);
  });
});

describe('baggage placement', () => {
  it('centers a 4 by 1 machine for all four rotations', () => {
    const centers = { 0: [12, 10.5], 1: [10.5, 12], 2: [9, 10.5], 3: [10.5, 9] };
    for (const rot of [0, 1, 2, 3] as const) {
      expect(drawCenter(node('machine', rot))).toEqual(centers[rot]);
      expect(bagPlacement(node('machine', rot))).toEqual({ x: centers[rot][0] * 2, y: centers[rot][1] * 2, rot: rot * 90 });
    }
  });

  it('has no placement for a drop', () => {
    expect(bagPlacement(node('drop', 0))).toBeNull();
  });

  it('puts one staging lane per two cells outside the truck edge of a width 6 bay', () => {
    expect(stagingLaneCenters(node('bay', 0, 10, 10, 6))).toEqual([[11, 18], [13, 18], [15, 18]]);
    expect(stagingLaneCenters(node('bay', 1, 10, 10, 6))).toEqual([[3, 11], [3, 13], [3, 15]]);
    expect(stagingLaneCenters(node('machine', 0))).toEqual([]);
  });
});

describe('baggage kit assets', () => {
  const byId = new Map((catalogJson.assets as { id: string; category: string }[]).map((a) => [a.id, a.category]));

  it('asks only for catalog assets of a loaded pack', () => {
    const ids = [...BAG_FIXED_ASSETS];
    for (const w of BAGGAGE.footprints.bay.widths) ids.push(bagAssetId(node('bay', 0, 0, 0, w)) ?? '');
    for (const kind of ['machine', 'carousel'] as const) ids.push(bagAssetId(node(kind, 0)) ?? '');
    for (const id of ids) {
      expect(byId.has(id), id).toBe(true);
      expect(TERMINAL_KIT_PACKS, id).toContain(byId.get(id));
    }
  });
});
