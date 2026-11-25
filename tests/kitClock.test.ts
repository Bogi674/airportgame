import { describe, expect, it } from 'vitest';
import { clockAngles } from '../src/ui/kit/clock';

describe('analog clock angles (R6-02)', () => {
  it('points every hand at 12 at midnight and noon', () => {
    expect(clockAngles(0)).toEqual({ hour: 0, minute: 0, second: 0 });
    expect(clockAngles(12 * 3600)).toEqual({ hour: 0, minute: 0, second: 0 });
  });

  it('moves the hour hand with the minutes', () => {
    const a = clockAngles(3 * 3600 + 30 * 60);
    expect(a.hour).toBeCloseTo(105);
    expect(a.minute).toBeCloseTo(180);
  });

  it('ticks the second hand once per second and stops it in minute step mode', () => {
    expect(clockAngles(15.7).second).toBe(90);
    expect(clockAngles(15.7, true).second).toBe(0);
  });

  it('wraps times past one day and before zero', () => {
    expect(clockAngles(86_400 + 6 * 3600).hour).toBeCloseTo(180);
    expect(clockAngles(-3600).hour).toBeCloseTo(330);
  });
});
