import type { GameOptions } from '@shared/protocol';
import type { Command, LoggedCommand } from './commands';
import { Sim } from './sim';

export const REPLAY_VERSION = 1;

/** Seed plus command log is a full replay (hard rule 4). */
export interface Replay {
  version: number;
  seed: string;
  options: GameOptions;
  commands: LoggedCommand[];
}

/** Builds a replay from a live sim. */
export function recordReplay(sim: Sim): Replay {
  return {
    version: REPLAY_VERSION,
    seed: sim.seed,
    options: sim.options,
    commands: sim.log.entries.map((e) => ({ tick: e.tick, cmd: e.cmd })),
  };
}

/**
 * Runs a replay headlessly for `ticks` ticks. Commands logged at tick T are enqueued
 * before tick T runs, exactly as they were applied live.
 */
export function runReplay(replay: Replay, ticks: number): Sim {
  if (replay.version !== REPLAY_VERSION) {
    throw new Error(`Unsupported replay version ${replay.version}`);
  }
  const sim = new Sim(replay.seed, replay.options);
  let next = 0;
  const cmds = replay.commands;
  for (let t = 0; t < ticks; t++) {
    while (next < cmds.length && cmds[next].tick === t) {
      sim.enqueue(cmds[next].cmd as Command);
      next++;
    }
    sim.step();
  }
  return sim;
}
