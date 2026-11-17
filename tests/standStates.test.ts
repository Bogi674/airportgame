import { describe, expect, it } from 'vitest';
import { standStates } from '@render/standStates';
import { buildTestAirport, ownedSim, run } from './helpers';

/** Connection badges on the map (T47, revision 4 section 2.3). */
describe('stand state badges', () => {
  it('flags a stand with no taxiway lead in, and nothing on a connected airport', () => {
    const sim = ownedSim();
    sim.cash = 80_000_000;
    buildTestAirport(sim, { standCode: 'E', standsPerRow: 2 });
    expect(standStates(sim.airfield.data)).toEqual([]);
    // A stand far from every taxiway.
    const ev = run(sim, { type: 'buildStands', x: 3700, y: 6200, headingDeg: 180, count: 1, spacingM: 45, standType: 'remote', size: 'medium' });
    if (ev.some((e) => e.startsWith('buildFailed'))) throw new Error(ev.join(', '));
    const loose = sim.airfield.data.stands[sim.airfield.data.stands.length - 1];
    const states = standStates(sim.airfield.data);
    expect(states.map((s) => [s.id, s.kind])).toEqual([[loose.id, 'noTaxiway']]);
  });

  it('flags a clearance breach in amber when the stand still has a lead in', () => {
    const sim = ownedSim();
    sim.cash = 80_000_000;
    buildTestAirport(sim, { standCode: 'E', standsPerRow: 2 });
    const af = { ...sim.airfield.data, clearanceBreaches: [sim.airfield.data.stands[0].id] };
    expect(standStates(af).map((s) => s.kind)).toEqual(['clearance']);
  });
});
