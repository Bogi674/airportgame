import { AIRFIELD } from '@data/index';
import type { PadSide, Runway } from './airfield';
import { runwayUnitCost } from './surfaceRules';
import type { Pt } from './geom';

/**
 * Runway end turn pads (docs/GAME_DESIGN.md section 6, prefab pieces): paved ground beyond the runway
 * end, adjoined to it, wider than the runway on the side the player picks, with the yellow turn curve
 * in it (revision: pads sit beyond the threshold). Geometry is worked out from the runway, so a pad
 * follows its end when the runway is resized.
 */

const TP = AIRFIELD.turnPad;

/** Maps pad local coordinates to the world: `s` outward past the runway end, `l` toward the pad side. */
function frame(r: Runway, end: 'a' | 'b', side: PadSide): (s: number, l: number) => Pt {
  const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1) || 1;
  const ux = (r.x2 - r.x1) / len;
  const uy = (r.y2 - r.y1) / len;
  const ox = end === 'a' ? r.x1 : r.x2;
  const oy = end === 'a' ? r.y1 : r.y2;
  // Outward is away from the other end.
  const ix = end === 'a' ? -ux : ux;
  const iy = end === 'a' ? -uy : uy;
  // Left of the heading from A to B, whichever end the pad is at.
  const nx = side === 'left' ? uy : -uy;
  const ny = side === 'left' ? -ux : ux;
  return (s, l) => ({ x: ox + ix * s + nx * l, y: oy + iy * s + ny * l });
}

/** Extra paved width and outward length of a pad for the runway's code. */
export function padSize(r: Pick<Runway, 'code' | 'widthM'>): { extra: number; length: number } {
  return { extra: Math.max(4, TP.widthM[r.code] - r.widthM), length: TP.lengthM[r.code] };
}

/** The pad's pavement: flush with the runway's far edge, `extra` past the near edge, reaching `length` out. */
export function padPolygon(r: Runway, end: 'a' | 'b', side: PadSide): Pt[] {
  const at = frame(r, end, side);
  const h = r.widthM / 2;
  const { extra, length } = padSize(r);
  // The 1 m overlap at the end joins the pavement fills with no hairline seam.
  return [at(-1, -h), at(-1, h + extra), at(length, h + extra), at(length, -h)];
}

export function padArea(r: Pick<Runway, 'code' | 'widthM'>): number {
  const { extra, length } = padSize(r);
  return (r.widthM + extra) * length;
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
 * The yellow turn curve: its tail meets the runway centerline at the end, sweeps into the pad and turns
 * round on a circle as wide as the pavement allows, then back to the end: a teardrop that points at the
 * runway. The same shape fits either end and side through the local frame.
 */
export function padCurve(r: Runway, end: 'a' | 'b', side: PadSide): Pt[] {
  const at = frame(r, end, side);
  const h = r.widthM / 2;
  const { extra, length } = padSize(r);
  const R = (2 * h + extra) / 2 - 3;
  const cl = extra / 2;
  const cs = length / 2;
  const k = cs * 0.5;
  const local: Pt[] = [{ x: 0, y: 0 }];
  const lc = (s: number, l: number): Pt => ({ x: s, y: l });
  bezier(lc(0, 0), lc(k, 0), lc(cs - k, cl + R), lc(cs, cl + R), 16, local);
  for (let d = 95; d <= 270; d += 5) {
    const a = (d * Math.PI) / 180;
    local.push({ x: cs + R * Math.cos(a), y: cl + R * Math.sin(a) });
  }
  bezier(lc(cs, cl - R), lc(cs - k, cl - R), lc(k, 0), lc(0, 0), 16, local);
  return local.map((p) => at(p.x, p.y));
}
