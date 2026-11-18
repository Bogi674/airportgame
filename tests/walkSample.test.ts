import { describe, expect, it } from 'vitest';
import { WALL, type TerminalGrid } from '../src/shared/business';
import { cellIndex, ensureCells, newGrid, vEdgeIndex } from '../src/shared/terminalOps';
import { buildWalkGraph, type WalkGraph } from '../src/sim/terminal/walkGraph';
import { nearestNode, walkDistance } from '../src/sim/terminal/walkDistance';
import { ROUTE_OUT, cellAt, routePoint } from '../src/sim/cohorts/walkSample';

function handGrid(x0: number, y0: number, w: number, h: number): TerminalGrid {
  const g = newGrid(1, 0, 0, 0);
  ensureCells(g, x0, y0, x0 + w, y0 + h);
  return g;
}

function setFloor(g: TerminalGrid, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g.floor[cellIndex(g, x, y)] = 1;
}

function setVWall(g: TerminalGrid, x: number, y: number, kind: number): void {
  g.vWall[vEdgeIndex(g, x, y)] = kind;
}

function openFloor(): { g: TerminalGrid; wg: WalkGraph } {
  const g = handGrid(0, 0, 40, 20);
  setFloor(g, 0, 0, 40, 20);
  return { g, wg: buildWalkGraph(g) };
}

function splitFloor(door: boolean): { g: TerminalGrid; wg: WalkGraph } {
  const g = handGrid(0, 0, 40, 20);
  setFloor(g, 0, 0, 40, 20);
  for (let y = 0; y < 20; y++) setVWall(g, 20, y, WALL.Wall);
  if (door) setVWall(g, 20, 10, WALL.Door);
  return { g, wg: buildWalkGraph(g) };
}

describe('routePoint', () => {
  it('starts at the from centre, ends at the to centre and grows along the route', () => {
    const { g, wg } = openFloor();
    const from = nearestNode(wg, cellIndex(g, 3, 3));
    const to = nearestNode(wg, cellIndex(g, 35, 15));
    const out = new Float64Array(ROUTE_OUT);
    expect(routePoint(wg, wg.cache, from, 0, to, 0, out)).toBe(1);
    expect(out[0]).toBe(wg.nodeX[from]! + 0.5);
    expect(out[1]).toBe(wg.nodeY[from]! + 0.5);
    const total = walkDistance(wg, from, to);
    let last = -1;
    for (let s = 0; s < total; s += total / 10) {
      routePoint(wg, wg.cache, from, 0, to, s, out);
      expect(out[5]).toBeGreaterThanOrEqual(last);
      last = out[5]!;
    }
    expect(last).toBeGreaterThan(0);
    expect(routePoint(wg, wg.cache, from, 0, to, total + 5, out)).toBe(0);
    expect(out[0]).toBe(wg.nodeX[to]! + 0.5);
    expect(out[1]).toBe(wg.nodeY[to]! + 0.5);
  });

  it('resuming from the trail node gives the same point as a fresh walk', () => {
    const { g, wg } = openFloor();
    const from = nearestNode(wg, cellIndex(g, 3, 3));
    const to = nearestNode(wg, cellIndex(g, 35, 15));
    const a = new Float64Array(ROUTE_OUT);
    const b = new Float64Array(ROUTE_OUT);
    const total = walkDistance(wg, from, to);
    routePoint(wg, wg.cache, from, 0, to, total * 0.4, a);
    const node = a[4]!;
    const acc = a[5]!;
    expect(node).not.toBe(from);
    routePoint(wg, wg.cache, from, 0, to, total * 0.7, a);
    expect(routePoint(wg, wg.cache, node, acc, to, total * 0.7, b)).toBe(1);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it('passes the door of a split floor', () => {
    const { g, wg } = splitFloor(true);
    const from = nearestNode(wg, cellIndex(g, 10, 3));
    const to = nearestNode(wg, cellIndex(g, 30, 3));
    const total = walkDistance(wg, from, to);
    const out = new Float64Array(ROUTE_OUT);
    let near = Infinity;
    for (let s = 0; s < total; s += 0.25) {
      routePoint(wg, wg.cache, from, 0, to, s, out);
      near = Math.min(near, Math.hypot(out[0]! - 20, out[1]! - 10.5));
    }
    expect(near).toBeLessThanOrEqual(1);
  });

  it('has no route without a door', () => {
    const { g, wg } = splitFloor(false);
    const from = nearestNode(wg, cellIndex(g, 10, 3));
    const to = nearestNode(wg, cellIndex(g, 30, 3));
    expect(routePoint(wg, wg.cache, from, 0, to, 5, new Float64Array(ROUTE_OUT))).toBe(-1);
  });

  it('rejects invalid ids and finds cells by logical position', () => {
    const { g, wg } = openFloor();
    const out = new Float64Array(ROUTE_OUT);
    expect(routePoint(wg, wg.cache, -1, 0, 0, 1, out)).toBe(-1);
    expect(routePoint(wg, wg.cache, 0, 0, wg.nodeCount, 1, out)).toBe(-1);
    expect(cellAt(wg, 5, 6)).toBe(cellIndex(g, 5, 6));
    expect(cellAt(wg, -500, 0)).toBe(-1);
  });
});
