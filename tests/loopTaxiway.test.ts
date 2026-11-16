import { describe, expect, it } from 'vitest';
import { FlState, GA_AIRLINE } from '@sim/ops/traffic';
import type { Sim } from '@sim/sim';
import { ownedSim, run } from './helpers';

/**
 * The player's layout from the 2026-11-16 report: one runway and a single one way taxiway drawn as a
 * loop from one runway end to the other, with general aviation stands hanging off it.
 */
function loopAirport(reverse: boolean): Sim {
  const sim = ownedSim();
  const problems: string[] = [];
  const pts = [{ x: 3000, y: 5000 }, { x: 3000, y: 5200 }, { x: 4200, y: 5200 }, { x: 4200, y: 5000 }];
  problems.push(...run(sim, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 1200, code: 'B', approach: 'visual', surface: 'asphalt', tier: 1 }));
  problems.push(...run(sim, { type: 'buildTaxiway', points: reverse ? pts.slice().reverse() : pts, code: 'B', kind: 'taxiway', surface: 'asphalt', tier: 1 }));
  problems.push(...run(sim, { type: 'setTaxiwayProps', id: sim.airfield.data.taxiways[0].id, oneWay: true }));
  problems.push(...run(sim, { type: 'buildGaBlock', x: 3600, y: 5260, headingDeg: 0, count: 4 }));
  if (problems.length > 0) throw new Error(`loop airport failed: ${problems.join(', ')}`);
  return sim;
}

describe('one way loop between both runway ends', () => {
  for (const reverse of [false, true]) {
    it(`gives an entry and a taxi link at each runway end, loop drawn ${reverse ? 'B to A' : 'A to B'}`, () => {
      const sim = loopAirport(reverse);
      expect(sim.airfield.data.entries.length).toBe(2);
      // One way traffic can only reach the holding point at the downstream end.
      expect(sim.traffic.holdCount()).toBe(1);
    });

    it(`general aviation lands, parks, departs and frees its stand, loop drawn ${reverse ? 'B to A' : 'A to B'}`, () => {
      const sim = loopAirport(reverse);
      const docked = new Set<number>();
      let departed = 0;
      const ev: string[] = [];
      let unreachable = 0;
      for (let t = 0; t < 400000; t++) {
        sim.step();
        if (t % 50 !== 0) continue;
        const tr = sim.traffic;
        for (let f = 0; f < tr.fState.length; f++) {
          if (tr.fAirline[f] !== GA_AIRLINE) continue;
          if (tr.fState[f] === FlState.OnGround) docked.add(f);
          else if (docked.has(f)) {
            docked.delete(f);
            departed++;
          }
        }
        ev.length = 0;
        sim.drainEvents(ev);
        for (const e of ev) if (e.includes('reason=noStand') || e.includes('reason=noRoute')) unreachable++;
      }
      expect(departed).toBeGreaterThan(2);
      expect(unreachable).toBe(0);
    });
  }
});
