import { describe, expect, it } from 'vitest';
import type { Sim } from '@sim/sim';
import { taxiGraph } from '@shared/pavement/fromAirfield';
import { nodeGeometry } from '@shared/pavement/pavement';
import { sectionPolylines } from '@shared/pavement/sections';
import type { Taxiway } from '@shared/airfield';
import { ownedSim, run } from './helpers';

const tw = (points: { x: number; y: number }[]): { type: 'buildTaxiway'; points: { x: number; y: number }[]; code: 'C'; kind: 'taxiway'; surface: 'asphalt'; tier: 1 } => ({
  type: 'buildTaxiway',
  points,
  code: 'C',
  kind: 'taxiway',
  surface: 'asphalt',
  tier: 1,
});

/** A long east west taxiway with a north south connector that joins its middle. */
function tee(sim: Sim): void {
  const p = run(sim, tw([{ x: 3000, y: 5000 }, { x: 4000, y: 5000 }]), tw([{ x: 3500, y: 5300 }, { x: 3500, y: 5000 }]));
  if (p.length > 0) throw new Error(p.join(', '));
}

/** A crossing: the second taxiway passes over the middle of the first with a point on it. */
function cross(sim: Sim): void {
  const p = run(sim, tw([{ x: 3000, y: 5000 }, { x: 4000, y: 5000 }]), tw([{ x: 3500, y: 5300 }, { x: 3500, y: 5000 }, { x: 3500, y: 4700 }]));
  if (p.length > 0) throw new Error(p.join(', '));
}

describe('taxiway sections (T71)', () => {
  it('splits the joined taxiway into two sections that keep its name and cost', () => {
    const sim = ownedSim();
    run(sim, tw([{ x: 3000, y: 5000 }, { x: 4000, y: 5000 }]));
    const cost = sim.airfield.data.taxiways[0].cost;
    run(sim, tw([{ x: 3500, y: 5300 }, { x: 3500, y: 5000 }]));
    const ts = sim.airfield.data.taxiways;
    expect(ts.length).toBe(3);
    const main = ts.filter((t) => t.points.every((p) => p.y === 5000));
    expect(main.length).toBe(2);
    expect(main[0].name).toBe(main[1].name);
    expect(main[0].line).toBe(main[1].line);
    expect(main[0].cost + main[1].cost).toBe(cost);
    const connector = ts.find((t) => !main.includes(t)) as Taxiway;
    expect(connector.name).toBe(`${main[0].name}1`);
  });

  it('splits both taxiways at a crossing into four sections', () => {
    const sim = ownedSim();
    cross(sim);
    const ts = sim.airfield.data.taxiways;
    expect(ts.length).toBe(4);
    expect(new Set(ts.map((t) => t.line ?? t.id)).size).toBe(2);
  });

  it('builds the same pavement graph as the unsplit layout', () => {
    const sim = ownedSim();
    cross(sim);
    const split = taxiGraph(sim.airfield.data.taxiways).graph;
    const kinds = [...nodeGeometry(split).values()].map((g) => g.kind).sort();
    expect(split.nodes.length).toBe(5);
    expect(split.edges.length).toBe(4);
    // One junction in the middle and four open ends: no seam node anywhere.
    expect(kinds.filter((k) => k === 'junction').length).toBe(1);
    expect(kinds.filter((k) => k === 'end').length).toBe(4);
  });

  it('continues an open end without a split', () => {
    const sim = ownedSim();
    run(sim, tw([{ x: 3000, y: 5000 }, { x: 3500, y: 5000 }]), tw([{ x: 3500, y: 5000 }, { x: 4000, y: 5000 }]));
    expect(sim.airfield.data.taxiways.length).toBe(1);
  });

  it('undo restores the unsplit taxiway and redo splits it again', () => {
    const sim = ownedSim();
    run(sim, tw([{ x: 3000, y: 5000 }, { x: 4000, y: 5000 }]));
    const before = structuredClone(sim.airfield.data.taxiways);
    run(sim, tw([{ x: 3500, y: 5300 }, { x: 3500, y: 5000 }]));
    const after = structuredClone(sim.airfield.data.taxiways);
    run(sim, { type: 'undo' });
    expect(sim.airfield.data.taxiways.map((t) => t.points)).toEqual(before.map((t) => t.points));
    run(sim, { type: 'redo' });
    const ids = (l: Taxiway[]): number[] => l.map((t) => t.id).sort((p, q) => p - q);
    expect(ids(sim.airfield.data.taxiways)).toEqual(ids(after));
  });

  it('splits the parallel taxiway at every connector', () => {
    const sim = ownedSim();
    const p = run(
      sim,
      { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 1800, code: 'C', approach: 'visual', surface: 'asphalt', tier: 1 },
      { type: 'buildParallelTaxiway', runwayId: 1, side: 'left', offsetM: 180, connectors: 3, code: 'C', surface: 'asphalt', tier: 1 },
    );
    expect(p).toEqual([]);
    const ts = sim.airfield.data.taxiways;
    const lines = new Map<number, number>();
    for (const t of ts) lines.set(t.line ?? t.id, (lines.get(t.line ?? t.id) ?? 0) + 1);
    // The connectors sit inset from the parallel's ends, so three connectors cut it into four sections.
    expect([...lines.values()].sort()).toEqual([1, 1, 1, 4]);
    expect(sim.airfield.data.entries.length).toBeGreaterThanOrEqual(3);
  });

  it('cuts at an end that lands on a segment, using that end as the new vertex', () => {
    const a: Taxiway = { ...structuredClone(base), id: 1, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    const b: Taxiway = { ...structuredClone(base), id: 2, points: [{ x: 40, y: 50 }, { x: 40, y: 1 }] };
    const parts = sectionPolylines(a, [a, b]);
    expect(parts).toEqual([
      [{ x: 0, y: 0 }, { x: 40, y: 1 }],
      [{ x: 40, y: 1 }, { x: 100, y: 0 }],
    ]);
  });

  it('is deterministic over 2 000 ticks with sections', () => {
    const hash = (): number => {
      const sim = ownedSim();
      tee(sim);
      for (let i = 0; i < 2000; i++) sim.step();
      return sim.stateHash();
    };
    expect(hash()).toBe(hash());
  });
});

const base: Taxiway = {
  id: 0,
  cost: 0,
  kind: 'taxiway',
  points: [],
  code: 'C',
  widthM: 15,
  surface: 'asphalt',
  pcr: 1,
  condition: 1,
  oneWay: false,
  closed: false,
  userMaxCode: 'C',
  maxCode: 'C',
  speedKmh: 30,
  name: 'A',
};
