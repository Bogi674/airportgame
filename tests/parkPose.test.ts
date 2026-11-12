import { describe, expect, it } from 'vitest';
import { AIRCRAFT, SPRITE_BASES, standGeometry } from '@data/aircraft';
import { aircraftBoundary, footprintSpecSchema } from '@shared/aircraftFootprint';
import { standRefusal } from '@shared/standSizes';
import { parkedCentre, parkedOffsetM, standSlot, standTypes, stopBarIndex, stopBarOffset } from '@shared/standGeom';
import { refuseFit } from '@shared/flightBlock';
import { STAND_SIZES_ORDER } from '@shared/airfield';
import { AcState } from '@sim/ops/traffic';
import type { Command } from '@sim/commands';
import { Sim } from '@sim/sim';
import { buildTestAirport, ownedSim, run, OPTIONS } from './helpers';

/** Code E runway, parallel taxiway, one apron connected to it, and one stand per size: small, medium, large. */
function buildScene(sim: Sim): void {
  const errors: string[] = [];
  const go = (...cmds: Command[]): void => {
    errors.push(...run(sim, ...cmds));
  };
  go(
    { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 3300, code: 'E', approach: 'precision', surface: 'asphalt', tier: 2 },
    { type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 200, code: 'E', connectors: 4, surface: 'asphalt', tier: 2 },
    { type: 'buildApron', polygon: [{ x: 3400, y: 5205 }, { x: 4900, y: 5205 }, { x: 4900, y: 5460 }, { x: 3400, y: 5460 }], surface: 'concrete', tier: 2 },
    { type: 'buildStands', x: 3600, y: 5340, headingDeg: 180, count: 1, spacingM: 30, standType: 'remote', size: 'small' },
    { type: 'buildStands', x: 3900, y: 5340, headingDeg: 180, count: 1, spacingM: 45, standType: 'remote', size: 'medium' },
    { type: 'buildStands', x: 4350, y: 5340, headingDeg: 180, count: 1, spacingM: 80, standType: 'remote', size: 'large' },
  );
  if (errors.length > 0) throw new Error(`scene airport failed: ${errors.join(', ')}`);
}

const SIZES = ['small', 'medium', 'large'] as const;

interface TrafficInternals {
  nodeOwner: Int32Array;
}

/** Docks a type on the stand of a size. Returns the sim and the aircraft index once in turnaround, or null when the stand refuses the type or it never docks. */
function dock(typeIdx: number, size: (typeof SIZES)[number]): { sim: Sim; ac: number; standIdx: number } | null {
  const sim = ownedSim();
  buildScene(sim);
  const standIdx = sim.airfield.data.stands.findIndex((s) => s.size === size);
  const events = run(sim, { type: 'testDockAt', standId: sim.airfield.data.stands[standIdx].id, typeIdx, turnTicks: 1200 });
  if (events.length > 0 || sim.traffic.count === 0 && sim.traffic.fStand.every((v) => v < 0)) return null;
  for (let t = 0; t < 6000; t++) {
    sim.step();
    for (let ac = 0; ac < sim.traffic.active.length; ac++) {
      if (sim.traffic.active[ac] === 1 && sim.traffic.state[ac] === AcState.Turnaround) return { sim, ac, standIdx };
    }
  }
  return null;
}

