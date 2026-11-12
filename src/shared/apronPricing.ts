import { SURFACE_SPEC, STAND_SIZES } from '@data/index';
import { compassVector, type Apron, type Stand, type StandSize, type StandType, type Surface, type Taxiway } from './airfield';
import { apronArea, clearOf, cutRegion, freeRegion, mergeRegion, mergeShapes, polylineBoxes, touches, type ApronShape } from './apronGeom';
import type { MultiPolygon } from './clip';
import { standBox } from './clearance';
import type { Pt } from './geom';
import { standSlot } from './standGeom';
import { tierOf, unitCost } from './surfaceRules';

/**
 * Apron and stand paving prices, shared by the sim and the build preview so the ghost shows the cash the
 * command will take. Everything here is pure geometry and money; the sim adds ids, names and items.
 */

/** Share of a removed apron piece, or demolished object, that is paid back. */
export const REFUND_SHARE = 0.25;

/** Largest apron the sim accepts after a merge, in square meters. */
export const MAX_APRON_M2 = 600000;

/** Apron and stand corners are stored on half meter points. */
export const roundApronPt = (v: number): number => Math.round(v * 2) / 2;

export const roundApronPoly = (poly: readonly Pt[]): Pt[] => poly.map((p) => ({ x: roundApronPt(p.x), y: roundApronPt(p.y) }));

/** A paved piece as the pricing sees it: its outline and its surface. */
export type ApronPiece = Pick<Apron, 'polygon' | 'holes' | 'surface'>;

/** A box to pave: a stand slot or a GA block, in the surface it is paved in. */
export interface PricedBox {
  polygon: Pt[];
  surface: Surface;
}

/** The stand heading as the sim stores it: whole degrees in [0, 360). */
export const standHeading = (headingDeg: number): number => ((Math.round(headingDeg) % 360) + 360) % 360;

/** Centres of a row of stands along its perpendicular, on half meter points. */
export function rowSlots(x: number, y: number, headingDeg: number, count: number, spacing: number): Pt[] {
  const d = compassVector(headingDeg);
  const perp = { x: -d.y, y: d.x };
  const out: Pt[] = [];
  for (let i = 0; i < count; i++) out.push({ x: roundApronPt(x + perp.x * spacing * i), y: roundApronPt(y + perp.y * spacing * i) });
  return out;
}

/** The unrounded outline of a GA block whose stand row starts at (x, y), as the sim lays it out. */
export function gaBlockPolygon(x: number, y: number, headingDeg: number, count: number): Pt[] {
  const spacing = STAND_SIZES.small.widthM;
  const d = compassVector(headingDeg);
  const perp = { x: -d.y, y: d.x };
  const w = spacing * count + 10;
  const depth = 30;
  const o = { x: x - perp.x * 5 - d.x * 8, y: y - perp.y * 5 - d.y * 8 };
  return [
    { x: o.x, y: o.y },
    { x: o.x + perp.x * w, y: o.y + perp.y * w },
    { x: o.x + perp.x * w + d.x * depth, y: o.y + perp.y * w + d.y * depth },
    { x: o.x + d.x * depth, y: o.y + d.y * depth },
  ];
}

export interface RowPricing {
  /** Stand centres, as the sim places them. */
  slots: Pt[];
  /** The GA block outline, rounded, or null for a stand row. */
  block: Pt[] | null;
  /** Stand slot boxes in their surface, in the order the sim paves them. */
  boxes: PricedBox[];
  standCost: number;
  /** The paving the boxes need beyond the apron they already sit on. */
  paving: number;
  total: number;
  /** True when the paving would make an apron larger than MAX_APRON_M2, which the sim refuses. */
  tooLarge: boolean;
}

export interface RowInput {
  x: number;
  y: number;
  headingDeg: number;
  count: number;
  spacingM: number;
  size: StandSize;
  type: StandType;
  surface: Surface;
}

/** Prices a row of stands: their build cost, and the paving of their slot boxes against the aprons. */
export function standRowPricing(aprons: readonly ApronPiece[], input: RowInput, before: PricedBox[] = []): RowPricing {
  const slots = rowSlots(input.x, input.y, input.headingDeg, input.count, input.spacingM);
  const heading = standHeading(input.headingDeg);
  const slot = standSlot(input.size);
  const boxes: PricedBox[] = [];
  if (slot) {
    for (const p of slots) {
      const stand = { x: p.x, y: p.y, headingDeg: heading };
      boxes.push({ polygon: standBox(stand, slot), surface: input.surface });
    }
  }
  const standCost = STAND_SIZES[input.size].cost[input.type] * input.count;
  const paved = paveBoxes<ApronPiece>(aprons, [...before, ...boxes], (step, sh) => ({ polygon: sh.polygon, holes: sh.holes.length > 0 ? sh.holes : undefined, surface: step.surface }));
  const paving = paved?.charge ?? 0;
  return { slots, block: null, boxes, standCost, paving, total: standCost + paving, tooLarge: paved === null };
}

/**
 * Prices a GA block: the block is paved first, then the stand slots against it, and its stands sit
 * 8 m behind the block edge as the sim places them.
 */
export function gaBlockPricing(aprons: readonly ApronPiece[], x: number, y: number, headingDeg: number, count: number, surface: Surface): RowPricing {
  const d = compassVector(headingDeg);
  const block = roundApronPoly(gaBlockPolygon(x, y, headingDeg, count));
  const row = standRowPricing(aprons, { x: x + d.x * 8, y: y + d.y * 8, headingDeg, count, spacingM: STAND_SIZES.small.widthM, size: 'small', type: 'remote', surface }, [{ polygon: block, surface }]);
  return { ...row, block };
}

