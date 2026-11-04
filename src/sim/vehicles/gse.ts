import { AIRCRAFT } from '@data/aircraft';
import { GSE_INDEX } from '@data/index';
import { atan2Det, cosLut, sinLut } from '@shared/trig';
import { AcState, MAX_AIRCRAFT, type Traffic } from '../ops/traffic';

export const MAX_VEHICLES = 1024;

/** Vehicle life cycle. */
const Drive = 1;
const Work = 2;
const Leave = 3;
const Attached = 4;

const SPEED_MPS = 6;
const STEP_M = SPEED_MPS * 0.1;

const TUG = GSE_INDEX.tug;
const GPU = GSE_INDEX.gpu;
const REFUELLER = GSE_INDEX.refueller;
const BELT = GSE_INDEX.beltloader;
const TRACTOR = GSE_INDEX.tractor;
const CART = GSE_INDEX.cart;
const CATERING = GSE_INDEX.catering;
const STAIRS = GSE_INDEX.stairs;

/**
 * Ground support equipment for turnarounds. Vehicles are a presentation of the turnaround:
 * they drive from beside the stand to their service point at the aircraft, wait there, and leave
 * when the aircraft moves. They never change aircraft timing, so they are not part of saves or hashes.
 * Positions come from the aircraft frame, so a vehicle never needs a path search (hard rule 7).
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
  private readonly tx = new Float64Array(MAX_VEHICLES);
  private readonly ty = new Float64Array(MAX_VEHICLES);
  private readonly sx = new Float64Array(MAX_VEHICLES);
  private readonly sy = new Float64Array(MAX_VEHICLES);
  /** Local offset in the aircraft frame for attached vehicles. */
  private readonly lf = new Float64Array(MAX_VEHICLES);
  /** Flight the aircraft slot was serviced for, so a turnaround spawns its crew once. */
  private readonly served = new Int32Array(MAX_AIRCRAFT).fill(-1);
  private readonly tugged = new Int32Array(MAX_AIRCRAFT).fill(-1);

  constructor(private readonly traffic: Traffic) {}

  reset(): void {
    this.active.fill(0);
    this.owner.fill(-1);
    this.served.fill(-1);
    this.tugged.fill(-1);
    this.count = 0;
  }

  // hot
  update(): void {
    const t = this.traffic;
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
    const dx = this.tx[v] - this.x[v];
    const dy = this.ty[v] - this.y[v];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= STEP_M) {
      this.x[v] = this.tx[v];
      this.y[v] = this.ty[v];
      if (this.state[v] === Leave) this.free(v);
      else this.state[v] = Work;
      return;
    }
    this.heading[v] = atan2Det(dy, dx);
    this.x[v] += (dx / d) * STEP_M;
    this.y[v] += (dy / d) * STEP_M;
  }

  private free(v: number): void {
    this.active[v] = 0;
    this.owner[v] = -1;
    this.count--;
  }

  /** Sends the vehicles of an aircraft away. Tugs are released separately from the turnaround crew. */
  private release(a: number, tugs: boolean): void {
    for (let v = 0; v < MAX_VEHICLES; v++) {
      if (this.active[v] === 0 || this.owner[v] !== a) continue;
      if ((this.kind[v] === TUG) !== tugs) continue;
      this.state[v] = Leave;
      this.tx[v] = this.sx[v];
      this.ty[v] = this.sy[v];
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

  /**
   * One vehicle from beside the stand to a point at fwd and side (meters along and to the right of
   * the nose direction). It starts 40 m out on its own side so left and right crews do not cross.
   */
  private spawn(a: number, kind: number, fwd: number, side: number): void {
    const v = this.alloc();
    if (v < 0) return;
    const t = this.traffic;
    const h = t.heading[a];
    const cx = cosLut(h);
    const cy = sinLut(h);
    const rx = -cy;
    const ry = cx;
    this.kind[v] = kind;
    this.owner[v] = a;
    this.tx[v] = t.x[a] + cx * fwd + rx * side;
    this.ty[v] = t.y[a] + cy * fwd + ry * side;
    const out = side >= 0 ? 40 : -40;
    this.sx[v] = this.tx[v] + rx * out;
    this.sy[v] = this.ty[v] + ry * out;
    this.x[v] = this.sx[v];
    this.y[v] = this.sy[v];
    this.heading[v] = atan2Det(this.ty[v] - this.sy[v], this.tx[v] - this.sx[v]);
    this.state[v] = Drive;
  }

  private spawnCrew(a: number): void {
    const spec = AIRCRAFT[this.traffic.type[a]];
    const L = spec.dimensions.lengthM;
    const half = spec.dimensions.fuselageWidthM / 2;
    const span = spec.dimensions.wingspanM;
    const seats = spec.capacity.seatsTypical;
    this.spawn(a, GPU, 0.36 * L, -(half + 2.2));
    this.spawn(a, REFUELLER, -0.04 * L, span * 0.3);
    this.spawn(a, BELT, -0.22 * L, half + 4.2);
    this.spawn(a, TRACTOR, -0.22 * L - 7, half + 6.5);
    this.spawn(a, CART, -0.22 * L - 11, half + 6.5);
    if (seats >= 40) this.spawn(a, CATERING, 0.22 * L, -(half + 6));
    if (seats >= 8 && seats < 40) this.spawn(a, STAIRS, 0.2 * L, -(half + 3.2));
  }

  private spawnTug(a: number): void {
    const L = AIRCRAFT[this.traffic.type[a]].dimensions.lengthM;
    const v = this.alloc();
    if (v < 0) return;
    this.kind[v] = TUG;
    this.owner[v] = a;
    this.state[v] = Attached;
    this.lf[v] = 0.5 * L + 3;
    this.sx[v] = this.traffic.x[a] + cosLut(this.traffic.heading[a]) * this.lf[v] - sinLut(this.traffic.heading[a]) * 30;
    this.sy[v] = this.traffic.y[a] + sinLut(this.traffic.heading[a]) * this.lf[v] + cosLut(this.traffic.heading[a]) * 30;
  }
}
