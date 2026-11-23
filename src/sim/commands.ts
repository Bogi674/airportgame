import type { Approach, BuildingKind, CodeLetter, PadSide, PushbackDir, StandSize, StandUpgrade, StandType, Surface } from '@shared/airfield';
import type { FeeLevel } from '@shared/business';
import type { TerminalEdit } from '@shared/terminalOps';
import type { Pt } from '@shared/geom';

/**
 * Every player action is a serializable command applied at a tick boundary (hard rule 4).
 * The test traffic commands are scaffolding until airlines schedule the real flights in M6.
 */
export type Command =
  | { type: 'setTestTraffic'; perHour: number; turnScale: number }
  | { type: 'testArrival'; typeIdx: number; inTicks: number; turnTicks: number }
  /** Test arrival that lands now and takes the given stand, under the same refusal rules as a normal stand assignment. */
  | { type: 'testDockAt'; standId: number; typeIdx: number; turnTicks: number }
  | { type: 'buyParcel'; parcelId: number }
  | { type: 'buyParcels'; ids: number[] }
  | { type: 'buildRunway'; x: number; y: number; headingDeg: number; lengthM: number; code: CodeLetter; approach: Approach; surface: Surface; tier: number }
  | { type: 'buildTaxiway'; points: Pt[]; code: CodeLetter; kind: 'taxiway' | 'taxilane'; surface: Surface; tier: number }
  /** `landingEnd` is the threshold aircraft land over, A when absent; `distM` and `side` count from it along the landing direction. */
  | { type: 'buildRapidExit'; runwayId: number; distM: number; side: 'left' | 'right'; angleDeg: 30 | 45 | 90; code: CodeLetter; surface: Surface; tier: number; landingEnd?: 'a' | 'b' }
  | { type: 'buildParallelTaxiway'; runwayId: number; side: 'left' | 'right'; offsetM: number; code: CodeLetter; connectors: number; surface: Surface; tier: number }
  | { type: 'buildApron'; polygon: Pt[]; surface: Surface; tier: number }
  /** Takes a piece out of an apron: the one given, or every apron the piece overlaps. */
  | { type: 'cutApron'; polygon: Pt[]; id?: number }
  /** Takes a piece out of every apron it overlaps, leaving the stand boxes and taxiway pavement inside it paved. */
  | { type: 'removeApronArea'; polygon: Pt[] }
  /** Adds a piece to the apron it touches, on that apron's surface. */
  | { type: 'extendApron'; apronId: number; polygon: Pt[] }
  /** surface is optional: without it a stand takes the apron under it, else concrete. */
  | { type: 'buildStands'; x: number; y: number; headingDeg: number; count: number; spacingM: number; standType: StandType; size: StandSize; surface?: Surface }
  /** surface is optional: without it a GA block takes the apron under its stands, else asphalt. */
  | { type: 'buildGaBlock'; x: number; y: number; headingDeg: number; count: number; surface?: Surface }
  | { type: 'demolish'; kind: 'runway' | 'taxiway' | 'apron' | 'stand' | 'road' | 'depot' | 'building'; id: number }
  /** Builds an ATC tower centred on the point, at the given level from 1 to 5, paying the build cost plus each upgrade. */
  | { type: 'buildTower'; x: number; y: number; level: number }
  /** Raises a tower by one level. */
  | { type: 'upgradeTower'; id: number }
  /** Removes a tower and refunds a share of what it cost. */
  | { type: 'demolishTower'; id: number }
  /** Draws a service road (T60). Its ends snap to depot exits, stand connection points and other roads. */
  | { type: 'buildRoad'; points: Pt[] }
  /** Builds a ground handling depot centred on the point, door side facing the heading (rounded to 90 degrees). */
  | { type: 'buildDepot'; x: number; y: number; headingDeg: number }
  /** Builds a supporting building (T65) centred on the point, door side facing the heading (rounded to 90 degrees). */
  | { type: 'buildBuilding'; kind: BuildingKind; x: number; y: number; headingDeg: number }
  /** Buys one fire vehicle for a fire station. */
  | { type: 'buyFireVehicle'; id: number }
  | { type: 'setTaxiwayProps'; id: number; oneWay?: boolean; preferred?: number; closed?: boolean; userMaxCode?: CodeLetter; speedKmh?: number }
  | { type: 'reclassTaxiway'; id: number; code: CodeLetter; surface: Surface; tier: number }
  | { type: 'reverseTaxiway'; id: number }
  /** Moves a holding position along its taxiway, never closer to the runway than the default. */
  | { type: 'moveHolding'; runwayId: number; taxiwayId: number; side: 1 | -1; distM: number }
  | { type: 'buyGse'; kind: string; count: number }
  | { type: 'setStandProps'; id: number; closed?: boolean; accepts?: number; pushback?: PushbackDir }
  /** Builds a stand upgrade (T66): pays its cost and closes the stand until the works finish. */
  | { type: 'startStandUpgrade'; id: number; upgrade: StandUpgrade }
  /** Picks the gate desk (logical cell of a grid) that boards a stand; building -1 clears it (T66). */
  | { type: 'setStandGate'; id: number; building: number; x: number; y: number }
  | { type: 'assignStand'; flight: number; standId: number }
  | { type: 'cancelFlight'; flight: number }
  | { type: 'setAutoStands'; on: boolean }
  | { type: 'autoAssignStands' }
  | { type: 'resizeRunway'; id: number; end: 'a' | 'b'; deltaM: number }
  | { type: 'reclassRunway'; id: number; code: CodeLetter; approach: Approach }
  /** Builds a turn pad at one end of a runway on the given side, or removes it with null. */
  | { type: 'turnPad'; runwayId: number; end: 'a' | 'b'; side: PadSide | null }
  | { type: 'editTaxiway'; id: number; op: 'extend' | 'trim' | 'cut'; end?: 'start' | 'end'; points?: Pt[]; at?: Pt; at2?: Pt }
  | { type: 'resurface'; kind: 'runway' | 'taxiway' | 'apron'; id: number; surface: Surface; tier: number }
  /** level is the floor index and defaults to 0, the only floor that can be built for now. */
  | { type: 'terminalBuild'; building: number; ox: number; oy: number; headingDeg: number; level?: number; edit: TerminalEdit }
  | { type: 'demolishTerminal'; id: number }
  /** Raises the leveled fixture covering logical cell (x, y) of a building one level through works (T74). */
  | { type: 'upgradeFixture'; building: number; x: number; y: number }
  /** Cancels the upgrade works of the fixture covering logical cell (x, y), with a full refund (T74). */
  | { type: 'cancelFixtureUpgrade'; building: number; x: number; y: number }
  /** Places a prop of the kit on floor 0 of a building (T76): x and y in grid meters on the 0.5 m grid, rot in quarter turns. */
  | { type: 'placeProp'; building: number; asset: string; x: number; y: number; rot: 0 | 1 | 2 | 3 }
  /** Removes the topmost prop under the point (x, y) in grid meters with a full refund (T76). */
  | { type: 'removeProp'; building: number; x: number; y: number }
  /** Baggage network (T43): place a node on a building grid, remove it, assign a stand to a bay (bayId -1 unassigns), or rerun the link rule of a node. */
  /** Zones a rectangle of logical cells on a terminal floor as a tenant unit of a category (T32). */
  | { type: 'zoneUnit'; building: number; x: number; y: number; w: number; h: number; category: number }
  /** Removes a tenant unit and ends its lease. */
  | { type: 'removeUnit'; id: number }
  /** Accepts or declines a pending application of a brand for a unit. */
  | { type: 'acceptTenant'; unit: number; brand: number }
  | { type: 'declineTenant'; unit: number; brand: number }
  /** Buys a one off advertising campaign that brings one application for a vacant unit of the category. */
  | { type: 'adCampaign'; category: number }
  | { type: 'placeBaggageNode'; building: number; kind: 'machine' | 'bay' | 'carousel'; cx: number; cy: number; rot: 0 | 1 | 2 | 3; widthCells: number }
  | { type: 'removeBaggageNode'; id: number }
  | { type: 'setStandBay'; standId: number; bayId: number }
  | { type: 'fixBaggageNode'; id: number }
  | { type: 'signAirline'; airlineId: number; sign: boolean }
  /** Weekly planner (T61): place a flight series on a stand at an arrival minute of the day, on all its operating days. */
  | { type: 'placeSeries'; seriesId: number; standId: number; minute: number }
  | { type: 'unplaceSeries'; seriesId: number }
  | { type: 'cancelSeries'; seriesId: number }
  | { type: 'renewSeries'; seriesId: number }
  | { type: 'setAirlineFee'; airlineId: number; level: FeeLevel }
  /** Caps the hired staff of a role, -1 for automatic staffing with no cap (T68). */
  | { type: 'setStaffCap'; role: number; cap: number }
  | { type: 'takeLoan'; amount: number }
  | { type: 'repayLoan'; amount: number }
  | { type: 'undo' }
  | { type: 'redo' };

export interface LoggedCommand {
  tick: number;
  cmd: Command;
}

/** Ordered record of applied commands. Seed plus this log is a full replay. */
export class CommandLog {
  readonly entries: LoggedCommand[] = [];

  push(tick: number, cmd: Command): void {
    this.entries.push({ tick, cmd });
  }

  /** The last `n` commands, used for crash reports. */
  tail(n: number): Command[] {
    const from = Math.max(0, this.entries.length - n);
    const out: Command[] = [];
    for (let i = from; i < this.entries.length; i++) out.push(this.entries[i].cmd);
    return out;
  }
}
