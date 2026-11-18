import { AIRCRAFT, SPRITE_BASES, standGeometry } from '@data/aircraft';
import { GROUND, GSE, GSE_INDEX, type GseSpec } from '@data/index';
import { aircraftBoundary, footprintClash, footprintSpecSchema, type AircraftBoundary, type Poly } from '@shared/aircraftFootprint';
import type { Pt } from '@shared/geom';
import { followHitch, type TowPose } from '@shared/trailer';
import { atan2Det, cosLut, PI, sinLut } from '@shared/trig';
import { AcState, MAX_AIRCRAFT, type Traffic } from '../ops/traffic';
import type { RoadNet } from './roads';

export const MAX_VEHICLES = 1024;

/** Vehicle life cycle. */
const Drive = 1;
const Work = 2;
/** Life cycle state of a vehicle at its dock, for tests that read the pose there. */
export const WORK_STATE = Work;
const Leave = 3;
const Attached = 4;
/** On the service road from the depot to the stand connection point, and back. */
const RoadIn = 5;
const RoadOut = 6;
/** A cart towed behind the vehicle in `lead`. */
const Towed = 7;

/** Meters per tick on the apron lanes and stand paths, and over the last meters to the dock (D17). */
const APRON_STEP_M = (GROUND.apronLane.speedKmh / 3.6) * 0.1;
const SLOW_STEP_M = (GROUND.approach.speedKmh / 3.6) * 0.1;

/** Most waypoints of a stand path: the strip point, staging, up to three detour points and the dock. */
const MAX_WP = 8;
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
/** How far a vehicle looks ahead for one to follow on a road, in meters. */
const FOLLOW_LOOK_M = 16;
/** How far behind the tail a train turns in to its dock line, in meters. */
const TRAIN_AFT_M = 8;
/** How far forward a leaving train may angle out from its dock, tried in order until the drive is clear, in meters. */
const TRAIN_LEAVE_RISE_M = [6, 3];
/** Longest cart train behind a tractor, hitches included, in meters. */
const TRAIN_MAX_M = GROUND.cartsPerTrain.xl * (GSE[GSE_INDEX.cart].lengthM + GROUND.train.hitchGapM);
/** How far inside the stand's top edge the stand path begins, in meters. */
const STAND_EDGE_IN_M = 2.5;
/** Ticks before the end of a turnaround at which the crew leaves. */
const CLEAR_LEAD_TICKS = GROUND.crewClearLeadS * 10;
/** Ticks a vehicle waits for a junction before it drives on regardless, so two vehicles never lock each other. */
const NODE_PATIENCE = 300;
/** Depot exit must be this clear of other vehicles before the next one leaves, in meters. */
const EXIT_CLEAR_M = 12;

const TUG = GSE_INDEX.tug;
const GPU = GSE_INDEX.gpu;
const REFUELLER = GSE_INDEX.refueller;
const BELT = GSE_INDEX.beltloader;
const TRACTOR = GSE_INDEX.tractor;
const CART = GSE_INDEX.cart;
const CATERING = GSE_INDEX.catering;
const STAIRS = GSE_INDEX.stairs;
const CART_ARM = GROUND.train.hitchGapM + GSE[CART].lengthM / 2;

/**
 * Order in which crews drive in on each side, and in which docks claim their lateral place, inboard first.
 * A dock that would overlap an earlier one on its side is pushed outboard of it, so a straight drive in
 * never passes a parked vehicle. The kind index is the saved fleet index, so gse.json order cannot carry this.
 * Carts claim their place but never drive alone: they come towed behind the tractor (T60).
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
 * once on first use. A path is the staging point, then the dock, with detour points when the
 * straight drive would clash. Its dock heading is relative to the aircraft heading.
 * The tractor's train has its own arrival and leave paths, round the tail in and forward out.
 */
const pathX = new Float64Array(TYPES * KINDS * MAX_WP);
const pathY = new Float64Array(TYPES * KINDS * MAX_WP);
const pathN = new Uint8Array(TYPES * KINDS);
const dockRel = new Float64Array(TYPES * KINDS);
const trainOutX = new Float64Array(TYPES * MAX_WP);
const trainOutY = new Float64Array(TYPES * MAX_WP);
const trainOutN = new Uint8Array(TYPES);
/** Kinds in the turnaround crew of each type, one bit per kind. */
const crewMask = new Uint32Array(TYPES);
let pathsReady = false;

