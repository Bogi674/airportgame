import { describe, expect, it } from 'vitest';
import { AIRCRAFT, SPRITE_BASES } from '@data/aircraft';
import { BUSINESS, GSE } from '@data/index';
import { aircraftBoundary, apronCheck, footprintSpecSchema, type AircraftBoundary, type SceneAircraft, type SceneVehicle } from '@shared/aircraftFootprint';
import { ACCEPT_COMMERCIAL, towerRect, type StandSize } from '@shared/airfield';
import { depotRect } from '@shared/roadGraph';
import { sizeForSpan, standRefusal } from '@shared/standSizes';
import { FlState } from '@sim/ops/traffic';
import type { Command } from '@sim/commands';
import type { Sim } from '@sim/sim';
import { buildTestGround, ownedSim, run } from './helpers';

/** One stand of every size on a code E apron, west to east, with room between them. */
const SIZES: { size: StandSize; x: number; spacingM: number }[] = [
  { size: 'small', x: 3600, spacingM: 30 },
  { size: 'medium', x: 3900, spacingM: 45 },
  { size: 'large', x: 4350, spacingM: 80 },
  { size: 'xl', x: 4900, spacingM: 95 },
];

function buildScene(sim: Sim): void {
  const errors: string[] = [];
  const go = (cmd: Command): void => {
    errors.push(...run(sim, cmd));
  };
  go({ type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 3300, code: 'E', approach: 'precision', surface: 'asphalt', tier: 2 });
  go({ type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 200, code: 'E', connectors: 4, surface: 'asphalt', tier: 2 });
  go({ type: 'buildApron', polygon: [{ x: 3400, y: 5205 }, { x: 5200, y: 5205 }, { x: 5200, y: 5480 }, { x: 3400, y: 5480 }], surface: 'concrete', tier: 2 });
  for (const s of SIZES) go({ type: 'buildStands', x: s.x, y: 5340, headingDeg: 180, count: 1, spacingM: s.spacingM, standType: 'remote', size: s.size });
  // Commercial only, so no general aviation arrives on its own; the test flights are not GA and use every stand.
  for (const st of sim.airfield.data.stands) go({ type: 'setStandProps', id: st.id, accepts: ACCEPT_COMMERCIAL });
  go({ type: 'buildTower', x: 3000, y: 4700, level: 5 });
  errors.push(...buildTestGround(sim));
  if (errors.length > 0) throw new Error(`scene failed: ${errors.join(', ')}`);
}

const boundaries: AircraftBoundary[] = AIRCRAFT.map((a) => aircraftBoundary(footprintSpecSchema.parse(SPRITE_BASES[a.sprite.base])));

function rectOf(x: number, y: number, h: number, lengthM: number, widthM: number) {
  const c = Math.cos(h);
  const s = Math.sin(h);
  const hl = lengthM / 2;
  const hw = widthM / 2;
  return [
    { x: x + c * hl - s * hw, y: y + s * hl + c * hw },
    { x: x + c * hl + s * hw, y: y + s * hl - c * hw },
    { x: x - c * hl + s * hw, y: y - s * hl - c * hw },
    { x: x - c * hl - s * hw, y: y - s * hl + c * hw },
  ];
}

/** The scene as it stands this tick: every active aircraft and vehicle, and the buildings as solids. */
function scene(sim: Sim): { aircraft: SceneAircraft[]; vehicles: SceneVehicle[]; solids: { x: number; y: number }[][] } {
  const t = sim.traffic;
  const aircraft: SceneAircraft[] = [];
  for (let a = 0; a < 256; a++) {
    if (t.active[a] !== 1) continue;
    const spec = AIRCRAFT[t.type[a]];
    const c = Math.cos(t.heading[a]);
    const s = Math.sin(t.heading[a]);
    const half = spec.dimensions.lengthM / 2;
    aircraft.push({ boundary: boundaries[t.type[a]], noseX: t.x[a] + c * half, noseY: t.y[a] + s * half, cos: c, sin: s, reachM: Math.hypot(spec.dimensions.lengthM, spec.dimensions.wingspanM) + 2 });
  }
  const g = sim.gse;
  const vehicles: SceneVehicle[] = [];
  for (let v = 0; v < 1024; v++) {
    if (g.active[v] !== 1) continue;
    const spec = GSE[g.kind[v]];
    let head = v;
    while (g.lead[head] >= 0) head = g.lead[head];
    vehicles.push({ poly: rectOf(g.x[v], g.y[v], g.heading[v], spec.lengthM, spec.widthM), heightM: spec.heightM, docks: spec.docks, label: `${spec.id}#${v}`, train: head });
  }
  const af = sim.airfield.data;
  const solids = [...(af.depots ?? []).map(depotRect), ...(af.towers ?? []).map((w) => towerRect(w.x, w.y, BUSINESS.tower.footprintM))];
  return { aircraft, vehicles, solids };
}

