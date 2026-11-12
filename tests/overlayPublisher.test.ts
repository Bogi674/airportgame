import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import type { Sim } from '@sim/sim';
import type { OverlayData } from '@shared/overlay';
import { emptyOverlay } from '@sim/terminal/overlays';
import { OverlayPublisher } from '../src/worker/overlayPublisher';
import { buildTestAirport, buildTestTerminal, ownedSim } from './helpers';

const TICKS_PER_MINUTE = 600;
const WIDE = AIRCRAFT.findIndex((a) => a.id === 'a320neo');
const LONG_TURN_TICKS = 36000;

describe('OverlayPublisher', () => {
  it('is never due while off', () => {
    const p = new OverlayPublisher();
    expect(p.due(0)).toBe(false);
    expect(p.due(10 * TICKS_PER_MINUTE)).toBe(false);
  });

  it('is due at once after subscribing', () => {
    const p = new OverlayPublisher();
    p.setOn(true);
    expect(p.due(1234)).toBe(true);
  });

  it('is not due again until 600 ticks after a mark', () => {
    const p = new OverlayPublisher();
    p.setOn(true);
    p.mark(1000);
    expect(p.due(1000)).toBe(false);
    expect(p.due(1000 + TICKS_PER_MINUTE - 1)).toBe(false);
  });

  it('is due again at exactly 600 ticks after a mark', () => {
    const p = new OverlayPublisher();
    p.setOn(true);
    p.mark(1000);
    expect(p.due(1000 + TICKS_PER_MINUTE)).toBe(true);
  });

  it('is due at once when the tick goes backwards, as after a new sim replaces the old one', () => {
    const p = new OverlayPublisher();
    p.setOn(true);
    p.mark(50000);
    expect(p.due(100)).toBe(true);
    p.mark(100);
    expect(p.due(100 + TICKS_PER_MINUTE - 1)).toBe(false);
    expect(p.due(100 + TICKS_PER_MINUTE)).toBe(true);
  });

  it('is due at once after off then on', () => {
    const p = new OverlayPublisher();
    p.setOn(true);
    p.mark(1000);
    p.setOn(false);
    expect(p.due(1001)).toBe(false);
    p.setOn(true);
    expect(p.due(1001)).toBe(true);
  });
});

function terminalSim(): Sim {
  const sim = ownedSim('GOLDEN-0010');
  buildTestAirport(sim);
  expect(buildTestTerminal(sim, { checkIn: 4, security: 2, gateDesk: 2 })).toEqual([]);
  const f = sim.traffic.scheduleArrival(WIDE, sim.traffic.nowTick + 100, 0, LONG_TURN_TICKS, -1);
  expect(f).toBeGreaterThanOrEqual(0);
  return sim;
}

function blank(): OverlayData {
  return emptyOverlay({ building: 0, w: 0, h: 0, density: new Uint16Array(0), nodeCell: new Int32Array(0), nodeQueue: new Uint16Array(0), nodeWaitS: new Uint16Array(0), gateCell: new Int32Array(0), gateDistM: new Uint16Array(0) }, 0);
}

/** Runs ticks like the worker does: one step, then the overlay read whenever the publisher is due. */
function run(sim: Sim, ticks: number, withOverlay: boolean): number {
  const publisher = new OverlayPublisher();
  publisher.setOn(withOverlay);
  const out = blank();
  let publishes = 0;
  for (let t = 0; t < ticks; t++) {
    sim.step();
    if (!publisher.due(sim.tick)) continue;
    for (let i = 0; i < sim.terminalCount(); i++) sim.overlayData(i, out);
    publisher.mark(sim.tick);
    publishes++;
  }
  if (withOverlay) expect(publishes).toBeGreaterThan(1);
  else expect(publishes).toBe(0);
  return sim.stateHash();
}

describe('terminal overlay feed', () => {
  it('leaves the state hash equal to a run without it over 2000 ticks', () => {
    const withFeed = terminalSim();
    const without = terminalSim();
    expect(run(withFeed, 2000, true)).toBe(run(without, 2000, false));
  });
});
