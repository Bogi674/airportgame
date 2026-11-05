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
 * The yellow turn curve, drawn as the user's reference diagram shows it: a tangent loop on the pad.
 * The curved branch leaves the threshold along the runway centerline, sweeps the long way round a
 * circle set in the pad and comes back on a straight diagonal to the threshold. The same shape fits
 * either end and side through the local frame.
 */
export function padCurve(r: Runway, end: 'a' | 'b', side: PadSide): Pt[] {
  const at = frame(r, end, side);
  const { extra, length } = padSize(r);
  // Proportions measured from the user's reference diagram: the loop radius is a third of the paved
  // width, and its centre sits a little over half the pad length out, so the loop keeps a clear
  // margin from every pad edge instead of filling the pavement.
  const paved = r.widthM + extra;
  const wantRadius = paved * 0.33;
  const cs = length * 0.53;
  const cl = extra / 2;
  const d = Math.hypot(cs, cl);
  // The threshold is outside the loop for every code. The clamp only guards the tangent math.
  const radius = Math.min(wantRadius, d - 1);
  const phi = Math.atan2(cl, cs);
  const alpha = Math.asin(radius / d);
  const reach = Math.sqrt(d * d - radius * radius);
  // The two tangents from the threshold: the shallow one leaves the marking along the centerline,
  // the steep one is the straight return diagonal.
  const upper = { s: reach * Math.cos(phi - alpha), l: reach * Math.sin(phi - alpha) };
  const lower = { s: reach * Math.cos(phi + alpha), l: reach * Math.sin(phi + alpha) };
  const beta1 = Math.atan2(upper.l - cl, upper.s - cs);
  const beta2 = Math.atan2(lower.l - cl, lower.s - cs);
  // The loop travels the long way round: over the far side of the circle and back along the pad side.
  const span = (beta2 - beta1 + 2 * Math.PI) % (2 * Math.PI);
  const local: Pt[] = [{ x: 0, y: 0 }];
  // The curved branch starts along the runway centerline and meets the circle tangentially.
  const k = reach / 3;
  bezier(
    local[0],
    { x: k, y: 0 },
    { x: upper.s + k * Math.sin(beta1), y: upper.l - k * Math.cos(beta1) },
    { x: upper.s, y: upper.l },
    16,
    local,
  );
  const steps = Math.max(2, Math.ceil(span / (Math.PI / 36)));
  for (let j = 1; j < steps; j++) {
    const beta = beta1 + (span * j) / steps;
    local.push({ x: cs + radius * Math.cos(beta), y: cl + radius * Math.sin(beta) });
  }
  // The straight diagonal back to the threshold closes the marking.
  local.push({ x: lower.s, y: lower.l }, { x: 0, y: 0 });
  return local.map((p) => at(p.x, p.y));
}
