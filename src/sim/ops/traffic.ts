import { AIRCRAFT, RUNWAY_OCCUPANCY, wakeSeparationSec, WAKE_ORDER, type AircraftSpec } from '@data/aircraft';
import { codeIndex, compassVector, type AirfieldPayload, type CodeLetter, type Runway } from '@shared/airfield';
import { SnapHeader, type SnapshotViews } from '@shared/snapshot';
import { SEASONS, WIND_BINS, windBand, type Climate } from '@shared/site';
import { atan2Det, cosLut, PI, sinLut, TWO_PI } from '@shared/trig';
import { foldF64, foldU32 } from '../hash';
import { packTyped, unpackInto } from '../save/pack';
import type { Rng } from '../rng';
import { standRefusal } from '@shared/standSizes';
import { PUSHBACK_EXTENSION_M } from '@shared/standFork';
import { EdgeKind, TaxiNetwork } from '../airfield/network';
import { checkLanding, checkTakeoff, requiredTakeoffM, takeoffWeight } from './performance';

export const MAX_AIRCRAFT = 256;
const MAX_ROUTE = 40;
const MAX_FLIGHTS = 1024;
const DT = 0.1;
const KT = 0.514444;
const APPROACH_START_M = 4000;
const TOUCHDOWN_M = 300;
const TAXI_DECEL = 1.5;
const TAXI_ACCEL = 1.0;
const PUSHBACK_SPEED = 1.5;
const MAX_DELAY_TICKS = 12000;
const RETRY_TICKS = 300;
const SLOTS = 8;
const TURN_RATE = 0.35;

export const AcState = { Free: 0, Approach: 1, Rollout: 2, TaxiIn: 3, Turnaround: 4, Pushback: 5, TaxiOut: 6, Holding: 7, LineUp: 8, Takeoff: 9 } as const;
export const FlState = { Free: 0, Scheduled: 1, Inbound: 2, OnGround: 3, Departing: 4, Done: 5 } as const;

const ROLE_TURNAROUND_MIN: Record<string, number> = { ga: 15, commuter: 20, regionalTurboprop: 30, regionalJet: 35, narrowbody: 45, widebody: 75 };

const SURFACE_BIT: Record<string, number> = { dirt: 1, gravel: 2, grass: 4, asphalt: 8, concrete: 16 };
const surfaceMask = (a: AircraftSpec): number => a.surfaces.reduce((m, s) => m | SURFACE_BIT[s], 0);
const MASKS = AIRCRAFT.map(surfaceMask);
const CODES_OF: CodeLetter[] = AIRCRAFT.map((a) => a.derivedForReading.code);
const WAKE_OF = AIRCRAFT.map((a) => WAKE_ORDER.indexOf(a.derivedForReading.wake));
const ACR_OF = AIRCRAFT.map((a) => {
  const gear = a.weights.mtowKg < 7000 ? 1 : a.weights.mtowKg < 100000 ? 0.8 : a.weights.mtowKg < 280000 ? 0.65 : 0.55;
  const wheels = a.weights.mtowKg < 7000 ? 2 : a.weights.mtowKg < 100000 ? 4 : a.weights.mtowKg < 280000 ? 8 : 12;
  return ((a.weights.mtowKg / 1000) * gear) / Math.sqrt(wheels) * 1.1;
});

const turnWrap = (a: number): number => {
  let d = a;
  while (d > PI) d -= TWO_PI;
  while (d < -PI) d += TWO_PI;
  return d;
};

interface Scratch {
  x: number;
  y: number;
  h: number;
}

/** The parts of the site that traffic needs. */
export interface TrafficSite {
  windFreq: Float32Array;
  windMeanKt: Float32Array;
  climate: Climate;
  idealHeadingDeg: number;
}

/** Flights, aircraft, air traffic control and ground movement. All typed arrays, no allocation per tick. */
export class Traffic {
  // Aircraft
  readonly active = new Uint8Array(MAX_AIRCRAFT);
  readonly state = new Uint8Array(MAX_AIRCRAFT);
  readonly type = new Uint8Array(MAX_AIRCRAFT);
  readonly livery = new Uint8Array(MAX_AIRCRAFT);
  readonly flight = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly x = new Float64Array(MAX_AIRCRAFT);
  readonly y = new Float64Array(MAX_AIRCRAFT);
  readonly heading = new Float64Array(MAX_AIRCRAFT);
  readonly speed = new Float64Array(MAX_AIRCRAFT);
  readonly dist = new Float64Array(MAX_AIRCRAFT);
  readonly routeLen = new Uint8Array(MAX_AIRCRAFT);
  readonly routeIdx = new Uint8Array(MAX_AIRCRAFT);
  readonly routeEdge = new Int32Array(MAX_AIRCRAFT * MAX_ROUTE);
  readonly routeDir = new Int8Array(MAX_AIRCRAFT * MAX_ROUTE);
  readonly heldNode = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly curBlock = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly prevBlock = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly nextBlock = new Int32Array(MAX_AIRCRAFT).fill(-1);
  /** Edge the junction and block were reserved for, or -1. */
  readonly nextAcq = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly waitingFor = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly ignoreLocks = new Int32Array(MAX_AIRCRAFT);
  readonly yieldUntil = new Int32Array(MAX_AIRCRAFT);
  /** Until this tick the aircraft shows in the deadlock overlay. Not saved, it only feeds the overlay. */
  private readonly deadlockUntil = new Int32Array(MAX_AIRCRAFT);
  readonly standId = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly rwyIdx = new Int32Array(MAX_AIRCRAFT).fill(-1);
  /** +1 when moving from threshold A toward B on the runway, -1 for the other way. */
  readonly rwyDir = new Int8Array(MAX_AIRCRAFT);
  readonly rwyS = new Float64Array(MAX_AIRCRAFT);
  readonly rwyExitS = new Float64Array(MAX_AIRCRAFT);
  readonly rwySlot = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly entryIdx = new Int32Array(MAX_AIRCRAFT).fill(-1);
  readonly timer = new Int32Array(MAX_AIRCRAFT);
  readonly stuckTicks = new Int32Array(MAX_AIRCRAFT);
  readonly goalX = new Float64Array(MAX_AIRCRAFT);
  readonly goalY = new Float64Array(MAX_AIRCRAFT);
  count = 0;
  private readonly activeList = new Int32Array(MAX_AIRCRAFT);

  // Flights
  readonly fState = new Uint8Array(MAX_FLIGHTS);
  readonly fType = new Uint8Array(MAX_FLIGHTS);
  readonly fLivery = new Uint8Array(MAX_FLIGHTS);
  readonly fEta = new Int32Array(MAX_FLIGHTS);
  readonly fTurn = new Int32Array(MAX_FLIGHTS);
  readonly fAc = new Int32Array(MAX_FLIGHTS).fill(-1);
  readonly fDelay = new Int32Array(MAX_FLIGHTS);
  readonly fRetryAt = new Int32Array(MAX_FLIGHTS);
  readonly fAirline = new Int8Array(MAX_FLIGHTS).fill(-1);
  /** How late the arrival touched down against its schedule, in ticks. */
  readonly fLate = new Int32Array(MAX_FLIGHTS);
  /** Stage length in km a flight departs on, 0 for the default weight. */
  readonly fStage = new Int32Array(MAX_FLIGHTS);
  /** Stand id a flight is assigned to by the player or the auto scheduler, -1 for none. */
  readonly fStand = new Int32Array(MAX_FLIGHTS).fill(-1);
  /** When false only flights with an assigned stand are accepted. */
  autoStands = true;
  /** Multiplier on new turnaround times from the ground handling fleet, set by the business. */
  serviceSlowdown = 1;
  /** Arrival delay in ticks, kept for statistics when the flight completes. */
  completedFlights = 0;
  divertedFlights = 0;
  deadlocks = 0;

  // Network and runway state
  net: TaxiNetwork = TaxiNetwork.build({ version: 0, runways: [], taxiways: [], aprons: [], stands: [], holding: [], entries: [] }, 0);
  private af: AirfieldPayload = { version: 0, runways: [], taxiways: [], aprons: [], stands: [], holding: [], entries: [] };
  private nodeOwner = new Int32Array(0);
  private blockCount = new Int32Array(0);
  private blockDir = new Int8Array(0);
  private blockLast = new Int32Array(0);
  private standOwner = new Int32Array(0);

  /** Stands with no aircraft assigned. */
  get standsFree(): number {
    let n = 0;
    for (let i = 0; i < this.standOwner.length; i++) if (this.standOwner[i] === -1) n++;
    return n;
  }

  /** Arrivals assigned to each runway entry and departures queued for it, so they never share a connector. */
  private entryInbound = new Int32Array(0);
  private entryDeparting = new Int32Array(0);
  private readonly entryCounted = new Uint8Array(MAX_AIRCRAFT);
  private rsvStart = new Int32Array(0);
  private rsvEnd = new Int32Array(0);
  private rsvCat = new Int8Array(0);
  private readonly tmpEdge = new Int32Array(MAX_ROUTE);
  private readonly tmpDir = new Int8Array(MAX_ROUTE);
  private readonly tailEdge = new Int32Array(MAX_ROUTE);
  private readonly tailDir = new Int8Array(MAX_ROUTE);
  private readonly pos: Scratch = { x: 0, y: 0, h: 0 };
  private readonly bits = [new Uint32Array(0)];

  /** Business callbacks: arrival at the stand, start of push back, departure, and whether a contact stand has a terminal. */
  hooks: { docked(f: number): void; pushback(f: number): void; departed(f: number): void; contactOk?(x: number, y: number): boolean } | null = null;
  weather: 'clear' | 'rain' | 'fog' | 'wind' = 'clear';

  // Weather and settings
  windFromDeg = 0;
  windKt = 0;
  private testPerHour = 0;
  private testTurnScale = 1;
  private tick = 0;
  private readonly rng: Rng;
  private readonly weatherRng: Rng;

