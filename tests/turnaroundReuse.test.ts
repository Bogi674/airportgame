import { describe, expect, it } from 'vitest';
import { AcState } from '@sim/ops/traffic';
import { TICKS_PER_MINUTE } from '@shared/business';
import { buildTestAirport, buildTestStaffCenter, buildTestTerminal, ownedSim, run } from './helpers';

describe('turnaround crew on a reused aircraft slot (T38 fix)', () => {
  it('sends the full crew to every flight, so no airline turnaround waits for hours', () => {
    // The soak airport: an aircraft slot that turned one flight around takes the next one. Before the fix the vehicle
    // scan read the last flight's "vehicle tasks done" flag and sent the new crew home before it arrived.
    const sim = ownedSim('SOAK-0001');
    buildTestAirport(sim, { standsPerRow: 12 });
    expect(buildTestTerminal(sim)).toEqual([]);
    buildTestStaffCenter(sim);
    // Enough trucks that queues stay short, so a turnaround of six hours or more can only mean a crew that never came.
    for (const kind of ['catering', 'refueller', 'gpu', 'beltloader']) run(sim, { type: 'buyGse', kind, count: 3 });
    for (let i = 0; i < 3; i++) run(sim, { type: 'signAirline', airlineId: i, sign: true });
    const since = new Int32Array(256).fill(-1);
    let longest = 0;
    for (let t = 0; t < 40_000; t++) {
      sim.step();
      const tr = sim.traffic;
      for (let a = 0; a < 256; a++) {
        const on = tr.active[a] === 1 && tr.state[a] === AcState.Turnaround;
        if (!on) since[a] = -1;
        else if (since[a] < 0) since[a] = sim.tick;
        else longest = Math.max(longest, sim.tick - since[a]);
      }
    }
    expect(sim.traffic.completedFlights).toBeGreaterThan(4);
    expect(longest).toBeLessThan(6 * 60 * TICKS_PER_MINUTE);
  });
});
