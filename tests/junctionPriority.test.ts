import { describe, expect, it } from 'vitest';
import type { Sim } from '@sim/sim';
import { AcState } from '@sim/ops/traffic';
import { EdgeKind, type TaxiNetwork } from '@sim/airfield/network';
import { migrate, SAVE_VERSION } from '@sim/save/migrations';
import { buildTestAirport, ownedSim, run } from './helpers';

const ROUTE = 40;

/** The private junction state the priority rules work on. */
interface Internals {
  net: TaxiNetwork;
  tick: number;
  active: Uint8Array;
  state: Uint8Array;
  type: Uint8Array;
  routeLen: Uint8Array;
  routeIdx: Uint8Array;
  routeEdge: Int32Array;
  routeDir: Int8Array;
  dist: Float64Array;
  speed: Float64Array;
  x: Float64Array;
  y: Float64Array;
  heldNode: Int32Array;
  nodeOwner: Int32Array;
  waitingFor: Int32Array;
  reqNode: Int32Array;
  reqTick: Int32Array;
  reqClass: Uint8Array;
  rebuildActive(): void;
  tryEnter(i: number, node: number, nextE: number, nextD: number): boolean;
}

interface Junction {
  node: number;
  inbound: [number, number];
  outbound: number;
}

/** A node with at least three taxiway edges touching it: two inbound edges and one outbound edge. */
function findJunction(net: TaxiNetwork): Junction {
  for (let n = 0; n < net.nodeCount; n++) {
    const touching: number[] = [];
    for (let e = 0; e < net.edgeCount; e++) {
      if (net.edgeKind[e] !== EdgeKind.Taxiway) continue;
      if (net.edgeFrom[e] === n || net.edgeTo[e] === n) touching.push(e);
    }
    if (touching.length >= 3) return { node: n, inbound: [touching[0], touching[1]], outbound: touching[2] };
  }
  throw new Error('test airport has no junction of three taxiway edges');
}

/**
 * Puts aircraft i on the junction with its inbound edge at routeIdx and its outbound edge after it.
 * It sits 2 km from the node so no conflict zone applies.
 */
function place(t: Internals, i: number, state: number, routeIdx: number, inbound: number, outbound: number, node: number): void {
  const net = t.net;
  const base = i * ROUTE;
  t.active[i] = 1;
  t.state[i] = state;
  t.type[i] = 0;
  t.routeLen[i] = routeIdx + 2;
  t.routeIdx[i] = routeIdx;
  t.routeEdge[base + routeIdx] = inbound;
  t.routeDir[base + routeIdx] = net.edgeTo[inbound] === node ? 1 : -1;
  t.routeEdge[base + routeIdx + 1] = outbound;
  t.routeDir[base + routeIdx + 1] = net.edgeFrom[outbound] === node ? 1 : -1;
  t.dist[i] = 0;
  t.speed[i] = 0;
  t.x[i] = net.nodeX[node] + 2000;
  t.y[i] = net.nodeY[node];
  t.heldNode[i] = -1;
  t.rebuildActive();
}

function junctionSim(): { t: Internals; j: Junction } {
  const sim = ownedSim();
  buildTestAirport(sim, { standsPerRow: 4 });
  const t = sim.traffic as unknown as Internals;
  return { t, j: findJunction(t.net) };
}

describe('junction priority', () => {
  it('a taxi out gives way to an arrival that is taxiing in', () => {
    const { t, j } = junctionSim();
    place(t, 3, AcState.TaxiOut, 1, j.inbound[0], j.outbound, j.node);
    place(t, 7, AcState.TaxiIn, 1, j.inbound[1], j.outbound, j.node);
    // Aircraft 7 asks first while another holds the node, so its request is open when 3 asks.
    t.nodeOwner[j.node] = 99;
    expect(t.tryEnter(7, j.node, j.outbound, 1)).toBe(false);
    t.nodeOwner[j.node] = -1;
    expect(t.tryEnter(3, j.node, j.outbound, 1)).toBe(false);
    expect(t.waitingFor[3]).toBe(7);
    expect(t.tryEnter(7, j.node, j.outbound, 1)).toBe(true);
  });

  it('an arrival already past its first edge gives way to one on its first edge', () => {
    const { t, j } = junctionSim();
    place(t, 3, AcState.TaxiIn, 1, j.inbound[0], j.outbound, j.node);
    place(t, 7, AcState.TaxiIn, 0, j.inbound[1], j.outbound, j.node);
    t.nodeOwner[j.node] = 99;
    expect(t.tryEnter(7, j.node, j.outbound, 1)).toBe(false);
    t.nodeOwner[j.node] = -1;
    expect(t.tryEnter(3, j.node, j.outbound, 1)).toBe(false);
    expect(t.waitingFor[3]).toBe(7);
    expect(t.tryEnter(7, j.node, j.outbound, 1)).toBe(true);
  });

  it('equal classes go by first request tick, then by index', () => {
    const { t, j } = junctionSim();
    place(t, 3, AcState.TaxiOut, 1, j.inbound[0], j.outbound, j.node);
    place(t, 7, AcState.TaxiOut, 1, j.inbound[1], j.outbound, j.node);
    t.nodeOwner[j.node] = 99;
    t.tick = 10;
    expect(t.tryEnter(7, j.node, j.outbound, 1)).toBe(false);
    t.tick = 20;
    expect(t.tryEnter(3, j.node, j.outbound, 1)).toBe(false);
    expect(t.reqTick[7]).toBe(10);
    expect(t.reqTick[3]).toBe(20);
    t.nodeOwner[j.node] = -1;
    expect(t.tryEnter(3, j.node, j.outbound, 1)).toBe(false);
    expect(t.waitingFor[3]).toBe(7);
    expect(t.tryEnter(7, j.node, j.outbound, 1)).toBe(true);
    expect(t.reqNode[7]).toBe(-1);
  });
});

function traffic(seed?: string): Sim {
  const sim = ownedSim(seed);
  buildTestAirport(sim, { standsPerRow: 4 });
  run(sim, { type: 'setTestTraffic', perHour: 60, turnScale: 0.1 });
  return sim;
}

describe('junction priority determinism', () => {
  it('2000 ticks twice from one seed give identical hashes', () => {
    const a = traffic();
    const b = traffic();
    for (let t = 0; t < 2000; t++) a.step();
    for (let t = 0; t < 2000; t++) b.step();
    expect(a.stateHash()).toBe(b.stateHash());
  });
});

describe('junction priority save', () => {
  it('a version 8 save without junction requests migrates to the current version', () => {
    const sim = traffic();
    for (let t = 0; t < 1000; t++) sim.step();
    const old = JSON.parse(JSON.stringify(sim.serialize())) as { version: number; traffic: { arrays: Record<string, string> } };
    old.version = 8;
    delete old.traffic.arrays.reqNode;
    delete old.traffic.arrays.reqTick;
    delete old.traffic.arrays.reqClass;
    expect(migrate(old).version).toBe(SAVE_VERSION);
  });
});
