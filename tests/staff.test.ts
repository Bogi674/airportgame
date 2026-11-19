import { describe, expect, it } from 'vitest';
import { Staff, STAFF_FLAG, STAFF_STATE } from '../src/sim/staff/staff';
import { breakJitterMin, staffSeed, staffSkill } from '../src/sim/staff/staffTraits';

describe('staff store', () => {
  it('allocates slots in order with serial seeds', () => {
    const st = new Staff();
    expect([st.alloc(0, 0), st.alloc(1, 1), st.alloc(2, 2)]).toEqual([0, 1, 2]);
    for (let i = 0; i < 3; i++) expect(st.seed[i]).toBe(staffSeed(i));
    expect(st.state[0]).toBe(STAFF_STATE.Off);
  });

  it('reuses a freed slot with the next serial seed', () => {
    const st = new Staff();
    st.alloc(0, 0);
    st.alloc(0, 0);
    st.alloc(0, 0);
    st.free(1);
    expect(st.alloc(1, 2)).toBe(1);
    expect(st.seed[1]).toBe(staffSeed(3));
    expect(st.role[1]).toBe(1);
  });

  it('lowers hi when the top slot is freed', () => {
    const st = new Staff();
    st.alloc(0, 0);
    st.alloc(0, 0);
    st.alloc(0, 0);
    st.free(1);
    st.free(2);
    expect(st.hi).toBe(1);
    expect(st.hired(0)).toBe(1);
  });

  it('keeps skill and break jitter in range', () => {
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const seed = staffSeed(i);
      const k = staffSkill(seed);
      expect(k).toBeGreaterThanOrEqual(0.9);
      expect(k).toBeLessThanOrEqual(1.1);
      sum += k;
      const j = breakJitterMin(seed);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThanOrEqual(60);
    }
    expect(Math.abs(sum / 10000 - 1)).toBeLessThan(0.01);
  });

  it('hashes equal for equal calls and differs on a flag change', () => {
    const make = (): Staff => {
      const st = new Staff();
      st.alloc(0, 0);
      st.alloc(2, 1);
      return st;
    };
    const a = make();
    const b = make();
    expect(a.hash(1)).toBe(b.hash(1));
    b.flags[1] |= STAFF_FLAG.Tired;
    expect(a.hash(1)).not.toBe(b.hash(1));
  });

  it('hashes signed and wide fields', () => {
    const st = new Staff();
    st.alloc(0, 0);
    const base = st.hash(1);
    st.stX[0] = -5;
    const withX = st.hash(1);
    expect(withX).not.toBe(base);
    st.home[0] = 7;
    expect(st.hash(1)).not.toBe(withX);
  });
});
