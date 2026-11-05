import type { Approach, CodeLetter, PadSide, PushbackDir, StandSize, StandType, Surface } from '@shared/airfield';
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
  | { type: 'buyParcel'; parcelId: number }
  | { type: 'buyParcels'; ids: number[] }
  | { type: 'buildRunway'; x: number; y: number; headingDeg: number; lengthM: number; code: CodeLetter; approach: Approach; surface: Surface; tier: number }
  | { type: 'buildTaxiway'; points: Pt[]; code: CodeLetter; kind: 'taxiway' | 'taxilane'; surface: Surface; tier: number }
  | { type: 'buildRapidExit'; runwayId: number; distM: number; side: 'left' | 'right'; angleDeg: 30 | 45 | 90; code: CodeLetter; surface: Surface; tier: number }
  | { type: 'buildParallelTaxiway'; runwayId: number; side: 'left' | 'right'; offsetM: number; code: CodeLetter; connectors: number; surface: Surface; tier: number }
  | { type: 'buildApron'; polygon: Pt[]; surface: Surface; tier: number }
  /** Takes a piece out of an apron: the one given, or every apron the piece overlaps. */
  | { type: 'cutApron'; polygon: Pt[]; id?: number }
  | { type: 'buildStands'; x: number; y: number; headingDeg: number; count: number; spacingM: number; standType: StandType; size: StandSize }
  | { type: 'buildGaBlock'; x: number; y: number; headingDeg: number; count: number }
  | { type: 'demolish'; kind: 'runway' | 'taxiway' | 'apron' | 'stand'; id: number }
  | { type: 'setTaxiwayProps'; id: number; oneWay?: boolean; preferred?: number; closed?: boolean; userMaxCode?: CodeLetter; speedKmh?: number }
  | { type: 'reclassTaxiway'; id: number; code: CodeLetter; surface: Surface; tier: number }
  | { type: 'reverseTaxiway'; id: number }
  /** Moves a holding position along its taxiway, never closer to the runway than the default. */
  | { type: 'moveHolding'; runwayId: number; taxiwayId: number; side: 1 | -1; distM: number }
  | { type: 'buyGse'; kind: string; count: number }
  | { type: 'setStandProps'; id: number; closed?: boolean; usage?: 'any' | 'commercial' | 'ga'; pushback?: PushbackDir }
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
  | { type: 'terminalBuild'; building: number; ox: number; oy: number; headingDeg: number; edit: TerminalEdit }
  | { type: 'demolishTerminal'; id: number }
  | { type: 'signAirline'; airlineId: number; rotations: number }
  | { type: 'setSlot'; airlineId: number; index: number; minute: number }
  | { type: 'setAirlineFee'; airlineId: number; level: FeeLevel }
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