  constructor(
    private readonly site: TrafficSite,
    rng: Rng,
    private readonly emit: (code: string) => void,
  ) {
    this.rng = rng.fork('traffic');
    this.weatherRng = rng.fork('weather');
    this.bits = [new Uint32Array(this.x.buffer), new Uint32Array(this.y.buffer), new Uint32Array(this.speed.buffer)];
    this.updateWind();
  }

  // Setup ------------------------------------------------------------------

  setTestTraffic(perHour: number, turnScale: number): void {
    this.testPerHour = Math.max(0, Math.min(240, perHour));
    this.testTurnScale = Math.max(0.05, Math.min(6, turnScale));
  }

  get nowTick(): number {
    return this.tick;
  }

  setWeather(kind: 'clear' | 'rain' | 'fog' | 'wind'): void {
    this.weather = kind;
  }

  usableTypesPublic(out: number[]): void {
    this.usableTypes(out);
  }

  /** Runway length factor: wet surface, and the 5 percent bonus on an Optimal wind band. */
  private lengthFactor(r: Runway, dir: number): number {
    const hdg = dir === 1 ? r.headingDeg : (r.headingDeg + 180) % 360;
    const band = windBand(hdg % 180, this.site.idealHeadingDeg) === 'optimal' ? 0.95 : 1;
    return band * (this.weather === 'rain' ? 1.15 : 1);
  }

  get network(): TaxiNetwork {
    return this.net;
  }

  /** Rebuilds the network after an airfield change and re-plans everything that was moving on it. */
  setAirfield(af: AirfieldPayload): void {
    this.af = { ...af, runways: af.runways, taxiways: af.taxiways, aprons: af.aprons, stands: af.stands, holding: af.holding, entries: af.entries };
    this.net = TaxiNetwork.build(af, af.version);
    const R = af.runways.length;
    this.rsvStart = new Int32Array(R * SLOTS);
    this.rsvEnd = new Int32Array(R * SLOTS);
    this.rsvCat = new Int8Array(R * SLOTS).fill(-1);
    this.entryInbound = new Int32Array(af.entries.length);
    this.entryDeparting = new Int32Array(af.entries.length);
    this.entryCounted.fill(0);
    this.resetOwnership();
    for (let k = 0; k < this.count; k++) this.replan(this.activeList[k]);
    this.rebuildActive();
  }

  private resetOwnership(): void {
    this.nodeOwner = new Int32Array(this.net.nodeCount).fill(-1);
    const B = this.net.blockTotal;
    this.blockCount = new Int32Array(B);
    this.blockDir = new Int8Array(B);
    this.blockLast = new Int32Array(B).fill(-1);
    this.standOwner = new Int32Array(this.af.stands.length).fill(-1);
    for (let i = 0; i < MAX_AIRCRAFT; i++) {
      this.heldNode[i] = -1;
      this.curBlock[i] = -1;
      this.prevBlock[i] = -1;
      this.nextBlock[i] = -1;
      this.nextAcq[i] = -1;
      this.waitingFor[i] = -1;
    }
    for (let i = 0; i < MAX_AIRCRAFT; i++) {
      if (this.active[i] === 1 && this.standId[i] >= 0) {
        const idx = this.af.stands.findIndex((s) => s.id === this.standId[i]);
        if (idx >= 0) this.standOwner[idx] = i;
        else this.standId[i] = -1;
      }
    }
  }

  private replan(i: number): void {
    const st = this.state[i];
    if (st === AcState.Takeoff) {
      if (this.rwyIdx[i] >= this.af.runways.length) this.removeAircraft(i, 'lost');
      return;
    }
    if (st === AcState.Approach || st === AcState.Rollout) {
      // The landing continues on its runway, but the exit and the route to the stand are looked up again.
      const rw = this.af.runways[this.rwyIdx[i]];
      const sIdx = this.af.stands.findIndex((x) => x.id === this.standId[i]);
      if (!rw || sIdx < 0 || this.net.standNode[sIdx] < 0) {
        this.removeAircraft(i, 'lost');
        return;
      }
      const dir = this.rwyDir[i];
      const d = compassVector(dir === 1 ? rw.headingDeg : (rw.headingDeg + 180) % 360);
      const ex = (dir === 1 ? rw.x1 : rw.x2) + d.x * this.rwyExitS[i];
      const ey = (dir === 1 ? rw.y1 : rw.y2) + d.y * this.rwyExitS[i];
      let entry = -1;
      let bestD = 30;
      this.af.entries.forEach((e, idx) => {
        const dd = Math.hypot(e.x - ex, e.y - ey);
        if (e.runwayId === rw.id && dd < bestD && this.net.entryNode[idx] >= 0) {
          bestD = dd;
          entry = idx;
        }
      });
      const n = entry < 0 ? -1 : this.net.route(this.net.entryNode[entry], this.net.standNode[sIdx], CODES_OF[this.type[i]], ACR_OF[this.type[i]], MASKS[this.type[i]], this.tmpEdge, this.tmpDir, MAX_ROUTE);
      if (n < 0) {
        this.removeAircraft(i, 'lost');
        return;
      }
      for (let k = 0; k < n; k++) {
        this.routeEdge[i * MAX_ROUTE + k] = this.tmpEdge[k];
        this.routeDir[i * MAX_ROUTE + k] = this.tmpDir[k];
      }
      this.routeLen[i] = n;
      this.routeIdx[i] = 0;
      this.entryIdx[i] = entry;
      this.standOwner[sIdx] = i;
      return;
    }
    if (st === AcState.Turnaround) return;
    const from = this.nearestNode(this.x[i], this.y[i]);
    const goal = this.nearestNode(this.goalX[i], this.goalY[i]);
    if (from < 0 || goal < 0) {
      this.removeAircraft(i, 'lost');
      return;
    }
    const n = this.net.route(from, goal, CODES_OF[this.type[i]], ACR_OF[this.type[i]], MASKS[this.type[i]], this.tmpEdge, this.tmpDir, MAX_ROUTE);
    if (n < 0) {
      this.removeAircraft(i, 'lost');
      return;
    }
    for (let k = 0; k < n; k++) {
      this.routeEdge[i * MAX_ROUTE + k] = this.tmpEdge[k];
      this.routeDir[i * MAX_ROUTE + k] = this.tmpDir[k];
    }
    this.routeLen[i] = n;
    this.routeIdx[i] = 0;
    this.dist[i] = 0;
    this.speed[i] = 0;
    if (st === AcState.Holding || st === AcState.LineUp || st === AcState.Pushback) this.state[i] = AcState.TaxiOut;
    if (this.state[i] === AcState.TaxiOut) {
      // Entry indexes change with the airfield, so find the entry this aircraft was heading for again.
      this.entryIdx[i] = -1;
      for (let e = 0; e < this.af.entries.length; e++) {
        if (Math.hypot(this.af.entries[e].x - this.goalX[i], this.af.entries[e].y - this.goalY[i]) < 15) this.entryIdx[i] = e;
      }
      const sIdx = this.af.stands.findIndex((x) => x.id === this.standId[i]);
      if (sIdx >= 0 && this.standOwner[sIdx] === i) this.standOwner[sIdx] = -1;
      this.standId[i] = -1;
    }
  }

