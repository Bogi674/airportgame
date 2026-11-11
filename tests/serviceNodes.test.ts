import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@data/index';
import { FIXTURE_KEYS, WALL, ZONE, fixtureKey, type FixtureKey, type TerminalGrid } from '../src/shared/business';
import { cellIndex, ensureCells, hEdgeIndex, newGrid, vEdgeIndex } from '../src/shared/terminalOps';
import { buildServiceNodes, expSeries, lnSeries, lognormalFactor, type ServiceNodes } from '../src/sim/terminal/serviceNodes';
import { buildWalkGraph, type WalkGraph } from '../src/sim/terminal/walkGraph';
import { Rng } from '../src/sim/rng';

/** A grid with logical cells from (x0, y0) to (x0 + w, y0 + h), rounded to whole chunks by ensureCells. */
function handGrid(x0: number, y0: number, w: number, h: number): TerminalGrid {
  const g = newGrid(1, 0, 0, 0);
  ensureCells(g, x0, y0, x0 + w, y0 + h);
  return g;
}

/** Sets floor on logical cells from (x0, y0) up to, not including, (x1, y1). */
function setFloor(g: TerminalGrid, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g.floor[cellIndex(g, x, y)] = 1;
}

/** Puts a fixture on one logical cell. */
function place(g: TerminalGrid, x: number, y: number, key: FixtureKey): void {
  g.fixture[cellIndex(g, x, y)] = FIXTURE_KEYS.indexOf(key) + 1;
}

/** Puts a two cell fixture with its anchor at (x, y), rot 0, and its tail at (x + 1, y). */
function placeTwo(g: TerminalGrid, x: number, y: number, key: FixtureKey): void {
  const a = cellIndex(g, x, y);
  const t = cellIndex(g, x + 1, y);
  g.fixture[a] = FIXTURE_KEYS.indexOf(key) + 1;
  g.fixtureRot[a] = 1;
  g.fixture[t] = FIXTURE_KEYS.indexOf(key) + 1;
  g.fixtureRot[t] = 5;
}

/** Puts a wall on the vertical edge left of logical cell (x, y). */
function wallLeftOf(g: TerminalGrid, x: number, y: number): void {
  g.vWall[vEdgeIndex(g, x, y)] = WALL.Wall;
}

/** Puts a wall on the horizontal edge above logical cell (x, y). */
function wallAbove(g: TerminalGrid, x: number, y: number): void {
  g.hWall[hEdgeIndex(g, x, y)] = WALL.Wall;
}

/** Nodes for a grid, with its walk graph. */
function nodesOf(g: TerminalGrid): { nodes: ServiceNodes; wg: WalkGraph } {
  const wg = buildWalkGraph(g);
  return { nodes: buildServiceNodes(g, wg), wg };
}

/** Node index whose logical cell is (x, y). */
function nodeAt(nodes: ServiceNodes, x: number, y: number): number {
  for (let k = 0; k < nodes.count; k++) if (nodes.lx[k] === x && nodes.ly[k] === y) return k;
  throw new Error(`no node at ${x},${y}`);
}

/** A 30 by 6 open hall with a row of fixtures on row 2, each on its own cell. */
function fixtureRow(): TerminalGrid {
  const g = handGrid(0, 0, 30, 6);
  setFloor(g, 0, 0, 30, 6);
  place(g, 2, 2, 'checkIn');
  place(g, 4, 2, 'seating');
  place(g, 6, 2, 'belt');
  place(g, 8, 2, 'convenience');
  place(g, 10, 2, 'kiosk');
  placeTwo(g, 12, 2, 'bagDrop');
  place(g, 16, 2, 'passport');
  placeTwo(g, 18, 2, 'gateDesk');
  place(g, 20, 2, 'toilet');
  place(g, 22, 2, 'security');
  return g;
}