/** A paving step: the aprons of one surface a box touches, and the shapes they become. */
export interface PaveStep<T> {
  surface: Surface;
  absorbed: T[];
  shapes: ApronShape[];
  after: number;
  add: number;
}

/**
 * Lays boxes one after another against the evolving apron list. A box pays only for the part no apron
 * covers, at the surface's base price. Returns the final list and the total charge, or null when a result
 * would be too large. `make` builds each new apron from its step, so the sim can give it an id.
 */
export function paveBoxes<T extends ApronPiece>(aprons: readonly T[], boxes: readonly PricedBox[], make: (step: PaveStep<T>, shape: ApronShape, k: number) => T): { aprons: T[]; charge: number } | null {
  let list: T[] = aprons.slice();
  let charge = 0;
  for (const bx of boxes) {
    // Only the part no apron covers is paved, so pavement under the box keeps its own surface.
    const free = freeRegion(bx.polygon, list);
    if (free.length === 0) continue;
    const absorbed = list.filter((a) => a.surface === bx.surface && touches(a, { polygon: bx.polygon }));
    const shapes = mergeRegion(free, absorbed);
    const before = absorbed.reduce((sum, a) => sum + apronArea(a), 0);
    const after = shapes.reduce((sum, sh) => sum + apronArea(sh), 0);
    if (after > MAX_APRON_M2) return null;
    const add = Math.max(0, after - before) * SURFACE_SPEC[bx.surface].costPerM2;
    charge += add;
    const step: PaveStep<T> = { surface: bx.surface, absorbed, shapes, after, add };
    list = list.filter((a) => !absorbed.includes(a)).concat(shapes.map((sh, k) => make(step, sh, k)));
  }
  return { aprons: list, charge: Math.round(charge) };
}

/** The result of merging a piece into the touching aprons of its surface. */
export interface MergePlan<T> {
  absorbed: T[];
  shapes: ApronShape[];
  /** Area of the merged shapes. */
  after: number;
  /** Area the piece adds beyond the aprons it merges into. */
  added: number;
  cost: number;
}

/** Merges a piece into the touching aprons of its surface; only the new area is charged at `unit`. */
export function mergePiece<T extends ApronPiece>(aprons: readonly T[], poly: readonly Pt[], surface: Surface, unit: number): MergePlan<T> {
  const piece = { polygon: poly.slice() };
  const absorbed = aprons.filter((a) => a.surface === surface && touches(a, piece));
  const shapes = mergeShapes(poly.slice(), absorbed);
  const before = absorbed.reduce((sum, a) => sum + apronArea(a), 0);
  const after = shapes.reduce((sum, sh) => sum + apronArea(sh), 0);
  const added = Math.max(0, after - before);
  return { absorbed, shapes, after, added, cost: Math.round(added * unit) };
}

/** The price per square meter of extending an apron: its surface at its own strength tier. */
export function extendUnitPrice(a: Pick<Apron, 'surface' | 'pcr'>): number {
  return unitCost(a.surface, Math.max(0, SURFACE_SPEC[a.surface].pcrTiers.indexOf(a.pcr)));
}

/** Unit price of a merge at a tier, the same factor the apron tool charges. */
export function buildUnitPrice(surface: Surface, tier: number): number {
  return SURFACE_SPEC[surface].costPerM2 * tierOf(surface, tier).factor;
}

/** Stand boxes and taxiway pavement, which a removal never takes out of an apron. */
export function keptPavement(stands: readonly Pick<Stand, 'x' | 'y' | 'headingDeg' | 'size'>[], taxiways: readonly Pick<Taxiway, 'points' | 'widthM'>[]): Pt[][] {
  const out: Pt[][] = [];
  for (const s of stands) {
    const slot = standSlot(s.size);
    if (slot) out.push(standBox(s, slot));
  }
  for (const t of taxiways) out.push(...polylineBoxes(t.points, t.widthM));
  return out;
}

/** What a removal takes out of one apron, and what it refunds. */
export interface RemovePiece<T> {
  apron: T;
  shapes: ApronShape[];
  removed: number;
  refund: number;
}

export interface RemovePlan<T> {
  pieces: RemovePiece<T>[];
  area: number;
  refund: number;
}

/**
 * Takes a piece out of the aprons it touches, or out of the one given id. Built pavement inside the piece
 * stays paved, and the removed area is refunded at the surface price times the refund share.
 */
export function removePlan<T extends ApronPiece & { id: number }>(aprons: readonly T[], poly: readonly Pt[], kept: readonly Pt[][], id?: number): RemovePlan<T> {
  const region: MultiPolygon = clearOf(poly.slice(), kept);
  const targets = aprons.filter((a) => (id === undefined ? touches(a, { polygon: poly.slice() }) : a.id === id));
  const pieces: RemovePiece<T>[] = [];
  let area = 0;
  let refund = 0;
  for (const a of targets) {
    const shapes = cutRegion(a, region);
    const removed = apronArea(a) - shapes.reduce((sum, sh) => sum + apronArea(sh), 0);
    if (removed < 1) continue;
    const r = removed * SURFACE_SPEC[a.surface].costPerM2 * REFUND_SHARE;
    pieces.push({ apron: a, shapes, removed, refund: r });
    area += removed;
    refund += r;
  }
  return { pieces, area, refund };
}
