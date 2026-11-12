import { AIRCRAFT, SPRITE_BASES, standGeometry } from '@data/aircraft';
import { GSE, GSE_INDEX, type GseSpec } from '@data/index';
import { aircraftBoundary, footprintClash, footprintSpecSchema, type AircraftBoundary, type Poly } from '@shared/aircraftFootprint';
import type { Pt } from '@shared/geom';
import { atan2Det, cosLut, PI, sinLut } from '@shared/trig';
import { AcState, MAX_AIRCRAFT, type Traffic } from '../ops/traffic';

export const MAX_VEHICLES = 1024;

/** Vehicle life cycle. */
const Drive = 1;
const Work = 2;
/** Life cycle state of a vehicle at its dock, for tests that read the pose there. */
export const WORK_STATE = Work;
const Leave = 3;
const Attached = 4;

const SPEED_MPS = 6;
const STEP_M = SPEED_MPS * 0.1;

/** Most waypoints in one drive: staging, two detour points and the dock. */
const MAX_WP = 4;
/** Gap a vehicle keeps from the aircraft hard footprint, in meters. Matches the clash check default. */
const CLEARANCE_M = 0.5;
/** Spacing of the clash samples along each leg of a drive, in meters. */
const SAMPLE_M = 0.5;
/**
 * Lateral gap from the aircraft outline to a parked vehicle. The clash buffer is an octagon whose
 * vertices sit at CLEARANCE_M / cos(PI / 8), so its reach across a flat side is that far, not CLEARANCE_M.
 * The extra 1 cm keeps a parked vehicle clear of that edge under floating point rounding.
 */
const GAP_M = CLEARANCE_M / cosLut(PI / 8) + 0.01;
/** Distance of the pushback tug centre ahead of the nose, in meters. */
const TUG_AHEAD_M = 3;

const TUG = GSE_INDEX.tug;
const GPU = GSE_INDEX.gpu;
const REFUELLER = GSE_INDEX.refueller;
const BELT = GSE_INDEX.beltloader;
const TRACTOR = GSE_INDEX.tractor;
const CART = GSE_INDEX.cart;
const CATERING = GSE_INDEX.catering;
const STAIRS = GSE_INDEX.stairs;

/**
 * Order in which crews drive in on each side, and in which docks claim their lateral place, inboard first.
 * A dock that would overlap an earlier one on its side is pushed outboard of it, so a straight drive in
 * never passes a parked vehicle. The kind index is the saved fleet index, so gse.json order cannot carry this.
 */
const DOCK_ORDER = [BELT, TRACTOR, CART, CATERING, GPU, STAIRS, REFUELLER];

const TYPES = AIRCRAFT.length;
const KINDS = GSE.length;

/** Aircraft side of each docking kind: 0 for the right, 1 for the left. */
const SIDE_R = 0;
const SIDE_L = 1;
const sideOf = new Uint8Array(KINDS);
for (let k = 0; k < KINDS; k++) sideOf[k] = GSE[k].dock?.side === 'L' ? SIDE_L : SIDE_R;

/**
 * Drive paths per (type, kind) in the aircraft local frame, nose at y = 0 and aft positive, built
 * once on first use. A path is the staging point, then the dock, with two detour points when the
 * straight drive would clash. Its dock heading is relative to the aircraft heading.
 */
const pathX = new Float64Array(TYPES * KINDS * MAX_WP);
const pathY = new Float64Array(TYPES * KINDS * MAX_WP);
const pathN = new Uint8Array(TYPES * KINDS);
const dockRel = new Float64Array(TYPES * KINDS);
/** Kinds in the turnaround crew of each type, one bit per kind. */
const crewMask = new Uint32Array(TYPES);
let pathsReady = false;

/**
 * Ground support equipment for turnarounds. Vehicles are a presentation of the turnaround:
 * they drive from beside the stand to their dock at the aircraft, wait there, and leave
 * when the aircraft moves. They never change aircraft timing, so they are not part of saves or hashes.
 * Docks and drive paths come from the aircraft frame, so a vehicle never needs a path search (hard rule 7).
 */
