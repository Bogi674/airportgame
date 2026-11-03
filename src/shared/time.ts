/** Fixed simulation step in game seconds (hard rule 3). */
export const TICK_SECONDS = 0.1;

/** At speed 1 the clock runs 1 game minute per real second (docs/ARCHITECTURE.md section 3). */
export const TICKS_PER_REAL_SECOND_AT_1X = 600;

/** Snapshots leave the sim worker at a steady 20 Hz regardless of sim speed. */
export const SNAPSHOT_INTERVAL_MS = 50;

/** Above this many ticks of backlog the speed caps automatically. */
export const BACKLOG_SPEED_CAP_TICKS = 50;

export const SPEEDS = [0, 1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];
