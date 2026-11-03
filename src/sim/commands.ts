import type { Approach, CodeLetter, StandType, Surface } from '@shared/airfield';
import type { Pt } from '@shared/geom';

/**
 * Every player action is a serializable command applied at a tick boundary (hard rule 4).
 * M0 only has the scaffold test traffic commands. Gameplay commands arrive with their milestones.
 */
export type Command =
  | { type: 'spawnTestAircraft'; x: number; y: number; heading: number; speed: number }
  | { type: 'clearTestAircraft' }
  | { type: 'buyParcel'; parcelId: number }
  | { type: 'buyParcels'; ids: number[] }
  | { type: 'buildRunway'; x: number; y: number; headingDeg: number; lengthM: number; code: CodeLetter; approach: Approach; surface: Surface; tier: number }
  | { type: 'buildTaxiway'; points: Pt[]; code: CodeLetter; kind: 'taxiway' | 'taxilane'; surface: Surface; tier: number }
  | { type: 'buildRapidExit'; runwayId: number; distM: number; side: 'left' | 'right'; angleDeg: 30 | 45 | 90; code: CodeLetter; surface: Surface; tier: number }
  | { type: 'buildParallelTaxiway'; runwayId: number; side: 'left' | 'right'; offsetM: number; code: CodeLetter; connectors: number; surface: Surface; tier: number }
  | { type: 'buildApron'; polygon: Pt[]; surface: Surface; tier: number }
  | { type: 'buildStands'; x: number; y: number; headingDeg: number; count: number; spacingM: number; standType: StandType; code: CodeLetter }
  | { type: 'buildGaBlock'; x: number; y: number; headingDeg: number; count: number }
  | { type: 'demolish'; kind: 'runway' | 'taxiway' | 'apron' | 'stand'; id: number }
  | { type: 'setTaxiwayProps'; id: number; oneWay?: boolean; closed?: boolean; userMaxCode?: CodeLetter; speedKmh?: number }
  | { type: 'resurface'; kind: 'runway' | 'taxiway' | 'apron'; id: number; surface: Surface; tier: number }
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
