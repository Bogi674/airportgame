import { AIRFIELD } from '@data/index';
import { compassVector, type AirfieldPayload, type Runway, type Taxiway } from './airfield';
import { atan2Det, TWO_PI } from './trig';
import type { Pt } from './geom';

/**
 * Construction grid along a runway or a taxiway segment (handoff/tasks/T42-grid-snapping.md, R1).
 * The grid is the Cities Skylines model: the player draws the runway or taxiway freely, then a
 * lattice of nodes forms along it, and placement tools snap to those nodes. Every runway carries one
 * grid anchored at threshold A along the heading from A to B, every taxiway segment carries one
 * grid anchored at its first point along the segment. The lattice has no extent; the renderer
 * culls the lines it draws to the viewport.
 */

const GRID = AIRFIELD.constructionGrid;

/** A snappable grid: an origin, a heading, and the spacing along and across it. */
export interface ConstructionGrid {
  /** Stable identity: `runway:<id>`, or `taxi:<id>:<segment>` counting the segments from 0. */
  id: string;
  kind: 'runway' | 'taxiway';
  /** The anchor the grid is built from: threshold A, or the first point of the segment. */
  origin: Pt;
  /** Compass heading of the along axis in whole degrees. */
  headingDeg: number;
  /** Unit vector of the along axis. */
  ax: number;
  ay: number;
  /** Unit vector of the across axis, square to the left of travel: (ay, -ax). */
  cx: number;
  cy: number;
  /** Distance between neighbouring nodes along and across the grid, in meters. */
  spacingMinorM: number;
  /** Distance between highlighted lines, a whole multiple of the minor spacing. */
  spacingMajorM: number;
  /** Length of the runway or segment the grid runs along, in meters. */
  lengthM: number;
}

/** What a point snapped to a grid becomes. */
export interface GridSnap {
  /** The snapped point, always a node of the grid. */
  p: Pt;
  /** True when the snap moved the point, false when it was already on a node. */
  snapped: boolean;
  /** Heading of the grid that was used, for the tools that snap their heading too. */
  headingDeg: number;
  /** Identity of the grid that was used. */
  gridId: string;
  /** Node index along the grid heading. */
  i: number;
  /** Node index across the grid heading, positive to the left of travel. */
  j: number;
  /** True when the node is on a highlighted line in both directions. */
  major: boolean;
}

/** Whole degrees of a direction vector, as a compass heading. */
function headingOf(ux: number, uy: number): number {
  const rad = atan2Det(ux, -uy);
  const deg = (rad * 360) / TWO_PI;
  return ((Math.round(deg) % 360) + 360) % 360;
}

/** The grid of a runway: threshold A is the origin, the centerline is the i=0 line. */
function runwayGrid(r: Runway): ConstructionGrid {
  const d = compassVector(r.headingDeg);
  return {
    id: `runway:${r.id}`,
    kind: 'runway',
    origin: { x: r.x1, y: r.y1 },
    headingDeg: r.headingDeg,
    ax: d.x,
    ay: d.y,
    cx: d.y,
    cy: -d.x,
    spacingMinorM: GRID.spacingMinorM,
    spacingMajorM: GRID.spacingMajorM,
    lengthM: r.lengthM,
  };
}

/** The grid of one taxiway segment, or null when the segment has no length to run along. */
function segmentGrid(t: Taxiway, index: number): ConstructionGrid | null {
  const a = t.points[index];
  const b = t.points[index + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) return null;
  const ax = (b.x - a.x) / len;
  const ay = (b.y - a.y) / len;
  return {
    id: `taxi:${t.id}:${index}`,
    kind: 'taxiway',
    origin: { x: a.x, y: a.y },
    headingDeg: headingOf(ax, ay),
    ax,
    ay,
    cx: ay,
    cy: -ax,
    spacingMinorM: GRID.spacingMinorM,
    spacingMajorM: GRID.spacingMajorM,
    lengthM: len,
  };
}

/** Per airfield payload and version, so a bumped version rebuilds the grids. */
const cache = new WeakMap<AirfieldPayload, { version: number; grids: ConstructionGrid[] }>();

/**
 * The snappable grids of an airfield: one per runway, then one per taxiway segment in the order
 * the taxiways and their points are stored. The result is cached per airfield payload and version,
 * so the renderer and the tools share one array until `refresh()` bumps the version.
 */
export function gridsFor(af: AirfieldPayload): ConstructionGrid[] {
  const cached = cache.get(af);
  if (cached && cached.version === af.version) return cached.grids;
  const grids: ConstructionGrid[] = [];
  for (const r of af.runways) grids.push(runwayGrid(r));
  for (const t of af.taxiways) {
    for (let i = 0; i + 1 < t.points.length; i++) {
      const g = segmentGrid(t, i);
      if (g) grids.push(g);
    }
  }
  cache.set(af, { version: af.version, grids });
  return grids;
}

/** World position of a grid node. The origin is the node (0, 0). */
export function gridPoint(g: ConstructionGrid, i: number, j: number): Pt {
  const along = g.spacingMinorM * i;
  const across = g.spacingMinorM * j;
  return { x: g.origin.x + g.ax * along + g.cx * across, y: g.origin.y + g.ay * along + g.cy * across };
}

/** Snaps a point to the nearest node of a grid. */
export function snapToGrid(p: Pt, g: ConstructionGrid): GridSnap {
  const dx = p.x - g.origin.x;
  const dy = p.y - g.origin.y;
  const along = dx * g.ax + dy * g.ay;
  const across = dx * g.cx + dy * g.cy;
  // The + 0 turns a rounded negative zero into a plain zero, so node indexes stay canonical.
  const i = Math.round(along / g.spacingMinorM) + 0;
  const j = Math.round(across / g.spacingMinorM) + 0;
  const q = gridPoint(g, i, j);
  const step = g.spacingMajorM / g.spacingMinorM;
  return {
    p: q,
    snapped: q.x !== p.x || q.y !== p.y,
    headingDeg: g.headingDeg,
    gridId: g.id,
    i,
    j,
    major: i % step === 0 && j % step === 0,
  };
}
