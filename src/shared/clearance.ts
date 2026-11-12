import { AIRFIELD, STAND_SIZES } from '@data/index';
import { AIRCRAFT, codeFromSpan, type AircraftSpec } from '@data/aircraft';
import { codeIndex, type AirfieldPayload, type CodeLetter, type Stand, type Taxiway } from './airfield';
import { closestOnSegment, distToSegment, pointInPolygon, segmentIntersection, type Pt } from './geom';
import { endpoint } from './validate';
import type { StandSlot } from './standGeom';

/**
 * Wingtip envelope of the taxiway tool (docs/GAME_DESIGN.md section 6, clearances): the largest type
 * of the drawn code slides along the new arm, and every stretch closer to an object than the code's
 * taxiway to object distance, or running beside another taxiway closer than the taxiway separation,
 * is a clash. Clashes are warnings, the arm can still be built.
 */

/** Largest aircraft of a code in the roster, or of the largest code below it when the code has none. */
export function envelopeType(code: CodeLetter): AircraftSpec | null {
  let best: AircraftSpec | null = null;
  for (const a of AIRCRAFT) {
    if (codeIndex(codeFromSpan(a.dimensions.wingspanM)) > codeIndex(code)) continue;
    if (!best || a.dimensions.wingspanM > best.dimensions.wingspanM) best = a;
  }
  return best;
}

export interface ClashObstacles {
  /** Building footprints in world meters. */
  buildings: Pt[][];
}

const STEP_M = 4;
/** Parallel means within about 25 degrees. */
const PARALLEL_COS = 0.9;
const tmp = { x: 0, y: 0, t: 0 };

function distToPolygon(x: number, y: number, poly: readonly Pt[]): number {
  if (pointInPolygon(x, y, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    closestOnSegment(x, y, a.x, a.y, b.x, b.y, tmp);
    best = Math.min(best, Math.hypot(x - tmp.x, y - tmp.y));
  }
  return best;
}

/** What a point of the new arm clashes with: 0 nothing, 1 an object, 2 a taxiway beside it. */
function clashAt(x: number, y: number, dx: number, dy: number, nearEnd: boolean, code: CodeLetter, af: AirfieldPayload, obs: ClashObstacles): 0 | 1 | 2 {
  const objD = AIRFIELD.codes[code].taxiObjectM;
  for (const s of af.stands) if (Math.hypot(s.x - x, s.y - y) < objD + STAND_SIZES[s.size].widthM / 2) return 1;
  for (const b of obs.buildings) if (distToPolygon(x, y, b) < objD) return 1;
  if (nearEnd) return 0;
  for (const t of af.taxiways) {
    const sep = Math.min(AIRFIELD.codes[code].taxiSepM, AIRFIELD.codes[t.code].taxiSepM);
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1];
      const b = t.points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) continue;
      closestOnSegment(x, y, a.x, a.y, b.x, b.y, tmp);
      const d = Math.hypot(x - tmp.x, y - tmp.y);
      // A taxiway the arm crosses or joins is not a clash, only one running beside it.
      if (d < 1 || d >= sep) continue;
      if (Math.abs(((b.x - a.x) * dx + (b.y - a.y) * dy) / len) >= PARALLEL_COS) return 2;
    }
  }
  return 0;
}

/** Clearance numbers a taxiway code gives a stand box (`src/data/airfield_codes.json`). */
export interface CodeClearance {
  spanM: number;
  taxiObjectM: number;
}

/**
 * Parked box of a stand as four world points: the stand slot (`standSlot`) laid on the stand heading,
 * so it runs from the nose limit back toward the taxilane, exactly where the painter draws the stand.
 */
export function standBox(s: Pick<Stand, 'x' | 'y' | 'headingDeg'>, slot: StandSlot): Pt[] {
  const h = s.headingDeg;
  const half = slot.widthM / 2;
  const at = (along: number, across: number): Pt => {
    const p = endpoint(s.x, s.y, h, along);
    return endpoint(p.x, p.y, (h + 90) % 360, across);
  };
  return [at(slot.near, -half), at(slot.near, half), at(slot.far, half), at(slot.far, -half)];
}

/** Distance from a polyline to a polygon boundary or interior, 0 when they touch or overlap. */
function polylinePolygonDistance(pts: readonly Pt[], poly: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    if (pointInPolygon(a.x, a.y, poly)) return 0;
    for (let k = 0; k < poly.length; k++) {
      const c = poly[k];
      const d = poly[(k + 1) % poly.length];
      if (segmentIntersection(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y) >= 0) return 0;
      best = Math.min(best, distToSegment(c.x, c.y, a.x, a.y, b.x, b.y), distToSegment(d.x, d.y, a.x, a.y, b.x, b.y), distToSegment(a.x, a.y, c.x, c.y, d.x, d.y), distToSegment(b.x, b.y, c.x, c.y, d.x, d.y));
    }
  }
  return best;
}

/**
 * The first taxiway, by id, whose centerline the parked box breaks (docs/GAME_DESIGN.md section 6). The
 * taxiway a stand leads into must clear the box by half the code span plus the stand's wingtip clearance,
 * every other taxiway by the code's taxiway to object distance. Null when the box is clear of all.
 */
export function standTaxiwayClash(box: readonly Pt[], leadTaxiwayId: number, taxiways: readonly Taxiway[], codes: Record<CodeLetter, CodeClearance>, wingtipClearanceM: number): { taxiwayId: number } | null {
  const ordered = [...taxiways].sort((p, q) => p.id - q.id);
  for (const t of ordered) {
    const row = codes[t.code];
    const required = t.id === leadTaxiwayId ? row.spanM / 2 + wingtipClearanceM : row.taxiObjectM;
    if (polylinePolygonDistance(t.points, box) < required) return { taxiwayId: t.id };
  }
  return null;
}

export interface Clashes {
  /** Stretches of the arm that clash, as sub polylines. */
  runs: Pt[][];
  /** Something is closer than the taxiway to object distance. */
  object: boolean;
  /** Another taxiway runs beside the arm closer than the taxiway separation. */
  taxiway: boolean;
}

/** Stretches of the polyline where the envelope clashes, as sub polylines. */
export function taxiClashes(pts: readonly Pt[], code: CodeLetter, af: AirfieldPayload, obs: ClashObstacles): Clashes {
  const out: Pt[][] = [];
  const res: Clashes = { runs: out, object: false, taxiway: false };
  if (pts.length < 2) return res;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const endGap = AIRFIELD.codes[code].taxiSepM;
  let run: Pt[] | null = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const dx = (b.x - a.x) / len;
    const dy = (b.y - a.y) / len;
    const steps = Math.max(1, Math.ceil(len / STEP_M));
    for (let k = i === 1 ? 0 : 1; k <= steps; k++) {
      const x = a.x + dx * ((len * k) / steps);
      const y = a.y + dy * ((len * k) / steps);
      const nearEnd = Math.hypot(x - first.x, y - first.y) < endGap || Math.hypot(x - last.x, y - last.y) < endGap;
      const c = clashAt(x, y, dx, dy, nearEnd, code, af, obs);
      if (c === 1) res.object = true;
      if (c === 2) res.taxiway = true;
      if (c !== 0) {
        if (!run) {
          run = [];
          out.push(run);
        }
        run.push({ x, y });
      } else run = null;
    }
  }
  // A single sample is drawn as a short piece along the arm.
  res.runs = out.map((r) => (r.length > 1 ? r : [r[0], { x: r[0].x + 0.1, y: r[0].y }]));
  return res;
}
