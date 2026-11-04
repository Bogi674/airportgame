import { describe, expect, it } from 'vitest';
import { recordReplay, runReplay } from '@sim/replay';
import { Sim } from '@sim/sim';
import type { Command } from '@sim/commands';
import { compassVector } from '@shared/airfield';

const OPTIONS = { preset: 'flatCoastal' } as const;

/** A sim where the player owns the whole site, so tests can place anything on land. */
function ownedSim(): Sim {
  const sim = new Sim('GOLDEN-0001', OPTIONS);
  sim.parcelOwner.fill(1);
  return sim;
}

function run(sim: Sim, ...cmds: Command[]): string[] {
  for (const c of cmds) sim.enqueue(c);
  sim.step();
  const ev: string[] = [];
  sim.drainEvents(ev);
  return ev;
}

const RUNWAY: Command = { type: 'buildRunway', x: 4000, y: 5600, headingDeg: 90, lengthM: 1800, code: 'C', approach: 'precision', surface: 'asphalt', tier: 1 };

describe('Runway tool', () => {
  it('builds a runway with code widths, designators and a cost', () => {
    const sim = ownedSim();
    const cash = sim.cash;
    expect(run(sim, RUNWAY)).toEqual([]);
    const r = sim.airfield.data.runways[0];
    expect(r.widthM).toBe(30);
    expect(r.shoulderM).toBe(7.5);
    expect(r.nameA).toBe('09');
    expect(r.nameB).toBe('27');
    expect(r.lengthM).toBe(1800);
    expect(r.x2 - r.x1).toBeCloseTo(1800, 3);
    expect(Math.abs(r.y2 - r.y1)).toBeLessThan(0.01);
    expect(sim.cash).toBe(cash - r.cost);
    expect(r.cost).toBeGreaterThan(1800 * 45 * 30);
  });

  it('refuses land the player does not own, water, bad lengths and runways too close', () => {
    const sim = new Sim('GOLDEN-0001', OPTIONS);
    expect(run(sim, { ...RUNWAY, x: 4000, y: 7000 } as Command)).toEqual(['notOwned']);
    const owned = ownedSim();
    expect(run(owned, { ...RUNWAY, lengthM: 100 } as Command)[0]).toMatch(/^runwayLength/);
    expect(run(owned, { ...RUNWAY, surface: 'grass' } as Command)).toEqual(['approachNeedsPaved']);
    expect(run(owned, RUNWAY)).toEqual([]);
    expect(run(owned, { ...RUNWAY, y: 5650 } as Command)[0]).toMatch(/^runwayTooClose/);
    const coast = ownedSim();
    expect(run(coast, { ...RUNWAY, x: 4000, y: 200, headingDeg: 0 } as Command)).toContain('onWater');
  });

  it('refuses when the player cannot pay', () => {
    const sim = ownedSim();
    sim.cash = 1000;
    expect(run(sim, RUNWAY)[0]).toMatch(/^insufficientFunds/);
    expect(sim.airfield.data.runways).toHaveLength(0);
  });

  it('names parallel runways L and R', () => {
    const sim = ownedSim();
    run(sim, RUNWAY, { ...RUNWAY, y: 5900 } as Command);
    const names = sim.airfield.data.runways.map((r) => `${r.nameA}/${r.nameB}`).sort();
    expect(names).toEqual(['09L/27R', '09R/27L']);
    // 09L is the northern runway (left of the 090 heading).
    const north = sim.airfield.data.runways.find((r) => r.y1 < 5700);
    expect(north?.nameA).toBe('09L');
  });
});

