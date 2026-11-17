import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { ACCEPT_ALL, ACCEPT_COMMERCIAL, ACCEPT_GA, validAccepts } from '@shared/airfield';
import { defaultAccepts, sizeGap } from '@shared/standSizes';
import { migrate } from '@sim/save/migrations';
import type { Sim } from '@sim/sim';
import { buildTestAirport, ownedSim, run } from './helpers';

/** Stand accepts bits, their migration and the size order of the automatic stand choice (user, 2026-11-17). */

const idx = (id: string): number => AIRCRAFT.findIndex((a) => a.id === id);

/** A test airport with two large stands, plus one medium stand on the same taxilane. */
function mixedAirport(seed?: string): Sim {
  const sim = ownedSim(seed);
  sim.cash = 80_000_000;
  buildTestAirport(sim, { standCode: 'E', standsPerRow: 2 });
  const ev = run(sim, { type: 'buildStands', x: 3700, y: 5330, headingDeg: 180, count: 1, spacingM: 45, standType: 'remote', size: 'medium' });
  if (ev.some((e) => e.startsWith('buildFailed'))) throw new Error(ev.join(', '));
  return sim;
}

describe('accepts bits', () => {
  it('validAccepts takes any non empty mix of the three bits only', () => {
    expect(validAccepts(0)).toBe(false);
    expect(validAccepts(ACCEPT_GA)).toBe(true);
    expect(validAccepts(ACCEPT_ALL)).toBe(true);
    expect(validAccepts(ACCEPT_ALL + 1)).toBe(false);
    expect(validAccepts(1.5)).toBe(false);
  });

  it('new stands start from the data defaults: small GA and commercial, larger commercial only', () => {
    expect(defaultAccepts('small')).toBe(ACCEPT_GA | ACCEPT_COMMERCIAL);
    expect(defaultAccepts('medium')).toBe(ACCEPT_COMMERCIAL);
    const sim = mixedAirport();
    const byNumber = sim.airfield.data.stands.map((s) => [s.size, s.accepts]);
    expect(byNumber).toEqual([
      ['large', ACCEPT_COMMERCIAL],
      ['large', ACCEPT_COMMERCIAL],
      ['medium', ACCEPT_COMMERCIAL],
    ]);
  });

  it('setStandProps refuses an empty or unknown mix and changes nothing', () => {
    const sim = mixedAirport();
    const st = sim.airfield.data.stands[0];
    const ev = run(sim, { type: 'setStandProps', id: st.id, accepts: 0, closed: true });
    expect(ev.join(' ')).toContain('stand.acceptsNone');
    expect(st.accepts).toBe(ACCEPT_COMMERCIAL);
    expect(st.closed).not.toBe(true);
    run(sim, { type: 'setStandProps', id: st.id, accepts: ACCEPT_ALL });
    expect(st.accepts).toBe(ACCEPT_ALL);
  });
});

describe('save version 16', () => {
  it('maps the old usage setting to accepts bits and drops usage', () => {
    const stand = (usage: string | undefined, size: string, type: string): Record<string, unknown> => ({ id: 1, usage, size, type });
    const stands = [stand('ga', 'medium', 'remote'), stand('commercial', 'small', 'remote'), stand('any', 'small', 'remote'), stand(undefined, 'small', 'remote'), stand('any', 'medium', 'remote'), stand(undefined, 'large', 'contact')];
    const out = migrate({ version: 15, airfield: { stands } }) as unknown as { airfield: { stands: Record<string, unknown>[] } };
    expect(out.airfield.stands.map((s) => s.accepts)).toEqual([ACCEPT_GA, ACCEPT_COMMERCIAL, 3, 3, ACCEPT_COMMERCIAL, ACCEPT_COMMERCIAL]);
    expect(out.airfield.stands.every((s) => !('usage' in s))).toBe(true);
  });
});

describe('automatic stand choice by size', () => {
  it('counts the size gap from the type own size', () => {
    expect(sizeGap('medium', AIRCRAFT[idx('a320neo')])).toBe(0);
    expect(sizeGap('large', AIRCRAFT[idx('a320neo')])).toBe(1);
    expect(sizeGap('xl', AIRCRAFT[idx('c172s')])).toBe(3);
  });

  it('a code C flight takes the free medium stand first, then the next larger size', () => {
    const sim = mixedAirport();
    const tr = sim.traffic;
    const medium = sim.airfield.data.stands.find((s) => s.size === 'medium');
    if (!medium) throw new Error('no medium stand');
    const f = tr.scheduleArrival(idx('a320neo'), tr.nowTick + 100, 0, 600, 0);
    tr.autoAssign();
    expect(tr.fStand[f]).toBe(medium.id);
    run(sim, { type: 'setStandProps', id: medium.id, closed: true });
    tr.fStand[f] = -1;
    tr.autoAssign();
    const got = sim.airfield.data.stands.find((s) => s.id === tr.fStand[f]);
    expect(got?.size).toBe('large');
  });

  it('runs 2 000 ticks twice from one seed to the same hash', () => {
    const go = (): number => {
      const sim = mixedAirport('GOLDEN-0002');
      run(sim, { type: 'setStandProps', id: sim.airfield.data.stands[0].id, accepts: ACCEPT_GA | ACCEPT_COMMERCIAL });
      run(sim, { type: 'setTestTraffic', perHour: 20, turnScale: 0.1 });
      for (let t = 0; t < 2000; t++) sim.step();
      return sim.stateHash();
    };
    expect(go()).toBe(go());
  });
});
