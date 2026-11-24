import { describe, expect, it } from 'vitest';
import { AIRFIELD } from '@data/index';
import { EdgeKind, TaxiNetwork } from '@sim/airfield/network';
import { buildTestAirport, ownedSim, run } from './helpers';

/** The network node nearest a point. */
function nodeNear(net: TaxiNetwork, x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let n = 0; n < net.nodeCount; n++) {
    const d = Math.hypot(net.nodeX[n] - x, net.nodeY[n] - y);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

/** Every movement sample of the given edges. */
function samplesOf(net: TaxiNetwork, edges: Iterable<number>): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const e of edges) {
    for (let k = 0; k < net.edgeSampleCount[e]; k++) {
      const s = net.edgeSampleStart[e] + k;
      out.push({ x: net.sampleX[s], y: net.sampleY[s] });
    }
  }
  return out;
}

const R = AIRFIELD.codes.C.turnRadiusM;

describe('taxi network curves (T84)', () => {
  it('follows the bend curve of an L shaped taxiway instead of the corner point', () => {
    const sim = ownedSim();
    expect(run(sim, { type: 'buildTaxiway', points: [{ x: 4000, y: 5600 }, { x: 4300, y: 5600 }, { x: 4300, y: 5900 }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 0 })).toEqual([]);
    const net = TaxiNetwork.build(sim.airfield.data, 1);
    const all = samplesOf(net, Array.from({ length: net.edgeCount }, (_, e) => e).filter((e) => net.edgeKind[e] === EdgeKind.Taxiway));
    // The fillet of a right angle bend: center r inside the corner, tangent points r from the corner.
    const cx = 4300 - R;
    const cy = 5600 + R;
    const near = all.filter((p) => p.x > 4300 - R + 0.5 && p.y < 5600 + R - 0.5);
    expect(near.length).toBeGreaterThan(3);
    for (const p of near) expect(Math.abs(Math.hypot(p.x - cx, p.y - cy) - R)).toBeLessThan(0.3);
    // No sample sits on the sharp corner.
    for (const p of all) expect(Math.hypot(p.x - 4300, p.y - 5600)).toBeGreaterThan(R * (Math.SQRT2 - 1) - 0.5);
  });

  it('turns at a T junction on the fillet curve, away from the junction point', () => {
    const sim = ownedSim();
    expect(run(sim, { type: 'buildTaxiway', points: [{ x: 4000, y: 6200 }, { x: 4600, y: 6200 }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 0 })).toEqual([]);
    expect(run(sim, { type: 'buildTaxiway', points: [{ x: 4300, y: 6200 }, { x: 4300, y: 6500 }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 0 })).toEqual([]);
    const net = TaxiNetwork.build(sim.airfield.data, 1);
    const from = nodeNear(net, 4000, 6200);
    const to = nodeNear(net, 4300, 6500);
    const outE = new Int32Array(64);
    const outD = new Int8Array(64);
    const n = net.route(from, to, 'C', 0, 0xff, outE, outD, 64);
    expect(n).toBe(2);
    // The traffic's curve, driven directly: the pose s meters from the node along the route.
    const traffic = sim.traffic as unknown as { net: TaxiNetwork; pos: { x: number; y: number; h: number }; cornerPose(a: number, ad: number, b: number, bd: number, s: number): boolean };
    traffic.net = net;
    const cx = 4300 - R;
    const cy = 6200 + R;
    let inside = 0;
    for (let s = -R + 0.25; s < R; s += 0.5) {
      expect(traffic.cornerPose(outE[0], outD[0], outE[1], outD[1], s)).toBe(true);
      const p = traffic.pos;
      expect(Math.abs(Math.hypot(p.x - cx, p.y - cy) - R)).toBeLessThan(0.05);
      expect(Math.hypot(p.x - 4300, p.y - 6200)).toBeGreaterThan(R * (Math.SQRT2 - 1) - 0.05);
      inside++;
    }
    expect(inside).toBeGreaterThan(10);
    // Outside the tangent points the aircraft is back on the straight edge.
    expect(traffic.cornerPose(outE[0], outD[0], outE[1], outD[1], -R - 0.5)).toBe(false);
    expect(traffic.cornerPose(outE[0], outD[0], outE[1], outD[1], R + 0.5)).toBe(false);
    // Straight through the junction there is no curve.
    const east = nodeNear(net, 4600, 6200);
    const m = net.route(from, east, 'C', 0, 0xff, outE, outD, 64);
    expect(m).toBe(2);
    expect(traffic.cornerPose(outE[0], outD[0], outE[1], outD[1], 0)).toBe(false);
  });

  it('is deterministic over 2 000 ticks with curved taxi edges', () => {
    const hash = (): number => {
      const sim = ownedSim();
      buildTestAirport(sim);
      run(sim, { type: 'setTestTraffic', perHour: 20, turnScale: 0.1 });
      for (let i = 0; i < 2000; i++) sim.step();
      return sim.stateHash();
    };
    expect(hash()).toBe(hash());
  });
});
