import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import type { Runway } from '@shared/airfield';
import { checkLanding, checkPavement, checkTakeoff, requiredTakeoffM } from '@sim/ops/performance';

const climate = { type: 'temperate' as const, tempMinC: 0, tempMaxC: 15, rainDays: 100, fogDays: 10, snowDays: 5, elevationM: 0 };
const by = (id: string) => AIRCRAFT.find((a) => a.id === id)!;
const rwy = (len: number, surface: Runway['surface'] = 'asphalt', pcr = 90): Runway => ({
  id: 1, cost: 0, x1: 0, y1: 0, x2: len, y2: 0, headingDeg: 90, lengthM: len, widthM: 45, shoulderM: 7.5, code: 'E', approach: 'precision', surface, pcr, condition: 100, nameA: '09', nameB: '27',
});

describe('runway performance checks', () => {
  it('names the limiting factor for a short runway', () => {
    const r = checkTakeoff(by('b777_300er'), rwy(1800), 1800, climate, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('takeoffLength');
      expect(r.needed).toBeGreaterThan(1800);
    }
    expect(checkTakeoff(by('a320neo'), rwy(3000), 3000, climate, 1).ok).toBe(true);
  });

  it('hot and high conditions lengthen the required run', () => {
    const hot = { ...climate, tempMaxC: 38, elevationM: 900 };
    expect(requiredTakeoffM(by('a320neo'), hot, 1)).toBeGreaterThan(requiredTakeoffM(by('a320neo'), climate, 1) * 1.2);
  });

  it('pavement checks surface and strength with a 10 percent overload margin', () => {
    expect(checkPavement(by('b777_300er'), 'grass', 6)).toMatchObject({ ok: false, reason: 'surface' });
    expect(checkPavement(by('b777_300er'), 'asphalt', 30)).toMatchObject({ ok: false, reason: 'strength' });
    expect(checkPavement(by('c172s'), 'grass', 6).ok).toBe(true);
    expect(checkLanding(by('b737_800'), rwy(900), 1)).toMatchObject({ ok: false, reason: 'landingLength' });
  });
});
