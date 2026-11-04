import { describe, expect, it } from 'vitest';
import type { Command } from '@sim/commands';
import type { Pt } from '@shared/geom';
import { taxiGraph } from '@shared/pavement/fromAirfield';
import { buildPavement } from '@shared/pavement/pavement';
import { TAXI_TOOL, taxiNodes } from '@shared/pavement/snap';
import { ownedSim, run } from './helpers';

const taxi = (points: Pt[]): Command => ({ type: 'buildTaxiway', points, code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 0 });

/** Node positions with their arm counts, sorted, so two layouts can be compared. */
function armSet(sim: ReturnType<typeof ownedSim>): string[] {
  return taxiNodes(sim.airfield.data.taxiways)
    .map((n) => `${n.p.x.toFixed(3)},${n.p.y.toFixed(3)}:${n.arms}`)
    .sort();
}

function minNodeGap(sim: ReturnType<typeof ownedSim>): number {
  const nodes = taxiNodes(sim.airfield.data.taxiways);
  let gap = Infinity;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) gap = Math.min(gap, Math.hypot(nodes[i].p.x - nodes[j].p.x, nodes[i].p.y - nodes[j].p.y));
  return gap;
}

describe('taxiway snapping (revision 2 section 2.2, test 3)', () => {
  it('a second arm onto a T node makes a 4 way junction without a new node', () => {
    const sim = ownedSim();
    run(sim, taxi([{ x: 4000, y: 5600 }, { x: 4300, y: 5600 }]));
    run(sim, taxi([{ x: 4150, y: 5450 }, { x: 4150, y: 5600 }]));
    const t = taxiNodes(sim.airfield.data.taxiways);
    const j1 = t.find((n) => n.arms === 3);
    expect(j1?.label).toBe('J1');
    const count = t.length;
    // Drawn from below, ending 9 m off the node: it snaps onto J1.
    expect(run(sim, taxi([{ x: 4150, y: 5760 }, { x: 4156, y: 5607 }]))).toEqual([]);
    const after = taxiNodes(sim.airfield.data.taxiways);
    expect(after.find((n) => n.p.x === 4150 && n.p.y === 5600)?.arms).toBe(4);
    expect(after.length).toBe(count + 1);
    expect(after.filter((n) => n.arms >= 3).length).toBe(1);
  });

  it('a segment snap splits the segment once and undo restores the arm set', () => {
    const sim = ownedSim();
    run(sim, taxi([{ x: 4000, y: 5600 }, { x: 4400, y: 5600 }]));
    const original = armSet(sim);
    expect(run(sim, taxi([{ x: 4210, y: 5450 }, { x: 4205, y: 5610 }]))).toEqual([]);
    const a = sim.airfield.data.taxiways[0];
    expect(a.points.length).toBe(3);
    expect(a.points[1]).toEqual({ x: 4205, y: 5600 });
    expect(taxiNodes(sim.airfield.data.taxiways).filter((n) => n.arms === 3).length).toBe(1);
    run(sim, { type: 'undo' });
    expect(armSet(sim)).toEqual(original);
    expect(sim.airfield.data.taxiways[0].points.length).toBe(2);
    run(sim, { type: 'redo' });
    expect(sim.airfield.data.taxiways[0].points.length).toBe(3);
    expect(taxiNodes(sim.airfield.data.taxiways).filter((n) => n.arms === 3).length).toBe(1);
  });

  it('an open end snap continues the taxiway instead of starting a new one', () => {
    const sim = ownedSim();
    run(sim, taxi([{ x: 4000, y: 5600 }, { x: 4200, y: 5600 }]));
    run(sim, taxi([{ x: 4208, y: 5603 }, { x: 4400, y: 5500 }]));
    expect(sim.airfield.data.taxiways.length).toBe(1);
    expect(sim.airfield.data.taxiways[0].points).toEqual([{ x: 4000, y: 5600 }, { x: 4200, y: 5600 }, { x: 4400, y: 5500 }]);
    run(sim, { type: 'undo' });
    expect(sim.airfield.data.taxiways[0].points.length).toBe(2);
  });

  it.each([99, 7, 2026])('random edits never leave two nodes closer than the gap, and the pavement stays valid (seed %i)', (start) => {
    let seed = start;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const sim = ownedSim();
    for (let k = 0; k < 60; k++) {
      const roll = rand();
      if (roll < 0.15) run(sim, { type: 'undo' });
      else if (roll < 0.2) run(sim, { type: 'redo' });
      else {
        const n = 2 + Math.floor(rand() * 3);
        const pts: Pt[] = [];
        let x = 3800 + rand() * 600;
        let y = 5400 + rand() * 400;
        for (let i = 0; i < n; i++) {
          pts.push({ x, y });
          x += (rand() - 0.5) * 300;
          y += (rand() - 0.5) * 300;
        }
        run(sim, taxi(pts));
      }
      expect(minNodeGap(sim)).toBeGreaterThanOrEqual(TAXI_TOOL.minNodeGapM - 1e-6);
    }
    expect(sim.airfield.data.taxiways.length).toBeGreaterThan(3);
    const geo = buildPavement(taxiGraph(sim.airfield.data.taxiways).graph);
    for (const f of geo.fills) for (const poly of f.polys) for (const r of poly) expect(r.length).toBeGreaterThanOrEqual(3);
  });
});