export class Gse {
  count = 0;
  readonly active = new Uint8Array(MAX_VEHICLES);
  readonly kind = new Uint8Array(MAX_VEHICLES);
  readonly state = new Uint8Array(MAX_VEHICLES);
  readonly owner = new Int32Array(MAX_VEHICLES).fill(-1);
  readonly x = new Float64Array(MAX_VEHICLES);
  readonly y = new Float64Array(MAX_VEHICLES);
  readonly heading = new Float64Array(MAX_VEHICLES);
  /** World waypoints of each vehicle, and the waypoint it drives to. */
  private readonly wpX = new Float64Array(MAX_VEHICLES * MAX_WP);
  private readonly wpY = new Float64Array(MAX_VEHICLES * MAX_WP);
  private readonly wpN = new Uint8Array(MAX_VEHICLES);
  private readonly ti = new Uint8Array(MAX_VEHICLES);
  /** Heading the vehicle takes once it reaches its dock. */
  private readonly dockHead = new Float64Array(MAX_VEHICLES);
  /** Local offset in the aircraft frame for attached vehicles. */
  private readonly lf = new Float64Array(MAX_VEHICLES);
  /** Flight the aircraft slot was serviced for, so a turnaround spawns its crew once. */
  private readonly served = new Int32Array(MAX_AIRCRAFT).fill(-1);
  private readonly tugged = new Int32Array(MAX_AIRCRAFT).fill(-1);
  /**
   * Crew sequencing per aircraft side, in DOCK_ORDER: a vehicle drives in only once
   * the one before it on its side is docked, and leaves only once the one after it has gone.
   * pending holds one bit per kind still to drive in, last the newest vehicle on each side, and prev
   * links each vehicle to the one that docked before it on its side.
   */
  private readonly pending = new Uint32Array(MAX_AIRCRAFT);
  private readonly last = new Int32Array(MAX_AIRCRAFT * 2).fill(-1);
  private readonly prev = new Int32Array(MAX_VEHICLES).fill(-1);

  constructor(private readonly traffic: Traffic) {
    prepareDockPaths();
  }

  reset(): void {
    this.active.fill(0);
    this.owner.fill(-1);
    this.served.fill(-1);
    this.tugged.fill(-1);
    this.pending.fill(0);
    this.last.fill(-1);
    this.prev.fill(-1);
    this.count = 0;
  }

  // hot
  update(): void {
    const t = this.traffic;
    // Crews only change when an aircraft changes state, so look for that twice a second.
    if (this.phase++ % 5 === 0) this.scan(t);
    if (this.count === 0) return;
    this.move(t);
  }

  private phase = 0;

  private scan(t: Traffic): void {
    for (let a = 0; a < MAX_AIRCRAFT; a++) {
      const st = t.state[a];
      const f = t.flight[a];
      if (st === AcState.Turnaround && f >= 0 && this.served[a] !== f) {
        this.served[a] = f;
        this.spawnCrew(a);
      } else if (st !== AcState.Turnaround && this.served[a] !== -1) {
        this.served[a] = -1;
        this.release(a, false);
      }
      if (st === AcState.Pushback && f >= 0 && this.tugged[a] !== f) {
        this.tugged[a] = f;
        this.spawnTug(a);
      } else if (st !== AcState.Pushback && this.tugged[a] !== -1) {
        this.tugged[a] = -1;
        this.release(a, true);
      }
    }
  }

  private move(t: Traffic): void {
    for (let v = 0; v < MAX_VEHICLES; v++) {
      if (this.active[v] === 0) continue;
      const s = this.state[v];
      if (s === Attached) {
        const a = this.owner[v];
        const h = t.heading[a];
        this.x[v] = t.x[a] + cosLut(h) * this.lf[v];
        this.y[v] = t.y[a] + sinLut(h) * this.lf[v];
        this.heading[v] = h;
      } else if (s === Drive || s === Leave) {
        this.step(v);
      }
    }
  }

