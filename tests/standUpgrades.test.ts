import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '@data/aircraft';
import { STAND_ACCESS } from '@data/index';
import { STAND_UPGRADE, type StandUpgrade } from '@shared/airfield';
import { worksTicks } from '@shared/surfaceRules';
import { Sim } from '@sim/sim';
import { migrate } from '@sim/save/migrations';
import { buildTestAirport, ownedSim, run, OPTIONS } from './helpers';

/** Stand upgrades built through works (T66 slice 1): fields, cost, timing, closing, saves. */

const UPGRADES: StandUpgrade[] = ['busBay', 'hydrantPit', 'fixedPower'];
const jet = AIRCRAFT.findIndex((a) => a.id === 'a320neo');

function airport(): Sim {
  const sim = ownedSim();
  sim.cash = 80_000_000;
  buildTestAirport(sim, { standsPerRow: 3 });
  return sim;
}

describe('stand upgrades', () => {
  for (const upgrade of UPGRADES) {
    it(`${upgrade} books its cost and finishes after its days`, () => {
      const sim = airport();
      const stand = sim.airfield.data.stands[0];
      const spec = STAND_ACCESS.upgrades[upgrade];
      const cash = sim.cash;
      run(sim, { type: 'startStandUpgrade', id: stand.id, upgrade });
      expect(sim.cash).toBe(cash - spec.cost);
      const works = stand.upgradeWorks;
      expect(works?.upgrade).toBe(upgrade);
      expect(works?.doneTick).toBe(sim.tick - 1 + worksTicks(spec.days));
      sim.airfield.update(sim.tick + worksTicks(spec.days) - 2);
      expect(stand.upgradeWorks).toBeDefined();
      expect(stand.upgrades ?? 0).toBe(0);
      sim.airfield.update(works?.doneTick ?? 0);
      expect(stand.upgradeWorks).toBeUndefined();
      expect(stand.upgrades).toBe(STAND_UPGRADE[upgrade]);
    });
  }

  it('the sim itself finishes a one day upgrade', () => {
    const sim = airport();
    const stand = sim.airfield.data.stands[0];
    run(sim, { type: 'startStandUpgrade', id: stand.id, upgrade: 'busBay' });
    const end = stand.upgradeWorks?.doneTick ?? 0;
    while (sim.tick <= end) sim.step();
    expect(stand.upgradeWorks).toBeUndefined();
    expect(stand.upgrades).toBe(STAND_UPGRADE.busBay);
  });

  it('finishing stand works tells the sim to rerun stand assignment', () => {
    const sim = airport();
    const stand = sim.airfield.data.stands[0];
    run(sim, { type: 'startStandUpgrade', id: stand.id, upgrade: 'busBay' });
    const end = stand.upgradeWorks?.doneTick ?? 0;
    expect(sim.airfield.update(end - 1)).toBe(false);
    expect(sim.airfield.update(end)).toBe(true);
    expect(sim.airfield.update(end + 1)).toBe(false);
  });

  it('refuses an unknown stand, a built upgrade, running works and a lack of cash', () => {
    const sim = airport();
    const stand = sim.airfield.data.stands[0];
    expect(run(sim, { type: 'startStandUpgrade', id: 9999, upgrade: 'busBay' }).join(' ')).toContain('nothingThere');
    run(sim, { type: 'startStandUpgrade', id: stand.id, upgrade: 'busBay' });
    expect(run(sim, { type: 'startStandUpgrade', id: stand.id, upgrade: 'hydrantPit' }).join(' ')).toContain('worksRunning');
    sim.airfield.update(stand.upgradeWorks?.doneTick ?? 0);
    expect(run(sim, { type: 'startStandUpgrade', id: stand.id, upgrade: 'busBay' }).join(' ')).toContain('upgradeBuilt');
    const other = sim.airfield.data.stands[1];
    sim.cash = STAND_ACCESS.upgrades.hydrantPit.cost - 1;
    const ev = run(sim, { type: 'startStandUpgrade', id: other.id, upgrade: 'hydrantPit' });
    expect(ev.join(' ')).toContain(`insufficientFunds|cost=${STAND_ACCESS.upgrades.hydrantPit.cost}`);
    expect(other.upgradeWorks).toBeUndefined();
    expect(sim.cash).toBe(STAND_ACCESS.upgrades.hydrantPit.cost - 1);
  });

  it('a stand under works takes no aircraft and takes them again after', () => {
    const sim = airport();
    const stand = sim.airfield.data.stands[0];
    run(sim, { type: 'startStandUpgrade', id: stand.id, upgrade: 'fixedPower' });
    expect(run(sim, { type: 'testDockAt', standId: stand.id, typeIdx: jet, turnTicks: 600 }).join(' ')).toContain('standClosed');
    expect(stand.closed).not.toBe(true);
    sim.airfield.update(stand.upgradeWorks?.doneTick ?? 0);
    expect(run(sim, { type: 'testDockAt', standId: stand.id, typeIdx: jet, turnTicks: 600 }).join(' ')).not.toContain('standClosed');
  });

  it('a save in the middle of works restores to the same hash and the works finish', () => {
    const a = airport();
    const stand = a.airfield.data.stands[0];
    run(a, { type: 'startStandUpgrade', id: stand.id, upgrade: 'busBay' });
    for (let t = 0; t < 200; t++) a.step();
    const b = new Sim('GOLDEN-0001', OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.stateHash()).toBe(a.stateHash());
    const restored = b.airfield.data.stands[0];
    expect(restored.upgradeWorks).toEqual(stand.upgradeWorks);
    const end = stand.upgradeWorks?.doneTick ?? 0;
    while (a.tick <= end) {
      a.step();
      b.step();
    }
    expect(restored.upgrades).toBe(STAND_UPGRADE.busBay);
    expect(restored.upgradeWorks).toBeUndefined();
    expect(b.stateHash()).toBe(a.stateHash());
  }, 120000);

  it('a stand saved without the new fields loads with no upgrades', () => {
    const sim = airport();
    const data = JSON.parse(JSON.stringify(sim.serialize())) as { version: number; airfield: { stands: Record<string, unknown>[] } };
    for (const s of data.airfield.stands) {
      delete s.upgrades;
      delete s.upgradeWorks;
      delete s.gate;
    }
    data.version = 21;
    const out = migrate(data);
    expect(out.version).toBeGreaterThan(21);
    const c = new Sim('GOLDEN-0001', OPTIONS);
    c.restore(out);
    expect(c.airfield.data.stands.every((s) => (s.upgrades ?? 0) === 0 && s.upgradeWorks === undefined)).toBe(true);
    expect(c.stateHash()).toBe(sim.stateHash());
  });

  it('2000 ticks from one seed with an upgrade started give identical hashes', () => {
    const hash = (): number => {
      const sim = airport();
      run(sim, { type: 'startStandUpgrade', id: sim.airfield.data.stands[1].id, upgrade: 'hydrantPit' });
      run(sim, { type: 'setTestTraffic', perHour: 20, turnScale: 0.1 });
      for (let t = 0; t < 2000; t++) sim.step();
      return sim.stateHash();
    };
    expect(hash()).toBe(hash());
  }, 120000);
});
