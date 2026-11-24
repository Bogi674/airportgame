import { TENANTS } from '@data/index';
import { TENANT_CATEGORY_KEYS } from '@data/schemas/tenants';
import { fixtureKey, isShopFixture, type LedgerCategory, type TerminalGrid } from '@shared/business';
import {
  TENANT_CATEGORY_COUNT,
  brandCategory,
  brandId,
  brandIndex,
  furnishUnit,
  unitArea,
  unitFront,
  unitHas,
  unitProblem,
  unitStillFits,
  type Brand,
  type TenantUnit,
  type TenantUnitView,
  type TenantsPayload,
} from '@shared/tenants';
import { foldU32 } from '../hash';
import type { Rng } from '../rng';

export interface TenantsHost {
  getCash(): number;
  book(category: LedgerCategory, amount: number): void;
  emit(code: string): void;
  /** Units came, went or changed tenant: visit points must be rebuilt and the grids redrawn. */
  unitsChanged(): void;
}

export interface TenantsSave {
  units: TenantUnit[];
  nextId: number;
  paxYear: number;
  rng: number;
}

/**
 * Tenant units, generated brands and their applications (T32, docs/DESIGN_REVISION_4.md 7.1 and 7.2, D29 to D31).
 * Brands are rebuilt from forks of the seed by category and pool index, so only the units and their brand ids are saved.
 */
export class Tenants {
  units: TenantUnit[] = [];
  private nextId = 1;
  /** Passengers of the trailing year, a running sum that forgets 1/365 a day. Drives the brand pool (D30). */
  paxYear = 0;
  /** Picks applicants. Saved. */
  private readonly rng: Rng;
  /** The seed stream brands fork from. Never advanced. */
  private readonly seed: Rng;
  private readonly brands = new Map<number, Brand>();
  /** Bumped on every change a viewer would see. */
  version = 0;

  constructor(rng: Rng, private readonly host: TenantsHost) {
    this.seed = rng;
    this.rng = rng.fork('tenants');
  }

  /** The brand with this id, generated from the seed on first use. Names stay unique inside a category. */
  brand(id: number): Brand {
    const hit = this.brands.get(id);
    if (hit) return hit;
    const category = brandCategory(id);
    const k = brandIndex(id);
    const key = TENANT_CATEGORY_KEYS[category]!;
    const spec = TENANTS.categories[key];
    const taken = new Set<string>();
    for (let j = 0; j < k; j++) taken.add(this.brand(brandId(category, j)).name);
    const r = this.seed.fork(`brand|${key}|${k}`);
    let name = '';
    for (let tries = 0; tries < 8 && (name === '' || taken.has(name)); tries++) {
      name = `${TENANTS.adjectives[r.int(0, TENANTS.adjectives.length - 1)]} ${spec.nouns[r.int(0, spec.nouns.length - 1)]}`;
    }
    if (taken.has(name)) name = `${name} ${k + 1}`;
    const b: Brand = { id, name, category, color: TENANTS.colors[r.int(0, TENANTS.colors.length - 1)]!, template: r.int(0, spec.templates.length - 1) };
    this.brands.set(id, b);
    return b;
  }

  /** Brands the pool of every category holds today: the base plus one per passengers per brand of the trailing year. */
  poolSize(): number {
    return TENANTS.poolBase + Math.floor(this.paxYear / TENANTS.poolPaxPerBrand);
  }

  private find(id: number): TenantUnit | undefined {
    return this.units.find((u) => u.id === id);
  }

  /** Zones a unit on a grid. Returns a problem code or null. Zoning is free; the tenant pays its own fit out. */
  zone(g: TerminalGrid, x: number, y: number, w: number, h: number, category: number): string | null {
    const p = unitProblem(g, x, y, w, h, category, this.units);
    if (p) return p;
    this.units.push({ id: this.nextId++, building: g.id, x, y, w, h, category, brand: -1, applications: [], salesToday: 0, salesYesterday: 0 });
    this.changed();
    return null;
  }

  /** Removes a unit and ends its lease. */
  remove(id: number): string | null {
    const i = this.units.findIndex((u) => u.id === id);
    if (i < 0) return 'nothingThere';
    this.units.splice(i, 1);
    this.changed();
    return null;
  }

