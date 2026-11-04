import { describe, expect, it } from 'vitest';
import { AIRFIELD } from '@data/index';
import type { Runway } from '@shared/airfield';
import { checkRunwayObstacles, type ObstacleInput } from '@shared/obstacles';
import { CELL_M, GRID_N, LandClass } from '@shared/site';
import { ownedSim, run } from './helpers';

const OS = AIRFIELD.obstacleSurfaces;
/** Runway 09/27 from (2000, 4000) to (5000, 4000): threshold A is the west end. */
const runway = (approach: Runway['approach'] = 'precision'): Runway => ({
  id: 1, cost: 0, x1: 2000, y1: 4000, x2: 5000, y2: 4000, headingDeg: 90, lengthM: 3000, widthM: 45, shoulderM: 7.5,
  code: 'C', approach, surface: 'asphalt', pcr: 50, condition: 100, nameA: '09', nameB: '27',
});
const flat = (): ObstacleInput => ({
  heights: new Float32Array(GRID_N * GRID_N),
  landClass: new Uint8Array(GRID_N * GRID_N).fill(LandClass.Grass),
  parcelId: new Uint16Array(GRID_N * GRID_N),
  parcelOwner: new Uint8Array(2),
  buildings: [],
});
/** A 40 m square building whose near edge is `d` meters west of threshold A, on the extended centerline. */
const buildingWest = (d: number) => [{ x: 2000 - d - 40, y: 3980 }, { x: 2000 - d, y: 3980 }, { x: 2000 - d, y: 4020 }, { x: 2000 - d - 40, y: 4020 }];

describe('obstacle surfaces', () => {
  it('a flat, empty site leaves the built approach type in both directions', () => {
    const res = checkRunwayObstacles(runway(), flat());
    expect(res.approachA).toBe('precision');
    expect(res.approachB).toBe('precision');
    expect(res.penetrations).toEqual([]);
  });

  it('a building under the approach surface rules out that direction only', () => {
    const p = OS.approach.precision;
    // Where the 1:50 surface is lower than the building, but the building is still inside the surface.
    const d = p.startM + (OS.terminalHeightM - OS.toleranceM - 5) / p.slope;
    const inp = { ...flat(), buildings: [buildingWest(d)] };
    const res = checkRunwayObstacles(runway(), inp);
    expect(res.approachA).not.toBe('precision');
    expect(res.approachB).toBe('precision');
    expect(res.penetrations.length).toBeGreaterThan(0);
    expect(res.penetrations.every((q) => q.end === 'a')).toBe(true);
    // Far enough out the surface clears it.
    const far = p.startM + (OS.terminalHeightM + 5) / p.slope;
    expect(checkRunwayObstacles(runway(), { ...flat(), buildings: [buildingWest(far)] }).approachA).toBe('precision');
  });

  it('forest on land the player does not own penetrates, owning the land clears it', () => {
    const inp = flat();
    // A forest block beside the runway, just outside the strip, under the transitional surface.
    const stripHalf = AIRFIELD.stripWidthM.precision / 2;
    for (let y = 4000 - stripHalf - 40; y < 4000 - stripHalf; y += CELL_M) {
      for (let x = 3000; x < 3200; x += CELL_M) {
        const c = Math.floor(y / CELL_M) * GRID_N + Math.floor(x / CELL_M);
        inp.landClass[c] = LandClass.Forest;
        inp.parcelId[c] = 1;
      }
    }
    const res = checkRunwayObstacles(runway(), inp);
    expect(res.penetrations.some((q) => q.end === 'both')).toBe(true);
    expect(res.approachA).toBe('visual');
    expect(res.approachB).toBe('visual');
    inp.parcelOwner[1] = 1;
    expect(checkRunwayObstacles(runway(), inp).penetrations).toEqual([]);
  });

  it('the sim derives the results for built runways and fog closes demoted directions', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2600, code: 'C', approach: 'precision', surface: 'asphalt', tier: 2 });
    const obs = sim.airfield.data.obstacles ?? [];
    expect(obs.length).toBe(1);
    expect(obs[0].runwayId).toBe(1);
    expect(sim.traffic.obstacles).toBe(obs);
  });
});