describe('Taxiway and network', () => {
  it('places holding points at the correct distance and reports entries with TODA', () => {
    const sim = ownedSim();
    run(sim, RUNWAY);
    // A connector from the runway edge going south 300 m.
    run(sim, { type: 'buildTaxiway', points: [{ x: 4500, y: 5615 }, { x: 4500, y: 5900 }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 0 });
    const af = sim.airfield.data;
    expect(af.taxiways[0].name).toBe('A');
    expect(af.holding.length).toBeGreaterThanOrEqual(1);
    const rw = af.runways[0];
    for (const h of af.holding) {
      const dist = Math.abs(h.y - rw.y1);
      expect(dist).toBeGreaterThanOrEqual(90 - 3);
      expect(dist).toBeLessThanOrEqual(90 + 3);
    }
    expect(af.entries).toHaveLength(1);
    expect(af.entries[0].todaTowardB).toBe(1300);
    expect(af.entries[0].todaTowardA).toBe(500);
  });

  it('visual runways hold closer than precision ones', () => {
    const sim = ownedSim();
    run(sim, { ...RUNWAY, approach: 'visual' } as Command);
    run(sim, { type: 'buildTaxiway', points: [{ x: 4500, y: 5615 }, { x: 4500, y: 5900 }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 0 });
    const h = sim.airfield.data.holding[0];
    expect(Math.abs(h.y - 5600)).toBeGreaterThan(72);
    expect(Math.abs(h.y - 5600)).toBeLessThan(78);
  });

  it('downgrades the maximum code of a taxiway built too close to the runway', () => {
    const sim = ownedSim();
    run(sim, RUNWAY);
    run(sim, { type: 'buildParallelTaxiway', runwayId: sim.airfield.data.runways[0].id, side: 'right', offsetM: 120, code: 'C', connectors: 2, surface: 'asphalt', tier: 0 });
    const main = sim.airfield.data.taxiways.find((t) => t.name === 'A');
    expect(main?.maxCode).toBe('B');
    const far = ownedSim();
    run(far, RUNWAY);
    run(far, { type: 'buildParallelTaxiway', runwayId: far.airfield.data.runways[0].id, side: 'right', offsetM: 190, code: 'C', connectors: 2, surface: 'asphalt', tier: 0 });
    expect(far.airfield.data.taxiways.find((t) => t.name === 'A')?.maxCode).toBe('C');
    expect(far.airfield.data.taxiways).toHaveLength(3);
    expect(far.airfield.data.taxiways.map((t) => t.name).sort()).toEqual(['A', 'A1', 'A2']);
  });

  it('builds a rapid exit that leaves the runway at the preset angle', () => {
    const sim = ownedSim();
    run(sim, RUNWAY);
    const id = sim.airfield.data.runways[0].id;
    expect(run(sim, { type: 'buildRapidExit', runwayId: id, distM: 1100, side: 'right', angleDeg: 30, code: 'C', surface: 'asphalt', tier: 0 })).toEqual([]);
    const t = sim.airfield.data.taxiways[0];
    expect(t.kind).toBe('rapidExit');
    const p0 = t.points[0];
    const pn = t.points[t.points.length - 1];
    expect(p0.y).toBeCloseTo(5600, 0);
    const heading = Math.atan2(pn.y - t.points[t.points.length - 2].y, pn.x - t.points[t.points.length - 2].x);
    expect((heading * 180) / Math.PI).toBeCloseTo(30, 0);
    expect(pn.y).toBeGreaterThan(5600);
    expect(sim.airfield.data.holding.length).toBeGreaterThanOrEqual(1);
    expect(run(sim, { type: 'buildRapidExit', runwayId: id, distM: 50, side: 'left', angleDeg: 45, code: 'C', surface: 'asphalt', tier: 0 })[0]).toMatch(/^exitDistance/);
  });

  it('applies segment properties', () => {
    const sim = ownedSim();
    run(sim, { type: 'buildTaxiway', points: [{ x: 4000, y: 4000 }, { x: 4200, y: 4000 }], code: 'D', kind: 'taxiway', surface: 'concrete', tier: 2 });
    const id = sim.airfield.data.taxiways[0].id;
    run(sim, { type: 'setTaxiwayProps', id, oneWay: true, closed: true, userMaxCode: 'C', speedKmh: 40 });
    const t = sim.airfield.data.taxiways[0];
    expect([t.oneWay, t.closed, t.maxCode, t.speedKmh, t.pcr, t.widthM]).toEqual([true, true, 'C', 40, 80, 18]);
  });
});

describe('Aprons and stands', () => {
  const apron: Command = { type: 'buildApron', polygon: [{ x: 4000, y: 4000 }, { x: 4300, y: 4000 }, { x: 4300, y: 4100 }, { x: 4000, y: 4100 }], surface: 'concrete', tier: 1 };

  it('needs an apron for jet stands and puts them on its surface', () => {
    const sim = ownedSim();
    const stand: Command = { type: 'buildStands', x: 4040, y: 4050, headingDeg: 0, count: 4, spacingM: 45, standType: 'remote', size: 'medium' };
    expect(run(sim, stand)).toEqual(['standNeedsApron']);
    expect(run(sim, apron)).toEqual([]);
    expect(run(sim, stand)).toEqual([]);
    expect(sim.airfield.data.stands.map((s) => s.number)).toEqual(['1', '2', '3', '4']);
    expect(sim.airfield.data.stands[0].surface).toBe('concrete');
    expect(sim.airfield.data.stands[0].pushback).toBe('auto');
  });

  it('refuses overlapping stands and tight spacing', () => {
    const sim = ownedSim();
    run(sim, apron);
    expect(run(sim, { type: 'buildStands', x: 4040, y: 4050, headingDeg: 0, count: 2, spacingM: 30, standType: 'remote', size: 'medium' })[0]).toMatch(/^standSpacing/);
    run(sim, { type: 'buildStands', x: 4040, y: 4050, headingDeg: 0, count: 2, spacingM: 45, standType: 'remote', size: 'medium' });
    expect(run(sim, { type: 'buildStands', x: 4060, y: 4050, headingDeg: 0, count: 1, spacingM: 45, standType: 'remote', size: 'medium' })).toEqual(['standOverlap']);
  });

  it('builds a GA block with an asphalt apron and tie down stands', () => {
    const sim = ownedSim();
    expect(run(sim, { type: 'buildGaBlock', x: 3000, y: 3000, headingDeg: 0, count: 6 })).toEqual([]);
    expect(sim.airfield.data.aprons).toHaveLength(1);
    expect(sim.airfield.data.stands).toHaveLength(6);
    expect(sim.airfield.data.stands[0].size).toBe('small');
    const d = compassVector(0);
    expect(d.y).toBeCloseTo(-1);
  });
});

describe('Undo, redo, demolish and resurface', () => {
  it('undo refunds, redo charges again, new actions clear redo', () => {
    const sim = ownedSim();
    const cash = sim.cash;
    run(sim, RUNWAY);
    const spent = cash - sim.cash;
    run(sim, { type: 'undo' });
    expect(sim.cash).toBe(cash);
    expect(sim.airfield.data.runways).toHaveLength(0);
    run(sim, { type: 'redo' });
    expect(sim.cash).toBe(cash - spent);
    expect(sim.airfield.data.runways).toHaveLength(1);
    run(sim, { type: 'undo' });
    run(sim, { type: 'buildApron', polygon: [{ x: 4000, y: 4000 }, { x: 4100, y: 4000 }, { x: 4100, y: 4100 }], surface: 'asphalt', tier: 0 });
    expect(run(sim, { type: 'redo' })).toEqual(['nothingToRedo']);
  });

  it('demolish refunds a quarter and can be undone', () => {
    const sim = ownedSim();
    run(sim, RUNWAY);
    const r = sim.airfield.data.runways[0];
    const afterBuild = sim.cash;
    run(sim, { type: 'demolish', kind: 'runway', id: r.id });
    expect(sim.cash).toBe(afterBuild + Math.round(r.cost * 0.25));
    expect(sim.airfield.data.runways).toHaveLength(0);
    run(sim, { type: 'undo' });
    expect(sim.cash).toBe(afterBuild);
    expect(sim.airfield.data.runways).toHaveLength(1);
  });

  it('resurfacing restores condition and changes tier', () => {
    const sim = ownedSim();
    run(sim, RUNWAY);
    const r = sim.airfield.data.runways[0];
    r.condition = 40;
    const cash = sim.cash;
    run(sim, { type: 'resurface', kind: 'runway', id: r.id, surface: 'concrete', tier: 3 });
    expect(r.condition).toBe(100);
    expect(r.surface).toBe('concrete');
    expect(r.pcr).toBe(100);
    expect(sim.cash).toBeLessThan(cash);
  });

  it('prefab parallel taxiway is one undo step', () => {
    const sim = ownedSim();
    run(sim, RUNWAY);
    run(sim, { type: 'buildParallelTaxiway', runwayId: sim.airfield.data.runways[0].id, side: 'left', offsetM: 190, code: 'C', connectors: 3, surface: 'asphalt', tier: 0 });
    expect(sim.airfield.data.taxiways).toHaveLength(4);
    run(sim, { type: 'undo' });
    expect(sim.airfield.data.taxiways).toHaveLength(0);
  });
});

describe('Airfield determinism', () => {
  it('a replay of builds reproduces the hash', () => {
    const live = ownedSim();
    const script: Command[] = [
      RUNWAY,
      { type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 190, code: 'C', connectors: 3, surface: 'asphalt', tier: 0 },
      { type: 'buildApron', polygon: [{ x: 4000, y: 6200 }, { x: 4300, y: 6200 }, { x: 4300, y: 6300 }, { x: 4000, y: 6300 }], surface: 'concrete', tier: 1 },
      { type: 'buildStands', x: 4040, y: 6250, headingDeg: 0, count: 3, spacingM: 45, standType: 'remote', size: 'medium' },
      { type: 'undo' },
      { type: 'redo' },
    ];
    for (let i = 0; i < script.length; i++) {
      live.enqueue(script[i]);
      for (let t = 0; t < 20; t++) live.step();
    }
    const replay = JSON.parse(JSON.stringify(recordReplay(live))) as ReturnType<typeof recordReplay>;
    // Ownership is a test setup, so apply it to the replay run as well.
    const rerun = new Sim(replay.seed, replay.options);
    rerun.parcelOwner.fill(1);
    let next = 0;
    for (let t = 0; t < 120; t++) {
      while (next < replay.commands.length && replay.commands[next].tick === t) rerun.enqueue(replay.commands[next++].cmd);
      rerun.step();
    }
    expect(rerun.stateHash()).toBe(live.stateHash());
    expect(runReplay).toBeDefined();
  });
});