  /** Accepts a pending application: the brand moves in and the other applications lapse. */
  accept(unitId: number, brand: number): string | null {
    const u = this.find(unitId);
    if (!u || !u.applications.includes(brand)) return 'noApplication';
    if (u.brand >= 0) return 'unitLeased';
    if (this.leasedBy(brand)) return 'brandTaken';
    u.brand = brand;
    u.applications.length = 0;
    // The brand cannot open twice, so its other applications lapse too.
    for (const o of this.units) {
      const j = o.applications.indexOf(brand);
      if (j >= 0) o.applications.splice(j, 1);
    }
    this.host.emit(`tenantOpened|name=${this.brand(brand).name}`);
    this.changed();
    return null;
  }

  decline(unitId: number, brand: number): string | null {
    const u = this.find(unitId);
    const j = u ? u.applications.indexOf(brand) : -1;
    if (!u || j < 0) return 'noApplication';
    u.applications.splice(j, 1);
    this.changed();
    return null;
  }

  /** A one off advertising campaign: pays the cost and brings one application for a vacant unit of the category. */
  campaign(category: number): string | null {
    if (category < 0 || category >= TENANT_CATEGORY_COUNT) return 'badUnit';
    if (!this.vacantOf(category)) return 'noVacantUnit';
    const cost = TENANTS.campaignCost;
    if (cost > this.host.getCash()) return `insufficientFunds|cost=${cost}`;
    if (!this.apply(category)) return 'noApplicant';
    this.host.book('advertising', -cost);
    return null;
  }

  private leasedBy(brand: number): boolean {
    return this.units.some((u) => u.brand === brand);
  }

  /** The vacant unit of a category with the fewest pending applications, lowest id first. */
  private vacantOf(category: number): TenantUnit | null {
    let best: TenantUnit | null = null;
    for (const u of this.units) {
      if (u.category !== category || u.brand >= 0) continue;
      if (!best || u.applications.length < best.applications.length) best = u;
    }
    return best;
  }

  /** One application for the category from a pool brand that is not open anywhere nor pending on the unit. */
  private apply(category: number): boolean {
    const u = this.vacantOf(category);
    if (!u) return false;
    const pool = this.poolSize();
    const free: number[] = [];
    for (let k = 0; k < pool; k++) {
      const id = brandId(category, k);
      if (!this.leasedBy(id) && !u.applications.includes(id)) free.push(id);
    }
    if (free.length === 0) return false;
    u.applications.push(free[this.rng.int(0, free.length - 1)]!);
    if (u.applications.length > TENANTS.maxApplications) u.applications.shift();
    this.host.emit(`tenantApplied|name=${this.brand(u.applications[u.applications.length - 1]!).name}`);
    this.changed();
    return true;
  }

  /** Closes a day: books the rent of leased units (per m2) plus the sales share (D31) and rolls the yearly passengers. */
  chargeDaily(paxToday: number): void {
    let income = 0;
    for (const u of this.units) {
      if (u.brand >= 0) income += unitArea(u) * TENANTS.rentPerM2Day + u.salesToday * TENANTS.salesShare;
      u.salesYesterday = u.salesToday;
      u.salesToday = 0;
    }
    if (income !== 0) this.host.book('rent', Math.round(income));
    this.paxYear += paxToday - this.paxYear / 365;
    this.version++;
  }

  /** Opens a day: every application period, one application per category that has a vacant unit (D30). */
  newDay(day: number): void {
    if (day % TENANTS.applicationDays === 0) for (let c = 0; c < TENANT_CATEGORY_COUNT; c++) this.apply(c);
  }

  /** A visit to the unit under logical cell (x, y) of building `building` spent `amount`. */
  sale(building: number, x: number, y: number, amount: number): void {
    for (const u of this.units) {
      if (u.building === building && u.brand >= 0 && unitHas(u, x, y)) {
        u.salesToday += amount;
        return;
      }
    }
  }

  leasedCount(): number {
    let n = 0;
    for (const u of this.units) if (u.brand >= 0) n++;
    return n;
  }

  leasedIn(building: number): number {
    let n = 0;
    for (const u of this.units) if (u.building === building && u.brand >= 0) n++;
    return n;
  }

