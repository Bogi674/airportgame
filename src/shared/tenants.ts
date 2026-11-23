import { TENANTS } from '@data/index';
import { TENANT_CATEGORY_KEYS, type FurnishKind, type TenantCategory } from '@data/schemas/tenants';
import { FIXTURE_KEYS, TERMINAL_CELL_M, ZONE, type TerminalGrid } from './business';
import { cellsOfRect, propRect } from './props';
import { canStep } from './terminalRooms';
import { cellIndex } from './terminalOps';

/** A rectangle of terminal floor zoned for one tenant category (T32). Cells are logical cells of its building's grid. */
export interface TenantUnit {
  id: number;
  building: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Index into TENANT_CATEGORY_KEYS. */
  category: number;
  /** Brand id of the tenant, -1 while the unit is vacant. */
  brand: number;
  /** Brand ids of the pending applications, oldest first. */
  applications: number[];
  /** Visitor spend counted today and on the last closed day. */
  salesToday: number;
  salesYesterday: number;
}

/** A generated brand. Rebuilt from the seed, never saved. */
export interface Brand {
  id: number;
  name: string;
  category: number;
  color: string;
  /** Index into the category's furnishing templates. */
  template: number;
}

/** A unit as the UI and the renderer see it: the record plus its tenant and applicants resolved. */
export interface TenantUnitView extends TenantUnit {
  tenant: Brand | null;
  applicants: Brand[];
  /** Furnishing and sign, set only on the copies sent to the renderer. */
  furnish?: FurnishItem[];
}

/** The tenants part of the business payload. */
export interface TenantsPayload {
  units: TenantUnitView[];
  /** Brands per category the pool holds today. */
  pool: number[];
}

export const TENANT_CATEGORY_COUNT = TENANT_CATEGORY_KEYS.length;
export const CELL_M2 = TERMINAL_CELL_M * TERMINAL_CELL_M;

/** Brand ids encode the category and the brand's index in its pool. */
export const brandId = (category: number, k: number): number => k * TENANT_CATEGORY_COUNT + category;
export const brandCategory = (id: number): number => id % TENANT_CATEGORY_COUNT;
export const brandIndex = (id: number): number => Math.floor(id / TENANT_CATEGORY_COUNT);

/** Fixture id that visit points of a category carry, so the needs and favourite shops match them like fixtures. */
export const categoryVisitKind = (category: number): number => FIXTURE_KEYS.indexOf(TENANT_CATEGORY_KEYS[category] as TenantCategory) + 1;

export const unitArea = (u: { w: number; h: number }): number => u.w * u.h * CELL_M2;

/** Zones a unit may sit in, the same as the shop fixtures it replaces. */
const UNIT_ZONES: readonly number[] = [ZONE.Commercial, ZONE.Secure, ZONE.International];

/** True when logical cell (x, y) lies in the unit. */
export const unitHas = (u: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean =>
  x >= u.x && y >= u.y && x < u.x + u.w && y < u.y + u.h;

/**
 * The problem with zoning a unit of `category` over the rectangle, or null when it is fine. Checks the size against
 * D29, then that every cell has floor in a passenger zone with no fixture, prop or other unit on it.
 */
export function unitProblem(g: TerminalGrid, x: number, y: number, w: number, h: number, category: number, others: readonly TenantUnit[]): string | null {
  const key = TENANT_CATEGORY_KEYS[category];
  if (!key || w < 1 || h < 1) return 'badUnit';
  const spec = TENANTS.categories[key];
  const m2 = w * h * CELL_M2;
  if (m2 < spec.minM2) return `unitTooSmall|min=${spec.minM2}`;
  if (m2 > spec.maxM2) return `unitTooLarge|max=${spec.maxM2}`;
  for (let cy = y; cy < y + h; cy++) {
    for (let cx = x; cx < x + w; cx++) {
      const i = cellIndex(g, cx, cy);
      if (i < 0 || g.floor[i]! === 0) return 'unitNeedsFloor';
      if (!UNIT_ZONES.includes(g.zone[i]!)) return 'unitZone';
      if (g.fixture[i]! !== 0) return 'unitBlocked';
    }
  }
  for (const p of g.props) {
    const r = propRect(p);
    if (!r) continue;
    const c = cellsOfRect(r);
    if (c.x0 < x + w && c.x1 >= x && c.y0 < y + h && c.y1 >= y) return 'unitBlocked';
  }
  for (const o of others) {
    if (o.building === g.id && o.x < x + w && o.x + o.w > x && o.y < y + h && o.y + o.h > y) return 'unitOverlap';
  }
  return null;
}

/** True when a unit still fits its grid after an edit: floor under every cell and no fixture on any. Size and zone stay as zoned. */
export function unitStillFits(g: TerminalGrid, u: TenantUnit): boolean {
  for (let cy = u.y; cy < u.y + u.h; cy++) {
    for (let cx = u.x; cx < u.x + u.w; cx++) {
      const i = cellIndex(g, cx, cy);
      if (i < 0 || g.floor[i]! === 0 || g.fixture[i]! !== 0) return false;
    }
  }
  return true;
}

/** Logical cell people visit a unit at: its center cell. */
export function unitAnchor(u: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: u.x + Math.floor((u.w - 1) / 2), y: u.y + Math.floor((u.h - 1) / 2) };
}

/** Sides of a unit, as the canStep directions: 0 left, 1 right, 2 up, 3 down. */
type Side = 0 | 1 | 2 | 3;

