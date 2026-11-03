/**
 * Every player action is a serializable command applied at a tick boundary (hard rule 4).
 * M0 only has the scaffold test traffic commands. Gameplay commands arrive with their milestones.
 */
export type Command =
  | { type: 'spawnTestAircraft'; x: number; y: number; heading: number; speed: number }
  | { type: 'clearTestAircraft' };

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
