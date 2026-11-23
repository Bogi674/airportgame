import { describe, expect, it } from "vitest";
import { AIRCRAFT } from "@data/aircraft";
import { PROFILES, TENANTS } from "@data/index";
import { NEED_COUNT } from "@data/schemas/needs";
import { TENANT_CATEGORY_KEYS } from "@data/schemas/tenants";
import {
  FIXTURE_KEYS,
  LEDGER_CATEGORIES,
  TICKS_PER_DAY,
} from "@shared/business";
import { brandCategory, brandId, furnishUnit, unitArea } from "@shared/tenants";
import { Stage } from "@sim/cohorts/cohorts";
import { Rng } from "@sim/rng";
import { Tenants, type TenantsHost } from "@sim/market/tenants";
import { Sim } from "@sim/sim";
import {
  buildTestAirport,
  buildTestTerminal,
  leaseUnit,
  OPTIONS,
  ownedSim,
  run,
} from "./helpers";

const CAT = (k: (typeof TENANT_CATEGORY_KEYS)[number]): number =>
  TENANT_CATEGORY_KEYS.indexOf(k);
const WIDE = AIRCRAFT.findIndex((a) => a.id === "a320neo");
const M = PROFILES.maxGroup;
const HUNGER = 0;

function terminalSim(seed?: string): Sim {
  const sim = ownedSim(seed);
  sim.cash = 100_000_000;
  buildTestAirport(sim);
  expect(
    buildTestTerminal(sim, {
      checkIn: 4,
      security: 2,
      gateDesk: 2,
      seating: 0,
      toilet: 0,
    }),
  ).toEqual([]);
  return sim;
}

const zone = (
  sim: Sim,
  x: number,
  y: number,
  w: number,
  h: number,
  category: number,
): string[] =>
  run(sim, {
    type: "zoneUnit",
    building: sim.business.grids[0]!.id,
    x,
    y,
    w,
    h,
    category,
  }).filter((e) => !e.startsWith("tenant"));

/** A tenants store with a host that records bookings. */
function bare(seed = 7): {
  t: Tenants;
  booked: Record<string, number>;
  cash: { v: number };
} {
  const booked: Record<string, number> = {};
  const cash = { v: 1_000_000 };
  const host: TenantsHost = {
    getCash: () => cash.v,
    book: (c, a) => {
      booked[c] = (booked[c] ?? 0) + a;
      cash.v += a;
    },
    emit: () => undefined,
    unitsChanged: () => undefined,
  };
  return { t: new Tenants(new Rng(seed), host), booked, cash };
}

describe("tenant data", () => {
  it("holds the D29 sizes and the D30 and D31 values", () => {
    expect([
      TENANTS.categories.convenience.minM2,
      TENANTS.categories.convenience.maxM2,
    ]).toEqual([12, 60]);
    expect([
      TENANTS.categories.quickFood.minM2,
      TENANTS.categories.quickFood.maxM2,
    ]).toEqual([40, 300]);
    expect([
      TENANTS.categories.bar.minM2,
      TENANTS.categories.bar.maxM2,
    ]).toEqual([40, 200]);
    expect(TENANTS.rentPerM2Day).toBe(1.2);
    expect(TENANTS.salesShare).toBe(0.12);
    expect(TENANTS.applicationDays).toBe(10);
    expect(TENANTS.campaignCost).toBe(20000);
    expect(TENANTS.poolPaxPerBrand).toBe(100000);
  });

  it("appends the bar as the last fixture key and the advertising ledger category", () => {
    expect(FIXTURE_KEYS[FIXTURE_KEYS.length - 1]).toBe("bar");
    expect(LEDGER_CATEGORIES.indexOf("advertising")).toBe(11);
  });
});

describe("brands", () => {
  it("are the same for one seed and differ between seeds", () => {
    const names = (seed: number): string[] => {
      const { t } = bare(seed);
      return TENANT_CATEGORY_KEYS.flatMap((_, c) =>
        [0, 1, 2].map((k) => t.brand(brandId(c, k)).name),
      );
    };
    expect(names(11)).toEqual(names(11));
    expect(names(11)).not.toEqual(names(12));
  });

  it("keep names unique inside a category and carry their category", () => {
    const { t } = bare(3);
    for (let c = 0; c < TENANT_CATEGORY_KEYS.length; c++) {
      const list = Array.from({ length: 12 }, (_, k) => t.brand(brandId(c, k)));
      expect(new Set(list.map((b) => b.name)).size).toBe(12);
      for (const b of list) expect(brandCategory(b.id)).toBe(c);
    }
  });
});

