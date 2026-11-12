import { describe, expect, it } from 'vitest';
import { AIRCRAFT, SPRITE_BASES } from '@data/aircraft';
import { GSE, GSE_INDEX } from '@data/index';
import { aircraftBoundary, footprintClash, footprintSpecSchema, toAircraftLocal, vehiclesTouch, type Poly } from '@shared/aircraftFootprint';
import type { Pt } from '@shared/geom';
import { AcState, MAX_AIRCRAFT } from '@sim/ops/traffic';
import type { Command } from '@sim/commands';
import type { Sim } from '@sim/sim';
import { sizeForCode } from '@shared/standSizes';
import { WORK_STATE } from '@sim/vehicles/gse';
import { buildTestAirport, ownedSim, run } from './helpers';

/** The clash gap the crew keeps, as in src/sim/vehicles/gse.ts. */
const GAP_M = 0.5;

/** Wingspan above which a type needs a code E runway and stand, as the test airport is code C. */
const CODE_C_MAX_SPAN_M = 36;

/**
 * A code E runway with a parallel taxiway, an apron and one code E stand, for the wide bodies that
 * buildTestAirport cannot land. Throws if any command is refused.
 */
function buildCodeEAirport(sim: Sim): void {
  const errors: string[] = [];
  const go = (cmd: Command): void => {
    errors.push(...run(sim, cmd));
  };
  go({ type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 3300, code: 'E', approach: 'precision', surface: 'asphalt', tier: 2 });
  go({ type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 200, code: 'E', connectors: 4, surface: 'asphalt', tier: 2 });
  go({ type: 'buildApron', polygon: [{ x: 3800, y: 5270 }, { x: 4900, y: 5270 }, { x: 4900, y: 5460 }, { x: 3800, y: 5460 }], surface: 'concrete', tier: 2 });
  go({ type: 'buildStands', x: 4850, y: 5340, headingDeg: 180, count: 1, spacingM: 80, standType: 'remote', size: sizeForCode('E') });
  if (errors.length > 0) throw new Error(`code E test airport failed: ${errors.join(', ')}`);
}

/** Convex hull of a point set, counter clockwise (monotone chain). */
function hullOf(points: Poly): Poly {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
    upper.push(pts[i]);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * The hard parts buffered by the clash gap, as convex hulls, so each check needs no buffer work.
 * Same octagon as the clash check: vertices at gap / cos(PI / 8), then the hull of every sum.
 */
function bufferedHard(hard: readonly Poly[], gapM: number): Poly[] {
  const r = gapM / Math.cos(Math.PI / 8);
  const octagon: Pt[] = [];
  for (let k = 0; k < 8; k++) octagon.push({ x: r * Math.cos((k * Math.PI) / 4), y: r * Math.sin((k * Math.PI) / 4) });
  return hard.map((poly) => hullOf(poly.flatMap((p) => octagon.map((o) => ({ x: p.x + o.x, y: p.y + o.y })))));
}

/** Largest lateral distance of the outline where it crosses station y. */
function outlineReach(poly: Poly, y: number): number {
  let m = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if (p.y === q.y || (p.y - y) * (q.y - y) > 0) continue;
    m = Math.max(m, Math.abs(p.x + ((q.x - p.x) * (y - p.y)) / (q.y - p.y)));
  }
  return m;
}

/** World rectangle of a vehicle centred at (x, y), long axis along heading. */
function rectOf(x: number, y: number, heading: number, lengthM: number, widthM: number): Poly {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const hl = lengthM / 2;
  const hw = widthM / 2;
  return [
    { x: x + c * hl - s * hw, y: y + s * hl + c * hw },
    { x: x + c * hl + s * hw, y: y + s * hl - c * hw },
    { x: x - c * hl + s * hw, y: y - s * hl - c * hw },
    { x: x - c * hl - s * hw, y: y - s * hl + c * hw },
  ];
}

