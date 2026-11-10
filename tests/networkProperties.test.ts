import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { AIRFIELD } from '@data/index';
import { AcState } from '@sim/ops/traffic';
import { Rng, hashString } from '@sim/rng';
import { ownedSim, run, buildTestAirport } from './helpers';
import { EdgeKind, SAMPLE_M, TaxiNetwork } from '@sim/airfield/network';
import type { AirfieldPayload, Stand, Taxiway } from '@shared/airfield';

const RUNWAY_Y = 0;
const SPINE_Y = 200;

function taxiway(id: number, points: { x: number; y: number }[], oneWay = false): Taxiway {
  return {
    id,
    cost: 0,
    kind: 'taxiway',
    points,
    code: 'C',
    widthM: 15,
    surface: 'asphalt',
    pcr: 60,
    condition: 1,
    oneWay,
    closed: false,
    userMaxCode: 'C',
    maxCode: 'C',
    speedKmh: 40,
    name: `T${id}`,
  };
}

function distToPolyline(p: { x: number; y: number }, pts: { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

/** Point at a fraction along a random segment of the polyline. */
function pointOn(rng: Rng, pts: { x: number; y: number }[]): { x: number; y: number } {
  const s = rng.int(0, pts.length - 2);
  const t = rng.range(0.25, 0.75);
  return { x: pts[s].x + (pts[s + 1].x - pts[s].x) * t, y: pts[s].y + (pts[s + 1].y - pts[s].y) * t };
}

/**
 * A random connected layout: one runway, a spine taxiway, connectors from the runway to the spine, and 3 to 12
 * taxiways in all, the extra ones branching from or crossing earlier ones with bends, plus stands beside them.
 */
function randomLayout(seed: string): AirfieldPayload {
  const rng = new Rng(hashString(seed));
  const total = rng.int(3, 12);
  const taxiways: Taxiway[] = [];
  taxiways.push(taxiway(1, [{ x: 100, y: SPINE_Y }, { x: 1900, y: SPINE_Y }]));
  const entries: AirfieldPayload['entries'] = [];
  const connectors = Math.min(2, total - 1);
  for (let c = 0; c < connectors; c++) {
    const x = c === 0 ? rng.range(300, 700) : rng.range(1200, 1700);
    taxiways.push(taxiway(taxiways.length + 1, [{ x, y: RUNWAY_Y }, { x, y: SPINE_Y }]));
    entries.push({ x, y: RUNWAY_Y, runwayId: 1, taxiwayId: taxiways.length, todaTowardB: 2000, todaTowardA: 2000 });
  }
  // Extra taxiways: branches that bend, and crossings of the spine. A candidate is kept only when it stays clear
  // of every other taxiway except at its start, so no two arms run almost on top of each other.
  const starts: { x: number; y: number }[] = taxiways.slice(1).map((t) => t.points[1]);
  for (let attempt = 0; attempt < 400 && taxiways.length < total; attempt++) {
    const host = taxiways[rng.int(0, taxiways.length - 1)];
    if (host.points[0].y === RUNWAY_Y) continue;
    const cross = host === taxiways[0] && rng.next() < 0.3;
    const start = pointOn(rng, host.points);
    if (starts.some((p) => Math.hypot(p.x - start.x, p.y - start.y) < 80)) continue;
    const pts = [start];
    if (cross) {
      pts[0] = { x: start.x, y: SPINE_Y - 100 };
      pts.push({ x: start.x + rng.range(-20, 20), y: SPINE_Y + 150 });
    } else {
      let { x, y } = start;
      const dir = rng.next() < 0.5 ? 1 : -1;
      for (let k = rng.int(1, 3); k > 0; k--) {
        y += dir * rng.range(90, 220);
        x += rng.range(-120, 120);
        pts.push({ x, y });
      }
    }
    if (pts.some((p) => p.y < 40)) continue;
    const clear = pts.slice(cross ? 0 : 1).every((p) => taxiways.every((t) => t === host || distToPolyline(p, t.points) > 45));
    if (!clear) continue;
    starts.push(pts[pts.length - 1], start);
    taxiways.push(taxiway(taxiways.length + 1, pts, !cross && rng.next() < 0.1));
  }
  const stands: Stand[] = [];
  const standCount = rng.int(1, 4);
  for (let s = 0; s < standCount; s++) {
    const host = taxiways[0];
    const x = host.points[0].x + 200 + s * 380 + rng.range(0, 60);
    // A stand needs its own stretch of the spine, clear of every other arm.
    if (taxiways.slice(1).some((t) => distToPolyline({ x, y: SPINE_Y - 70 }, t.points) < 90)) continue;
    stands.push({
      id: stands.length + 1,
      cost: 0,
      number: String(stands.length + 1),
      x,
      y: SPINE_Y - 70,
      headingDeg: 180,
      type: 'remote',
      size: 'medium',
      code: 'C',
      surface: 'concrete',
      pushback: 'auto',
    });
  }
  return {
    version: 1,
    runways: [
      {
        id: 1, cost: 0, x1: 0, y1: RUNWAY_Y, x2: 2000, y2: RUNWAY_Y, headingDeg: 90, lengthM: 2000, widthM: 45, shoulderM: 0,
        code: 'C', approach: 'precision', surface: 'asphalt', pcr: 60, condition: 1, nameA: '09', nameB: '27',
      },
    ],
    taxiways,
    aprons: [],
    stands,
    holding: [],
    entries,
  };
}

const LAYOUTS = 200;
const nets: { af: AirfieldPayload; net: TaxiNetwork }[] = [];
for (let n = 0; n < LAYOUTS; n++) {
  const af = randomLayout(`PROP-${n}`);
  nets.push({ af, net: TaxiNetwork.build(af, 1) });
}

describe('TaxiNetwork properties on random layouts', () => {
  it('builds a network for every layout with junctions', () => {
    for (const { net } of nets) expect(net.edgeCount).toBeGreaterThan(3);
    expect(nets.some(({ net }) => net.conflictEdge.length > 0)).toBe(true);
  });

  it('has samples every 2 m or less on every edge', () => {
    for (const { net } of nets) {
      for (let e = 0; e < net.edgeCount; e++) {
        const n = net.edgeSampleCount[e];
        expect(n).toBeGreaterThanOrEqual(2);
        expect(net.edgeLen[e] / (n - 1)).toBeLessThanOrEqual(SAMPLE_M + 1e-6);
        const s = net.edgeSampleStart[e];
        for (let k = 1; k < n; k++) {
          const d = Math.hypot(net.sampleX[s + k] - net.sampleX[s + k - 1], net.sampleY[s + k] - net.sampleY[s + k - 1]);
          expect(d).toBeLessThanOrEqual(SAMPLE_M + 1e-3);
        }
      }
    }
  });

  it('partitions the two way edges into blocks, one block per taxiway', () => {
    for (const { net } of nets) {
      const sourceOfBlock = new Map<number, number>();
      for (let e = 0; e < net.edgeCount; e++) {
        const kind = net.edgeKind[e];
        const b = net.edgeBlock[e];
        if (kind === EdgeKind.Runway || net.edgeOneWay[e] === 1) {
          expect(b).toBe(-1);
          continue;
        }
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(net.blockTotal);
        if (kind === EdgeKind.StandLeadIn || kind === EdgeKind.StandFork) continue;
        const prev = sourceOfBlock.get(b);
        if (prev === undefined) sourceOfBlock.set(b, net.edgeSource[e]);
        else expect(prev).toBe(net.edgeSource[e]);
      }
      const sources = new Set(Array.from(sourceOfBlock.values()));
      expect(sources.size).toBe(sourceOfBlock.size);
    }
  });

  it('reaches every stand from every runway entry', () => {
    const edges = new Int32Array(64);
    const dirs = new Int8Array(64);
    for (const { af, net } of nets) {
      for (let s = 0; s < af.stands.length; s++) {
        expect(net.standNode[s]).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < net.entryNode.length; i++) {
          const n = net.route(net.standNode[s], net.entryNode[i], 'C', 60, 0b11111, edges, dirs, 64);
          if (n <= 0) console.log('FAIL', JSON.stringify(af.taxiways.map((t) => [t.id, t.oneWay, t.points])), JSON.stringify(af.stands.map((x) => [x.x, x.y])), s, i, net.entryNode[i], net.standNode[s]);
          expect(n).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps conflict sets symmetric, irreflexive, sorted and within taxiway edges', () => {
    for (const { net } of nets) {
      expect(net.conflictStart.length).toBe(net.edgeCount + 1);
      expect(net.conflictStart[net.edgeCount]).toBe(net.conflictEdge.length);
      const has = (a: number, b: number): boolean => {
        for (let c = net.conflictStart[a]; c < net.conflictStart[a + 1]; c++) if (net.conflictEdge[c] === b) return true;
        return false;
      };
      for (let e = 0; e < net.edgeCount; e++) {
        for (let c = net.conflictStart[e]; c < net.conflictStart[e + 1]; c++) {
          const f = net.conflictEdge[c];
          expect(f).not.toBe(e);
          expect(net.edgeSource[f]).not.toBe(net.edgeSource[e]);
          expect(net.edgeKind[f]).toBeLessThanOrEqual(EdgeKind.RapidExit);
          expect(has(f, e)).toBe(true);
          if (c > net.conflictStart[e]) expect(net.conflictEdge[c]).toBeGreaterThan(net.conflictEdge[c - 1]);
        }
      }
    }
  });
});

describe('junction conflicts in traffic', () => {
  const ROUTE = 40;
  const GROUND: number[] = [AcState.TaxiIn, AcState.TaxiOut, AcState.Pushback, AcState.Holding];

  /** Smallest wingtip distance minus the code clearance over all ticks, for aircraft on conflicting edges. */
  function worstSlack(seed: string, seconds: number, perHour: number): { slack: number; pairs: number; info: string } {
    const sim = ownedSim(seed);
    buildTestAirport(sim, { standsPerRow: 10 });
    run(sim, { type: 'setTestTraffic', perHour, turnScale: 0.1 });
    const t = sim.traffic;
    const net = t.net;
    let slack = Infinity;
    let pairs = 0;
    let info = '';
    for (let tick = 0; tick < seconds * 10; tick++) {
      sim.step();
      for (let i = 0; i < 256; i++) {
        if (t.active[i] === 0 || !GROUND.includes(t.state[i])) continue;
        const ei = t.routeEdge[i * ROUTE + t.routeIdx[i]];
        for (let j = i + 1; j < 256; j++) {
          if (t.active[j] === 0 || !GROUND.includes(t.state[j])) continue;
          const ej = t.routeEdge[j * ROUTE + t.routeIdx[j]];
          let conflict = false;
          for (let c = net.conflictStart[ei]; c < net.conflictStart[ei + 1]; c++) if (net.conflictEdge[c] === ej) conflict = true;
          // An aircraft stopped short of a junction waits at its hold distance, which the node owner check governs.
          // Pairs that wait for each other are ordered by the tie break and by junction priority (T09).
          if (!conflict || t.speed[i] < 0.3 || t.speed[j] < 0.3 || t.waitingFor[i] === j || t.waitingFor[j] === i) continue;
          pairs++;
          const a = AIRCRAFT[t.type[i]];
          const b = AIRCRAFT[t.type[j]];
          // Each code allows its own wingtip clearance (taxiway separation minus span), the pair needs the smaller one.
          const clearance = Math.min(...[a, b].map((x) => AIRFIELD.codes[x.derivedForReading.code].taxiSepM - x.dimensions.wingspanM));
          const tips = Math.hypot(t.x[i] - t.x[j], t.y[i] - t.y[j]) - (a.dimensions.wingspanM + b.dimensions.wingspanM) / 2;
          if (tips - clearance < slack) {
            slack = tips - clearance;
            info = `tick ${sim.tick} st ${t.state[i]}/${t.state[j]} ei ${ei}/${ej} d ${t.dist[i].toFixed(0)}/${t.dist[j].toFixed(0)} len ${net.edgeLen[ei].toFixed(0)}/${net.edgeLen[ej].toFixed(0)} sp ${t.speed[i].toFixed(1)}/${t.speed[j].toFixed(1)} ${a.id}/${b.id} tips ${tips.toFixed(1)} clr ${clearance} wf ${t.waitingFor[i]}/${t.waitingFor[j]} idx ${i}/${j} held ${t.heldNode[i]}/${t.heldNode[j]} acq ${t.nextAcq[i]}/${t.nextAcq[j]}`;
          }
        }
      }
    }
    return { slack, pairs, info };
  }

  it('keeps wingtips at least the code clearance apart on conflicting edges', () => {
    for (const seed of ['GOLDEN-0001', 'GOLDEN-0002']) {
      const r = worstSlack(seed, 3600, 40);
      expect(r.pairs).toBeGreaterThan(20);
      expect(r.slack, seed + r.info).toBeGreaterThanOrEqual(0);
    }
  });
});
