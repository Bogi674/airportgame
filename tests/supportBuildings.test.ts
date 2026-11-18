import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { GROUND, GSE_INDEX } from '@data/index';
import { buildingDoor, depotExit } from '@shared/roadGraph';
import { airportFireCategory, neededCategory, stationCategory } from '@shared/fireCover';
import { LEDGER_CATEGORIES, TICKS_PER_DAY, TICKS_PER_MINUTE } from '@shared/business';
import { Sim } from '@sim/sim';
import { AcState } from '@sim/ops/traffic';
import { buildTestAirport, OPTIONS, ownedSim, run } from './helpers';

const idx = (id: string): number => AIRCRAFT.findIndex((a) => a.id === id);
/** A free spot west of the test apron, south of the depot and fire station. */
const FARM = { x: 3640, y: 5480 };

describe('fire cover (T65)', () => {
  it('maps vehicles to categories and lengths to needs per the section 10 table', () => {
    expect(stationCategory({ fireVehicles: 0 })).toBe(0);
    expect(stationCategory({ fireVehicles: 1 })).toBe(6);
    expect(stationCategory({ fireVehicles: 2 })).toBe(7);
    expect(stationCategory({ fireVehicles: 3 })).toBe(10);
    expect(neededCategory(27)).toBe(5);
    expect(neededCategory(37.6)).toBe(6);
    expect(neededCategory(73.9)).toBe(9);
  });

  it('refuses airline flights over the category once the grace is over, never before', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 4 });
    const station = sim.airfield.data.buildings!.find((b) => b.kind === 'fire')!;
    expect(airportFireCategory(sim.airfield.data)).toBe(10);
    expect(run(sim, { type: 'demolish', kind: 'building', id: station.id })).toEqual([]);
    expect(sim.traffic.fireCategory).toBe(0);
    // Inside the grace the flight comes.
    expect(sim.traffic.fireEnforced).toBe(false);
    const ok = run(sim, { type: 'testArrival', typeIdx: idx('a320neo'), inTicks: 0, turnTicks: 600 });
    expect(ok.some((e) => e.startsWith('flightRefused'))).toBe(false);
    // After the grace it is refused with the needed and available category.
    sim.business.fireGraceUntil = 0;
    sim.business.refreshFire();
    const events: string[] = run(sim, { type: 'testArrival', typeIdx: idx('a320neo'), inTicks: 0, turnTicks: 600 });
    for (let t = 0; t < 50; t++) {
      sim.step();
      sim.drainEvents(events);
    }
    expect(events).toContain('flightRefused|type=a320neo|reason=fireCategory|needed=6|available=0');
  });
});