describe('service nodes', () => {
  it('has nodes only on the service kinds, in cell order, and none on seating, belt, shops or tails', () => {
    const { nodes } = nodesOf(fixtureRow());
    const keys = Array.from(nodes.kind, (id) => fixtureKey(id));
    expect(keys).toEqual(['checkIn', 'kiosk', 'bagDrop', 'passport', 'gateDesk', 'toilet', 'security']);
    const cells = Array.from(nodes.cell);
    expect(cells).toEqual([...cells].sort((a, b) => a - b));
    expect(nodes.count).toBe(7);
  });

  it('takes servers and mean service time from the module data', () => {
    const { nodes } = nodesOf(fixtureRow());
    const toilet = nodeAt(nodes, 20, 2);
    expect(nodes.servers[toilet]).toBe(BUSINESS.modules.toilet.servers);
    expect(nodes.servers[toilet]).toBe(6);
    expect(nodes.meanS[toilet]).toBe(90);
    const security = nodeAt(nodes, 22, 2);
    expect(nodes.servers[security]).toBe(1);
    expect(nodes.meanS[security]).toBe(12);
  });

  it('gives each node the walk node of its cell', () => {
    const { nodes, wg } = nodesOf(fixtureRow());
    for (let k = 0; k < nodes.count; k++) {
      expect(nodes.walkNode[k]).toBeGreaterThanOrEqual(0);
      expect(nodes.walkNode[k]).toBe(wg.cellNode[nodes.cell[k]!]);
    }
    expect(nodes.slots).toBe(BUSINESS.terminal.service.queueSlots);
    expect(Array.from(nodes.serving).every((s) => s === -1)).toBe(true);
    expect(nodes.evictedCount).toBe(0);
    expect(nodes.evicted.length).toBe(0);
  });

  it('counts the open room cells within reach of a check in desk, times 4 square metres', () => {
    const g = handGrid(0, 0, 20, 20);
    setFloor(g, 0, 0, 20, 20);
    place(g, 10, 10, 'checkIn');
    const { nodes } = nodesOf(g);
    // Cells within 4 steps of (10, 10) in a 20 by 20 open room: 4 + 8 + 12 + 16 = 40.
    expect(nodes.queueCap[0]).toBe(40 * 4);
  });

  it('a wall cuts the queue count', () => {
    const g = handGrid(0, 0, 20, 20);
    setFloor(g, 0, 0, 20, 20);
    place(g, 10, 10, 'checkIn');
    for (let y = 0; y < 20; y++) wallLeftOf(g, 12, y);
    const { nodes } = nodesOf(g);
    // Cells with x 6 to 11 within 4 steps of (10, 10), excluding the desk: 31.
    expect(nodes.queueCap[0]).toBe(31 * 4);
    expect(nodes.queueCap[0]).toBeLessThan(40 * 4);
  });

  it('security skips secure cells, which are neither counted nor passed through', () => {
    const g = handGrid(0, 0, 20, 20);
    setFloor(g, 0, 0, 20, 20);
    place(g, 10, 10, 'security');
    for (let y = 0; y < 20; y++) for (let x = 11; x < 20; x++) g.zone[cellIndex(g, x, y)] = ZONE.Secure;
    const { nodes } = nodesOf(g);
    // Cells at x 6 to 10 within 4 steps of (10, 10), excluding the lane: 8 + 7 + 5 + 3 + 1 = 24.
    expect(nodes.queueCap[0]).toBe(24 * 4);
  });

  it('a fixture boxed in by walls has no queue', () => {
    const g = handGrid(0, 0, 20, 20);
    setFloor(g, 0, 0, 20, 20);
    place(g, 10, 10, 'checkIn');
    wallLeftOf(g, 10, 10);
    wallLeftOf(g, 11, 10);
    wallAbove(g, 10, 10);
    wallAbove(g, 10, 11);
    const { nodes } = nodesOf(g);
    expect(nodes.queueCap[0]).toBe(0);
  });

  it('keeps the queue ring sized by the slot count and the done list by the node count', () => {
    const { nodes } = nodesOf(fixtureRow());
    expect(nodes.qCohort.length).toBe(nodes.count * nodes.slots);
    expect(nodes.qSize.length).toBe(nodes.count * nodes.slots);
    expect(nodes.doneCohort.length).toBe(nodes.count * 16);
    expect(nodes.doneNode.length).toBe(nodes.count * 16);
  });
});

describe('lognormal math', () => {
  it('lnSeries matches Math.log on (0.5, 2]', () => {
    for (let i = 1; i <= 60; i++) {
      const x = 0.5 + (1.5 * i) / 60;
      expect(Math.abs(lnSeries(x) - Math.log(x))).toBeLessThan(1e-9);
    }
  });

  it('expSeries matches Math.exp over a sweep', () => {
    for (let i = 0; i <= 80; i++) {
      const x = -5 + (10 * i) / 80;
      expect(Math.abs(expSeries(x) - Math.exp(x))).toBeLessThan(1e-9);
    }
  });

  it('lognormalFactor has mean 1 and standard deviation cv over 20000 draws', () => {
    const rng = new Rng(20260311);
    const n = 20000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const f = lognormalFactor(rng, 0.4);
      sum += f;
      sumSq += f * f;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumSq / n - mean * mean);
    expect(Math.abs(mean - 1)).toBeLessThan(0.02);
    expect(Math.abs(sd - 0.4)).toBeLessThan(0.4 * 0.05);
  });

  it('the same seed gives the same sequence', () => {
    const a = new Rng(99);
    const b = new Rng(99);
    for (let i = 0; i < 100; i++) expect(lognormalFactor(a, 0.4)).toBe(lognormalFactor(b, 0.4));
  });
});

describe('service nodes on a grid with a negative origin', () => {
  it('reports logical cells from the grid origin and counts the queue there', () => {
    const g = newGrid(1, 0, 0, 0);
    ensureCells(g, -40, -20, 20, 20);
    expect(g.x0).toBeLessThan(0);
    expect(g.y0).toBeLessThan(0);
    for (let y = -10; y < 10; y++) for (let x = -10; x < 10; x++) g.floor[cellIndex(g, x, y)] = 1;
    place(g, -3, 5, 'checkIn');
    const { nodes } = nodesOf(g);
    expect(nodes.count).toBe(1);
    expect(nodes.lx[0]).toBe(-3);
    expect(nodes.ly[0]).toBe(5);
    expect(nodes.queueCap[0]).toBe(40 * 4);
  });
});

describe('service queue expansion stops at fixtures', () => {
  it('a fixture next to the anchor is neither counted nor passed through', () => {
    const g = handGrid(0, 0, 20, 1);
    setFloor(g, 0, 0, 20, 1);
    place(g, 10, 0, 'checkIn');
    place(g, 11, 0, 'seating');
    const { nodes } = nodesOf(g);
    // Only the cells 6 to 9 on the left are reachable in this one row corridor: 4 cells.
    expect(nodes.queueCap[0]).toBe(4 * 4);
  });
});