  private step(v: number): void {
    const k = v * MAX_WP + this.ti[v];
    const dx = this.wpX[k] - this.x[v];
    const dy = this.wpY[k] - this.y[v];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= STEP_M) {
      this.x[v] = this.wpX[k];
      this.y[v] = this.wpY[k];
      if (this.state[v] === Leave) {
        if (this.ti[v] === 0) this.free(v);
        else this.ti[v]--;
      } else if (this.ti[v] === this.wpN[v] - 1) {
        this.state[v] = Work;
        this.heading[v] = this.dockHead[v];
        this.advance(this.owner[v], sideOf[this.kind[v]]);
      } else {
        this.ti[v]++;
      }
      return;
    }
    this.heading[v] = atan2Det(dy, dx);
    this.x[v] += (dx / d) * STEP_M;
    this.y[v] += (dy / d) * STEP_M;
  }

  /** Frees a vehicle that has driven off, and sends away the one that docked before it on its side. */
  private free(v: number): void {
    const before = this.prev[v];
    this.prev[v] = -1;
    this.active[v] = 0;
    this.owner[v] = -1;
    this.count--;
    if (before >= 0) this.leave(before);
  }

  /** Turns a vehicle back along its drive. */
  private leave(v: number): void {
    const s = this.state[v];
    if (s === Leave) return;
    if (s === Work) this.ti[v] = this.wpN[v] - 2;
    else if (s === Drive) this.ti[v] -= 1;
    else this.ti[v] = 0;
    this.state[v] = Leave;
  }

  /**
   * Sends the vehicles of an aircraft away. Tugs are released separately from the turnaround crew.
   * Crew vehicles still to come are dropped, and on each side the newest leaves first.
   */
  private release(a: number, tugs: boolean): void {
    if (!tugs) {
      this.pending[a] = 0;
      for (let side = SIDE_R; side <= SIDE_L; side++) {
        const v = this.last[a * 2 + side];
        this.last[a * 2 + side] = -1;
        if (v >= 0) this.leave(v);
      }
      return;
    }
    for (let v = 0; v < MAX_VEHICLES; v++) {
      if (this.active[v] === 1 && this.owner[v] === a && this.kind[v] === TUG) this.leave(v);
    }
  }

  /** Sends in the next pending crew vehicle on one side of an aircraft, in DOCK_ORDER. */
  private advance(a: number, side: number): void {
    for (let i = 0; i < DOCK_ORDER.length; i++) {
      const k = DOCK_ORDER[i];
      const bit = 1 << k;
      if ((this.pending[a] & bit) === 0 || sideOf[k] !== side) continue;
      this.pending[a] &= ~bit;
      const v = this.spawnDock(a, k);
      if (v < 0) continue;
      this.prev[v] = this.last[a * 2 + side];
      this.last[a * 2 + side] = v;
      return;
    }
  }

  private alloc(): number {
    for (let v = 0; v < MAX_VEHICLES; v++) {
      if (this.active[v] === 0) {
        this.active[v] = 1;
        this.count++;
        return v;
      }
    }
    return -1;
  }

  /** One crew vehicle, staged beside the aircraft and driven in along its cached path to its dock. Returns the vehicle, or -1 when none was placed. */
  private spawnDock(a: number, kind: number): number {
    const type = this.traffic.type[a];
    const pk = type * KINDS + kind;
    const n = pathN[pk];
    if (n < 2) return -1;
    const v = this.alloc();
    if (v < 0) return -1;
    const t = this.traffic;
    const h = t.heading[a];
    const c = cosLut(h);
    const s = sinLut(h);
    const half = AIRCRAFT[type].dimensions.lengthM / 2;
    const noseX = t.x[a] + c * half;
    const noseY = t.y[a] + s * half;
    for (let i = 0; i < n; i++) {
      const lx = pathX[pk * MAX_WP + i];
      const ly = pathY[pk * MAX_WP + i];
      this.wpX[v * MAX_WP + i] = noseX + lx * s - ly * c;
      this.wpY[v * MAX_WP + i] = noseY - lx * c - ly * s;
    }
    this.kind[v] = kind;
    this.owner[v] = a;
    this.wpN[v] = n;
    this.ti[v] = 1;
    this.x[v] = this.wpX[v * MAX_WP];
    this.y[v] = this.wpY[v * MAX_WP];
    this.heading[v] = atan2Det(this.wpY[v * MAX_WP + 1] - this.y[v], this.wpX[v * MAX_WP + 1] - this.x[v]);
    this.dockHead[v] = h + dockRel[pk];
    this.state[v] = Drive;
    this.prev[v] = -1;
    return v;
  }

  /** Queues the crew of a turnaround and sends in the first vehicle on each side. */
  private spawnCrew(a: number): void {
    this.pending[a] = crewMask[this.traffic.type[a]];
    this.last[a * 2 + SIDE_R] = -1;
    this.last[a * 2 + SIDE_L] = -1;
    this.advance(a, SIDE_R);
    this.advance(a, SIDE_L);
  }

  private spawnTug(a: number): void {
    const L = AIRCRAFT[this.traffic.type[a]].dimensions.lengthM;
    const v = this.alloc();
    if (v < 0) return;
    this.kind[v] = TUG;
    this.owner[v] = a;
    this.state[v] = Attached;
    this.lf[v] = 0.5 * L + TUG_AHEAD_M;
    this.wpX[v * MAX_WP] = this.traffic.x[a] + cosLut(this.traffic.heading[a]) * this.lf[v] - sinLut(this.traffic.heading[a]) * 30;
    this.wpY[v * MAX_WP] = this.traffic.y[a] + sinLut(this.traffic.heading[a]) * this.lf[v] + cosLut(this.traffic.heading[a]) * 30;
    this.wpN[v] = 1;
    this.ti[v] = 0;
  }
}

