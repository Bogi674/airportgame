import { AIRFIELD } from '@data/index';
import type { PadSide, Runway } from './airfield';
import { runwayUnitCost } from './surfaceRules';
import type { Pt } from './geom';

/**
 * Runway end turn pads (docs/GAME_DESIGN.md section 6, prefab pieces): extra pavement beside one end of
 * the runway so an aircraft can turn round, and the yellow turn curve on it (docs/ART_AND_ASSETS.md
 * section 8). Geometry is worked out from the runway, so a pad follows its end when the runway is resized.
 */

const TP = AIRFIELD.turnPad;

/** Maps pad local coordinates to the world: `s` inward from the runway end, `l` toward the pad side. */
function frame(r: Runway, end: 'a' | 'b', side: PadSide): (s: number, l: number) => Pt {
  const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1) || 1;
  const ux = (r.x2 - r.x1) / len;
  const uy = (r.y2 - r.y1) / len;
  const ox = end === 'a' ? r.x1 : r.x2;
  const oy = end === 'a' ? r.y1 : r.y2;
  const ix = end === 'a' ? ux : -ux;
  const iy = end === 'a' ? uy : -uy;
  // Left of the heading from A to B, whichever end the pad is at.
  const nx = side === 'left' ? uy : -uy;
  const ny = side === 'left' ? -ux : ux;
  return (s, l) => ({ x: ox + ix * s + nx * l, y: oy + iy * s + ny * l });
}

/** Extra paved width, full width length and taper of a pad for the runway's code. */
export function padSize(r: Pick<Runway, 'code' | 'widthM'>): { extra: number; length: number; taper: number } {
  return { extra: Math.max(4, TP.widthM[r.code] - r.widthM), length: TP.lengthM[r.code], taper: TP.taperM[r.code] };
}

/** The pad's pavement, overlapping the runway edge by a meter so the fills join. */
export function padPolygon(r: Runway, end: 'a' | 'b', side: PadSide): Pt[] {
  const at = frame(r, end, side);
  const h = r.widthM / 2;
  const { extra, length, taper } = padSize(r);
  return [at(0, h - 1), at(0, h + extra), at(length, h + extra), at(length + taper, h - 1)];
}

export function padArea(r: Pick<Runway, 'code' | 'widthM'>): number {
  const { extra, length, taper } = padSize(r);
  return extra * (length + taper / 2);
}

/** The pad's cost in cash: its area times the runway surface's unit cost at the runway's strength tier, rounded. */
export function padValue(r: Runway): number {
  return Math.round(padArea(r) * runwayUnitCost(r));
}

function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number, out: Pt[]): void {
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
}

/**
 * The yellow turn curve: it leaves the runway centerline, sweeps into the pad, turns round near the
 * end on a circle as wide as the pavement allows, and rejoins the centerline: a teardrop.
 */
export function padCurve(r: Runway, end: 'a' | 'b', side: PadSide): Pt[] {
  const at = frame(r, end, side);
  const h = r.widthM / 2;
  const { extra, length, taper } = padSize(r);
  const R = (2 * h + extra) / 2 - 3;
  const cl = extra / 2;
  const cs = R + 4;
  const sIn = length + taper;
  const k = (sIn - cs) * 0.5;
  const local: Pt[] = [{ x: sIn, y: 0 }];
  const lc = (s: number, l: number): Pt => ({ x: s, y: l });
  bezier(lc(sIn, 0), lc(sIn - k, 0), lc(cs + k, cl + R), lc(cs, cl + R), 16, local);
  for (let d = 95; d <= 270; d += 5) {
    const a = (d * Math.PI) / 180;
    local.push({ x: cs + R * Math.cos(a), y: cl + R * Math.sin(a) });
  }
  bezier(lc(cs, cl - R), lc(cs + k, cl - R), lc(sIn - k, 0), lc(sIn, 0), 16, local);
  return local.map((p) => at(p.x, p.y));
}