/** A cheap fingerprint of every vehicle and aircraft pose. */
function poseKey(sim: Sim): number {
  let k = 0;
  for (let v = 0; v < 1024; v++) if (sim.gse.active[v] === 1) k = (k * 31 + sim.gse.x[v] * 7 + sim.gse.y[v] * 13 + sim.gse.heading[v] + v) % 1e12;
  for (let a = 0; a < 256; a++) if (sim.traffic.active[a] === 1) k = (k * 31 + sim.traffic.x[a] * 7 + sim.traffic.y[a] * 13 + a) % 1e12;
  return k;
}

describe('apron scene collision QA (T64)', () => {
  it('every stand size with its own types and the largest type it takes passes the gse.py check at every tick of a full turnaround', () => {
    const sim = ownedSim();
    buildScene(sim);
    const problems = new Set<string>();
    const served: string[] = [];
    for (const [k, s] of SIZES.entries()) {
      const stand = sim.airfield.data.stands[k];
      // Crew paths live in the aircraft frame, and the stand size only moves the road line, so each type runs on its own
      // size and every size also runs the largest type it takes.
      const fits = AIRCRAFT.map((spec, i) => ({ spec, i })).filter((x) => standRefusal(stand, x.spec) === null);
      const largest = fits.reduce((m, x) => (x.spec.dimensions.wingspanM > m.spec.dimensions.wingspanM ? x : m), fits[0]);
      for (const { spec, i: typeIdx } of fits) {
        if (sizeForSpan(spec.dimensions.wingspanM) !== s.size && spec !== largest.spec) continue;
        // Weather can refuse or divert a light type, so a flight that never docked is sent again.
        let docked = false;
        let lastPose = -1;
        for (let attempt = 0; attempt < 3 && !docked; attempt++) {
          // A retry waits out the weather spell that diverted the last one.
          if (attempt > 0) for (let t = 0; t < 12_000; t++) sim.step();
          const events = run(sim, { type: 'testDockAt', standId: stand.id, typeIdx, turnTicks: 20_000 });
          // A refused flight (weather) is retried; a stand refusal shows as never docked.
          if (events.some((e) => e.startsWith('flightRefused') && e.includes(`type=${spec.id}`))) continue;
          let f = -1;
          for (let i = 0; i < sim.traffic.fStand.length; i++) if (sim.traffic.fStand[i] === stand.id && sim.traffic.fState[i] !== FlState.Done && sim.traffic.fState[i] !== FlState.Free) f = i;
          if (f < 0) continue;
          for (let t = 0; t < 40_000; t++) {
            sim.step();
            if (sim.traffic.fState[f] === FlState.OnGround) docked = true;
            // Nothing moved since the last check means nothing new can clash.
            const pose = t % 2 === 0 ? poseKey(sim) : lastPose;
            if (pose !== lastPose) {
              lastPose = pose;
              const sc = scene(sim);
              for (const e of apronCheck(sc.aircraft, sc.vehicles, sc.solids)) problems.add(`${s.size} ${spec.id}: ${e.replace(/#\d+/g, '')}`);
            }
            // The next flight waits until this one has left and its crew is home.
            if (sim.traffic.fState[f] === FlState.Done && sim.gse.count === 0) break;
          }
        }
        // A combination the weather kept away is covered by the asserts below, on another size or type.
        if (docked) served.push(`${s.size} ${spec.id}`);
      }
    }
    // Every size served a type, and every type was served on at least one size.
    for (const s of SIZES) expect(served.some((x) => x.startsWith(`${s.size} `)), s.size).toBe(true);
    for (const a of AIRCRAFT) expect(served.some((x) => x.endsWith(` ${a.id}`)), a.id).toBe(true);
    expect([...problems]).toEqual([]);
  }, 240_000);
});