describe('parked pose', () => {
  it('puts the nose gear on the stop bar and the hard footprint inside the stand slot', () => {
    const docked = { small: 0, medium: 0, large: 0 };
    const expected = { small: 0, medium: 0, large: 0 };
    AIRCRAFT.forEach((spec, typeIdx) => {
      for (const size of SIZES) {
        const slot = standSlot(size);
        if (!slot) throw new Error(`no stand slot for ${size}`);
        if (standRefusal({ size, surface: 'concrete' }, spec) !== null) continue;
        expected[size]++;
        const r = dock(typeIdx, size);
        expect(r, `${spec.id} docks on ${size}`).not.toBeNull();
        if (!r) continue;
        docked[size]++;
        const { sim, ac, standIdx } = r;
        const stand = sim.airfield.data.stands[standIdx];
        const h = sim.traffic.heading[ac];
        const c = Math.cos(h);
        const s = Math.sin(h);
        const half = spec.dimensions.lengthM / 2;
        const noseX = sim.traffic.x[ac] + c * half;
        const noseY = sim.traffic.y[ac] + s * half;
        const gear = standGeometry(spec).noseGearM;
        const gx = noseX - c * gear;
        const gy = noseY - s * gear;
        const bar = stopBarOffset(size, stopBarIndex(size, spec));
        const dirX = Math.sin((stand.headingDeg * Math.PI) / 180);
        const dirY = -Math.cos((stand.headingDeg * Math.PI) / 180);
        const wantX = stand.x + dirX * bar;
        const wantY = stand.y + dirY * bar;
        expect(Math.hypot(gx - wantX, gy - wantY), `${spec.id} on ${size}`).toBeLessThan(0.3);
        const pose = parkedCentre(stand, spec);
        expect(Math.hypot(pose.x - sim.traffic.x[ac], pose.y - sim.traffic.y[ac]), `${spec.id} centre`).toBeLessThan(0.3);
        const outline = aircraftBoundary(footprintSpecSchema.parse(SPRITE_BASES[spec.sprite.base]));
        for (const poly of outline.hard) {
          for (const p of poly) {
            // Aircraft local to world: x to the right (s, -c), y aft from the nose.
            const wx = noseX + p.x * s - p.y * c;
            const wy = noseY - p.x * c - p.y * s;
            const along = (wx - stand.x) * dirX + (wy - stand.y) * dirY;
            const across = (wx - stand.x) * dirY * -1 + (wy - stand.y) * dirX;
            expect(along, `${spec.id} on ${size} along`).toBeLessThanOrEqual(slot.far + 0.01);
            expect(along, `${spec.id} on ${size} tail`).toBeGreaterThanOrEqual(slot.near - 0.01);
            expect(Math.abs(across), `${spec.id} on ${size} across`).toBeLessThanOrEqual(slot.widthM / 2 + 0.01);
          }
        }
      }
    });
    for (const size of SIZES) {
      expect(expected[size], `${size} has pairs`).toBeGreaterThan(0);
      expect(docked[size], `${size} docked pairs`).toBe(expected[size]);
    }
  }, 240000);

  it('gives identical hashes on two runs and the same state after a save at docked', () => {
    const play = (): { sim: Sim; ac: number } => {
      const r = dock(AIRCRAFT.findIndex((a) => a.id === 'a320neo'), 'medium');
      if (!r) throw new Error('no dock');
      return r;
    };
    const a = play();
    const b = play();
    expect(a.sim.stateHash()).toBe(b.sim.stateHash());
    const text = JSON.stringify(a.sim.serialize());
    const loaded = new Sim('GOLDEN-0001', OPTIONS);
    loaded.restore(JSON.parse(text));
    for (let t = 0; t < 800; t++) {
      a.sim.step();
      loaded.step();
    }
    expect(loaded.stateHash()).toBe(a.sim.stateHash());
  });

  it('pushes fork stands back in turn under busy traffic with no stale node reservation and no deadlock', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 10 });
    run(sim, { type: 'setTestTraffic', perHour: 40, turnScale: 0.1 });
    for (let t = 0; t < 36000; t++) sim.step();
    expect(sim.traffic.completedFlights).toBeGreaterThan(10);
    // Every reserved node belongs to an aircraft that still holds it.
    const owners = (sim.traffic as unknown as TrafficInternals).nodeOwner;
    for (let n = 0; n < owners.length; n++) {
      const o = owners[n];
      if (o >= 0) expect(sim.traffic.heldNode[o], `node ${n} owner ${o}`).toBe(n);
    }
  }, 120000);

  it('starts a push back from the parked distance and leaves the stand', () => {
    const r = dock(AIRCRAFT.findIndex((a) => a.id === 'a320neo'), 'medium');
    expect(r).not.toBeNull();
    if (!r) return;
    const { sim, ac, standIdx } = r;
    const stand = sim.airfield.data.stands[standIdx];
    sim.traffic.timer[ac] = 0;
    let started = -1;
    for (let t = 0; t < 2000 && started < 0; t++) {
      sim.step();
      if (sim.traffic.state[ac] === AcState.Pushback) started = t;
    }
    expect(started).toBeGreaterThanOrEqual(0);
    const away0 = Math.hypot(sim.traffic.x[ac] - stand.x, sim.traffic.y[ac] - stand.y);
    expect(Math.abs(away0 + parkedOffsetM('medium', AIRCRAFT[sim.traffic.type[ac]]))).toBeLessThan(1.5);
    for (let t = 0; t < 40000 && sim.traffic.completedFlights < 1; t++) sim.step();
    expect(sim.traffic.completedFlights).toBe(1);
  }, 120000);

  it('restores an aircraft saved at the old pose with its centre on the stand point and pushes it back', () => {
    const r = dock(AIRCRAFT.findIndex((a) => a.id === 'a320neo'), 'medium');
    expect(r).not.toBeNull();
    if (!r) return;
    const { sim, ac, standIdx } = r;
    const stand = sim.airfield.data.stands[standIdx];
    const spec = AIRCRAFT[sim.traffic.type[ac]];
    sim.traffic.dist[ac] += -parkedOffsetM('medium', spec);
    sim.traffic.x[ac] = stand.x;
    sim.traffic.y[ac] = stand.y;
    sim.traffic.timer[ac] = 300;
    const loaded = new Sim('GOLDEN-0001', OPTIONS);
    loaded.restore(JSON.parse(JSON.stringify(sim.serialize())));
    for (let t = 0; t < 40000 && loaded.traffic.completedFlights < 1; t++) loaded.step();
    expect(loaded.traffic.completedFlights).toBe(1);
    expect(loaded.traffic.active[ac]).toBe(0);
  }, 120000);
});

describe('stop bar rule', () => {
  const spec = (id: string) => AIRCRAFT[AIRCRAFT.findIndex((a) => a.id === id)];

  it('gives a listed type its own bar', () => {
    expect(stopBarIndex('large', spec('b787_9'))).toBe(1);
    expect(stopBarIndex('large', spec('b777_300er'))).toBe(0);
  });

  it('gives an unlisted type the first bar of a type no longer than it, else the last bar', () => {
    const base = spec('a320neo');
    const longer = (lengthM: number) => ({ ...base, icaoType: 'ZZZZ', dimensions: { ...base.dimensions, lengthM } });
    expect(stopBarIndex('large', longer(100))).toBe(0);
    expect(stopBarIndex('large', longer(65))).toBe(1);
    expect(stopBarIndex('large', longer(20))).toBe(standTypes('large').length - 1);
  });

  it('is refused by the fit rule when a type is longer than the longest type the stand is drawn for', () => {
    for (const size of STAND_SIZES_ORDER) {
      const bars = standTypes(size);
      if (bars.length === 0) continue;
      for (const a of AIRCRAFT) {
        const refusal = refuseFit({ closed: false, usage: 'any', size, surface: 'concrete', type: 'remote', code: 'E', linked: true, contactOk: () => true }, a);
        if (a.dimensions.lengthM > bars[0].dimensions.lengthM) expect(refusal, `${a.id} on ${size}`).not.toBeNull();
      }
    }
  });
});