/** Hooks the vehicles read from the rest of the sim: the road net, the stand of an aircraft, carts per train and the fleet. */
export interface GseHost {
  roads: RoadNet;
  /** Stand index the aircraft is parked on, or -1. */
  standIndexOf(a: number): number;
  /** Carts per train for the aircraft's stand size. */
  cartsFor(a: number): number;
  /** Vehicles of a kind the airport owns. */
  owned(kind: number): number;
  /** Catering trucks the catering units hold. */
  cateringTrucks(): number;
}

/**
 * Ground support equipment for turnarounds (T60). With a depot and a service road to the stand, crew
 * vehicles leave the depot one at a time, drive the precomputed lane of the stand's route, then their
 * stand path to the dock, and leave the same way. Without one they appear at the stand's road point, as
 * before roads existed. Junctions and taxiway crossings are held by one vehicle at a time, a crossing
 * also waits for aircraft on the crossed taxiway, and vehicles keep their gap to the one ahead.
 * Vehicles never change aircraft timing yet, so they are not part of saves or hashes (T63 makes them so).
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
  /** The vehicle a towed cart hangs behind, and the cart behind each vehicle, or -1. */
  readonly lead = new Int32Array(MAX_VEHICLES).fill(-1);
  readonly tail = new Int32Array(MAX_VEHICLES).fill(-1);
  /** World waypoints of each vehicle's stand path, and the waypoint it drives to. */
  private readonly wpX = new Float64Array(MAX_VEHICLES * MAX_WP);
  private readonly wpY = new Float64Array(MAX_VEHICLES * MAX_WP);
  private readonly wpN = new Uint8Array(MAX_VEHICLES);
  private readonly ti = new Uint8Array(MAX_VEHICLES);
  /** Leave path of a train tractor, forward and out, in world waypoints; zero length for every other vehicle. */
  private readonly outX = new Float64Array(MAX_VEHICLES * MAX_WP);
  private readonly outY = new Float64Array(MAX_VEHICLES * MAX_WP);
  private readonly outN = new Uint8Array(MAX_VEHICLES);
  /** Heading the vehicle takes once it reaches its dock. */
  private readonly dockHead = new Float64Array(MAX_VEHICLES);
  /** Local offset in the aircraft frame for attached vehicles. */
  private readonly lf = new Float64Array(MAX_VEHICLES);
  /** Road route: stand index, the next lane point, and the road net build the route belongs to. */
  private readonly rStand = new Int32Array(MAX_VEHICLES).fill(-1);
  private readonly ri = new Int32Array(MAX_VEHICLES);
  private readonly rVer = new Int32Array(MAX_VEHICLES);
  /** Up to two road nodes a vehicle holds, and how long it has waited for the next. */
  private readonly held = new Int32Array(MAX_VEHICLES * 2).fill(-1);
  private readonly waited = new Int32Array(MAX_VEHICLES);
  /** The vehicle ahead on the road, refreshed a few times a second, or -1. */
  private readonly ahead = new Int32Array(MAX_VEHICLES).fill(-1);
  /** 1 when the vehicle leaves as soon as it reaches the stand, because its aircraft left first. */
  private readonly turnBack = new Uint8Array(MAX_VEHICLES);
  /** Vehicles of each kind out of their depot, and catering trucks out of the catering units. */
  private readonly out = new Int32Array(KINDS);
  private outUnit = 0;
  /** Flight the aircraft slot was serviced for, so a turnaround spawns its crew once. */
  private readonly served = new Int32Array(MAX_AIRCRAFT).fill(-1);
  /** 1 once an aircraft's crew was sent away ahead of the end of its turnaround. */
  private readonly cleared = new Uint8Array(MAX_AIRCRAFT);
  /** Turnaround timer when the crew was called, so a short turnaround keeps its crew for two thirds of it. */
  private readonly turnAt = new Int32Array(MAX_AIRCRAFT);
  /**
   * The vehicle on the leg between an aircraft's road point and its stand path, or -1. One at a time,
   * so crews from both sides never meet where the road ends.
   */
  private readonly front = new Int32Array(MAX_AIRCRAFT).fill(-1);
  private readonly tugged = new Int32Array(MAX_AIRCRAFT).fill(-1);
  /**
   * Crew sequencing per aircraft side, in DOCK_ORDER: a vehicle drives in only once
   * the one before it on its side is docked, and leaves only once the one after it has gone.
   * pending holds one bit per kind still to drive in, last the newest vehicle on each side, and prev
   * links each vehicle to the one that docked before it on its side. waiting marks a side whose next
   * vehicle waits for the depot exit to clear.
   */
  private readonly pending = new Uint32Array(MAX_AIRCRAFT);
  private readonly waiting = new Uint8Array(MAX_AIRCRAFT * 2);
  private readonly last = new Int32Array(MAX_AIRCRAFT * 2).fill(-1);
  private readonly prev = new Int32Array(MAX_VEHICLES).fill(-1);
  private readonly pose: TowPose = { x: 0, y: 0, heading: 0 };
  private roadVersion = -1;
  private phase = 0;

  constructor(
    private readonly traffic: Traffic,
    private readonly host: GseHost | null = null,
  ) {
    prepareDockPaths();
  }

  reset(): void {
    this.active.fill(0);
    this.owner.fill(-1);
    this.served.fill(-1);
    this.tugged.fill(-1);
    this.cleared.fill(0);
    this.front.fill(-1);
    this.pending.fill(0);
    this.waiting.fill(0);
    this.last.fill(-1);
    this.prev.fill(-1);
    this.lead.fill(-1);
    this.tail.fill(-1);
    this.held.fill(-1);
    this.out.fill(0);
    this.outUnit = 0;
    this.count = 0;
  }

  // hot
  update(): void {
    const t = this.traffic;
    if (this.host && this.host.roads.version !== this.roadVersion) this.onRoadsRebuilt();
    // Crews only change when an aircraft changes state, so look for that twice a second.
    if (this.phase++ % 5 === 0) {
      this.scan(t);
      if (this.count > 0) this.findAhead();
    }
    if (this.count === 0) return;
    this.move(t);
  }

  /** True when a vehicle is at its dock: docked itself, or a cart in a train whose tractor is docked. */
  isDocked(v: number): boolean {
    return this.state[this.trainHead(v)] === Work;
  }

  /** True when vehicle b belongs to the same train as a. */
  sameTrain(a: number, b: number): boolean {
    return this.trainHead(a) === this.trainHead(b);
  }

  private trainHead(v: number): number {
    let h = v;
    while (this.lead[h] >= 0) h = this.lead[h];
    return h;
  }

  /** Routes of an older road net are gone: vehicles on the way in jump to their stand, those on the way out go home. */
  private onRoadsRebuilt(): void {
    const roads = this.host!.roads;
    this.roadVersion = roads.version;
    this.held.fill(-1);
    for (let v = 0; v < MAX_VEHICLES; v++) {
      if (this.active[v] === 0) continue;
      if (this.state[v] === RoadIn) this.reachStand(v);
      else if (this.state[v] === RoadOut) this.free(v);
    }
  }

  private scan(t: Traffic): void {
    for (let a = 0; a < MAX_AIRCRAFT; a++) {
      const st = t.state[a];
      const f = t.flight[a];
      if (st === AcState.Turnaround && f >= 0 && this.served[a] !== f) {
        this.served[a] = f;
        this.cleared[a] = 0;
        this.turnAt[a] = t.timer[a];
        this.spawnCrew(a);
      } else if (st !== AcState.Turnaround && this.served[a] !== -1) {
        this.served[a] = -1;
        if (this.cleared[a] === 0) this.release(a, false);
        this.cleared[a] = 0;
      } else if (st === AcState.Turnaround && this.cleared[a] === 0 && t.timer[a] <= Math.min(CLEAR_LEAD_TICKS, this.turnAt[a] / 3)) {
        // The crew starts to leave before the turnaround ends, so the stand is clear by pushback.
        this.cleared[a] = 1;
        this.release(a, false);
      }
      if (this.served[a] !== -1) {
        for (let side = SIDE_R; side <= SIDE_L; side++) if (this.waiting[a * 2 + side] === 1) this.advance(a, side);
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

  /** For every vehicle on a road, the nearest one ahead in its lane. Quadratic, but only a few times a second. */
  private findAhead(): void {
    for (let v = 0; v < MAX_VEHICLES; v++) {
      this.ahead[v] = -1;
      if (this.active[v] === 0 || (this.state[v] !== RoadIn && this.state[v] !== RoadOut)) continue;
      const hx = cosLut(this.heading[v]);
      const hy = sinLut(this.heading[v]);
      let best = FOLLOW_LOOK_M;
      for (let o = 0; o < MAX_VEHICLES; o++) {
        if (o === v || this.active[o] === 0 || this.lead[o] === v) continue;
        const dx = this.x[o] - this.x[v];
        const dy = this.y[o] - this.y[v];
        const along = dx * hx + dy * hy;
        if (along <= 0 || along >= best) continue;
        const across = dx * hy - dy * hx;
        if (across > 1.5 || across < -1.5) continue;
        // Only a vehicle going the same way is followed; oncoming ones keep to their own lane.
        if (cosLut(this.heading[o]) * hx + sinLut(this.heading[o]) * hy < 0.5) continue;
        best = along;
        this.ahead[v] = o;
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
      } else if (s === RoadIn || s === RoadOut) {
        this.stepRoad(v);
      } else if (s === Drive || s === Leave) {
        this.step(v);
      }
    }
    // Carts follow their lead after every lead has moved.
    for (let v = 0; v < MAX_VEHICLES; v++) {
      if (this.active[v] === 0 || this.lead[v] >= 0 || this.tail[v] < 0) continue;
      let lead = v;
      for (let c = this.tail[v]; c >= 0; c = this.tail[c]) {
        const g = GSE[this.kind[lead]];
        const hx = this.x[lead] - cosLut(this.heading[lead]) * (g.lengthM / 2);
        const hy = this.y[lead] - sinLut(this.heading[lead]) * (g.lengthM / 2);
        this.pose.heading = this.heading[c];
        followHitch(hx, hy, this.x[c], this.y[c], CART_ARM, this.pose);
        this.x[c] = this.pose.x;
        this.y[c] = this.pose.y;
        this.heading[c] = this.pose.heading;
        lead = c;
      }
    }
  }

  /** True when the vehicle ahead is too close to move on. */
  private blocked(v: number): boolean {
    const o = this.ahead[v];
    if (o < 0 || this.active[o] === 0) return false;
    const dx = this.x[o] - this.x[v];
    const dy = this.y[o] - this.y[v];
    const need = (GSE[this.kind[v]].lengthM + GSE[this.kind[o]].lengthM) / 2 + GROUND.vehicleGapM;
    return dx * dx + dy * dy < need * need;
  }

  /**
   * One tick along the road lane. Before a junction or crossing node the vehicle must hold it; a crossing
   * is only taken while no aircraft is on or about to enter the crossed taxiway section.
   */
  private stepRoad(v: number): void {
    const roads = this.host!.roads;
    if (this.blocked(v)) return;
    const k = this.ri[v];
    const node = roads.ptNode[k];
    const dx = roads.ptX[k] - this.x[v];
    const dy = roads.ptY[k] - this.y[v];
    const d = Math.sqrt(dx * dx + dy * dy);
    const holdM = roads.nodeHoldM[node];
    // The vehicle's front stops at the hold distance, so it never noses past a hold line.
    if (holdM > 0 && d - GSE[this.kind[v]].lengthM / 2 <= holdM && !this.holds(v, node)) {
      if (!this.tryHold(v, node)) {
        if (++this.waited[v] < NODE_PATIENCE) return;
      }
      this.waited[v] = 0;
    }
    this.releasePassed(v);
    const s0 = this.rStand[v];
    // Home: a returning vehicle drives into the depot once its front reaches the door.
    if (this.state[v] === RoadOut && k === roads.outStart[s0] + roads.outLen[s0] - 1 && d <= GSE[this.kind[v]].lengthM / 2) {
      this.free(v);
      return;
    }
    const step = Math.max(roads.ptStep[k > 0 ? k - 1 : k], SLOW_STEP_M);
    if (d <= step) {
      this.x[v] = roads.ptX[k];
      this.y[v] = roads.ptY[k];
      const s = this.rStand[v];
      const end = this.state[v] === RoadIn ? roads.inStart[s] + roads.inLen[s] : roads.outStart[s] + roads.outLen[s];
      if (k + 1 < end) {
        this.ri[v] = k + 1;
        return;
      }
      if (this.state[v] === RoadIn) this.reachStand(v);
      else this.free(v);
      return;
    }
    // On the way out, the leg is free once the vehicle is past the first lane point; then the one before it may go.
    if (this.state[v] === RoadOut && k > roads.outStart[this.rStand[v]] + 1 && this.front[this.owner[v]] === v) {
      this.leaveFront(v);
      this.sendPrev(v);
    }
    this.heading[v] = atan2Det(dy, dx);
    this.x[v] += (dx / d) * step;
    this.y[v] += (dy / d) * step;
  }

  private holds(v: number, node: number): boolean {
    return this.held[v * 2] === node || this.held[v * 2 + 1] === node;
  }

  private tryHold(v: number, node: number): boolean {
    const roads = this.host!.roads;
    const owner = roads.nodeOwner[node];
    if (owner >= 0 && owner !== v) return false;
    const slot = roads.nodeCrossSlot[node];
    if (slot >= 0 && this.traffic.taxiOnEdges(roads.crossMark[slot])) return false;
    roads.nodeOwner[node] = v;
    const i = this.held[v * 2] < 0 ? v * 2 : v * 2 + 1;
    if (this.held[i] >= 0) roads.nodeOwner[this.held[i]] = -1;
    this.held[i] = node;
    return true;
  }

  /** Lets go of held nodes the vehicle and its carts are clear of. */
  private releasePassed(v: number): void {
    const roads = this.host!.roads;
    let trainM = GSE[this.kind[v]].lengthM / 2;
    for (let c = this.tail[v]; c >= 0; c = this.tail[c]) trainM += GSE[CART].lengthM + GROUND.train.hitchGapM;
    for (let i = v * 2; i <= v * 2 + 1; i++) {
      const n = this.held[i];
      if (n < 0 || roads.ptNode[this.ri[v]] === n) continue;
      const dx = roads.graph.nodeX[n] - this.x[v];
      const dy = roads.graph.nodeY[n] - this.y[v];
      const clear = roads.nodeHoldM[n] + trainM;
      if (dx * dx + dy * dy > clear * clear) {
        roads.nodeOwner[n] = -1;
        this.held[i] = -1;
      }
    }
  }

  private dropHeld(v: number): void {
    if (!this.host) return;
    for (let i = v * 2; i <= v * 2 + 1; i++) {
      const n = this.held[i];
      if (n >= 0 && this.host.roads.nodeOwner[n] === v) this.host.roads.nodeOwner[n] = -1;
      this.held[i] = -1;
    }
  }

  /**
   * A vehicle at its stand's road point starts its stand path once the leg to it is free, or turns straight
   * back when its aircraft has left. Returns false while it waits.
   */
  private reachStand(v: number): boolean {
    const a = this.owner[v];
    if (this.turnBack[v] === 0 && this.front[a] >= 0 && this.front[a] !== v) return false;
    this.dropHeld(v);
    if (this.turnBack[v] === 1) {
      this.turnBack[v] = 0;
      this.ti[v] = 0;
      this.state[v] = Leave;
      this.endLeave(v);
      return true;
    }
    // Along the strip from the connection point to the stand path's first point, then on to the dock.
    this.front[a] = v;
    this.ti[v] = 0;
    this.state[v] = Drive;
    return true;
  }

  /** Takes the leg between the stand and its road point for a vehicle that goes home by road. False while another holds it. */
  private takeFront(v: number): boolean {
    const a = this.owner[v];
    if (this.rStand[v] < 0 || a < 0) return true;
    if (this.front[a] >= 0 && this.front[a] !== v) return false;
    this.front[a] = v;
    return true;
  }

  /** Frees the leg between the stand and its road point when this vehicle holds it. */
  private leaveFront(v: number): void {
    const a = this.owner[v];
    if (a >= 0 && this.front[a] === v) this.front[a] = -1;
  }

  private step(v: number): void {
    const leaving = this.state[v] === Leave;
    const useOut = leaving && this.outN[v] > 0;
    const k = v * MAX_WP + this.ti[v];
    const tx = useOut ? this.outX[k] : this.wpX[k];
    const ty = useOut ? this.outY[k] : this.wpY[k];
    const dx = tx - this.x[v];
    const dy = ty - this.y[v];
    const d = Math.sqrt(dx * dx + dy * dy);
    // The last meters to the dock are driven slowly.
    const toDock = !leaving && this.ti[v] === this.wpN[v] - 1 && d <= GROUND.approach.slowLastM;
    const stepM = toDock ? SLOW_STEP_M : APRON_STEP_M;
    if (d <= stepM) {
      this.x[v] = tx;
      this.y[v] = ty;
      if (leaving) {
        // At the waiting point the vehicle takes the leg to the road before it drives onto the road line.
        if (useOut) {
          if (this.ti[v] === this.outN[v] - 1) this.endLeave(v);
          else if (this.ti[v] !== this.outN[v] - 2 || this.takeFront(v)) this.ti[v]++;
        } else if (this.ti[v] === 0) this.endLeave(v);
        else if (this.ti[v] !== 1 || this.takeFront(v)) this.ti[v]--;
      } else if (this.ti[v] <= 1) {
        // On the leg from the road line to the waiting point; the leg is free once the vehicle is in the box.
        if (this.ti[v] === 1) this.leaveFront(v);
        this.ti[v]++;
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
    this.x[v] += (dx / d) * stepM;
    this.y[v] += (dy / d) * stepM;
  }

  /** A leaving vehicle back at its stand's road point: home along the road when there is one, else gone. Sends the one that docked before it away. */
  private endLeave(v: number): void {
    const s = this.rStand[v];
    const roads = this.host?.roads;
    if (roads && s >= 0 && this.rVer[v] === roads.version && s < roads.standRoad.length && roads.standRoad[s] === 1) {
      const a = this.owner[v];
      // Wait at the end of the stand path until the leg to the road is free.
      if (this.front[a] >= 0 && this.front[a] !== v) return;
      this.front[a] = v;
      this.state[v] = RoadOut;
      this.ri[v] = roads.outStart[s];
      return;
    }
    this.sendPrev(v);
    this.free(v);
  }

  /** Sends away the crew member that docked before this one on its side. */
  private sendPrev(v: number): void {
    const before = this.prev[v];
    this.prev[v] = -1;
    if (before >= 0) this.leave(before);
  }

  /** Frees a vehicle and the carts it tows. */
  private free(v: number): void {
    this.dropHeld(v);
    this.leaveFront(v);
    this.sendPrev(v);
    for (let c = v; c >= 0; ) {
      const next = this.tail[c];
      const unit = this.host !== null && this.rStand[c] >= this.host.roads.standCount;
      if (unit && this.outUnit > 0) this.outUnit--;
      else if (this.rStand[c] >= 0 && this.out[this.kind[c]] > 0) this.out[this.kind[c]]--;
      this.active[c] = 0;
      this.owner[c] = -1;
      this.lead[c] = -1;
      this.tail[c] = -1;
      this.rStand[c] = -1;
      this.outN[c] = 0;
      this.turnBack[c] = 0;
      this.count--;
      c = next;
    }
  }

  /** Turns a vehicle back along its drive. A vehicle still on the road in turns back once it reaches the stand. */
  private leave(v: number): void {
    const s = this.state[v];
    if (s === Leave || s === RoadOut) return;
    if (s === RoadIn) {
      this.turnBack[v] = 1;
      return;
    }
    if (this.outN[v] > 0 && s === Work) {
      // A train drives forward and out, never back through its carts.
      this.ti[v] = 1;
      this.state[v] = Leave;
      return;
    }
    this.outN[v] = 0;
    if (s === Work) this.ti[v] = this.wpN[v] - 2;
    else if (s === Drive) this.ti[v] = Math.max(0, this.ti[v] - 1);
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
        this.waiting[a * 2 + side] = 0;
        const v = this.last[a * 2 + side];
        this.last[a * 2 + side] = -1;
        if (v >= 0) this.leave(v);
      }
      return;
    }
    for (let v = 0; v < MAX_VEHICLES; v++) {
      if (this.active[v] === 1 && this.owner[v] === a && this.kind[v] === TUG) this.free(v);
    }
  }

  /** Sends in the next pending crew vehicle on one side of an aircraft, in DOCK_ORDER. */
  private advance(a: number, side: number): void {
    this.waiting[a * 2 + side] = 0;
    for (let i = 0; i < DOCK_ORDER.length; i++) {
      const k = DOCK_ORDER[i];
      const bit = 1 << k;
      if ((this.pending[a] & bit) === 0 || sideOf[k] !== side) continue;
      const v = this.spawnDock(a, k);
      if (v === -2) {
        // The depot exit is busy: try again on the next scan.
        this.waiting[a * 2 + side] = 1;
        return;
      }
      this.pending[a] &= ~bit;
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
        this.lead[v] = -1;
        this.tail[v] = -1;
        this.rStand[v] = -1;
        this.outN[v] = 0;
        this.turnBack[v] = 0;
        this.ahead[v] = -1;
        this.waited[v] = 0;
        return v;
      }
    }
    return -1;
  }

  /** True when no vehicle stands within the clear radius of a point. */
  private clearAt(x: number, y: number): boolean {
    for (let v = 0; v < MAX_VEHICLES; v++) {
      if (this.active[v] === 0) continue;
      const dx = this.x[v] - x;
      const dy = this.y[v] - y;
      if (dx * dx + dy * dy < EXIT_CLEAR_M * EXIT_CLEAR_M) return false;
    }
    return true;
  }

  /**
   * One crew vehicle for an aircraft. With a road from a depot it leaves the depot when the exit is clear
   * and one of its kind is free (-2 while the exit is busy, -1 when none is free); without a road it
   * appears at the stand's road point. A tractor brings its train of carts. Returns the vehicle.
   */
  private spawnDock(a: number, kind: number): number {
    const t = this.traffic;
    const type = t.type[a];
    const pk = type * KINDS + kind;
    const n = pathN[pk];
    if (n < 2) return -1;
    const host = this.host;
    const roads = host?.roads;
    const s = host ? host.standIndexOf(a) : -1;
    // A catering truck comes from a catering unit that reaches the stand and has a truck free, else from a depot (T65).
    const nS = roads ? roads.standCount : 0;
    const fromUnit = !!roads && kind === CATERING && s >= 0 && s < nS && roads.standRoad[nS + s] === 1 && this.outUnit < host!.cateringTrucks();
    const r = fromUnit ? nS + s : s;
    const routed = !!roads && s >= 0 && s < nS && roads.standRoad[r] === 1;
    const carts = kind === TRACTOR && host ? host.cartsFor(a) : 0;
    if (routed) {
      if (!fromUnit && this.out[kind] >= host!.owned(kind)) return -1;
      if (!this.clearAt(roads!.ptX[roads!.inStart[r]], roads!.ptY[roads!.inStart[r]])) return -2;
    }
    const v = this.alloc();
    if (v < 0) return -1;
    const h = t.heading[a];
    const c = cosLut(h);
    const sn = sinLut(h);
    const half = AIRCRAFT[type].dimensions.lengthM / 2;
    const noseX = t.x[a] + c * half;
    const noseY = t.y[a] + sn * half;
    const toWorld = (lx: number, ly: number, out: Float64Array, outY: Float64Array, i: number): void => {
      out[v * MAX_WP + i] = noseX + lx * sn - ly * c;
      outY[v * MAX_WP + i] = noseY - lx * c - ly * sn;
    };
    // The stand path starts at the stand's road point, level with the staging point: ahead of the nose, outside the span.
    // Long vehicles wait deeper inside the box, so no part of them pokes onto the road.
    // The stand path starts on the road line level with the staging point, so the vehicle never cuts across in front
    // of the nose, then turns into the box to its waiting point, deeper for long vehicles, and on to the dock.
    this.roadLines(a, s, noseX, noseY, c, sn, this.lines);
    const roadLy = this.lines[0];
    const waitLy = this.lines[1] + GSE[kind].lengthM / 2;
    toWorld(pathX[pk * MAX_WP], roadLy, this.wpX, this.wpY, 0);
    toWorld(pathX[pk * MAX_WP], waitLy, this.wpX, this.wpY, 1);
    for (let i = 0; i < n; i++) toWorld(pathX[pk * MAX_WP + i], pathY[pk * MAX_WP + i], this.wpX, this.wpY, i + 2);
    this.wpN[v] = n + 2;
    if (kind === TRACTOR) {
      const m = trainOutN[type];
      toWorld(trainOutX[type * MAX_WP + m - 1], waitLy, this.outX, this.outY, m);
      toWorld(trainOutX[type * MAX_WP + m - 1], roadLy, this.outX, this.outY, m + 1);
      for (let i = 0; i < m; i++) toWorld(trainOutX[type * MAX_WP + i], trainOutY[type * MAX_WP + i], this.outX, this.outY, i);
      this.outN[v] = m + 2;
    }
    this.kind[v] = kind;
    this.owner[v] = a;
    this.dockHead[v] = h + dockRel[pk];
    this.prev[v] = -1;
    if (routed) {
      this.rStand[v] = r;
      this.rVer[v] = roads!.version;
      if (fromUnit) this.outUnit++;
      else this.out[kind]++;
      // The vehicle, and its train, start just outside the depot door, so no part of them is in the building.
      const trainM = GSE[kind].lengthM + carts * (GSE[CART].lengthM + GROUND.train.hitchGapM);
      this.placeAlong(v, roads!, roads!.inStart[r], roads!.inStart[r] + roads!.inLen[r], trainM);
      this.state[v] = RoadIn;
    } else {
      this.ti[v] = 1;
      this.x[v] = this.wpX[v * MAX_WP];
      this.y[v] = this.wpY[v * MAX_WP];
      this.heading[v] = atan2Det(this.wpY[v * MAX_WP + 1] - this.y[v], this.wpX[v * MAX_WP + 1] - this.x[v]);
      this.state[v] = Drive;
    }
    if (carts > 0) this.hitchCarts(v, routed ? Math.min(carts, host!.owned(CART) - this.out[CART]) : carts, routed);
    return v;
  }

  /** Puts a vehicle the given distance along a lane from its first point, heading along it, with ri on the next point. */
  private placeAlong(v: number, roads: RoadNet, from: number, end: number, distM: number): void {
    let left = distM;
    let k = from;
    while (k + 1 < end) {
      const dx = roads.ptX[k + 1] - roads.ptX[k];
      const dy = roads.ptY[k + 1] - roads.ptY[k];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len >= left || k + 2 === end) {
        const f = len > 0 ? Math.min(1, left / len) : 0;
        this.x[v] = roads.ptX[k] + dx * f;
        this.y[v] = roads.ptY[k] + dy * f;
        this.heading[v] = atan2Det(dy, dx);
        this.ri[v] = k + 1;
        return;
      }
      left -= len;
      k++;
    }
  }

  /** Hangs carts behind a tractor in a straight line along its heading. */
  private hitchCarts(v: number, n: number, routed: boolean): void {
    let lead = v;
    let back = GSE[this.kind[v]].lengthM / 2 + CART_ARM;
    for (let i = 0; i < n; i++) {
      const c = this.alloc();
      if (c < 0) return;
      this.kind[c] = CART;
      this.owner[c] = this.owner[v];
      this.state[c] = Towed;
      this.heading[c] = this.heading[v];
      this.x[c] = this.x[v] - cosLut(this.heading[v]) * back;
      this.y[c] = this.y[v] - sinLut(this.heading[v]) * back;
      if (routed) {
        this.rStand[c] = this.rStand[v];
        this.out[CART]++;
      }
      this.lead[c] = lead;
      this.tail[lead] = c;
      lead = c;
      back += GSE[CART].lengthM / 2 + GROUND.train.hitchGapM + CART_ARM;
    }
  }

  /**
   * Aircraft frame stations of the stand's road line (the connection point) and of its waiting line, just inside
   * the stand's top edge so a vehicle waiting there is off the road. With no connection point both sit ahead of the nose.
   */
  private roadLines(a: number, s: number, noseX: number, noseY: number, c: number, sn: number, out: Float64Array): void {
    const roads = this.host?.roads;
    if (roads && s >= 0 && s < roads.graph.standConn.length && roads.graph.standConn[s] >= 0) {
      const n = roads.graph.standConn[s];
      const conn = -((roads.graph.nodeX[n] - noseX) * c + (roads.graph.nodeY[n] - noseY) * sn);
      if (conn < 0) {
        out[0] = conn;
        out[1] = conn + roads.connDepthM[s] + STAND_EDGE_IN_M;
        return;
      }
    }
    out[0] = out[1] = -Math.max(8, AIRCRAFT[this.traffic.type[a]].dimensions.lengthM * 0.15);
  }

  private readonly lines = new Float64Array(2);

  /** Queues the crew of a turnaround and sends in the first vehicle on each side. Carts come with the tractor. */
  private spawnCrew(a: number): void {
    this.pending[a] = crewMask[this.traffic.type[a]] & ~(1 << CART);
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
    if (k === TRACTOR) {
      // A train docks outboard of every dock beside it, carts included aft of the tractor, and a little wider,
      // so it never parks between the fuselage and the belt loader and its corners clear them when it turns out.
      const aft = reach + TRAIN_MAX_M;
      for (const q of placed) {
        if (q.side !== sign || q.m === 0) continue;
        if (q.y + q.reach + GAP_M > y - reach && q.y - q.reach - GAP_M < y + aft) m = Math.max(m, q.m + q.across + GAP_M + across);
      }
      m += GROUND.trainLateralExtraM;
    }
    // The train's claim runs aft of the tractor only, where its carts trail.
    if (k === TRACTOR) placed.push({ side: sign, m, y: y + TRAIN_MAX_M / 2, across, reach: reach + TRAIN_MAX_M / 2 });
    else placed.push({ side: sign, m, y, across, reach });
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
    if (d.k === TRACTOR) {
      // The train comes round the tail and docks along the fuselage facing the nose, carts trailing aft,
      // then leaves forward and out to the staging line, never back through its own carts.
      const aftY = L + TRAIN_AFT_M;
      const along: Pt = { x: 0, y: 1 };
      const arrive: Pt[] = [{ x: stage.x, y: aftY }, { x: dock.x, y: aftY }, dock];
      if (driveClear(b, d.g, arrive, along)) {
        pts = arrive;
        let leave: Pt[] = [dock, { x: stage.x, y: d.y }];
        for (const rise of TRAIN_LEAVE_RISE_M) {
          const cand = [dock, { x: stage.x, y: d.y - rise }];
          if (driveClear(b, d.g, cand, along)) {
            leave = cand;
            break;
          }
        }
        for (let i = 0; i < leave.length; i++) {
          trainOutX[type * MAX_WP + i] = leave[i].x;
          trainOutY[type * MAX_WP + i] = leave[i].y;
        }
        trainOutN[type] = leave.length;
      }
    }
    for (let i = 0; i < pts.length; i++) {
      pathX[pk * MAX_WP + i] = pts[i].x;
      pathY[pk * MAX_WP + i] = pts[i].y;
    }
    pathN[pk] = pts.length;
    // A perp dock faces the fuselage with its working end, the way it drove in, so it never turns on arrival.
    // A train tractor faces the nose, as it docks along the fuselage.
    dockRel[pk] = d.k === TRACTOR && trainOutN[type] > 0 ? 0 : d.perp ? d.sign * (PI / 2) : 0;
  }
}
