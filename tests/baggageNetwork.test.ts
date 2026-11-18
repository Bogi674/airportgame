import { describe, expect, it } from 'vitest';
import { BaggageNetwork, type BagNode, type BagNodeKind, type Cell, type CellRect } from '@sim/ops/baggage/network';

const PAVEMENT: CellRect = { x0: 40, y0: 0, x1: 60, y1: 10 };

function node(id: number, kind: BagNodeKind, inPort: Cell | null, outPort: Cell | null, floor = 0): BagNode {
  return { id, kind, floor, inPort, outPort, stands: [] };
}

function network(blocked: CellRect[] = [PAVEMENT], owned: CellRect | null = null, maxLenM = 300): BaggageNetwork {
  return new BaggageNetwork({ blocked, owned, maxLenM });
}

describe('baggage network, port of baggage_links.py __main__', () => {
  it('runs every rule check of the reference', () => {
    const net = network();
    net.add(node(1, 'drop', null, [2, 1]));
    expect(net.machineOf(1)).toBeNull();
    net.add(node(2, 'machine', [10, 5], [14, 5]));
    expect(net.machineOf(1), 'rule D adopts the orphan drop point').toBe(2);
    net.add(node(3, 'drop', null, [4, 1]));
    expect(net.machineOf(3), 'rule A').toBe(2);
    net.add(node(4, 'carousel', [20, 20], null));
    net.add(node(5, 'bay', [30, 12], [32, 12]));
    expect(net.carouselOf(5), 'rule B').toBe(4);
    expect('problem' in net.routeDeparture(1, 22)).toBe(true);
    net.assignStand(5, 22);
    expect(net.routeDeparture(1, 22), 'rule C').toEqual({ route: [1, 2, 5] });
    net.unassignStand(5, 22);
    expect('problem' in net.routeDeparture(1, 22), 'rule E').toBe(true);
    const blocked = net.path([35, 5], [65, 5], 0, 0);
    expect(blocked).toEqual({ problem: 'crossesPavement' });
  });
});

describe('baggage network paths', () => {
  it('chooses the shorter L variant when the other turn is blocked', () => {
    // The horizontal first variant turns at (4, 0), which is blocked.
    const net = network([{ x0: 4, y0: 0, x1: 4, y1: 0 }]);
    const p = net.path([0, 0], [4, 4], 0, 0);
    expect('problem' in p).toBe(false);
    if ('problem' in p) return;
    expect(p.cells[1]).toEqual([0, 1]);
    expect(p.cells[p.cells.length - 1]).toEqual([4, 4]);
    expect(p.lengthM).toBe(16);
  });

  it('breaks a length tie with the turn closest to the source', () => {
    const net = network([]);
    const p = net.path([0, 0], [4, 2], 0, 0);
    if ('problem' in p) throw new Error('expected a path');
    // Vertical first turns at (0, 2), two cells away. Horizontal first turns at (4, 0), four cells away.
    expect(p.cells[1]).toEqual([0, 1]);
    expect(p.cells[2]).toEqual([0, 2]);
  });

  it('reports differentFloor', () => {
    expect(network([]).path([0, 0], [4, 0], 0, 1)).toEqual({ problem: 'differentFloor' });
  });

  it('reports outsideOwned', () => {
    const net = network([], { x0: 0, y0: 0, x1: 10, y1: 10 });
    expect(net.path([0, 0], [12, 0], 0, 0)).toEqual({ problem: 'outsideOwned' });
  });

  it('reports tooLong at maxLenM 10', () => {
    expect(network([], null, 10).path([0, 0], [8, 0], 0, 0)).toEqual({ problem: 'tooLong' });
  });
});

describe('baggage network automatic rules', () => {
  it('keeps a manual link when the automatic rule E runs', () => {
    const net = network([]);
    net.add(node(4, 'carousel', [20, 20], null));
    net.add(node(5, 'bay', [30, 12], [32, 12]));
    net.add(node(2, 'machine', [10, 5], [14, 5]));
    expect(net.link(2, 5, 'manual')).not.toBeNull();
    net.assignStand(5, 22);
    net.unassignStand(5, 22);
    const kept = net.linksFrom(2).find((l) => l.dst === 5);
    expect(kept?.mode).toBe('manual');
  });

  it('never refills after remove, and warnings list the orphan', () => {
    const net = network([]);
    net.add(node(1, 'drop', null, [2, 1]));
    net.add(node(2, 'machine', [10, 5], [14, 5]));
    expect(net.machineOf(1)).toBe(2);
    net.remove(2);
    expect(net.machineOf(1)).toBeNull();
    expect(net.linksFrom(1)).toEqual([]);
    expect(net.warnings()).toEqual([{ id: 1, code: 'dropNoMachine' }]);
  });

  it('fix re-runs the rule and adds the nearer machine', () => {
    const net = network([]);
    net.add(node(1, 'drop', null, [2, 1]));
    net.add(node(2, 'machine', [10, 5], [14, 5]));
    net.add(node(3, 'machine', [4, 4], [8, 4]));
    expect(net.linksFrom(1).map((l) => l.dst)).toEqual([2]);
    net.fix(1);
    expect(net.linksFrom(1).map((l) => l.dst)).toEqual([2, 3]);
    expect(net.machineOf(1)).toBe(2);
  });

  it('lets the lowest id win a distance tie in rule A', () => {
    const net = network([]);
    net.add(node(3, 'machine', [6, 1], [8, 1]));
    net.add(node(2, 'machine', [2, 5], [6, 5]));
    net.add(node(1, 'drop', null, [2, 1]));
    expect(net.machineOf(1)).toBe(2);
  });

  it('reports a bay without carousel and a machine without bay', () => {
    const net = network([]);
    net.add(node(2, 'machine', [10, 5], [14, 5]));
    net.add(node(5, 'bay', [30, 12], [32, 12]));
    expect(net.warnings()).toEqual([
      { id: 2, code: 'machineNoBay' },
      { id: 5, code: 'bayNoCarousel' },
    ]);
  });
});
