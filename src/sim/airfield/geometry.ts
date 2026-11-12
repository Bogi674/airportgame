import { AIRFIELD } from '@data/index';
import {
  CODES,
  codeIndex,
  compassVector,
  type AirfieldPayload,
  type CodeLetter,
  type HoldingPoint,
  type Runway,
  type RunwayEntry,
  type Taxiway,
  runwaySide,
} from '@shared/airfield';
import { closestOnSegment, polylineLength } from '@shared/geom';

const SAMPLE_M = 2;

/** Designator number for a heading: 090 gives 09, 000 gives 36. */
export function designatorNumber(headingDeg: number): number {
  const n = Math.round((((headingDeg % 360) + 360) % 360) / 10) % 36;
  return n === 0 ? 36 : n;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Assigns 09/27 style names, adding L, C and R to runways that share a designator. */
export function assignRunwayNames(runways: Runway[]): void {
  const groups = new Map<number, Runway[]>();
  for (const r of runways) {
    const a = designatorNumber(r.headingDeg);
    const b = designatorNumber(r.headingDeg + 180);
    const key = Math.min(a, b);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
    r.nameA = pad2(a);
    r.nameB = pad2(b);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const ref = compassVector(list[0].headingDeg);
    // Perpendicular pointing to the left of the reference heading (north is -y).
    const lx = ref.y;
    const ly = -ref.x;
    const sorted = list.slice().sort((p, q) => (p.x1 * lx + p.y1 * ly) - (q.x1 * lx + q.y1 * ly) || p.id - q.id).reverse();
    const letters = sorted.length === 2 ? ['L', 'R'] : sorted.length === 3 ? ['L', 'C', 'R'] : sorted.map((_, i) => String(i + 1));
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const sameDir = Math.abs(((r.headingDeg - list[0].headingDeg + 540) % 360) - 180) < 90;
      const lA = sameDir ? letters[i] : letters[sorted.length - 1 - i];
      const lB = sameDir ? letters[sorted.length - 1 - i] : letters[i];
      r.nameA += lA;
      r.nameB += lB;
    }
  }
}

/** Largest code whose runway to taxiway separation is met at `distM`. */
export function codeForSeparation(approach: Runway['approach'], distM: number): CodeLetter {
  const table = AIRFIELD.runwayToTaxiwaySepM[approach];
  let best: CodeLetter = 'A';
  for (const c of CODES) if (table[c] <= distM) best = c;
  return best;
}

const minCode = (a: CodeLetter, b: CodeLetter): CodeLetter => (codeIndex(a) <= codeIndex(b) ? a : b);

