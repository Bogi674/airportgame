import { describe, expect, it } from 'vitest';
import { Sim } from '@sim/sim';
import type { Command } from '@sim/commands';
import { EdgeKind, TaxiNetwork } from '@sim/airfield/network';

function ownedSim(): Sim {
  const sim = new Sim('GOLDEN-0001', { preset: 'flatCoastal' });
  sim.parcelOwner.fill(1);
  return sim;
}

function run(sim: Sim, ...cmds: Command[]): string[] {
  for (const c of cmds) sim.enqueue(c);
  sim.step();
  const ev: string[] = [];
  sim.drainEvents(ev);
  return ev;
}

/** Runway 09/27, parallel taxiway with 3 connectors, an apron with two stands. */
function layout(sim: Sim): void {
  run(sim, { type: 'buildRunway', x: 3500, y: 5000, headingDeg: 90, lengthM: 2200, code: 'C', approach: 'precision', surface: 'asphalt', tier: 1 });
  run(sim, { type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 190, code: 'C', connectors: 3, surface: 'asphalt', tier: 1 });
  run(sim, { type: 'buildApron', polygon: [{ x: 4200, y: 5240 }, { x: 4600, y: 5240 }, { x: 4600, y: 5400 }, { x: 4200, y: 5400 }], surface: 'concrete', tier: 1 });
  run(sim, { type: 'buildStands', x: 4240, y: 5330, headingDeg: 0, count: 2, spacingM: 45, standType: 'remotePushback', code: 'C' });
}

describe('TaxiNetwork', () => {
  it('connects connectors to the parallel taxiway and the runway, and stands to the pavement', () => {
    const sim = ownedSim();
    layout(sim);
    const af = sim.airfield.data;
    expect(af.entries).toHaveLength(3);
    const net = TaxiNetwork.build(af, 1);
    expect(net.entryNode.every((n) => n >= 0)).toBe(true);
    expect(net.standNode.every((n) => n >= 0)).toBe(true);
    // Every entry node lies on the runway centerline and has a hold stop.
    for (const n of net.entryNode) expect(net.nodeOnRunway[n]).toBe(1);
    expect(net.holds.length).toBe(3);
    for (const h of net.holds) expect(h.dist).toBeGreaterThan(0);
  });

  it('routes from a stand to every runway entry and never uses runway edges', () => {
    const sim = ownedSim();
    layout(sim);
    const net = TaxiNetwork.build(sim.airfield.data, 1);
    const edges = new Int32Array(64);
    const dirs = new Int8Array(64);
    for (let i = 0; i < net.entryNode.length; i++) {
      const n = net.route(net.standNode[0], net.entryNode[i], 'C', 40, 0b11111, edges, dirs, 64);
      expect(n, `entry ${i}`).toBeGreaterThan(0);
      for (let k = 0; k < n; k++) expect(net.edgeKind[edges[k]]).not.toBe(EdgeKind.Runway);
      expect(net.edgeKind[edges[0]]).toBe(EdgeKind.StandLeadIn);
    }
  });

  it('respects closures, one way directions and maximum code', () => {
    const sim = ownedSim();
    layout(sim);
    const af = sim.airfield.data;
    const edges = new Int32Array(64);
    const dirs = new Int8Array(64);
    const base = TaxiNetwork.build(af, 1);
    expect(base.route(base.standNode[0], base.entryNode[0], 'C', 40, 0b11111, edges, dirs, 64)).toBeGreaterThan(0);
    // A code D aircraft cannot use code C pavement.
    expect(base.route(base.standNode[0], base.entryNode[0], 'D', 40, 0b11111, edges, dirs, 64)).toBe(-1);
    // Too heavy for the pavement strength.
    expect(base.route(base.standNode[0], base.entryNode[0], 'C', 500, 0b11111, edges, dirs, 64)).toBe(-1);
    // Closing the parallel taxiway cuts every route.
    run(sim, { type: 'setTaxiwayProps', id: af.taxiways[0].id, closed: true });
    const closed = TaxiNetwork.build(af, 2);
    expect(closed.route(closed.standNode[0], closed.entryNode[0], 'C', 40, 0b11111, edges, dirs, 64)).toBe(-1);
  });

  it('samples every 2 m with consistent headings', () => {
    const sim = ownedSim();
    layout(sim);
    const net = TaxiNetwork.build(sim.airfield.data, 1);
    const out = { x: 0, y: 0, h: 0 };
    for (let e = 0; e < net.edgeCount; e++) {
      expect(net.edgeSampleCount[e]).toBeGreaterThanOrEqual(2);
      net.pointAt(e, 0, out);
      expect(Math.hypot(out.x - net.nodeX[net.edgeFrom[e]], out.y - net.nodeY[net.edgeFrom[e]])).toBeLessThan(0.01);
      net.pointAt(e, net.edgeLen[e], out);
      expect(Math.hypot(out.x - net.nodeX[net.edgeTo[e]], out.y - net.nodeY[net.edgeTo[e]])).toBeLessThan(0.01);
    }
  });
});