/** Largest distance from the axis of the polygon edges that cross station y, so a half width or wing reach reads from the outline. */
function extentAt(poly: Poly, y: number): number {
  let m = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if (p.y === q.y || (p.y - y) * (q.y - y) > 0) continue;
    const x = p.x + ((q.x - p.x) * (y - p.y)) / (q.y - p.y);
    m = Math.max(m, Math.abs(x));
  }
  return m;
}

/**
 * Convex hull, counter clockwise (monotone chain). The clash buffer of a hull equals the buffer of
 * the outline it came from, so the clash checks use hulls and skip sorting the whole outline each call.
 */
function convexHull(points: Poly): Poly {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
    upper.push(pts[i]);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Axis aligned rectangle with its long axis along the unit vector (ux, uy). */
function rectAt(cx: number, cy: number, ux: number, uy: number, lengthM: number, widthM: number): Pt[] {
  const qx = (ux * lengthM) / 2;
  const qy = (uy * lengthM) / 2;
  const px = (-uy * widthM) / 2;
  const py = (ux * widthM) / 2;
  return [
    { x: cx + qx + px, y: cy + qy + py },
    { x: cx + qx - px, y: cy + qy - py },
    { x: cx - qx - px, y: cy - qy - py },
    { x: cx - qx + px, y: cy - qy + py },
  ];
}

function clashAt(b: AircraftBoundary, g: GseSpec, cx: number, cy: number, ux: number, uy: number): boolean {
  const poly = rectAt(cx, cy, ux, uy, g.lengthM, g.widthM);
  return footprintClash(b.hard, b.over, { poly, heightM: g.heightM, docks: g.docks }, CLEARANCE_M) !== null;
}

/** True when every sample of the drive keeps clear, and the dock pose itself is clear with the dock heading. */
function driveClear(b: AircraftBoundary, g: GseSpec, pts: readonly Pt[], orient: Pt): boolean {
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const len = Math.sqrt((q.x - p.x) ** 2 + (q.y - p.y) ** 2);
    if (len === 0) continue;
    const ux = (q.x - p.x) / len;
    const uy = (q.y - p.y) / len;
    const n = Math.ceil(len / SAMPLE_M);
    for (let s = 0; s < n; s++) {
      const f = s / n;
      if (clashAt(b, g, p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, ux, uy)) return false;
    }
  }
  const last = pts[pts.length - 1];
  return !clashAt(b, g, last.x, last.y, orient.x, orient.y);
}

/** Bit of a kit kind only on aircraft at least its minimum length, since shorter aircraft are loaded by hand. */
function kitBit(kind: number, lengthM: number): number {
  return lengthM < (GSE[kind].dock?.minAircraftLengthM ?? 0) ? 0 : 1 << kind;
}

/** Kinds in the turnaround crew of one type. General aviation gets only a refueller, the large ground kit stays at airline stands. */
function crewOf(type: number): number {
  const spec = AIRCRAFT[type];
  const lengthM = spec.dimensions.lengthM;
  let crew = 1 << REFUELLER;
  if (spec.role === 'ga') return crew;
  const seats = spec.capacity.seatsTypical;
  crew |= (1 << GPU) | kitBit(BELT, lengthM) | kitBit(TRACTOR, lengthM) | kitBit(CART, lengthM);
  if (seats >= 40) crew |= 1 << CATERING;
  if (seats >= 8 && seats < 40) crew |= 1 << STAIRS;
  return crew;
}

/** Builds the drive path of every docking kind for every type, once per process, when the first sim is made. */
function prepareDockPaths(): void {
  if (pathsReady) return;
  for (let t = 0; t < TYPES; t++) {
    crewMask[t] = crewOf(t);
    buildPaths(t);
  }
  pathsReady = true;
}

