import { describe, expect, it } from 'vitest';
import { QualityGovernor } from '../src/render/quality';

function feed(g: QualityGovernor, ms: number, seconds: number, start: number): number {
  let now = start;
  const end = start + seconds * 1000;
  while (now < end) {
    g.frame(ms, now);
    now += ms;
  }
  return now;
}

describe('quality governor', () => {
  it('steps down after 2 s over 20 ms and back up after 10 s under 12 ms', () => {
    const g = new QualityGovernor();
    let t = 1000;
    t = feed(g, 30, 2.5, t);
    expect(g.level).toBe(1);
    t = feed(g, 30, 4.5, t);
    expect(g.level).toBe(3);
    t = feed(g, 8, 40, t);
    expect(g.level).toBe(0);
    expect(t).toBeGreaterThan(0);
  });

  it('a locked preset disables it', () => {
    const g = new QualityGovernor();
    g.setPreset('high');
    feed(g, 40, 10, 1000);
    expect(g.level).toBe(0);
    g.setPreset('low');
    expect(g.level).toBe(3);
  });
});
