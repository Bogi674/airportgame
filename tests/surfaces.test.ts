import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { TICKS_PER_DAY } from '@shared/business';
import { surfaceChange, worksDays } from '@shared/surfaceRules';
import type { Command } from '@sim/commands';
import type { BuildContext } from '@shared/validate';
import { isProblem } from '@sim/airfield/airfield';
import { ownedSim, run } from './helpers';

const TAXI: Command = { type: 'buildTaxiway', points: [{ x: 4000, y: 5600 }, { x: 4420, y: 5600 }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 0 };

const ctxOf = (sim: ReturnType<typeof ownedSim>): BuildContext => ({ heights: sim.site.heights, parcelId: sim.site.parcelId, parcelOwner: sim.parcelOwner });
const typeIndex = (id: string): number => AIRCRAFT.findIndex((a) => a.id === id);

describe('taxiway surfaces (revision 2 section 2.5, test 5)', () => {
  it('codes D to F reject unpaved taxiways, codes A to C accept them', () => {
    const sim = ownedSim();
    const ev = run(sim, { ...TAXI, code: 'D', surface: 'grass' });
    expect(ev.some((e) => e.startsWith('surfaceCode'))).toBe(true);
    expect(sim.airfield.data.taxiways.length).toBe(0);
    expect(run(sim, { ...TAXI, code: 'C', surface: 'gravel' })).toEqual([]);
    expect(sim.airfield.data.taxiways[0].surface).toBe('gravel');
  });

  it('raising an unpaved taxiway above code C needs a paved surface in the same command', () => {
    const sim = ownedSim();
    run(sim, { ...TAXI, surface: 'grass' });
    const t = sim.airfield.data.taxiways[0];
    expect(run(sim, { type: 'reclassTaxiway', id: t.id, code: 'D', surface: 'grass', tier: 0 }).some((e) => e.startsWith('surfaceCode'))).toBe(true);
    expect(t.code).toBe('C');
    expect(run(sim, { type: 'reclassTaxiway', id: t.id, code: 'D', surface: 'asphalt', tier: 0 })).toEqual([]);
    expect(t.code).toBe('D');
    expect(t.works?.surface).toBe('asphalt');
  });

  it('an upgrade closes the taxiway for the works, charges up front and regenerates when done', () => {
    const sim = ownedSim();
    run(sim, TAXI);
    const t = sim.airfield.data.taxiways[0];
    const preview = surfaceChange(t, 'concrete', 0);
    expect(preview.upgrade).toBe(true);
    expect(preview.days).toBe(worksDays('concrete', 420 * (15 + 2 * 5)));
    const cash = sim.cash;
    const v0 = sim.airfield.version;
    expect(run(sim, { type: 'reclassTaxiway', id: t.id, code: 'C', surface: 'concrete', tier: 0 })).toEqual([]);
    expect(sim.cash).toBe(cash + preview.cashDelta);
    expect(t.surface).toBe('asphalt');
    expect(t.works).toBeDefined();
    const done = t.works?.doneTick ?? 0;
    expect(done - sim.tick).toBeLessThanOrEqual(preview.days * TICKS_PER_DAY);
    // A second change while works run is refused.
    expect(run(sim, { type: 'resurface', kind: 'taxiway', id: t.id, surface: 'asphalt', tier: 0 }).some((e) => e.startsWith('worksRunning'))).toBe(true);
    sim.airfield.update(done);
    expect(t.surface).toBe('concrete');
    expect(t.works).toBeUndefined();
    expect(sim.airfield.version).toBeGreaterThan(v0);
  });

  it('a downgrade that shuts out an assigned aircraft type is blocked and names it', () => {
    const sim = ownedSim();
    run(sim, TAXI);
    const t = sim.airfield.data.taxiways[0];
    const env = { tick: 0, assignedTypes: [typeIndex('atr72_600'), typeIndex('a320neo')] };
    const r = sim.airfield.execute({ type: 'resurface', kind: 'taxiway', id: t.id, surface: 'gravel', tier: 0 }, ctxOf(sim), sim.cash, env);
    expect(r && isProblem(r) ? r : null).toEqual({ code: 'surfaceExcludesType', args: { type: 'Airbus A320neo' } });
    expect(t.works).toBeUndefined();
    // Without the A320neo the ATR 72 accepts gravel, and the downgrade refunds part of the value.
    const ok = sim.airfield.execute({ type: 'resurface', kind: 'taxiway', id: t.id, surface: 'gravel', tier: 0 }, ctxOf(sim), sim.cash, { tick: 0, assignedTypes: [typeIndex('atr72_600')] });
    expect(ok && !isProblem(ok) ? ok.cashDelta : -1).toBeGreaterThan(0);
    expect(t.works?.surface).toBe('gravel');
  });

  it('works closed taxiways drop out of routing until the works finish', () => {
    const sim = ownedSim();
    run(sim, TAXI);
    const t = sim.airfield.data.taxiways[0];
    run(sim, { type: 'resurface', kind: 'taxiway', id: t.id, surface: 'concrete', tier: 0 });
    for (let i = 0; i < 3; i++) sim.step();
    const net = sim.traffic.network;
    const closed = [...Array(net.edgeCount).keys()].filter((e) => net.edgeSource[e] === t.id).every((e) => net.edgeClosed[e] === 1);
    expect(closed).toBe(true);
  });

  it('stays deterministic with works under way', () => {
    const play = (): number => {
      const sim = ownedSim();
      run(sim, TAXI);
      run(sim, { type: 'resurface', kind: 'taxiway', id: sim.airfield.data.taxiways[0].id, surface: 'concrete', tier: 0 });
      for (let i = 0; i < 2000; i++) sim.step();
      return sim.stateHash();
    };
    expect(play()).toBe(play());
  });
});
