import { describe, expect, it } from 'vitest';
import { AIRCRAFT, type AircraftSpec } from '@data/aircraft';
import { STAND_SIZES } from '@data/index';
import type { Stand } from '@shared/airfield';
import {
  blockWindow,
  blocksOverlap,
  refuseBlock,
  refuseFit,
  refuseStand,
  refuseUsage,
  STAND_BLOCK_BUFFER_MIN,
  standFacts,
  type StandFacts,
} from '@shared/flightBlock';
import { buildTestAirport, ownedSim } from './helpers';

const byId = (id: string): AircraftSpec => {
  const spec = AIRCRAFT.find((a) => a.id === id);
  if (!spec) throw new Error(`missing aircraft ${id}`);
  return spec;
};

const jet = byId('a320neo');
const light = byId('c172s');

/** Facts that pass every check for the given aircraft, so one field can be broken per test. */
const openFacts = (spec: AircraftSpec): StandFacts => ({
  closed: false,
  usage: 'any',
  size: 'xl',
  surface: spec.surfaces[0],
  type: 'remote',
  code: 'E',
  linked: true,
  contactOk: () => true,
});

describe('blockWindow and blocksOverlap', () => {
  it('ends the block after the turn and the buffer', () => {
    expect(STAND_BLOCK_BUFFER_MIN).toBe(5);
    expect(blockWindow(600, 45)).toEqual({ startMin: 600, endMin: 650 });
  });

  it('treats touching windows as free and shared time as a clash', () => {
    const a = { startMin: 600, endMin: 650 };
    expect(blocksOverlap(a, { startMin: 650, endMin: 700 })).toBe(false);
    expect(blocksOverlap(a, { startMin: 649, endMin: 700 })).toBe(true);
    expect(blocksOverlap({ startMin: 650, endMin: 700 }, a)).toBe(false);
  });
});

describe('refuseStand', () => {
  it('passes a stand that fits every check', () => {
    expect(refuseStand(openFacts(jet), jet)).toBeNull();
  });

  it('refuses a wingspan too big for the stand size', () => {
    expect(jet.dimensions.wingspanM).toBeGreaterThan(STAND_SIZES.small.maxSpanM);
    expect(refuseStand({ ...openFacts(jet), size: 'small' }, jet)).toBe('standSpan');
  });

  it('refuses a surface not on the aircraft list', () => {
    const off = (['dirt', 'gravel', 'grass'] as const).find((s) => !jet.surfaces.includes(s));
    if (!off) throw new Error('no surface outside the aircraft list');
    expect(refuseStand({ ...openFacts(jet), surface: off }, jet)).toBe('standSurfaceType');
  });

  it('refuses a closed stand', () => {
    expect(refuseStand({ ...openFacts(jet), closed: true }, jet)).toBe('standClosed');
  });

  it('refuses a commercial only stand for a general aviation type', () => {
    expect(light.capacity.seatsTypical).toBeLessThan(20);
    expect(refuseStand({ ...openFacts(light), usage: 'commercial' }, light)).toBe('standUsage');
  });

  it('refuses a ga only stand for a commercial type', () => {
    expect(jet.capacity.seatsTypical).toBeGreaterThanOrEqual(20);
    expect(refuseStand({ ...openFacts(jet), usage: 'ga' }, jet)).toBe('standUsage');
  });

  it('refuses a contact stand outside terminal reach', () => {
    expect(refuseStand({ ...openFacts(jet), type: 'contact', contactOk: () => false }, jet)).toBe('standNoTerminal');
  });

  it('refuses a stand with no taxi link', () => {
    expect(refuseStand({ ...openFacts(jet), linked: false }, jet)).toBe('standNoLink');
  });

  it('does not query terminal reach when span already fails', () => {
    let asked = 0;
    const f = { ...openFacts(jet), size: 'small' as const, type: 'contact' as const, contactOk: () => { asked++; return true; } };
    expect(refuseStand(f, jet)).toBe('standSpan');
    expect(refuseFit(f, jet)).toBe('standSpan');
    expect(asked).toBe(0);
  });
});

describe('refuseFit and refuseUsage', () => {
  it('refuseUsage takes a ga stand only for small types', () => {
    expect(refuseUsage('ga', light)).toBeNull();
    expect(refuseUsage('ga', jet)).toBe('standUsage');
    expect(refuseUsage('commercial', light)).toBe('standUsage');
    expect(refuseUsage('any', light)).toBeNull();
  });

  it('refuseFit ignores closed state and usage', () => {
    expect(refuseFit({ ...openFacts(jet), closed: true, usage: 'ga' }, jet)).toBeNull();
  });
});

describe('standFacts', () => {
  it('defaults closed to false and usage to any', () => {
    const st = { id: 1, cost: 0, number: '1', x: 0, y: 0, headingDeg: 0, type: 'remote', size: 'xl', code: 'E', surface: 'asphalt', pushback: 'none' } as unknown as Stand;
    const f = standFacts(st, true, () => true);
    expect(f.closed).toBe(false);
    expect(f.usage).toBe('any');
  });
});

describe('refuseBlock', () => {
  const others = [
    { flight: 1, window: { startMin: 0, endMin: 30 } },
    { flight: 2, window: { startMin: 600, endMin: 650 } },
  ];

  it('names the first flight whose block overlaps', () => {
    expect(refuseBlock({ startMin: 620, endMin: 700 }, others)).toEqual({ code: 'standBusy', flight: 2 });
  });

  it('returns null when no block overlaps', () => {
    expect(refuseBlock({ startMin: 100, endMin: 200 }, others)).toBeNull();
  });

  it('ignores the flight named as self', () => {
    expect(refuseBlock({ startMin: 620, endMin: 700 }, others, 2)).toBeNull();
  });
});

/** The private stand gates of Traffic, reached through a narrow view for the agreement test. */
interface StandGates {
  standFits(t: number, s: number): boolean;
  standAllows(t: number, s: number): boolean;
  net: { standNode: ArrayLike<number> };
  af: { stands: Stand[] };
}

describe('Traffic stand gates agree with refuseStand', () => {
  it('standFits and standAllows match the shared rule for each stand and type', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 4 });
    const tr = sim.traffic as unknown as StandGates;
    expect(tr.af.stands.length).toBeGreaterThan(2);
    tr.af.stands[0].closed = true;
    tr.af.stands[1].usage = 'ga';
    const types = ['a320neo', 'c172s', 'b737_800'].map((id) => AIRCRAFT.findIndex((a) => a.id === id));
    for (let s = 0; s < tr.af.stands.length; s++) {
      const st = tr.af.stands[s];
      for (const t of types) {
        const spec = AIRCRAFT[t];
        const linked = tr.net.standNode[s] >= 0;
        const base = standFacts(st, linked, () => true);
        const fitView = refuseStand({ ...base, closed: false, usage: 'any', linked: true }, spec);
        expect(tr.standFits(t, s)).toBe(fitView !== 'standSpan' && fitView !== 'standSurfaceType' && fitView !== 'standNoTerminal');
        const allowView = refuseStand({ ...base, size: 'xl', surface: spec.surfaces[0], type: 'remote', linked: true }, spec);
        expect(tr.standAllows(t, s)).toBe(allowView !== 'standClosed' && allowView !== 'standUsage');
      }
    }
  });
});