describe('fuel farm (T65)', () => {
  it('orders tankers below a quarter stock, fills on delivery and sells fuel to a docked flight', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 4 });
    expect(run(sim, { type: 'buildBuilding', kind: 'fuelFarm', x: FARM.x, y: FARM.y, headingDeg: 90 })).toEqual([]);
    const cap = GROUND.fuel.tankCount * GROUND.fuel.tankM3 * 1000;
    expect(sim.business.fuelCapacityL()).toBe(cap);
    const cash = sim.cash;
    for (let t = 0; t < 61 * TICKS_PER_MINUTE; t++) sim.step();
    const tankers = Math.ceil(cap / (GROUND.fuel.tankerM3 * 1000));
    expect(sim.business.fuelOrders.length / 2).toBe(tankers);
    expect(cash - sim.cash).toBeGreaterThanOrEqual(Math.round(tankers * GROUND.fuel.tankerM3 * 1000 * GROUND.fuel.buyPerL) - 1);
    for (let t = 0; t < (GROUND.fuel.leadHours * 60 + 61) * TICKS_PER_MINUTE; t++) sim.step();
    expect(sim.business.fuelStockL).toBe(cap);
    run(sim, { type: 'testArrival', typeIdx: idx('a320neo'), inTicks: 0, turnTicks: 600 });
    for (let t = 0; t < 20000 && sim.traffic.completedFlights === 0; t++) sim.step();
    expect(sim.traffic.completedFlights).toBe(1);
    expect(sim.business.fuelStockL).toBe(cap - GROUND.fuel.upliftL.a320neo);
  });

  it('holds a turnaround that the empty farm cannot fuel until a tanker arrives', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 4 });
    expect(run(sim, { type: 'buildBuilding', kind: 'fuelFarm', x: FARM.x, y: FARM.y, headingDeg: 90 })).toEqual([]);
    const events: string[] = run(sim, { type: 'testArrival', typeIdx: idx('a320neo'), inTicks: 0, turnTicks: 600 });
    let held = 0;
    for (let t = 0; t < 6 * 60 * TICKS_PER_MINUTE && sim.traffic.completedFlights === 0; t++) {
      sim.step();
      sim.drainEvents(events);
      for (let a = 0; a < 256; a++) if (sim.traffic.active[a] === 1 && sim.traffic.state[a] === AcState.Turnaround && sim.traffic.fuelOwed[a] > 0) held++;
    }
    expect(events.some((e) => e.startsWith('fuelShort|type=a320neo'))).toBe(true);
    expect(events).toContain('flightGrounded|type=a320neo|reason=fuel');
    expect(held).toBeGreaterThan(GROUND.fuel.groundAfterMin * TICKS_PER_MINUTE);
    expect(sim.traffic.completedFlights).toBe(1);
  });

  it('a save while a flight waits for fuel restores to the same hash, and the run is deterministic', () => {
    const prepared = (): Sim => {
      const sim = ownedSim();
      buildTestAirport(sim, { standsPerRow: 4 });
      run(sim, { type: 'buildBuilding', kind: 'fuelFarm', x: FARM.x, y: FARM.y, headingDeg: 90 });
      run(sim, { type: 'testArrival', typeIdx: idx('a320neo'), inTicks: 0, turnTicks: 600 });
      for (let t = 0; t < 4000; t++) sim.step();
      return sim;
    };
    const a = prepared();
    const b = new Sim(a.seed, OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    for (let t = 0; t < 2000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
    expect(prepared().stateHash()).toBe(prepared().stateHash());
  });

  it('charges upkeep for supporting buildings each day', () => {
    const upkeepAfterDay = (extra: boolean): number => {
      const sim = ownedSim();
      buildTestAirport(sim, { standsPerRow: 4 });
      if (extra) expect(run(sim, { type: 'buildBuilding', kind: 'staff', x: FARM.x, y: FARM.y, headingDeg: 90 })).toEqual([]);
      for (let t = 0; t < TICKS_PER_DAY + 10; t++) sim.step();
      const p = sim.business.payload(sim.tick);
      return p.history[p.history.length - 1][LEDGER_CATEGORIES.indexOf('upkeep')];
    };
    expect(upkeepAfterDay(false) - upkeepAfterDay(true)).toBeCloseTo(GROUND.buildings.staff.cost * GROUND.buildingUpkeepShare, -1);
  });
});

describe('catering unit (T65)', () => {
  it('sends its own catering trucks by road, and they go home there', () => {
    const sim = ownedSim();
    buildTestAirport(sim, { standsPerRow: 4 });
    expect(run(sim, { type: 'buildBuilding', kind: 'catering', x: FARM.x, y: FARM.y, headingDeg: 90 })).toEqual([]);
    const unit = sim.airfield.data.buildings!.find((b) => b.kind === 'catering')!;
    const door = buildingDoor(unit);
    const exit = depotExit(sim.airfield.data.depots![0]);
    expect(run(sim, { type: 'buildRoad', points: [door, { x: 3800, y: door.y }, { x: 3800, y: exit.y }] })).toEqual([]);
    expect(sim.roads.standRoad[sim.roads.standCount]).toBe(1);
    run(sim, { type: 'testArrival', typeIdx: idx('a320neo'), inTicks: 0, turnTicks: 30000 });
    let fromUnit = false;
    for (let t = 0; t < 40000 && sim.traffic.completedFlights === 0; t++) {
      sim.step();
      for (let v = 0; v < 1024; v++) {
        if (sim.gse.active[v] === 1 && sim.gse.kind[v] === GSE_INDEX.catering && Math.hypot(sim.gse.x[v] - door.x, sim.gse.y[v] - door.y) < 10) fromUnit = true;
      }
    }
    expect(fromUnit).toBe(true);
    for (let t = 0; t < 10000 && sim.gse.count > 0; t++) sim.step();
    expect(sim.gse.count).toBe(0);
  });
});
