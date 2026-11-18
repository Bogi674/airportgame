import { describe, expect, it } from 'vitest';
import { deskOptions, standWarnings } from '../src/ui/standInspector';

describe('deskOptions', () => {
  it('numbers desks per terminal in cell order and keeps the payload index', () => {
    const list = deskOptions([
      { building: 2, x: 5, y: 1 },
      { building: 1, x: 7, y: 3 },
      { building: 1, x: 2, y: 3 },
      { building: 1, x: 9, y: 0 },
    ]);
    expect(list.map((d) => [d.building, d.number, d.index])).toEqual([
      [1, 1, 3],
      [1, 2, 2],
      [1, 3, 1],
      [2, 1, 0],
    ]);
  });

  it('is empty without desks', () => {
    expect(deskOptions([])).toEqual([]);
  });
});

describe('standWarnings', () => {
  const base = { commercial: true, gateDeskCount: 2, far: false, busBay: false, busOwned: false };
  it('is quiet for a near stand', () => {
    expect(standWarnings(base)).toEqual([]);
  });
  it('warns of no gate desk only for a commercial stand', () => {
    expect(standWarnings({ ...base, gateDeskCount: 0 })).toEqual(['noGate']);
    expect(standWarnings({ ...base, gateDeskCount: 0, commercial: false })).toEqual([]);
  });
  it('asks for a bus bay at a far stand without one', () => {
    expect(standWarnings({ ...base, far: true })).toEqual(['farNoBay']);
    expect(standWarnings({ ...base, far: true, busOwned: true })).toEqual(['farNoBay']);
  });
  it('asks for a bus at a far stand with a bus bay and no bus', () => {
    expect(standWarnings({ ...base, far: true, busBay: true })).toEqual(['farNoBus']);
    expect(standWarnings({ ...base, far: true, busBay: true, busOwned: true })).toEqual([]);
  });
});