/**
 * The storefront side of a unit: the side with the most open steps from its cells to floor outside the unit. Ties go
 * to down, up, left, right in that order.
 */
export function unitFront(g: TerminalGrid, u: TenantUnit): Side {
  const open = [0, 0, 0, 0];
  for (let cy = u.y; cy < u.y + u.h; cy++) {
    for (let cx = u.x; cx < u.x + u.w; cx++) {
      const ax = cx - g.x0;
      const ay = cy - g.y0;
      if (cx === u.x && canStep(g, ax, ay, 0)) open[0]++;
      if (cx === u.x + u.w - 1 && canStep(g, ax, ay, 1)) open[1]++;
      if (cy === u.y && canStep(g, ax, ay, 2)) open[2]++;
      if (cy === u.y + u.h - 1 && canStep(g, ax, ay, 3)) open[3]++;
    }
  }
  let best: Side = 3;
  for (const s of [2, 0, 1] as const) if (open[s]! > open[best]!) best = s;
  return best;
}

/** One furnishing item or the sign, as a rectangle in logical grid meters. */
export interface FurnishItem {
  kind: FurnishKind | 'sign';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Lays out the furnishing template of a brand inside its unit (T32). The layout works in a local frame where `a` runs
 * along the storefront and `b` is the depth from the back wall (0) to the storefront: wall items stand on the back,
 * side or front band, rows run parallel to the front and grids fill the floor between, keeping an aisle at the front.
 * Items that do not fit are left out, so small units hold fewer.
 */
export function furnishUnit(u: TenantUnit, front: Side, template: number): FurnishItem[] {
  const key = TENANT_CATEGORY_KEYS[u.category];
  if (!key) return [];
  const spec = TENANTS.categories[key];
  const rules = spec.templates[template % spec.templates.length]!;
  const P = TENANTS.paint;
  const across = front === 0 || front === 1;
  const L = (across ? u.h : u.w) * TERMINAL_CELL_M;
  const D = (across ? u.w : u.h) * TERMINAL_CELL_M;
  const m = P.marginM;
  const aisle = P.aisleM;
  const local: FurnishItem[] = [];
  const add = (kind: FurnishKind | 'sign', a0: number, b0: number, a1: number, b1: number): void => {
    if (a1 - a0 > 0.05 && b1 - b0 > 0.05) local.push({ kind, x0: a0, y0: b0, x1: a1, y1: b1 });
  };
  let back = 0;
  let side = 0;
  for (const r of rules) {
    if (r.at === 'back') back = Math.max(back, r.depthM);
    if (r.at === 'sides') side = Math.max(side, r.depthM);
  }
  const innerA0 = (side > 0 ? side + m : 0) + m;
  const innerA1 = L - innerA0;
  const innerB0 = (back > 0 ? back + aisle : m) + m;
  const innerB1 = D - aisle;
  for (const r of rules) {
    if (r.at === 'back') add(r.kind, m, m, L - m, m + r.depthM);
    else if (r.at === 'sides') {
      const b0 = back > 0 ? m + back + m : m;
      add(r.kind, m, b0, m + r.depthM, D - aisle);
      add(r.kind, L - m - r.depthM, b0, L - m, D - aisle);
    } else if (r.at === 'front') add(r.kind, innerA0, D - m - r.depthM, innerA0 + Math.min(P.frontCounterMaxM, (L - 2 * innerA0) / 2), D - m);
    else if (r.at === 'rows') {
      for (let b = innerB0; b + r.depthM <= innerB1; b += r.depthM + r.gapM) add(r.kind, innerA0 + aisle / 2, b, innerA1 - aisle / 2, b + r.depthM);
    } else if (r.at === 'grid') {
      const pitch = r.sizeM + r.gapM;
      const cols = Math.floor((innerA1 - innerA0 + r.gapM) / pitch);
      const rows = Math.floor((innerB1 - innerB0 + r.gapM) / pitch);
      const a0 = innerA0 + (innerA1 - innerA0 - (cols * pitch - r.gapM)) / 2;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) add(r.kind, a0 + i * pitch, innerB0 + j * pitch, a0 + i * pitch + r.sizeM, innerB0 + j * pitch + r.sizeM);
    }
  }
  add('sign', 0, D - P.signDepthM, L, D);
  // Local (a, b) to logical meters: the front is the side `front`, the back the opposite one.
  const X0 = u.x * TERMINAL_CELL_M;
  const Y0 = u.y * TERMINAL_CELL_M;
  const W = u.w * TERMINAL_CELL_M;
  const H = u.h * TERMINAL_CELL_M;
  return local.map((it) => {
    const { x0: a0, y0: b0, x1: a1, y1: b1 } = it;
    if (front === 3) return { kind: it.kind, x0: X0 + a0, y0: Y0 + b0, x1: X0 + a1, y1: Y0 + b1 };
    if (front === 2) return { kind: it.kind, x0: X0 + W - a1, y0: Y0 + H - b1, x1: X0 + W - a0, y1: Y0 + H - b0 };
    if (front === 1) return { kind: it.kind, x0: X0 + b0, y0: Y0 + H - a1, x1: X0 + b1, y1: Y0 + H - a0 };
    return { kind: it.kind, x0: X0 + W - b1, y0: Y0 + a0, x1: X0 + W - b0, y1: Y0 + a1 };
  });
}