  /** Drops the units of a building that an edit broke (floor gone or a fixture placed on them), or all of them. */
  prune(grids: readonly TerminalGrid[]): void {
    const keep = this.units.filter((u) => {
      const g = grids.find((q) => q.id === u.building);
      return g !== undefined && unitStillFits(g, u);
    });
    if (keep.length === this.units.length) return;
    for (const u of this.units) if (!keep.includes(u)) this.host.emit(`unitRemoved|name=${u.brand >= 0 ? this.brand(u.brand).name : ''}`);
    this.units = keep;
    this.changed();
  }

  /**
   * Turns the shop fixtures of a save from before version 39 into units over their cells, each with a generated tenant
   * (D31). Duty free becomes the legacy category. Returns the number of units made.
   */
  convertLegacyShops(grids: readonly TerminalGrid[]): number {
    let n = 0;
    for (const g of grids) {
      for (let i = 0; i < g.fixture.length; i++) {
        const f = g.fixture[i]!;
        if (!isShopFixture(f)) continue;
        const key = fixtureKey(f);
        const name = key === 'dutyFree' ? TENANTS.legacyCategory.dutyFree : key;
        const category = TENANT_CATEGORY_KEYS.indexOf(name as (typeof TENANT_CATEGORY_KEYS)[number]);
        g.fixture[i] = 0;
        g.fixtureRot[i] = 0;
        g.fixtureOff[i] = 0;
        g.fixtureLevel[i] = 0;
        g.fixtureMode[i] = 0;
        g.leased[i] = 0;
        const x = g.x0 + (i % g.w);
        const y = g.y0 + Math.floor(i / g.w);
        const u: TenantUnit = { id: this.nextId++, building: g.id, x, y, w: 1, h: 1, category, brand: -1, applications: [], salesToday: 0, salesYesterday: 0 };
        const pool = this.poolSize();
        for (let k = 0; k < pool * 4 && u.brand < 0; k++) {
          const id = brandId(category, k);
          if (!this.leasedBy(id)) u.brand = id;
        }
        this.units.push(u);
        n++;
      }
    }
    if (n > 0) this.changed();
    return n;
  }

  private changed(): void {
    this.version++;
    this.host.unitsChanged();
  }

  view(u: TenantUnit): TenantUnitView {
    return { ...u, applications: u.applications.slice(), tenant: u.brand >= 0 ? this.brand(u.brand) : null, applicants: u.applications.map((b) => this.brand(b)) };
  }

  payload(): TenantsPayload {
    const pool = this.poolSize();
    return { units: this.units.map((u) => this.view(u)), pool: TENANT_CATEGORY_KEYS.map(() => pool), paxYear: Math.round(this.paxYear) };
  }

  /** Draw data of the units of one grid: outline, furnishing in the brand color and the sign. */
  drawList(g: TerminalGrid): TenantUnitView[] {
    return this.units.filter((u) => u.building === g.id).map((u) => {
      const v = this.view(u);
      v.furnish = v.tenant ? furnishUnit(u, unitFront(g, u), v.tenant.template) : [];
      return v;
    });
  }

  saveState(): TenantsSave {
    return { units: this.units.map((u) => ({ ...u, applications: u.applications.slice() })), nextId: this.nextId, paxYear: this.paxYear, rng: this.rng.getState() };
  }

  loadState(s: TenantsSave | undefined): void {
    this.units = (s?.units ?? []).map((u) => ({ ...u, applications: u.applications.slice() }));
    this.nextId = s?.nextId ?? 1;
    this.paxYear = s?.paxYear ?? 0;
    if (s) this.rng.setState(s.rng);
    this.version++;
  }

  hash(h: number): number {
    let acc = foldU32(h, this.units.length);
    acc = foldU32(acc, Math.floor(this.paxYear));
    acc = foldU32(acc, this.rng.getState());
    for (const u of this.units) {
      acc = foldU32(foldU32(foldU32(foldU32(acc, u.id), u.x + 65536), u.y + 65536), u.w * 256 + u.h);
      acc = foldU32(foldU32(foldU32(acc, u.category), u.brand + 1), Math.floor(u.salesToday));
      for (const b of u.applications) acc = foldU32(acc, b);
    }
    return acc;
  }
}
