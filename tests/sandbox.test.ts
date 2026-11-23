import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@data/index';
import { Sim } from '@sim/sim';
import { run } from './helpers';

const SANDBOX = { preset: 'flatCoastal', mode: 'sandbox' } as const;

describe('sandbox mode (T35)', () => {
  it('owns the whole site and holds the sandbox cash', () => {
    const sim = new Sim('GOLDEN-0001', SANDBOX);
    expect(sim.parcelOwner.every((o) => o === 1)).toBe(true);
    expect(sim.cash).toBe(BUSINESS.sandboxCash);
  });

  it('tops the cash up so no build is refused for money', () => {
    const sim = new Sim('GOLDEN-0001', SANDBOX);
    sim.book('construction', -BUSINESS.sandboxCash * 0.9);
    sim.step();
    expect(sim.cash).toBe(BUSINESS.sandboxCash);
  });

  it('signs an airline whatever its rating gate, where a career refuses it', () => {
    const career = new Sim('GOLDEN-0001', { preset: 'flatCoastal' });
    // The sign command names an airline by its index in the list.
    const gated = career.business.airlines.findIndex((a) => a.minRating > career.business.rating);
    expect(gated).toBeGreaterThanOrEqual(0);
    expect(run(career, { type: 'signAirline', airlineId: gated, sign: true }).some((e) => e.startsWith('ratingTooLow'))).toBe(true);
    const sandbox = new Sim('GOLDEN-0001', SANDBOX);
    expect(run(sandbox, { type: 'signAirline', airlineId: gated, sign: true }).some((e) => e.startsWith('ratingTooLow'))).toBe(false);
    expect(sandbox.business.airlines[gated]!.signed).toBe(true);
  });

  it('stays a sandbox through a save and restore', () => {
    const sim = new Sim('GOLDEN-0001', SANDBOX);
    for (let i = 0; i < 50; i++) sim.step();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as { options: { mode?: string } };
    expect(data.options.mode).toBe('sandbox');
    const copy = new Sim('GOLDEN-0001', data.options as typeof SANDBOX);
    copy.restore(data);
    expect(copy.stateHash()).toBe(sim.stateHash());
  });
});

describe('opening airlines (T35 fix)', () => {
  it('number the seven opening airlines by their index, with distinct liveries', () => {
    const sim = new Sim('GOLDEN-0001', { preset: 'flatCoastal' });
    expect(sim.business.airlines.map((a) => a.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(new Set(sim.business.airlines.map((a) => a.livery)).size).toBe(7);
    expect(new Set(sim.business.airlines.map((a) => a.name)).size).toBe(7);
  });

  it('renumbers the repeated airline ids of an older save on load', () => {
    const sim = new Sim('GOLDEN-0001', { preset: 'flatCoastal' });
    const data = JSON.parse(JSON.stringify(sim.serialize())) as { version: number; business: { airlines: { id: number }[] } };
    data.version = 41;
    data.business.airlines.forEach((a, i) => (a.id = i - (i % 3)));
    const copy = new Sim('GOLDEN-0001', { preset: 'flatCoastal' });
    copy.restore(data);
    expect(copy.business.airlines.map((a) => a.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