interface Sample {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

function sampleTaxiway(t: Taxiway): Sample[] {
  const out: Sample[] = [];
  for (let i = 1; i < t.points.length; i++) {
    const a = t.points[i - 1];
    const b = t.points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const dx = (b.x - a.x) / len;
    const dy = (b.y - a.y) / len;
    for (let d = 0; d < len; d += SAMPLE_M) out.push({ x: a.x + dx * d, y: a.y + dy * d, dx, dy });
  }
  const last = t.points[t.points.length - 1];
  const prev = t.points[t.points.length - 2];
  const ll = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
  out.push({ x: last.x, y: last.y, dx: (last.x - prev.x) / ll, dy: (last.y - prev.y) / ll });
  return out;
}

const tmp = { x: 0, y: 0, t: 0 };

function distToRunway(r: Runway, x: number, y: number): { d: number; t: number } {
  closestOnSegment(x, y, r.x1, r.y1, r.x2, r.y2, tmp);
  return { d: Math.hypot(x - tmp.x, y - tmp.y), t: tmp.t };
}

/** Holding points, runway entries and effective maximum codes, derived from the built geometry. */
export function deriveNetwork(af: AirfieldPayload): void {
  const holding: HoldingPoint[] = [];
  const entries: RunwayEntry[] = [];
  for (const t of af.taxiways) {
    t.maxCode = minCode(t.userMaxCode, t.code);
    const samples = sampleTaxiway(t);
    const n = samples.length;
    const ds = new Float64Array(n);
    const ts = new Float64Array(n);
    for (const r of af.runways) {
      const axis = compassVector(r.headingDeg);
      // Holding distance is measured from the runway centerline.
      const holdD = AIRFIELD.holdingDistanceM[r.approach];
      const touchD = r.widthM / 2 + r.shoulderM + 3;
      let parallelMin = Infinity;
      let firstTouch = -1;
      let lastTouch = -1;
      for (let i = 0; i < n; i++) {
        const s = samples[i];
        const res = distToRunway(r, s.x, s.y);
        ds[i] = res.d;
        ts[i] = res.t;
        if (res.d <= touchD) {
          if (firstTouch < 0) firstTouch = i;
          lastTouch = i;
        }
        // Stretches running parallel to the runway limit the taxiway code.
        const along = Math.abs(s.dx * axis.x + s.dy * axis.y);
        if (along > 0.966 && res.t > 0 && res.t < 1 && res.d > touchD) parallelMin = Math.min(parallelMin, res.d);
      }
      if (parallelMin < Infinity) t.maxCode = minCode(t.maxCode, codeForSeparation(r.approach, parallelMin));
      if (firstTouch < 0) continue;
      const tt = ts[firstTouch];
      entries.push({
        x: r.x1 + (r.x2 - r.x1) * tt,
        y: r.y1 + (r.y2 - r.y1) * tt,
        runwayId: r.id,
        taxiwayId: t.id,
        todaTowardB: Math.round(r.lengthM * (1 - tt)),
        todaTowardA: Math.round(r.lengthM * tt),
      });
      // The player may move a holding position further out on either side (docs/GAME_DESIGN.md section 6).
      const holdOn = (side: 1 | -1): number => {
        const set = t.holds?.find((h) => h.runwayId === r.id && h.side === side);
        return set && set.distM > holdD ? set.distM : holdD;
      };
      for (let i = 1; i < n; i++) {
        const side = runwaySide(r, samples[i].x, samples[i].y);
        const hd = holdOn(side);
        const leaving = ds[i - 1] < hd && ds[i] >= hd && i > firstTouch;
        const entering = ds[i - 1] >= hd && ds[i] < hd && i <= lastTouch;
        if (leaving || entering) {
          holding.push({ x: samples[i].x, y: samples[i].y, runwayId: r.id, taxiwayId: t.id, distM: Math.round(ds[i]), side, minM: holdD });
        }
      }
    }
  }
  af.holding = dedupeHolding(holding);
  af.entries = entries;
}

function dedupeHolding(list: HoldingPoint[]): HoldingPoint[] {
  const out: HoldingPoint[] = [];
  for (const h of list) {
    if (!out.some((o) => o.runwayId === h.runwayId && o.taxiwayId === h.taxiwayId && Math.hypot(o.x - h.x, o.y - h.y) < 6)) out.push(h);
  }
  return out;
}

/**
 * Taxiway names after the usual convention: main taxiways take letters A, B, C and so on, skipping I
 * and O (they read as 1 and 0) and N and X (N for north, X for closed), then double letters. A short
 * taxiway that joins the side of a longer one is a connector and is numbered after it, A1, A2, in the
 * order along the longer taxiway. Names follow the layout, so they are worked out again after every change.
 */
const NAME_LETTERS = 'ABCDEFGHJKLMPQRSTUVWYZ';

export function assignTaxiNames(taxiways: Taxiway[]): void {
  const lens = new Map<number, number>();
  for (const t of taxiways) lens.set(t.id, polylineLength(t.points));
  // Which longer taxiway does each short one end on, and where along it.
  const parent = new Map<number, { id: number; at: number }>();
  const c = { x: 0, y: 0, t: 0 };
  for (const t of taxiways) {
    if ((lens.get(t.id) ?? 0) > 400) continue;
    let best: { id: number; at: number; d: number } | null = null;
    for (const end of [t.points[0], t.points[t.points.length - 1]]) {
      for (const o of taxiways) {
        if (o.id === t.id || (lens.get(o.id) ?? 0) <= (lens.get(t.id) ?? 0)) continue;
        let run = 0;
        for (let i = 1; i < o.points.length; i++) {
          const a = o.points[i - 1];
          const b = o.points[i];
          closestOnSegment(end.x, end.y, a.x, a.y, b.x, b.y, c);
          const d = Math.hypot(end.x - c.x, end.y - c.y);
          const sl = Math.hypot(b.x - a.x, b.y - a.y);
          if (d < 2 && (!best || d < best.d)) best = { id: o.id, at: run + sl * c.t, d };
          run += sl;
        }
      }
    }
    if (best) parent.set(t.id, { id: best.id, at: best.at });
  }
  // Main taxiways first, longest first so the main parallel takes A.
  const mains = taxiways.filter((t) => !parent.has(t.id)).sort((p, q) => (lens.get(q.id) ?? 0) - (lens.get(p.id) ?? 0) || p.id - q.id);
  const names = new Map<number, string>();
  mains.forEach((t, i) => {
    const letter = NAME_LETTERS[i % NAME_LETTERS.length];
    names.set(t.id, i < NAME_LETTERS.length ? letter : `${letter}${letter}`);
  });
  const byParent = new Map<number, { id: number; at: number }[]>();
  for (const [id, p] of parent) {
    const list = byParent.get(p.id) ?? [];
    list.push({ id, at: p.at });
    byParent.set(p.id, list);
  }
  for (const [pid, list] of byParent) {
    list.sort((a, b) => a.at - b.at || a.id - b.id);
    list.forEach((x, i) => names.set(x.id, `${names.get(pid) ?? 'T'}${i + 1}`));
  }
  for (const t of taxiways) t.name = names.get(t.id) ?? t.name;
}
