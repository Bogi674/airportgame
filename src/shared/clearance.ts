import { AIRFIELD, STAND_SIZES } from '@data/index';
import { AIRCRAFT, codeFromSpan, type AircraftSpec } from '@data/aircraft';
import { codeIndex, type AirfieldPayload, type CodeLetter } from './airfield';
import { closestOnSegment, pointInPolygon, type Pt } from './geom';

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