describe("zoning a unit", () => {
  it("checks the category size, the floor, the zone, fixtures and other units", () => {
    const sim = terminalSim();
    // 2 cells of 4 m2 are below the 12 m2 of a convenience unit, 16 cells above its 60 m2.
    expect(zone(sim, 86, 46, 2, 1, CAT("convenience"))).toEqual([
      "unitTooSmall|min=12",
    ]);
    expect(zone(sim, 84, 46, 8, 2, CAT("convenience"))).toEqual([
      "unitTooLarge|max=60",
    ]);
    // The gate desks stand on row 42 from column 76.
    expect(zone(sim, 76, 42, 3, 1, CAT("convenience"))).toEqual([
      "unitBlocked",
    ]);
    // The public hall is no passenger shop zone until a commercial area is painted.
    expect(zone(sim, 50, 48, 3, 1, CAT("convenience"))).toEqual(["unitZone"]);
    expect(zone(sim, 86, 46, 3, 1, CAT("convenience"))).toEqual([]);
    expect(zone(sim, 87, 46, 3, 2, CAT("convenience"))).toEqual([
      "unitOverlap",
    ]);
    expect(sim.business.tenants.units).toHaveLength(1);
  });

  it("loses a unit when its floor is erased", () => {
    const sim = terminalSim();
    expect(zone(sim, 86, 46, 3, 1, CAT("convenience"))).toEqual([]);
    const g = sim.business.grids[0]!;
    run(sim, {
      type: "terminalBuild",
      building: g.id,
      ox: g.ox,
      oy: g.oy,
      headingDeg: g.headingDeg,
      edit: { op: "erase", x0: 87, y0: 46, x1: 88, y1: 47, variant: 0 },
    });
    expect(sim.business.tenants.units).toHaveLength(0);
  });

  it("refuses shop fixtures from the fixture tool", () => {
    const sim = terminalSim();
    const g = sim.business.grids[0]!;
    const cafe = FIXTURE_KEYS.indexOf("cafe") + 1;
    expect(
      run(sim, {
        type: "terminalBuild",
        building: g.id,
        ox: g.ox,
        oy: g.oy,
        headingDeg: g.headingDeg,
        edit: { op: "fixture", x0: 86, y0: 46, x1: 87, y1: 47, variant: cafe },
      }),
    ).toEqual(["useUnitTool"]);
  });
});

describe("applications", () => {
  it("arrive every application period for a vacant unit, at most three pending", () => {
    const { t } = bare();
    t.units.push({
      id: 1,
      building: 1,
      x: 0,
      y: 0,
      w: 3,
      h: 1,
      category: CAT("cafe"),
      brand: -1,
      applications: [],
      salesToday: 0,
      salesYesterday: 0,
    });
    for (let d = 1; d < TENANTS.applicationDays; d++) t.newDay(d);
    expect(t.units[0]!.applications).toHaveLength(0);
    t.newDay(TENANTS.applicationDays);
    expect(t.units[0]!.applications).toHaveLength(1);
    for (let k = 2; k <= 5; k++) t.newDay(k * TENANTS.applicationDays);
    expect(t.units[0]!.applications).toHaveLength(TENANTS.maxApplications);
    expect(new Set(t.units[0]!.applications).size).toBe(
      TENANTS.maxApplications,
    );
  });

  it("accept moves the brand in and declines drop the application", () => {
    const { t } = bare();
    t.units.push({
      id: 1,
      building: 1,
      x: 0,
      y: 0,
      w: 3,
      h: 1,
      category: CAT("cafe"),
      brand: -1,
      applications: [],
      salesToday: 0,
      salesYesterday: 0,
    });
    expect(t.campaign(CAT("cafe"))).toBeNull();
    expect(t.campaign(CAT("cafe"))).toBeNull();
    const [a, b] = t.units[0]!.applications;
    expect(t.decline(1, a!)).toBeNull();
    expect(t.units[0]!.applications).toEqual([b]);
    expect(t.accept(1, a!)).toBe("noApplication");
    expect(t.accept(1, b!)).toBeNull();
    expect(t.units[0]!.brand).toBe(b);
    expect(t.units[0]!.applications).toEqual([]);
    expect(t.leasedCount()).toBe(1);
  });

  it("a campaign costs 20 000 on the advertising line and needs a vacant unit", () => {
    const { t, booked } = bare();
    expect(t.campaign(CAT("bar"))).toBe("noVacantUnit");
    t.units.push({
      id: 1,
      building: 1,
      x: 0,
      y: 0,
      w: 5,
      h: 2,
      category: CAT("bar"),
      brand: -1,
      applications: [],
      salesToday: 0,
      salesYesterday: 0,
    });
    expect(t.campaign(CAT("bar"))).toBeNull();
    expect(booked.advertising).toBe(-20000);
  });

  it("the pool grows by one brand per 100 000 passengers of the trailing year", () => {
    const { t } = bare();
    expect(t.poolSize()).toBe(TENANTS.poolBase);
    t.paxYear = 250_000;
    expect(t.poolSize()).toBe(TENANTS.poolBase + 2);
  });
});

