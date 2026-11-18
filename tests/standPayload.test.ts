import { describe, expect, it } from 'vitest';
import { STAND_ACCESS } from '@data/index';
import type { Sim } from '@sim/sim';
import { buildTestAirport, buildTestTerminal, ownedSim, run } from './helpers';

/** Gate desk facts the business payload hands the stand inspector (T66 slice 4). */

function airport(withTerminal: boolean): Sim {
  const sim = ownedSim();
  sim.cash = 80_000_000;
  buildTestAirport(sim, { standsPerRow: 4 });
  if (withTerminal) expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 4 })).toEqual([]);
  return sim;
}

describe('stand payload gate facts', () => {
  it('lists desks, resolves each stand to its nearest desk and flags far stands', () => {
    const sim = airport(true);
    const [near, far] = sim.airfield.data.stands;
    const desk = sim.business.payload(sim.tick).gateDesks[0];
    expect(sim.business.payload(sim.tick).gateDesks.length).toBeGreaterThanOrEqual(2);
    const grid = sim.business.grids.find((g) => g.id === desk.building);
    expect(grid).toBeDefined();
    const world = sim.business.gateFor({ x: near.x, y: near.y });
    expect(world).not.toBeNull();
    if (!world) return;
    near.x = world.wx;
    near.y = world.wy + 5;
    far.x = world.wx;
    far.y = world.wy + STAND_ACCESS.stairsWalkLimitM + 400;
    const p = sim.business.payload(sim.tick);
    const idx = p.gateDesks.findIndex((d) => d.building === world.building && d.x === world.x && d.y === world.y);
    expect(p.standGate[0]).toBe(idx);
    expect(p.standFar[0]).toBe(0);
    expect(p.standFar[1]).toBe(1);
    expect(p.standGate[1]).toBeGreaterThanOrEqual(0);
  });

  it('an assigned desk overrides the nearest one', () => {
    const sim = airport(true);
    const stand = sim.airfield.data.stands[0];
    const before = sim.business.payload(sim.tick);
    const nearest = before.standGate[0];
    const other = before.gateDesks.findIndex((_, i) => i !== nearest);
    const d = before.gateDesks[other];
    expect(run(sim, { type: 'setStandGate', id: stand.id, building: d.building, x: d.x, y: d.y })).toEqual([]);
    expect(sim.business.payload(sim.tick).standGate[0]).toBe(other);
    expect(run(sim, { type: 'setStandGate', id: stand.id, building: -1, x: 0, y: 0 })).toEqual([]);
    expect(sim.business.payload(sim.tick).standGate[0]).toBe(nearest);
  });

  it('without desks the stands have no gate and are not far', () => {
    const sim = airport(false);
    const p = sim.business.payload(sim.tick);
    expect(p.gateDesks).toEqual([]);
    expect(p.standGate.length).toBeGreaterThan(0);
    expect(p.standGate.every((g) => g === -1)).toBe(true);
    expect(p.standFar.every((f) => f === 0)).toBe(true);
  });

  it('building the payload leaves the state hash unchanged', () => {
    const sim = airport(true);
    const before = sim.stateHash();
    sim.business.payload(sim.tick);
    sim.business.payload(sim.tick);
    expect(sim.stateHash()).toBe(before);
  });
});
