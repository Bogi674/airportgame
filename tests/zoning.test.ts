import { describe, expect, it } from 'vitest';
import { FIXTURE_FOOTPRINT, FIXTURE_KEYS, footprintOf } from '@shared/business';

describe('zoning constants', () => {
  it('appends the new fixture keys after the old ones', () => {
    expect(FIXTURE_KEYS.indexOf('securityExit') + 1).toBe(20);
    expect(FIXTURE_KEYS.indexOf('eGate') + 1).toBe(21);
    expect(FIXTURE_KEYS.indexOf('customs') + 1).toBe(22);
    expect(FIXTURE_KEYS[0]).toBe('checkIn');
    expect(FIXTURE_KEYS[18]).toBe('carousel');
  });

  it('has a footprint entry per key', () => {
    for (const k of FIXTURE_KEYS) expect(FIXTURE_FOOTPRINT[k].length).toBeGreaterThan(0);
  });

  it('picks the footprint by level', () => {
    expect(footprintOf('securityExit', 2)).toEqual([1, 3]);
    expect(footprintOf('securityExit', 0)).toEqual([2, 2]);
    expect(footprintOf('customs', 3)).toEqual([2, 2]);
  });
});
