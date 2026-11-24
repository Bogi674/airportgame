import { describe, expect, it } from 'vitest';
import { BUSINESS } from '@data/index';
import { minuteOfDay, nextClockTick, TICKS_PER_DAY, TICKS_PER_MINUTE } from '@shared/business';

/** Skip to the next morning (T92) and the game pace it sits on (T91). */
describe('skip to the next morning', () => {
  const six = BUSINESS.skipDay.untilMinute;

  it('lands on 06:00 of the next morning from any time of day', () => {
    for (const start of [0, 1, 5 * TICKS_PER_MINUTE, TICKS_PER_DAY / 2, TICKS_PER_DAY - 1, TICKS_PER_DAY, 7 * TICKS_PER_DAY + 123]) {
      const end = nextClockTick(start, six);
      expect(end).toBeGreaterThan(start);
      expect(end - start).toBeLessThanOrEqual(TICKS_PER_DAY);
      expect(minuteOfDay(end)).toBe(six);
      expect(minuteOfDay(end - 1)).toBe(six - 1);
    }
  });

  it('from 02:00 stops at 06:00 the same night, four game hours later', () => {
    const two = nextClockTick(0, 120);
    expect(nextClockTick(two, six) - two).toBe(4 * 60 * TICKS_PER_MINUTE);
  });

  it('runs a whole day in the 30 real seconds the owner set', () => {
    expect(BUSINESS.skipDay.realSeconds).toBe(30);
  });
});