describe("rent and sales", () => {
  it("a leased unit books rent per m2 plus the sales share at the daily close", () => {
    const { t, booked } = bare();
    t.units.push({
      id: 1,
      building: 1,
      x: 0,
      y: 0,
      w: 5,
      h: 2,
      category: CAT("quickFood"),
      brand: brandId(CAT("quickFood"), 0),
      applications: [],
      salesToday: 0,
      salesYesterday: 0,
    });
    t.units.push({
      id: 2,
      building: 1,
      x: 0,
      y: 4,
      w: 5,
      h: 1,
      category: CAT("cafe"),
      brand: -1,
      applications: [],
      salesToday: 0,
      salesYesterday: 0,
    });
    t.sale(1, 2, 1, 500);
    t.sale(1, 2, 4, 900);
    t.chargeDaily(0);
    expect(booked.rent).toBe(
      Math.round(unitArea({ w: 5, h: 2 }) * 1.2 + 500 * 0.12),
    );
    expect(t.units[0]!.salesYesterday).toBe(500);
    expect(t.units[0]!.salesToday).toBe(0);
  });

  it("a hungry passenger visiting a leased unit adds its spend to the unit sales", () => {
    const sim = terminalSim();
    expect(leaseUnit(sim, 86, 46, 5, 2, "quickFood")).toEqual([]);
    const unit = sim.business.tenants.units[0]!;
    expect(
      sim.traffic.scheduleArrival(
        WIDE,
        sim.traffic.nowTick + 4100,
        0,
        6000,
        -1,
      ),
    ).toBeGreaterThanOrEqual(0);
    const co = sim.cohorts;
    let c = -1;
    for (let t = 0; t < 6000 && c < 0; t++) {
      sim.step();
      for (let i = 0; i < co.hi; i++)
        if (co.stage[i] === Stage.Airside && co.size[i]! >= 1) c = i;
    }
    expect(c).toBeGreaterThanOrEqual(0);
    for (let m = 0; m < co.size[c]!; m++)
      co.memberNeed[(c * M + m) * NEED_COUNT + HUNGER] = 5000;
    for (let t = 0; t < 6000 && unit.salesToday === 0; t++) sim.step();
    expect(unit.salesToday).toBeGreaterThan(0);
  });
});

