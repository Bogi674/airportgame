import { describe, expect, it } from 'vitest';
import { hashString, Rng } from '@sim/rng';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = Rng.fromString('GOLDEN-0001');
    const b = Rng.fromString('GOLDEN-0001');
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('differs between seeds', () => {
    expect(Rng.fromString('A').next()).not.toBe(Rng.fromString('B').next());
  });

  it('stays in [0, 1) and int stays in range', () => {
    const r = new Rng(42);
    for (let i = 0; i < 5000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = r.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });

  it('forks are independent of parent usage and of fork order', () => {
    const p1 = new Rng(7);
    const p2 = new Rng(7);
    for (let i = 0; i < 50; i++) p2.next();
    const a1 = p1.fork('airfield');
    const t1 = p1.fork('terminal');
    const t2 = p2.fork('terminal');
    const a2 = p2.fork('airfield');
    expect(a1.next()).toBe(a2.next());
    expect(t1.next()).toBe(t2.next());
  });

  it('forks with different labels give different streams', () => {
    const p = new Rng(7);
    expect(p.fork('a').next()).not.toBe(p.fork('b').next());
  });

  it('restores from saved state', () => {
    const r = new Rng(99);
    for (let i = 0; i < 10; i++) r.next();
    const saved = r.getState();
    const expected = [r.next(), r.next(), r.next()];
    r.setState(saved);
    expect([r.next(), r.next(), r.next()]).toEqual(expected);
  });

  it('hashString is stable', () => {
    expect(hashString('GOLDEN-0001')).toBe(hashString('GOLDEN-0001'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});