  private nearestNode(x: number, y: number): number {
    let best = -1;
    let bestD = 400;
    for (let n = 0; n < this.net.nodeCount; n++) {
      if (this.net.nodeOnRunway[n] === 1) continue;
      const d = Math.hypot(this.net.nodeX[n] - x, this.net.nodeY[n] - y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  // Weather ----------------------------------------------------------------

  private updateWind(): void {
    const season = Math.floor((this.tick / (600 * 60 * 24 * 91.25)) % SEASONS);
    let r = this.weatherRng.next();
    let bin = 0;
    for (let b = 0; b < WIND_BINS; b++) {
      r -= this.site.windFreq[season * WIND_BINS + b];
      if (r <= 0) {
        bin = b;
        break;
      }
      bin = b;
    }
    this.windFromDeg = (bin * 22.5 + (this.weatherRng.next() - 0.5) * 22.5 + 360) % 360;
    this.windKt = this.site.windMeanKt[season * WIND_BINS + bin] * (0.4 + this.weatherRng.next() * 1.2);
  }

  private effectiveWind(): number {
    return this.weather === 'wind' ? this.windKt * 1.8 : this.windKt;
  }

  /** Wind component along a heading (positive is headwind). */
  private headwind(headingDeg: number): number {
    return this.effectiveWind() * cosLut(((this.windFromDeg - headingDeg) * PI) / 180);
  }

  private crosswind(headingDeg: number): number {
    return Math.abs(this.effectiveWind() * sinLut(((this.windFromDeg - headingDeg) * PI) / 180));
  }

  // Flights ----------------------------------------------------------------

  /** Schedules an arriving flight. Its turnaround and departure follow automatically. */
  scheduleArrival(typeIdx: number, etaTick: number, livery: number, turnTicks: number, airline = -1, stageKm = 0): number {
    let f = -1;
    for (let k = 0; k < MAX_FLIGHTS; k++) {
      if (this.fState[k] === FlState.Free || this.fState[k] === FlState.Done) {
        f = k;
        break;
      }
    }
    if (f < 0) return -1;
    this.fState[f] = FlState.Scheduled;
    this.fType[f] = typeIdx;
    this.fLivery[f] = livery;
    this.fEta[f] = etaTick;
    this.fTurn[f] = turnTicks;
    this.fAc[f] = -1;
    this.fDelay[f] = 0;
    this.fRetryAt[f] = 0;
    this.fAirline[f] = airline;
    this.fLate[f] = 0;
    this.fStage[f] = stageKm;
    this.fStand[f] = -1;
    return f;
  }

  turnaroundTicks(typeIdx: number): number {
    return Math.round((ROLE_TURNAROUND_MIN[AIRCRAFT[typeIdx].role] ?? 45) * 600 * this.testTurnScale);
  }

  /** Types that have a runway, an exit and a stand they can use right now. */
  private usableTypes(out: number[]): void {
    out.length = 0;
    for (let t = 0; t < AIRCRAFT.length; t++) {
      const a = AIRCRAFT[t];
      let ok = false;
      for (const r of this.af.runways) {
        if (!checkLanding(a, r, 0.95).ok) continue;
        for (let s = 0; s < this.af.stands.length; s++) {
          const st = this.af.stands[s];
          if (this.standFits(t, s)) {
            ok = this.net.standNode[s] >= 0 && st !== undefined;
            if (ok) break;
          }
        }
        if (ok) break;
      }
      if (ok) out.push(t);
    }
  }

  private readonly usable: number[] = [];

  private generateTestFlight(): void {
    this.usableTypes(this.usable);
    if (this.usable.length === 0) return;
    const t = this.usable[this.rng.int(0, this.usable.length - 1)];
    this.scheduleArrival(t, this.tick + 1500, this.rng.int(0, 7), this.turnaroundTicks(t));
  }

  /** Called every 10 ticks. */
  updateFlights(tick: number): void {
    this.tick = tick;
    if (this.testPerHour > 0 && this.tick % 50 === 0) {
      // Probability per 5 game seconds.
      if (this.rng.next() < (this.testPerHour * 5) / 3600) this.generateTestFlight();
    }
    for (let f = 0; f < MAX_FLIGHTS; f++) {
      if (this.fState[f] !== FlState.Scheduled) continue;
      const startAt = this.fEta[f] - Math.round(((APPROACH_START_M + TOUCHDOWN_M) / (AIRCRAFT[this.fType[f]].performance.vrefKt * KT)) * 10);
      if (this.tick < startAt || this.tick < this.fRetryAt[f]) continue;
      this.trySpawnArrival(f);
    }
    if (this.tick % 36000 === 0 && this.tick > 0) this.updateWind();
  }

  // Runway reservations ----------------------------------------------------

  private slotFree(r: number, start: number, end: number, cat: number): boolean {
    for (let k = 0; k < SLOTS; k++) {
      const o = r * SLOTS + k;
      if (this.rsvCat[o] < 0) continue;
      if (this.rsvEnd[o] < this.tick - 100) {
        this.rsvCat[o] = -1;
        continue;
      }
      const fog = this.weather === 'fog' ? 2 : 1;
      const sepAfter = (wakeSeparationSec(WAKE_ORDER[this.rsvCat[o]], WAKE_ORDER[cat]) * 10 + (fog === 2 ? 300 : 0)) * 1;
      const sepBefore = (wakeSeparationSec(WAKE_ORDER[cat], WAKE_ORDER[this.rsvCat[o]]) * 10 + (fog === 2 ? 300 : 0)) * 1;
      if (start < this.rsvEnd[o] + sepAfter && end + sepBefore > this.rsvStart[o]) return false;
    }
    return true;
  }

  private reserve(r: number, start: number, end: number, cat: number): number {
    for (let k = 0; k < SLOTS; k++) {
      const o = r * SLOTS + k;
      if (this.rsvCat[o] < 0) {
        this.rsvStart[o] = start;
        this.rsvEnd[o] = end;
        this.rsvCat[o] = cat;
        return o;
      }
    }
    return -1;
  }

  // Arrivals ---------------------------------------------------------------

  private standFits(t: number, s: number): boolean {
    const st = this.af.stands[s];
    // Wingspan within the stand size and the stand surface on the type's list (docs/DESIGN_REVISION_2.md 3.1).
    if (standRefusal(st, AIRCRAFT[t]) !== null) return false;
    if (st.type === 'contact' && this.hooks?.contactOk && !this.hooks.contactOk(st.x, st.y)) return false;
    return true;
  }

  /** True when a stand may take this aircraft type under its open or closed state and usage setting. */
  private standAllows(t: number, s: number): boolean {
    const st = this.af.stands[s];
    if (st.closed === true) return false;
    const ga = AIRCRAFT[t].capacity.seatsTypical < 20;
    if (st.usage === 'ga' && !ga) return false;
    if (st.usage === 'commercial' && ga) return false;
    return true;
  }

  private pickStand(t: number, fromNode: number, f = -1): number {
    // A stand the player or the scheduler assigned goes first. Without auto scheduling it is the only choice.
    if (f >= 0 && this.fStand[f] >= 0) {
      const s = this.af.stands.findIndex((x) => x.id === this.fStand[f]);
      if (s >= 0 && this.standOwner[s] === -1 && this.net.standNode[s] >= 0 && this.standFits(t, s) && this.standAllows(t, s)) {
        const n = this.net.route(fromNode, this.net.standNode[s], CODES_OF[t], ACR_OF[t], MASKS[t], this.tmpEdge, this.tmpDir, MAX_ROUTE);
        if (n >= 0) return s;
      }
      if (!this.autoStands) return -1;
    } else if (!this.autoStands) return -1;
    let best = -1;
    let bestScore = Infinity;
    for (let s = 0; s < this.af.stands.length; s++) {
      if (this.standOwner[s] !== -1 || this.net.standNode[s] < 0) continue;
      if (!this.standFits(t, s) || !this.standAllows(t, s)) continue;
      const waste = codeIndex(this.af.stands[s].code) - codeIndex(CODES_OF[t]);
      const light = CODES_OF[t] === 'A' || CODES_OF[t] === 'B';
      const gaBonus = light && this.af.stands[s].size === 'small' ? -1 : 0;
      const score = waste * 100 + gaBonus * 50 + s * 0.01;
      if (score >= bestScore) continue;
      const n = this.net.route(fromNode, this.net.standNode[s], CODES_OF[t], ACR_OF[t], MASKS[t], this.tmpEdge, this.tmpDir, MAX_ROUTE);
      if (n < 0) continue;
      bestScore = score;
      best = s;
    }
    return best;
  }

  /** Gives every unassigned scheduled flight a stand that is free for its whole stay, earliest first. */
  autoAssign(): void {
    const order: number[] = [];
    for (let f = 0; f < MAX_FLIGHTS; f++) if (this.fState[f] === FlState.Scheduled && this.fStand[f] < 0) order.push(f);
    order.sort((a, b) => this.fEta[a] - this.fEta[b] || a - b);
    for (const f of order) {
      const t = this.fType[f];
      const from = this.fEta[f] - 3000;
      const to = this.fEta[f] + this.fTurn[f] + 3000;
      let best = -1;
      let bestScore = Infinity;
      for (let s = 0; s < this.af.stands.length; s++) {
        if (this.net.standNode[s] < 0 || !this.standFits(t, s) || !this.standAllows(t, s)) continue;
        const id = this.af.stands[s].id;
        let clash = false;
        for (let g = 0; g < MAX_FLIGHTS && !clash; g++) {
          if (g === f || this.fStand[g] !== id || (this.fState[g] !== FlState.Scheduled && this.fState[g] !== FlState.Inbound && this.fState[g] !== FlState.OnGround)) continue;
          clash = this.fEta[g] < to && this.fEta[g] + this.fTurn[g] + 3000 > from;
        }
        if (clash) continue;
        const score = (codeIndex(this.af.stands[s].code) - codeIndex(CODES_OF[t])) * 100 + s * 0.01;
        if (score < bestScore) {
          bestScore = score;
          best = s;
        }
      }
      if (best >= 0) this.fStand[f] = this.af.stands[best].id;
    }
  }

  private refuse(f: number, reason: string, extra: string): void {
    this.emit(`flightRefused|type=${AIRCRAFT[this.fType[f]].id}|reason=${reason}${extra}`);
  }

  private delay(f: number, reason: string): void {
    this.fDelay[f] += RETRY_TICKS;
    this.fRetryAt[f] = this.tick + RETRY_TICKS;
    if (this.fDelay[f] > MAX_DELAY_TICKS) {
      this.fState[f] = FlState.Done;
      this.divertedFlights++;
      this.emit(`flightDiverted|type=${AIRCRAFT[this.fType[f]].id}|reason=${reason}`);
    }
  }

  private trySpawnArrival(f: number): void {
    const t = this.fType[f];
    const a = AIRCRAFT[t];
    const af = this.af;
    // Choose the runway end with the best headwind that the type can land on.
    let bestR = -1;
    let bestDir = 1;
    let bestHead = -Infinity;
    let firstFail = '';
    for (let r = 0; r < af.runways.length; r++) {
      const rw = af.runways[r];
      if (this.weather === 'fog' && rw.approach === 'visual') {
        firstFail = firstFail || 'fog|needed=0|available=0';
        continue;
      }
      const lim = checkLanding(a, rw, this.lengthFactor(rw, 1));
      if (!lim.ok) {
        if (!firstFail) firstFail = `${lim.reason}|needed=${lim.needed}|available=${lim.available}`;
        continue;
      }
      for (const dir of [1, -1] as const) {
        const hdg = dir === 1 ? rw.headingDeg : (rw.headingDeg + 180) % 360;
        const limit = a.weights.mtowKg < 30000 ? 15 : 20;
        if (this.crosswind(hdg) > limit) continue;
        const hw = this.headwind(hdg);
        if (hw > bestHead) {
          bestHead = hw;
          bestR = r;
          bestDir = dir;
        }
      }
    }
    if (bestR < 0) {
      if (firstFail) {
        const parts = firstFail.split('|');
        this.refuse(f, parts[0], `|${parts[1]}|${parts[2]}`);
        this.fState[f] = FlState.Done;
        this.divertedFlights++;
        return;
      }
      this.delay(f, 'crosswind');
      return;
    }
    const rw = af.runways[bestR];
    const vTd = a.performance.vrefKt * KT * 0.95;
    const vExit = a.derivedForReading.code === 'A' || a.derivedForReading.code === 'B' ? 8 : 15;
    const decel = a.weights.mtowKg > 200000 ? 1.8 : 2.2;
    const minRoll = (vTd * vTd - vExit * vExit) / (2 * decel);
    // Candidate exits ordered along the landing direction.
    const exits: { idx: number; s: number }[] = [];
    af.entries.forEach((e, idx) => {
      if (e.runwayId !== rw.id || this.net.entryNode[idx] < 0) return;
      const dAlong = Math.hypot(e.x - rw.x1, e.y - rw.y1);
      exits.push({ idx, s: bestDir === 1 ? dAlong : rw.lengthM - dAlong });
    });
    exits.sort((p, q) => p.s - q.s);
    const viable = exits.filter((e) => e.s >= TOUCHDOWN_M + minRoll);
    const ordered = viable.length > 0 ? viable : exits.slice(-1);
    let chosen = -1;
    let stand = -1;
    for (const ex of ordered) {
      if (this.exitQueued(ex.idx) || this.entryDeparting[ex.idx] > 0) continue;
      const node = this.net.entryNode[ex.idx];
      const s = this.pickStand(t, node, f);
      if (s >= 0) {
        chosen = ex.idx;
        stand = s;
        break;
      }
    }
    if (chosen < 0) {
      this.delay(f, ordered.length === 0 ? 'noExit' : 'noStand');
      return;
    }
    // A departure that has waited too long goes first: new landings wait their turn until it is away.
    if (this.departureStarving(bestR)) {
      this.delay(f, 'runwayBusy');
      return;
    }
    // Runway window for the landing.
    const approachTicks = Math.round(((APPROACH_START_M + TOUCHDOWN_M) / (a.performance.vrefKt * KT)) * 10);
    const sExit = ordered.find((e) => e.idx === chosen)?.s ?? rw.lengthM;
    const rollTicks = Math.round(((2 * (sExit - TOUCHDOWN_M)) / (vTd + vExit)) * 10);
    const start = this.tick + approachTicks - 100;
    const end = this.tick + approachTicks + rollTicks + RUNWAY_OCCUPANCY.landingRollout * 2;
    if (!this.slotFree(bestR, start, end, WAKE_OF[t])) {
      this.delay(f, 'runwayBusy');
      return;
    }
    this.fLate[f] = Math.max(0, this.tick + approachTicks - this.fEta[f]);
    const slot = this.reserve(bestR, start, end, WAKE_OF[t]);
    if (slot < 0) {
      this.delay(f, 'runwayBusy');
      return;
    }
    const ac = this.allocAircraft();
    if (ac < 0) {
      this.delay(f, 'noAircraftSlot');
      return;
    }
    // Route from the exit to the chosen stand.
    const n = this.net.route(this.net.entryNode[chosen], this.net.standNode[stand], CODES_OF[t], ACR_OF[t], MASKS[t], this.tmpEdge, this.tmpDir, MAX_ROUTE);
    for (let k = 0; k < n; k++) {
      this.routeEdge[ac * MAX_ROUTE + k] = this.tmpEdge[k];
      this.routeDir[ac * MAX_ROUTE + k] = this.tmpDir[k];
    }
    this.routeLen[ac] = n;
    this.routeIdx[ac] = 0;
    this.standOwner[stand] = ac;
    this.standId[ac] = af.stands[stand].id;
    this.type[ac] = t;
    this.livery[ac] = this.fLivery[f];
    this.flight[ac] = f;
    this.fAc[f] = ac;
    this.fState[f] = FlState.Inbound;
    this.state[ac] = AcState.Approach;
    this.rwyIdx[ac] = bestR;
    this.rwyDir[ac] = bestDir;
    this.rwyS[ac] = -APPROACH_START_M;
    this.rwyExitS[ac] = sExit;
    this.rwySlot[ac] = slot;
    this.entryIdx[ac] = chosen;
    this.entryInbound[chosen]++;
    this.entryCounted[ac] = 1;
    this.speed[ac] = a.performance.vrefKt * KT;
    this.goalX[ac] = this.net.nodeX[this.net.standNode[stand]];
    this.goalY[ac] = this.net.nodeY[this.net.standNode[stand]];
    this.placeOnRunway(ac);
  }

  private departureStarving(r: number): boolean {
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (this.state[j] === AcState.Holding && this.rwyIdx[j] === r && this.tick - this.timer[j] > 1200) return true;
    }
    return false;
  }

  /** True when a departing aircraft is waiting on the connector of this runway entry. */
  private exitQueued(entry: number): boolean {
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      const st = this.state[j];
      if ((st === AcState.Holding || st === AcState.LineUp || st === AcState.TaxiOut) && this.entryIdx[j] === entry) {
        const b = j * MAX_ROUTE + this.routeIdx[j];
        if (this.routeIdx[j] === this.routeLen[j] - 1 && this.net.edgeLen[this.routeEdge[b]] - this.dist[j] < 200) return true;
      }
    }
    return false;
  }

  private allocAircraft(): number {
    for (let i = 0; i < MAX_AIRCRAFT; i++) {
      if (this.active[i] === 0) {
        this.active[i] = 1;
        this.heldNode[i] = -1;
        this.curBlock[i] = -1;
        this.prevBlock[i] = -1;
        this.nextBlock[i] = -1;
        this.nextAcq[i] = -1;
        this.waitingFor[i] = -1;
        this.ignoreLocks[i] = 0;
        this.yieldUntil[i] = 0;
        this.stuckTicks[i] = 0;
        this.rwySlot[i] = -1;
        this.rebuildActive();
        return i;
      }
    }
    return -1;
  }

  private rebuildActive(): void {
    let n = 0;
    for (let i = 0; i < MAX_AIRCRAFT; i++) if (this.active[i] === 1) this.activeList[n++] = i;
    this.count = n;
  }

  private removeAircraft(i: number, why: string): void {
    this.uncount(i);
    this.releaseAll(i);
    const f = this.flight[i];
    if (f >= 0) {
      this.fState[f] = FlState.Done;
      this.fAc[f] = -1;
      if (why === 'departed') {
        this.completedFlights++;
        this.hooks?.departed(f);
      }
      else this.emit(`flightLost|type=${AIRCRAFT[this.type[i]].id}`);
    }
    const s = this.af.stands.findIndex((st) => st.id === this.standId[i]);
    if (s >= 0 && this.standOwner[s] === i) this.standOwner[s] = -1;
    this.active[i] = 0;
    this.state[i] = AcState.Free;
    this.flight[i] = -1;
    this.standId[i] = -1;
    this.rebuildActive();
  }

  private uncount(i: number): void {
    const c = this.entryCounted[i];
    const e = this.entryIdx[i];
    if (c === 1 && e >= 0 && e < this.entryInbound.length && this.entryInbound[e] > 0) this.entryInbound[e]--;
    if (c === 2 && e >= 0 && e < this.entryDeparting.length && this.entryDeparting[e] > 0) this.entryDeparting[e]--;
    this.entryCounted[i] = 0;
  }

  private releaseAll(i: number): void {
    if (this.heldNode[i] >= 0) {
      if (this.nodeOwner[this.heldNode[i]] === i) this.nodeOwner[this.heldNode[i]] = -1;
      this.heldNode[i] = -1;
    }
    for (const arr of [this.curBlock, this.prevBlock, this.nextBlock]) {
      const e = arr[i];
      if (e >= 0 && e < this.blockCount.length && this.blockCount[e] > 0) this.blockCount[e]--;
      arr[i] = -1;
    }
    this.nextAcq[i] = -1;
    this.waitingFor[i] = -1;
  }

  // Position on the runway -------------------------------------------------

  private placeOnRunway(i: number): void {
    const r = this.af.runways[this.rwyIdx[i]];
    if (!r) return;
    const dir = this.rwyDir[i];
    const bx = dir === 1 ? r.x1 : r.x2;
    const by = dir === 1 ? r.y1 : r.y2;
    const d = compassVector(dir === 1 ? r.headingDeg : (r.headingDeg + 180) % 360);
    this.x[i] = bx + d.x * this.rwyS[i];
    this.y[i] = by + d.y * this.rwyS[i];
    this.heading[i] = atan2Det(d.y, d.x);
  }

  // Per tick ---------------------------------------------------------------

  /** Moves every aircraft one tick. */
  // hot
  update(tick: number): void {
    this.tick = tick;
    for (let k = 0; k < this.count; k++) {
      const i = this.activeList[k];
      if (this.active[i] === 0) continue;
      switch (this.state[i]) {
        case AcState.Approach:
        case AcState.Rollout:
          this.updateLanding(i);
          break;
        case AcState.TaxiIn:
        case AcState.TaxiOut:
        case AcState.Pushback:
        case AcState.Holding:
        case AcState.LineUp:
          this.updateGround(i);
          break;
        case AcState.Turnaround:
          this.updateTurnaround(i);
          break;
        case AcState.Takeoff:
          this.updateTakeoff(i);
          break;
        default:
          break;
      }
    }
    if (tick % 20 === 0) {
      this.recountBlocks();
      this.detectDeadlocks();
    }
    if (tick % 50 === 0) this.updateCongestion();
  }

  private updateLanding(i: number): void {
    const t = this.type[i];
    const a = AIRCRAFT[t];
    const vTd = a.performance.vrefKt * KT * 0.95;
    const vExit = CODES_OF[t] === 'A' || CODES_OF[t] === 'B' ? 8 : 15;
    if (this.state[i] === AcState.Approach) {
      this.speed[i] = a.performance.vrefKt * KT;
      this.rwyS[i] += this.speed[i] * DT;
      if (this.rwyS[i] >= TOUCHDOWN_M) {
        this.state[i] = AcState.Rollout;
        this.speed[i] = vTd;
      }
    } else {
      const decel = a.weights.mtowKg > 200000 ? 1.8 : 2.2;
      const sExit = this.rwyExitS[i];
      const need = (vTd * vTd - vExit * vExit) / (2 * Math.max(1, sExit - TOUCHDOWN_M));
      const aEff = Math.max(decel, need);
      const remaining = Math.max(0, sExit - this.rwyS[i]);
      const limit = Math.sqrt(vExit * vExit + 2 * aEff * remaining);
      this.speed[i] = Math.max(vExit, Math.min(this.speed[i], limit));
      this.rwyS[i] += this.speed[i] * DT;
      if (this.rwyS[i] >= sExit) {
        // Wait on the runway at the exit until the connector is clear of other aircraft.
        if (this.connectorBusy(this.net.entryNode[this.entryIdx[i]], i)) {
          this.rwyS[i] = sExit;
          this.speed[i] = 0;
          if (this.rwySlot[i] >= 0) this.rsvEnd[this.rwySlot[i]] = this.tick + 300;
        } else {
          this.beginTaxiIn(i);
          return;
        }
      }
    }
    this.placeOnRunway(i);
  }

  private connectorBusy(node: number, self: number): boolean {
    const nx = this.net.nodeX[node];
    const ny = this.net.nodeY[node];
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === self) continue;
      const s = this.state[j];
      if (s !== AcState.TaxiIn && s !== AcState.TaxiOut && s !== AcState.Pushback && s !== AcState.Holding && s !== AcState.LineUp) continue;
      if (Math.hypot(this.x[j] - nx, this.y[j] - ny) < 45) return true;
    }
    return false;
  }

  private beginTaxiIn(i: number): void {
    const slot = this.rwySlot[i];
    if (slot >= 0) {
      // Keep the runway reserved while the aircraft drives clear of the exit connector.
      this.rsvEnd[slot] = this.tick + 250;
      this.rwySlot[i] = -1;
    }
    this.state[i] = AcState.TaxiIn;
    const node = this.net.entryNode[this.entryIdx[i]];
    this.nodeOwner[node] = i;
    this.heldNode[i] = node;
    this.routeIdx[i] = 0;
    this.dist[i] = 0;
    this.speed[i] = Math.min(this.speed[i], 10);
    this.rwyIdx[i] = -1;
    // Take the first edge's block so departures do not drive onto it from the other end.
    const e0 = this.routeEdge[i * MAX_ROUTE];
    const b0 = this.net.edgeBlock[e0];
    if (b0 >= 0) {
      this.blockCount[b0]++;
      this.blockDir[b0] = this.routeDir[i * MAX_ROUTE];
      this.blockLast[b0] = i;
      this.curBlock[i] = b0;
    }
    this.applyEdgePose(i);
  }

  private applyEdgePose(i: number): void {
    const k = i * MAX_ROUTE + this.routeIdx[i];
    const e = this.routeEdge[k];
    const dir = this.routeDir[k];
    const len = this.net.edgeLen[e];
    const coord = dir === 1 ? this.dist[i] : len - this.dist[i];
    this.net.pointAt(e, coord, this.pos);
    this.x[i] = this.pos.x;
    this.y[i] = this.pos.y;
    let h = this.pos.h;
    if (dir === -1 && this.state[i] !== AcState.Pushback) h += PI;
    const dh = turnWrap(h - this.heading[i]);
    // Limit the turn rate so corners look smooth, but never lag far behind.
    const maxTurn = TURN_RATE * DT * 4;
    this.heading[i] += Math.abs(dh) < maxTurn ? dh : dh > 0 ? maxTurn : -maxTurn;
  }

  // Ground movement --------------------------------------------------------

  private updateGround(i: number): void {
    const st = this.state[i];
    if (st === AcState.Holding) {
      if (this.tick % 10 === i % 10) this.tryClearDeparture(i);
      return;
    }
    const t = this.type[i];
    const net = this.net;
    const base = i * MAX_ROUTE;
    const idx = this.routeIdx[i];
    const e = this.routeEdge[base + idx];
    const dir = this.routeDir[base + idx];
    const len = net.edgeLen[e];
    const last = idx === this.routeLen[i] - 1;
    let vmax = st === AcState.Pushback ? PUSHBACK_SPEED : Math.min(net.edgeSpeed[e], 15);
    if (st === AcState.LineUp) vmax = 6;
    let goal: number;
    if (last) {
      goal = st === AcState.TaxiOut ? len - this.holdDistFor(i) : len;
      if (st === AcState.LineUp) goal = len;
      if (st === AcState.Holding) goal = this.dist[i];
    } else {
      goal = len;
      // Ask for the junction and the next edge when close enough.
      const nextE = this.routeEdge[base + idx + 1];
      const nextD = this.routeDir[base + idx + 1];
      const node = dir === 1 ? net.edgeTo[e] : net.edgeFrom[e];
      const lookahead = Math.max(60, this.speed[i] * 8);
      if (len - this.dist[i] < lookahead && this.nextAcq[i] !== nextE) {
        if (this.tick < this.yieldUntil[i] || !this.tryEnter(i, node, nextE, nextD)) goal = Math.max(0, len - (AIRCRAFT[t].dimensions.wingspanM * 0.5 + 12));
      }
    }
    if (st === AcState.Pushback) {
      // Pushback needs the junction and its surroundings clear.
      if (this.dist[i] < 0.5 && !this.pushbackClear(i)) {
        this.speed[i] = 0;
        return;
      }
    }
    // Brake for the goal.
    const toGoal = Math.max(0, goal - this.dist[i]);
    let allowed = Math.min(vmax, Math.sqrt(2 * TAXI_DECEL * Math.max(0, toGoal - 0.1)));
    // Keep a gap to the aircraft ahead.
    const gap = this.leaderLimit(i, e, dir, idx, last);
    if (gap < allowed) allowed = gap;
    if (this.speed[i] < allowed) this.speed[i] = Math.min(allowed, this.speed[i] + TAXI_ACCEL * DT);
    else this.speed[i] = Math.max(allowed, this.speed[i] - TAXI_DECEL * 1.5 * DT);
    this.dist[i] += this.speed[i] * DT;
    if (this.speed[i] < 0.05) this.stuckTicks[i]++;
    else this.stuckTicks[i] = 0;
    if (this.ignoreLocks[i] > 0) this.ignoreLocks[i]--;

    if (!last && this.dist[i] >= len - 0.35) {
      // Cross into the next edge only once the junction is reserved.
      const nextE = this.routeEdge[base + idx + 1];
      if (this.nextAcq[i] === nextE || this.ignoreLocks[i] > 0) {
        // A new block replaces the current one, a block shared with the next edge is simply kept.
        if (this.nextBlock[i] >= 0) {
          if (this.prevBlock[i] >= 0 && this.blockCount[this.prevBlock[i]] > 0) this.blockCount[this.prevBlock[i]]--;
          this.prevBlock[i] = this.curBlock[i];
          this.curBlock[i] = this.nextBlock[i];
          this.nextBlock[i] = -1;
        } else if (this.net.edgeBlock[nextE] !== this.curBlock[i]) {
          // Leaving a locked taxiway for an unlocked edge: the old block is released once the tail clears.
          if (this.prevBlock[i] >= 0 && this.blockCount[this.prevBlock[i]] > 0) this.blockCount[this.prevBlock[i]]--;
          this.prevBlock[i] = this.curBlock[i];
          this.curBlock[i] = -1;
        }
        this.nextAcq[i] = -1;
        this.routeIdx[i] = idx + 1;
        if (st === AcState.TaxiIn && this.entryCounted[i] === 1) this.uncount(i);
        if (st === AcState.Pushback && this.net.edgeKind[nextE] !== EdgeKind.StandFork) {
          // Push back runs along the lead in and a fork arc and ends on the taxilane: free the stand for the
          // next arrival and taxi under own power.
          this.state[i] = AcState.TaxiOut;
          const sIdx = this.af.stands.findIndex((x) => x.id === this.standId[i]);
          if (sIdx >= 0 && this.standOwner[sIdx] === i) this.standOwner[sIdx] = -1;
          this.standId[i] = -1;
        }
        this.dist[i] -= len;
        if (this.dist[i] < 0) this.dist[i] = 0;
      } else {
        this.dist[i] = len - 0.35;
        this.speed[i] = 0;
      }
    } else if (!last && this.dist[i] > len) {
      this.dist[i] = len;
    }
    this.releaseBehind(i, t);
    if (last) this.checkArrivedAtEnd(i, len, goal);
    this.applyEdgePose(i);
  }

  private holdDistFor(i: number): number {
    const idx = this.entryIdx[i];
    for (const h of this.net.holds) if (h.entryIdx === idx) return h.holdDist;
    return 60;
  }

  private checkArrivedAtEnd(i: number, len: number, goal: number): void {
    const st = this.state[i];
    if (st === AcState.TaxiIn && this.dist[i] >= len - 0.3 && this.speed[i] < 0.6) {
      this.dist[i] = len;
      this.speed[i] = 0;
      this.releaseAll(i);
      this.state[i] = AcState.Turnaround;
      const f = this.flight[i];
      this.timer[i] = f >= 0 ? Math.round(this.fTurn[f] * this.serviceSlowdown) : 6000;
      if (f >= 0) {
        this.fState[f] = FlState.OnGround;
        this.hooks?.docked(f);
      }
      this.applyEdgePose(i);
    } else if (st === AcState.TaxiOut && this.dist[i] >= goal - 0.3 && this.speed[i] < 0.6) {
      this.state[i] = AcState.Holding;
      this.timer[i] = this.tick;
      this.speed[i] = 0;
    } else if (st === AcState.LineUp && this.dist[i] >= len - 0.3) {
      this.beginTakeoff(i);
    }
  }

  /** Frees the junction and the edge lock behind the aircraft once its tail has cleared. */
  private releaseBehind(i: number, t: number): void {
    const a = AIRCRAFT[t];
    if (this.prevBlock[i] >= 0 && this.dist[i] >= a.dimensions.lengthM * 0.6) {
      if (this.blockCount[this.prevBlock[i]] > 0) this.blockCount[this.prevBlock[i]]--;
      this.prevBlock[i] = -1;
    }
    if (this.heldNode[i] >= 0 && this.nextAcq[i] < 0 && this.dist[i] >= a.dimensions.wingspanM * 0.5 + 8) {
      if (this.nodeOwner[this.heldNode[i]] === i) this.nodeOwner[this.heldNode[i]] = -1;
      this.heldNode[i] = -1;
    }
  }

  /**
   * The aircraft to wait for on a block held the other way: one of its holders that is waiting itself,
   * so the deadlock check sees the whole cycle, else the last to enter it.
   */
  private blockHolder(i: number, nb: number): number {
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === i || this.waitingFor[j] < 0) continue;
      if (this.curBlock[j] === nb || this.nextBlock[j] === nb) return j;
    }
    return this.blockLast[nb];
  }

    private tryEnter(i: number, node: number, nextE: number, nextD: number): boolean {
    const net = this.net;
    const ignore = this.ignoreLocks[i] > 0;
    const owner = this.nodeOwner[node];
    if (owner !== -1 && owner !== i && !ignore) {
      this.waitingFor[i] = owner;
      return false;
    }
    const nb = net.edgeBlock[nextE];
    // A block the aircraft already holds (the same taxiway) needs no new reservation.
    const needsBlock = nb >= 0 && nb !== this.curBlock[i];
    if (needsBlock && this.blockCount[nb] > 0 && this.blockDir[nb] !== nextD && this.blockLast[nb] !== i && !ignore) {
      this.waitingFor[i] = this.blockHolder(i, nb);
      return false;
    }
    // A stand lead in and its fork arcs are only for the aircraft that owns the stand, so an arrival
    // waits on the taxilane and never blocks the way out of the aircraft still on the stand.
    const leadKind = net.edgeKind[nextE];
    if (leadKind === EdgeKind.StandLeadIn || leadKind === EdgeKind.StandFork) {
      const s = leadKind === EdgeKind.StandLeadIn ? net.edgeStand[nextE] : net.edgeForkStand[nextE];
      if (this.standOwner[s] !== -1 && this.standOwner[s] !== i) return false;
    }
    if (this.heldNode[i] >= 0 && this.heldNode[i] !== node && this.nodeOwner[this.heldNode[i]] === i) this.nodeOwner[this.heldNode[i]] = -1;
    this.nodeOwner[node] = i;
    this.heldNode[i] = node;
    if (needsBlock) {
      this.blockCount[nb]++;
      this.blockDir[nb] = nextD;
      this.blockLast[nb] = i;
      this.nextBlock[i] = nb;
    }
    this.nextAcq[i] = nextE;
    this.waitingFor[i] = -1;
    return true;
  }

  private pushbackClear(i: number): boolean {
    const k = i * MAX_ROUTE + this.routeIdx[i];
    const e = this.routeEdge[k];
    const node = this.routeDir[k] === 1 ? this.net.edgeTo[e] : this.net.edgeFrom[e];
    if (this.net.edgeKind[e] === EdgeKind.StandFork) return this.forkPushClear(i, e, node);
    // The fork point belongs to this stand alone and arrivals keep off its fork while the stand is taken.
    // Before leaving the stand a fork push back needs the taxilane node at the end of its arc free, no other
    // push back heading for it and the stretch beyond it clear, so neighbouring stands take turns.
    const nextIdx = k + 1;
    if (this.net.edgeKind[e] === EdgeKind.StandLeadIn && node === this.net.forkNode[this.net.edgeStand[e]] && this.routeIdx[i] + 1 < this.routeLen[i] && this.net.edgeKind[this.routeEdge[nextIdx]] === EdgeKind.StandFork) {
      let blocker = this.forkSideBlocker(i, this.routeEdge[nextIdx]);
      // While still on the stand the push may switch to the other arc when that side is free.
      if (blocker >= 0 && this.af.stands[this.net.edgeStand[e]].pushback === 'auto') {
        const other = this.net.forkEdge[this.net.edgeForkStand[this.routeEdge[nextIdx]] * 2 + 1 - this.net.edgeForkSide[this.routeEdge[nextIdx]]];
        if (other >= 0 && this.forkSideBlocker(i, other) < 0 && this.rerouteFrom(i, nextIdx, other)) blocker = -1;
      }
      // The taxiway past the arc must not be held the other way, or the push would meet that traffic head on.
      if (blocker < 0 && this.routeIdx[i] + 2 < this.routeLen[i]) {
        const nb = this.net.edgeBlock[this.routeEdge[nextIdx + 1]];
        if (nb >= 0 && this.blockCount[nb] > 0 && this.blockDir[nb] !== this.routeDir[nextIdx + 1] && this.blockLast[nb] !== i) blocker = this.blockHolder(i, nb);
      }
      if (blocker >= 0) {
        this.waitingFor[i] = blocker;
        return false;
      }
      return true;
    }
    // Pushback goes from the stand to the junction, which is the far end of that edge in travel direction.
    const owner = this.nodeOwner[node];
    if (owner !== -1 && owner !== i) {
      this.waitingFor[i] = owner;
      return false;
    }
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === i) continue;
      const s = this.state[j];
      if (s === AcState.TaxiIn || s === AcState.TaxiOut || s === AcState.Pushback) {
        if (Math.hypot(this.x[j] - this.net.nodeX[node], this.y[j] - this.net.nodeY[node]) < 28) return false;
      }
    }
    if (this.nodeOwner[node] !== i) {
      this.nodeOwner[node] = i;
      this.heldNode[i] = node;
    }
    return true;
  }

  /** Who keeps aircraft i from pushing along a fork arc: the owner of its taxilane node or an aircraft in the stretch, or -1. */
  private forkSideBlocker(i: number, arc: number): number {
    const net = this.net;
    const end = net.edgeFrom[arc];
    const owner = this.nodeOwner[end];
    if (owner !== -1 && owner !== i) return owner;
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === i || this.state[j] !== AcState.Pushback) continue;
      // Another push back on its lead in or arc toward the same taxilane node.
      for (let q = this.routeIdx[j]; q < Math.min(this.routeLen[j], this.routeIdx[j] + 2); q++) {
        const ej = this.routeEdge[j * MAX_ROUTE + q];
        if (net.edgeKind[ej] === EdgeKind.StandFork && net.edgeFrom[ej] === end) return j;
      }
    }
    const slot = net.edgeForkStand[arc] * 2 + net.edgeForkSide[arc];
    return this.stretchOccupant(i, end, net.forkAwayX[slot], net.forkAwayY[slot], AIRCRAFT[this.type[i]].dimensions.wingspanM / 2);
  }

  /** Replaces the route from position k on with a push along `arc` and a route from its taxilane end to the same goal. */
  private rerouteFrom(i: number, k: number, arc: number): boolean {
    const base = i * MAX_ROUTE;
    const lastE = this.routeEdge[base + this.routeLen[i] - 1];
    const goal = this.routeDir[base + this.routeLen[i] - 1] === 1 ? this.net.edgeTo[lastE] : this.net.edgeFrom[lastE];
    const t = this.type[i];
    const m = this.net.route(this.net.edgeFrom[arc], goal, CODES_OF[t], ACR_OF[t], MASKS[t], this.tailEdge, this.tailDir, MAX_ROUTE);
    if (m < 0 || k - base + 1 + m > MAX_ROUTE) return false;
    this.routeEdge[k] = arc;
    this.routeDir[k] = -1;
    for (let q = 0; q < m; q++) {
      this.routeEdge[k + 1 + q] = this.tailEdge[q];
      this.routeDir[k + 1 + q] = this.tailDir[q];
    }
    this.routeLen[i] = k + 1 + m - base;
    return true;
  }

  /** True when a ground aircraft stands or moves in the push back stretch of a stand's fork side. */
  private forkStretchBusy(s: number, side: number): boolean {
    const net = this.net;
    const arc = net.forkEdge[s * 2 + side];
    if (arc < 0) return true;
    const node = net.edgeFrom[arc];
    return this.stretchOccupant(-1, node, net.forkAwayX[s * 2 + side], net.forkAwayY[s * 2 + side], 20) >= 0;
  }

  /** The first ground aircraft other than i inside the 28 m stretch from a node along (ax, ay), or -1. */
  private stretchOccupant(i: number, node: number, ax: number, ay: number, halfSpan: number): number {
    const nx = this.net.nodeX[node];
    const ny = this.net.nodeY[node];
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === i) continue;
      const st = this.state[j];
      if (st !== AcState.TaxiIn && st !== AcState.TaxiOut && st !== AcState.Pushback) continue;
      const rx = this.x[j] - nx;
      const ry = this.y[j] - ny;
      const along = rx * ax + ry * ay;
      const lateral = Math.abs(-rx * ay + ry * ax);
      if (along > 0 && along < PUSHBACK_EXTENSION_M && lateral < halfSpan + AIRCRAFT[this.type[j]].dimensions.wingspanM / 2) return j;
    }
    return -1;
  }

  /**
   * Push back along a fork arc reserves the taxilane node at its end and the 28 m of taxilane beyond it
   * in the push direction (docs/DESIGN_REVISION_2.md section 1). Aircraft waiting on the other side of
   * the node do not block it.
   */
  private forkPushClear(i: number, e: number, node: number): boolean {
    const net = this.net;
    const owner = this.nodeOwner[node];
    if (owner !== -1 && owner !== i) {
      this.waitingFor[i] = owner;
      return false;
    }
    const slot = net.edgeForkStand[e] * 2 + net.edgeForkSide[e];
    const j = this.stretchOccupant(i, node, net.forkAwayX[slot], net.forkAwayY[slot], AIRCRAFT[this.type[i]].dimensions.wingspanM / 2);
    if (j >= 0) {
      this.waitingFor[i] = j;
      return false;
    }
    if (this.nodeOwner[node] !== i) {
      this.nodeOwner[node] = i;
      this.heldNode[i] = node;
    }
    return true;
  }

  /** Speed limit from the aircraft ahead, on this edge or at the start of the next one. */
  private leaderLimit(i: number, e: number, dir: number, idx: number, last: boolean): number {
    const span = AIRCRAFT[this.type[i]].dimensions.wingspanM;
    let limit = Infinity;
    const base = i * MAX_ROUTE;
    const len = this.net.edgeLen[e];
    const nextE = last ? -1 : this.routeEdge[base + idx + 1];
    for (let k = 0; k < this.count; k++) {
      const j = this.activeList[k];
      if (j === i) continue;
      const s = this.state[j];
      if (s !== AcState.TaxiIn && s !== AcState.TaxiOut && s !== AcState.Pushback && s !== AcState.Holding && s !== AcState.LineUp) continue;
      const jb = j * MAX_ROUTE + this.routeIdx[j];
      let gap = -1;
      if (this.routeEdge[jb] === e && this.routeDir[jb] === dir && this.dist[j] > this.dist[i]) gap = this.dist[j] - this.dist[i];
      else if (nextE >= 0 && this.routeEdge[jb] === nextE && this.routeDir[jb] === this.routeDir[base + idx + 1]) gap = len - this.dist[i] + this.dist[j];
      if (gap < 0) continue;
      const need = 20 + 0.5 * span + 0.5 * AIRCRAFT[this.type[j]].dimensions.wingspanM + 2 * this.speed[i];
      const v = Math.sqrt(this.speed[j] * this.speed[j] + 2 * TAXI_DECEL * Math.max(0, gap - need));
      if (v < limit) limit = v;
    }
    return limit;
  }

  // Turnaround and departure -----------------------------------------------

  private updateTurnaround(i: number): void {
    if (this.timer[i] > 0) {
      this.timer[i]--;
      return;
    }
    if (this.tick % 20 !== i % 20) return;
    this.planDeparture(i);
  }

  /** Picks a runway entry the type can take off from and a route to it, then starts the push back. */
  private planDeparture(i: number): void {
    const t = this.type[i];
    const a = AIRCRAFT[t];
    const s = this.af.stands.findIndex((st) => st.id === this.standId[i]);
    if (s < 0 || this.net.standNode[s] < 0) return;
    const from = this.net.standNode[s];
    let bestScore = Infinity;
    let bestHold = -1;
    let bestDir = 1;
    let firstFail = '';
    let failAvail = -1;
    const f = this.flight[i];
    let waitedOnly = false;
    for (const h of this.net.holds) {
      // A queue of more than two departures per entry spills onto the taxiway and blocks arrivals.
      if (this.entryInbound[h.entryIdx] > 0 || this.entryDeparting[h.entryIdx] >= 2) {
        waitedOnly = true;
        continue;
      }
      const en = this.af.entries[h.entryIdx];
      const rIdx = this.af.runways.findIndex((r) => r.id === en.runwayId);
      if (rIdx < 0) continue;
      const rw = this.af.runways[rIdx];
      for (const dir of [1, -1] as const) {
        const toda = dir === 1 ? en.todaTowardB : en.todaTowardA;
        const hdg = dir === 1 ? rw.headingDeg : (rw.headingDeg + 180) % 360;
        const lim = checkTakeoff(a, rw, toda, this.site.climate, this.lengthFactor(rw, dir), this.shareFor(i));
        if (!lim.ok) {
          // Report the best an entry could offer, not the first entry that failed.
          if (!firstFail || lim.available > failAvail) {
            firstFail = `${lim.reason}|needed=${lim.needed}|available=${lim.available}`;
            failAvail = lim.available;
          }
          continue;
        }
        const limit = a.weights.mtowKg < 30000 ? 15 : 20;
        if (this.crosswind(hdg) > limit) continue;
        const n = this.net.route(from, h.node, CODES_OF[t], ACR_OF[t], MASKS[t], this.tmpEdge, this.tmpDir, MAX_ROUTE);
        if (n < 0) continue;
        let time = 0;
        for (let k = 0; k < n; k++) time += this.net.edgeLen[this.tmpEdge[k]] / Math.max(1, this.net.edgeSpeed[this.tmpEdge[k]]);
        // Prefer a headwind and short taxi times.
        const score = time - this.headwind(hdg) * 3;
        if (score < bestScore) {
          bestScore = score;
          bestHold = h.entryIdx;
          bestDir = dir;
        }
      }
    }
    if (bestHold < 0) {
      if (firstFail && !waitedOnly && this.stuckTicks[i] === 0) {
        const parts = firstFail.split('|');
        this.refuse(f, parts[0], `|${parts[1]}|${parts[2]}`);
        this.stuckTicks[i] = 1;
      }
      return;
    }
    const hold = this.net.holds.find((h) => h.entryIdx === bestHold);
    if (!hold) return;
    const bestN = this.forkPushback(s, this.net.route(from, hold.node, CODES_OF[t], ACR_OF[t], MASKS[t], this.tmpEdge, this.tmpDir, MAX_ROUTE), hold.node, t);
    const base = i * MAX_ROUTE;
    for (let k = 0; k < bestN; k++) {
      this.routeEdge[base + k] = this.tmpEdge[k];
      this.routeDir[base + k] = this.tmpDir[k];
    }
    this.routeLen[i] = bestN;
    this.routeIdx[i] = 0;
    this.dist[i] = 0;
    this.speed[i] = 0;
    this.uncount(i);
    this.entryIdx[i] = bestHold;
    this.entryDeparting[bestHold]++;
    this.entryCounted[i] = 2;
    const en = this.af.entries[bestHold];
    this.rwyIdx[i] = this.af.runways.findIndex((r) => r.id === en.runwayId);
    this.rwyDir[i] = bestDir;
    this.goalX[i] = this.net.nodeX[hold.node];
    this.goalY[i] = this.net.nodeY[hold.node];
    this.state[i] = bestN === 1 ? AcState.TaxiOut : AcState.Pushback;
    this.stuckTicks[i] = 0;
    // The first edge is the stand lead in, driven backward as the push back.
    if (this.net.edgeKind[this.tmpEdge[0]] !== EdgeKind.StandLeadIn) this.state[i] = AcState.TaxiOut;
    if (f >= 0) {
      this.fState[f] = FlState.Departing;
      this.hooks?.pushback(f);
    }
    // Leave the stand free for the next arrival once the aircraft is out of the way.
    this.standOwner[s] = i;
  }

  /**
   * Push back along a fork arc (docs/DESIGN_REVISION_2.md section 1). The planned route leaves the stand
   * nose first along one arc; the aircraft is instead pushed tail first along the other arc, or the side
   * the stand sets, onto the taxilane and then taxis forward from there. Rewrites tmpEdge and tmpDir and
   * returns the new length, or the planned length when the stand has no fork.
   */
  private forkPushback(s: number, n: number, goal: number, t: number): number {
    const net = this.net;
    if (n < 2 || this.tmpEdge[0] !== net.standEdge[s] || net.edgeKind[this.tmpEdge[1]] !== EdgeKind.StandFork) return n;
    const pref = this.af.stands[s].pushback;
    const away = 1 - net.edgeForkSide[this.tmpEdge[1]];
    // A set side is kept; otherwise the side away from the route, unless its stretch is taken and the other is clear.
    let side = pref === 'left' ? 0 : pref === 'right' ? 1 : away;
    if (pref === 'auto' && this.forkStretchBusy(s, away) && !this.forkStretchBusy(s, 1 - away)) side = 1 - away;
    const arc = net.forkEdge[s * 2 + side];
    if (arc < 0) return n;
    const m = net.route(net.edgeFrom[arc], goal, CODES_OF[t], ACR_OF[t], MASKS[t], this.tailEdge, this.tailDir, MAX_ROUTE);
    if (m < 0 || m + 2 > MAX_ROUTE) return n;
    this.tmpEdge[1] = arc;
    this.tmpDir[1] = -1;
    for (let k = 0; k < m; k++) {
      this.tmpEdge[k + 2] = this.tailEdge[k];
      this.tmpDir[k + 2] = this.tailDir[k];
    }
    return m + 2;
  }

  /** Takeoff weight share of the flight on aircraft i, from its stage length. */
  private shareFor(i: number): number {
    const f = this.flight[i];
    if (f < 0 || this.fStage[f] === 0) return 0.9;
    return takeoffWeight(AIRCRAFT[this.type[i]], this.fStage[f], 0.75).share;
  }

  private tryClearDeparture(i: number): void {
    const r = this.rwyIdx[i];
    if (r < 0) return;
    const t = this.type[i];
    const a = AIRCRAFT[t];
    const rw = this.af.runways[r];
    const roll = requiredTakeoffM(a, this.site.climate, rw ? this.lengthFactor(rw, this.rwyDir[i]) : 1, this.shareFor(i)) * 0.8;
    const vLof = a.performance.vrefKt * KT * 1.05;
    const rollTicks = Math.round(((2 * roll) / vLof) * 10);
    const start = this.tick;
    const end = this.tick + RUNWAY_OCCUPANCY.lineUp * 10 + rollTicks + 100;
    if (!this.slotFree(r, start, end, WAKE_OF[t])) return;
    const slot = this.reserve(r, start, end, WAKE_OF[t]);
    if (slot < 0) return;
    void rw;
    this.rwySlot[i] = slot;
    this.state[i] = AcState.LineUp;
  }

  private beginTakeoff(i: number): void {
    const en = this.af.entries[this.entryIdx[i]];
    const rw = this.af.runways[this.rwyIdx[i]];
    const along = Math.hypot(en.x - rw.x1, en.y - rw.y1);
    const dir = this.rwyDir[i];
    this.rwyS[i] = dir === 1 ? along : rw.lengthM - along;
    this.speed[i] = 2;
    this.releaseAll(i);
    const f = this.flight[i];
    void f;
    this.uncount(i);
    this.state[i] = AcState.Takeoff;
    this.placeOnRunway(i);
  }

  private updateTakeoff(i: number): void {
    const t = this.type[i];
    const a = AIRCRAFT[t];
    const rw = this.af.runways[this.rwyIdx[i]];
    if (!rw) {
      this.removeAircraft(i, 'departed');
      return;
    }
    const roll = requiredTakeoffM(a, this.site.climate, this.lengthFactor(rw, this.rwyDir[i]), this.shareFor(i)) * 0.8;
    const vLof = a.performance.vrefKt * KT * 1.05;
    const acc = (vLof * vLof) / (2 * roll);
    this.speed[i] += acc * DT;
    this.rwyS[i] += this.speed[i] * DT;
    this.placeOnRunway(i);
    if (this.rwySlot[i] >= 0 && this.rwyS[i] > rw.lengthM) {
      this.rsvEnd[this.rwySlot[i]] = Math.min(this.rsvEnd[this.rwySlot[i]], this.tick + 30);
      this.rwySlot[i] = -1;
    }
    if (this.rwyS[i] > rw.lengthM + 1500) this.removeAircraft(i, 'departed');
  }

  // Deadlocks and congestion -----------------------------------------------

  /** Rebuilds block counts from what aircraft actually hold, so a missed release can never lock a taxiway for good. */
  private recountBlocks(): void {
    this.blockCount.fill(0);
    for (let k = 0; k < this.count; k++) {
      const i = this.activeList[k];
      if (this.curBlock[i] >= 0) this.blockCount[this.curBlock[i]]++;
      if (this.prevBlock[i] >= 0) this.blockCount[this.prevBlock[i]]++;
      if (this.nextBlock[i] >= 0) this.blockCount[this.nextBlock[i]]++;
    }
    for (let b = 0; b < this.blockCount.length; b++) if (this.blockCount[b] === 0) this.blockLast[b] = -1;
  }

  private detectDeadlocks(): void {
    for (let k = 0; k < this.count; k++) {
      const i = this.activeList[k];
      if (this.waitingFor[i] < 0 || this.ignoreLocks[i] > 0) continue;
      let j = this.waitingFor[i];
      if (j === i) {
        this.waitingFor[i] = -1;
        continue;
      }
      let steps = 0;
      while (j >= 0 && steps < 10 && j !== i) {
        j = this.waitingFor[j];
        steps++;
      }
      if (j === i) {
        // A wait cycle: the lowest priority aircraft in it, preferring departures, drops its
        // reservations and holds back for a while so the others can pass.
        let victim = i;
        let score = -1;
        let m = i;
        for (let n = 0; n < 10; n++) {
          const st = this.state[m];
          const sc = (st === AcState.TaxiOut || st === AcState.Pushback ? 1000 : 0) + m;
          if (sc > score) {
            score = sc;
            victim = m;
          }
          m = this.waitingFor[m];
          if (m === i || m < 0) break;
        }
        this.releaseAll(victim);
        this.yieldUntil[victim] = this.tick + 400;
        this.deadlocks++;
        // Mark the whole cycle for the debug overlay.
        let w = i;
        for (let n = 0; n < 10 && w >= 0; n++) {
          this.deadlockUntil[w] = this.tick + 600;
          w = this.waitingFor[w];
          if (w === i) break;
        }
        this.emit('deadlock');
        return;
      }
    }
    // Aircraft stuck for a long time behind a closed loop of followers are also nudged.
    for (let k = 0; k < this.count; k++) {
      const i = this.activeList[k];
      if (this.stuckTicks[i] > 9000 && this.ignoreLocks[i] <= 0) {
        this.releaseAll(i);
        this.yieldUntil[i] = this.tick + 400;
        this.deadlocks++;
        this.stuckTicks[i] = 0;
      }
    }
  }

  private updateCongestion(): void {
    const c = this.net.congestion;
    for (let e = 0; e < c.length; e++) c[e] = this.net.edgeBlock[e] >= 0 ? this.blockCount[this.net.edgeBlock[e]] * 8 : 0;
  }

  // Saving ------------------------------------------------------------------

  private arrays(): Record<string, Float64Array | Int32Array | Uint8Array | Int8Array> {
    return {
      active: this.active, state: this.state, type: this.type, livery: this.livery, flight: this.flight, x: this.x, y: this.y,
      heading: this.heading, speed: this.speed, dist: this.dist, routeLen: this.routeLen, routeIdx: this.routeIdx,
      routeEdge: this.routeEdge, routeDir: this.routeDir, heldNode: this.heldNode, curBlock: this.curBlock, prevBlock: this.prevBlock,
      nextBlock: this.nextBlock, nextAcq: this.nextAcq, waitingFor: this.waitingFor, ignoreLocks: this.ignoreLocks, yieldUntil: this.yieldUntil,
      standId: this.standId, rwyIdx: this.rwyIdx, rwyDir: this.rwyDir, rwyS: this.rwyS, rwyExitS: this.rwyExitS, rwySlot: this.rwySlot,
      entryIdx: this.entryIdx, timer: this.timer, stuckTicks: this.stuckTicks, goalX: this.goalX, goalY: this.goalY,
      entryCounted: this.entryCounted, fState: this.fState, fType: this.fType, fLivery: this.fLivery, fEta: this.fEta,
      fTurn: this.fTurn, fAc: this.fAc, fDelay: this.fDelay, fRetryAt: this.fRetryAt, fAirline: this.fAirline, fLate: this.fLate, fStage: this.fStage, fStand: this.fStand,
      nodeOwner: this.nodeOwner, blockCount: this.blockCount, blockDir: this.blockDir, blockLast: this.blockLast, standOwner: this.standOwner,
      rsvStart: this.rsvStart, rsvEnd: this.rsvEnd, rsvCat: this.rsvCat, entryInbound: this.entryInbound, entryDeparting: this.entryDeparting,
    };
  }

  saveState(): unknown {
    const arrays: Record<string, string> = {};
    const src = this.arrays();
    for (const k of Object.keys(src)) arrays[k] = packTyped(src[k]);
    return {
      arrays,
      completed: this.completedFlights, diverted: this.divertedFlights, deadlocks: this.deadlocks,
      autoStands: this.autoStands,
      windFromDeg: this.windFromDeg, windKt: this.windKt, testPerHour: this.testPerHour, testTurnScale: this.testTurnScale,
      tick: this.tick, weather: this.weather, rng: this.rng.getState(), weatherRng: this.weatherRng.getState(),
    };
  }

  /** Restores state on a traffic object whose airfield has already been loaded. */
  loadState(raw: unknown): void {
    const o = raw as { arrays: Record<string, string>; completed: number; diverted: number; deadlocks: number; windFromDeg: number; windKt: number; testPerHour: number; testTurnScale: number; tick: number; weather: 'clear' | 'rain' | 'fog' | 'wind'; rng: number; weatherRng: number };
    const dst = this.arrays();
    const ctors: Record<string, new (b: ArrayBuffer) => never> = {};
    for (const k of Object.keys(dst)) {
      const a = dst[k];
      const C = a.constructor as unknown as new (b: ArrayBuffer) => never;
      ctors[k] = C;
      if (o.arrays[k] !== undefined) unpackInto(o.arrays[k], a as never, C as never);
    }
    this.autoStands = (raw as { autoStands?: boolean }).autoStands ?? true;
    this.completedFlights = o.completed;
    this.divertedFlights = o.diverted;
    this.deadlocks = o.deadlocks;
    this.windFromDeg = o.windFromDeg;
    this.windKt = o.windKt;
    this.testPerHour = o.testPerHour;
    this.testTurnScale = o.testTurnScale;
    this.tick = o.tick;
    this.weather = o.weather;
    this.rng.setState(o.rng);
    this.weatherRng.setState(o.weatherRng);
    this.rebuildActive();
  }

  // Snapshots and hashing --------------------------------------------------

  // hot
  writeSnapshot(views: SnapshotViews): void {
    const n = this.count;
    views.header[SnapHeader.AircraftCount] = n;
    for (let k = 0; k < n; k++) {
      const i = this.activeList[k];
      views.aircraftId[k] = i;
      views.aircraftX[k] = this.x[i];
      views.aircraftY[k] = this.y[i];
      views.aircraftHeading[k] = this.heading[i];
      views.aircraftType[k] = this.type[i];
      views.aircraftState[k] = this.state[i];
      views.aircraftLivery[k] = this.livery[i];
      views.aircraftFlags[k] = (this.waitingFor[i] >= 0 ? 1 : 0) | (this.deadlockUntil[i] > this.tick ? 2 : 0);
    }
  }

  hash(h: number): number {
    let acc = foldU32(h, this.count);
    acc = foldU32(acc, this.completedFlights);
    acc = foldU32(acc, this.deadlocks);
    acc = foldF64(acc, this.bits[0], MAX_AIRCRAFT);
    acc = foldF64(acc, this.bits[1], MAX_AIRCRAFT);
    acc = foldF64(acc, this.bits[2], MAX_AIRCRAFT);
    for (let i = 0; i < MAX_AIRCRAFT; i++) acc = foldU32(acc, this.state[i] + (this.routeIdx[i] << 8));
    return acc;
  }

  /** Aircraft currently on the ground, for the stress tool and the HUD. */
  get onGround(): number {
    let n = 0;
    for (let k = 0; k < this.count; k++) {
      const s = this.state[this.activeList[k]];
      if (s !== AcState.Approach && s !== AcState.Rollout && s !== AcState.Takeoff) n++;
    }
    return n;
  }

  runwayOf(i: number): Runway | null {
    return this.af.runways[this.rwyIdx[i]] ?? null;
  }
}