/** Builds the drive path of every kind in the crew of one aircraft type. */
function buildPaths(type: number): void {
  const spec = AIRCRAFT[type];
  const fp = footprintSpecSchema.parse(SPRITE_BASES[spec.sprite.base]);
  const outline = aircraftBoundary(fp);
  const b: AircraftBoundary = { hard: outline.hard.map(convexHull), over: outline.over };
  const coupling = standGeometry(spec).fuelCouplingM;
  const L = spec.dimensions.lengthM;
  const halfSpan = spec.dimensions.wingspanM / 2;
  // Docks already placed on each side, as lateral magnitude, station, and half extents.
  const placed: { side: number; m: number; y: number; across: number; reach: number }[] = [];
  // The pushback tug couples ahead of the nose while the last crew may still be leaving, so its
  // footprint claims the centreline first on both sides and no dock parks against it.
  const tug = GSE[TUG];
  for (const side of [1, -1]) placed.push({ side, m: 0, y: -TUG_AHEAD_M, across: tug.widthM / 2, reach: tug.lengthM / 2 });
  const docks: { k: number; sign: number; m: number; y: number; perp: boolean; g: GseSpec }[] = [];
  for (const k of DOCK_ORDER) {
    const g = GSE[k];
    // Only the crew of this type claims a place, so a kit it never gets cannot push another dock outboard.
    if (!g.dock || (crewMask[type] & (1 << k)) === 0) continue;
    const d = g.dock;
    const sign = d.side === 'R' ? 1 : -1;
    const perp = d.orient === 'perp';
    const across = perp ? g.lengthM / 2 : g.widthM / 2;
    const reach = perp ? g.widthM / 2 : g.lengthM / 2;
    const y = d.station === null ? coupling.u : d.station * L;
    // The outline tapers at the tail and sweeps in the wing, so the widest point under the vehicle's span sets its lateral.
    // The clash buffer reaches the outline diagonally past the span, so the sweep reaches the gap beyond the span too.
    const sweep = reach + GAP_M;
    const widest = (poly: Poly): number => Math.max(extentAt(poly, y - sweep), extentAt(poly, y), extentAt(poly, y + sweep));
    let inner = 0;
    for (const h of b.hard) inner = Math.max(inner, widest(h));
    let base: number;
    if (d.station === null && !(d.underWing && fp.heights.wing > g.heightM)) {
      // Beyond the wingtip, so clear of the wing as well as the hard parts.
      base = Math.max(inner, widest(b.over[0].poly)) + GAP_M + across;
    } else {
      // Under the wing when the wing clears the vehicle, outboard of the engines and fuselage at this station.
      base = inner + GAP_M + across;
    }
    let m = base;
    let moved = true;
    while (moved) {
      moved = false;
      for (const q of placed) {
        if (q.side !== sign) continue;
        // The epsilon keeps a dock pushed to exactly one gap from re-triggering on rounding.
        if (Math.abs(m - q.m) < across + q.across + GAP_M - 1e-9 && Math.abs(y - q.y) < reach + q.reach + GAP_M) {
          m = q.m + q.across + GAP_M + across;
          moved = true;
        }
      }
    }
    placed.push({ side: sign, m, y, across, reach });
    docks.push({ k, sign, m, y, perp, g });
  }
  // A drive that would clash with the aircraft comes in by the clear station ahead of the nose or behind the tail.
  for (const d of docks) {
    const dock: Pt = { x: d.sign * d.m, y: d.y };
    const stage: Pt = { x: d.sign * (halfSpan + d.g.lengthM / 2 + 2), y: d.y };
    // The clear station is the one ahead of the nose or behind the tail that is nearer the dock.
    const ahead = -d.g.lengthM;
    const behind = L + d.g.lengthM;
    const clearY = Math.abs(d.y - ahead) <= Math.abs(d.y - behind) ? ahead : behind;
    const orient: Pt = d.perp ? { x: 1, y: 0 } : { x: 0, y: 1 };
    let pts: Pt[] = [stage, dock];
    if (!driveClear(b, d.g, pts, orient)) pts = [stage, { x: stage.x, y: clearY }, { x: dock.x, y: clearY }, dock];
    const pk = type * KINDS + d.k;
    for (let i = 0; i < pts.length; i++) {
      pathX[pk * MAX_WP + i] = pts[i].x;
      pathY[pk * MAX_WP + i] = pts[i].y;
    }
    pathN[pk] = pts.length;
    // A perp dock faces the fuselage with its working end, the way it drove in, so it never turns on arrival.
    dockRel[pk] = d.perp ? d.sign * (PI / 2) : 0;
  }
}