describe('ground vehicles clear the aircraft at every tick', () => {
  it('no crew vehicle clashes with a docked aircraft or touches another vehicle, for every MVP 1 type', () => {
    const problems: string[] = [];
    const turned: string[] = [];
    /** Vehicle kinds seen at a turnaround, per type. */
    const kindsSeen = new Map<string, Set<number>>();
    /** Refueller dock side per type: true when it sits under the wing. */
    const refuellerUnder = new Map<string, boolean>();
    AIRCRAFT.forEach((spec, typeIdx) => {
      const footprint = footprintSpecSchema.parse(SPRITE_BASES[spec.sprite.base]);
      const outline = aircraftBoundary(footprint);
      const hard = bufferedHard(outline.hard, GAP_M);
      const over = outline.over;
      const half = spec.dimensions.lengthM / 2;
      // Every point of the footprint lies within this radius of the aircraft centre, so farther vehicles cannot clash.
      const reach = Math.hypot(spec.dimensions.lengthM, spec.dimensions.wingspanM) / 2 + 1;
      const sim = ownedSim();
      const lastPose = new Map<number, string>();
      const before = problems.length;
      let turnedHere = false;
      if (spec.dimensions.wingspanM > CODE_C_MAX_SPAN_M) buildCodeEAirport(sim);
      else buildTestAirport(sim, { standsPerRow: 4 });
      run(sim, { type: 'testArrival', typeIdx, inTicks: 0, turnTicks: 600 });
      for (let t = 0; t < 4000 && sim.traffic.completedFlights === 0; t++) {
        sim.step();
        let turningNow = false;
        const live: number[] = [];
        for (let v = 0; v < 1024; v++) if (sim.gse.active[v] === 1) live.push(v);
        for (let a = 0; a < MAX_AIRCRAFT; a++) {
          if (sim.traffic.state[a] !== AcState.Turnaround || sim.traffic.type[a] !== typeIdx) continue;
          turned.push(spec.id);
          turnedHere = true;
          turningNow = true;
          if (!kindsSeen.has(spec.id)) kindsSeen.set(spec.id, new Set());
          const h = sim.traffic.heading[a];
          const cx = Math.cos(h);
          const cy = Math.sin(h);
          // The aircraft position is its centre, so the nose lies half a length ahead of it.
          const nx = sim.traffic.x[a] + cx * half;
          const ny = sim.traffic.y[a] + cy * half;
          for (const v of live) {
            if (sim.gse.owner[v] !== a) continue;
            const kind = sim.gse.kind[v];
            kindsSeen.get(spec.id)?.add(kind);
            if (kind === GSE_INDEX.refueller && sim.gse.state[v] === WORK_STATE && !refuellerUnder.has(spec.id)) {
              // Dock pose in the aircraft frame: under the wing when the wing clears the vehicle, beyond the wingtip otherwise.
              const [centre] = toAircraftLocal([{ x: sim.gse.x[v], y: sim.gse.y[v] }], nx, ny, cx, cy);
              const span = GSE[kind].widthM / 2;
              const wingReach = Math.max(outlineReach(over[0].poly, centre.y - span), outlineReach(over[0].poly, centre.y), outlineReach(over[0].poly, centre.y + span));
              const inner = Math.abs(centre.x) - GSE[kind].lengthM / 2;
              refuellerUnder.set(spec.id, inner < wingReach);
            }
            const dock = GSE[kind].dock;
            if (dock?.orient === 'perp' && sim.gse.state[v] === WORK_STATE) {
              // A docked perp vehicle points its working end at the fuselage: its heading runs against its lateral offset.
              const [centre, ahead] = toAircraftLocal(
                [
                  { x: sim.gse.x[v], y: sim.gse.y[v] },
                  { x: sim.gse.x[v] + Math.cos(sim.gse.heading[v]), y: sim.gse.y[v] + Math.sin(sim.gse.heading[v]) },
                ],
                nx,
                ny,
                cx,
                cy,
              );
              if ((ahead.x - centre.x) * Math.sign(centre.x) > -0.99) problems.push(`${spec.id} tick ${t} ${GSE[kind].id} faces away from the fuselage`);
            }
            // A vehicle that has not moved since its last check cannot have changed its clash result.
            const pose = `${sim.gse.x[v]},${sim.gse.y[v]},${sim.gse.heading[v]}`;
            if (lastPose.get(v) === pose) continue;
            lastPose.set(v, pose);
            const g = GSE[sim.gse.kind[v]];
            if (Math.hypot(sim.gse.x[v] - sim.traffic.x[a], sim.gse.y[v] - sim.traffic.y[a]) > reach + Math.hypot(g.lengthM, g.widthM) / 2) continue;
            const world = rectOf(sim.gse.x[v], sim.gse.y[v], sim.gse.heading[v], g.lengthM, g.widthM);
            const local = toAircraftLocal(world, nx, ny, cx, cy);
            const clash = footprintClash(hard, over, { poly: local, heightM: g.heightM, docks: g.docks }, 0);
            if (clash !== null) problems.push(`${spec.id} tick ${t} ${g.id}: ${clash}`);
          }
        }
        for (let i = 0; i < live.length; i++) {
          for (let j = i + 1; j < live.length; j++) {
            const a = live[i];
            const b = live[j];
            if (sim.gse.owner[a] !== sim.gse.owner[b]) continue;
            const ga = GSE[sim.gse.kind[a]];
            const gb = GSE[sim.gse.kind[b]];
            const pa = rectOf(sim.gse.x[a], sim.gse.y[a], sim.gse.heading[a], ga.lengthM, ga.widthM);
            const pb = rectOf(sim.gse.x[b], sim.gse.y[b], sim.gse.heading[b], gb.lengthM, gb.widthM);
            if (vehiclesTouch({ poly: pa }, { poly: pb })) problems.push(`${spec.id} tick ${t} ${ga.id} touches ${gb.id}`);
          }
        }
        if (problems.length - before > 20) break;
        // Stop once the turnaround is over and the crew has driven off, so the checks cover every crew pose.
        if (turnedHere && !turningNow && sim.gse.count === 0) break;
      }
    });
    expect(new Set(turned).size).toBe(AIRCRAFT.length);
    
    // Every type brings a refueller. Airline types also bring the GPU, belt loader and tractor, and GA types nothing else.
    for (const spec of AIRCRAFT) {
      const kinds = kindsSeen.get(spec.id) ?? new Set<number>();
      // Belt loader, tractor and cart only come to aircraft of at least their minimum length.
      const kit = spec.dimensions.lengthM >= 20 ? [GSE_INDEX.beltloader, GSE_INDEX.tractor, GSE_INDEX.cart] : [];
      const expected = spec.role === 'ga' ? [GSE_INDEX.refueller] : [GSE_INDEX.refueller, GSE_INDEX.gpu, ...kit];
      for (const k of expected) expect(kinds.has(k), `${spec.id} ${GSE[k].id}`).toBe(true);
      if (spec.role === 'ga') expect([...kinds], spec.id).toEqual([GSE_INDEX.refueller]);
      if (spec.role !== 'ga') expect(kinds.has(GSE_INDEX.beltloader), spec.id).toBe(spec.dimensions.lengthM >= 20);
    }
    // The refueller sits under the wing only where the wing clears it, and beyond the wingtip otherwise.
    for (const spec of AIRCRAFT) {
      const footprint = footprintSpecSchema.parse(SPRITE_BASES[spec.sprite.base]);
      const under = footprint.heights.wing > GSE[GSE_INDEX.refueller].heightM;
      expect(refuellerUnder.get(spec.id), spec.id).toBe(under);
    }
    expect(problems).toEqual([]);
  }, 10_000);
});