describe("furnishing", () => {
  it("keeps every item inside its unit for every template and storefront side", () => {
    for (let c = 0; c < TENANT_CATEGORY_KEYS.length; c++) {
      const spec = TENANTS.categories[TENANT_CATEGORY_KEYS[c]!];
      for (let tpl = 0; tpl < spec.templates.length; tpl++) {
        for (const front of [0, 1, 2, 3] as const) {
          for (const [w, h] of [
            [6, 4],
            [1, 1],
            [3, 1],
            [1, 3],
            [5, 2],
            [10, 7],
          ] as const) {
            const u = {
              id: 1,
              building: 1,
              x: 10,
              y: 20,
              w,
              h,
              category: c,
              brand: 0,
              applications: [],
              salesToday: 0,
              salesYesterday: 0,
            };
            const items = furnishUnit(u, front, tpl);
            expect(items.some((i) => i.kind === "sign")).toBe(true);
            if (w === 6) expect(items.length).toBeGreaterThan(1);
            for (const i of items) {
              expect(i.x0).toBeGreaterThanOrEqual(20 - 1e-9);
              expect(i.y0).toBeGreaterThanOrEqual(40 - 1e-9);
              expect(i.x1).toBeLessThanOrEqual(20 + w * 2 + 1e-9);
              expect(i.y1).toBeLessThanOrEqual(40 + h * 2 + 1e-9);
            }
            // No item overlaps another, the sign included.
            const solid = items;
            for (let a = 0; a < solid.length; a++) {
              for (let b = a + 1; b < solid.length; b++) {
                const p = solid[a]!;
                const q = solid[b]!;
                expect(
                  p.x0 < q.x1 - 1e-9 &&
                    q.x0 < p.x1 - 1e-9 &&
                    p.y0 < q.y1 - 1e-9 &&
                    q.y0 < p.y1 - 1e-9,
                ).toBe(false);
              }
            }
          }
        }
      }
    }
  });
});

describe("saves and determinism", () => {
  it("a version 38 save turns shop fixtures into leased units", () => {
    const a = terminalSim();
    const g = a.business.grids[0]!;
    const i = (46 - g.y0) * g.w + (88 - g.x0);
    const j = (46 - g.y0) * g.w + (90 - g.x0);
    g.fixture[i] = FIXTURE_KEYS.indexOf("dutyFree") + 1;
    g.fixture[j] = FIXTURE_KEYS.indexOf("cafe") + 1;
    const data = JSON.parse(JSON.stringify(a.serialize())) as {
      version: number;
      business: { tenants?: unknown };
    };
    data.version = 38;
    delete data.business.tenants;
    const b = new Sim("GOLDEN-0001", OPTIONS);
    b.restore(data);
    const h = b.business.grids[0]!;
    expect(h.fixture[i]).toBe(0);
    expect(h.fixture[j]).toBe(0);
    const units = b.business.tenants.units;
    expect(units.map((u) => [u.x, u.y, u.category])).toEqual([
      [88, 46, CAT("convenience")],
      [90, 46, CAT("cafe")],
    ]);
    expect(units.every((u) => u.brand >= 0)).toBe(true);
    const ev: string[] = [];
    b.step();
    b.drainEvents(ev);
    expect(b.cohorts.visitTable(0)!.count).toBeGreaterThanOrEqual(2);
    expect(ev).toContain("shopsConverted|n=2");
  });

  it("a save mid run restores units and applications to the same hash", () => {
    const a = terminalSim();
    expect(leaseUnit(a, 86, 46, 5, 2, "quickFood")).toEqual([]);
    expect(zone(a, 86, 49, 5, 1, CAT("cafe"))).toEqual([]);
    run(a, { type: "adCampaign", category: CAT("cafe") });
    a.enqueue({ type: "setTestTraffic", perHour: 30, turnScale: 0.1 });
    for (let t = 0; t < 1000; t++) a.step();
    const b = new Sim(a.seed, OPTIONS);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 1000; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.business.tenants.units).toEqual(a.business.tenants.units);
  });

  it("two runs from one seed give identical hashes over 2000 ticks", () => {
    const make = (): number => {
      const s = terminalSim();
      expect(leaseUnit(s, 86, 46, 5, 2, "quickFood")).toEqual([]);
      expect(zone(s, 86, 49, 5, 1, CAT("cafe"))).toEqual([]);
      s.enqueue({ type: "setTestTraffic", perHour: 60, turnScale: 0.1 });
      for (let t = 0; t < 2000; t++) s.step();
      return s.stateHash();
    };
    expect(make()).toBe(make());
  });

  it("a day of traffic books tenant income on the rent line", () => {
    const s = terminalSim();
    expect(leaseUnit(s, 86, 46, 5, 2, "quickFood")).toEqual([]);
    for (let t = 0; t < TICKS_PER_DAY + 10; t++) s.step();
    const days = s.business.payload(s.traffic.nowTick).history;
    expect(
      days[days.length - 1]![LEDGER_CATEGORIES.indexOf("rent")],
    ).toBeGreaterThanOrEqual(
      Math.round(unitArea({ w: 5, h: 2 }) * TENANTS.rentPerM2Day),
    );
  });
});
