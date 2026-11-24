/** Fixed simulation step in game seconds (hard rule 3). */
export const TICK_SECONDS = 0.1;

/**
 * The game calendar runs this many times faster than physical motion. One tick is always 0.1 s of motion
 * (aircraft, vehicles and walkers), but one tick advances the game clock by CLOCK_SCALE tenths of a game
 * second, so a game minute is 600 / CLOCK_SCALE ticks and a game day is 72000 ticks. A faster calendar was tried for T91 and dropped: ground handling then overran
 * its turnaround windows, so the pace comes from more ticks per real second instead (owner, 2026-11-24). Durations given in game
 * minutes, hours or days (turnarounds, works, weather, service times in data) follow the calendar; physical
 * durations (taxiing, runway occupancy, wake separation, walking) keep their tick counts.
 */
export const CLOCK_SCALE = 12;

/** Ticks in one game minute on the calendar (50 with CLOCK_SCALE 12). */
export const TICKS_PER_GAME_MINUTE = 600 / CLOCK_SCALE;

/** Game clock seconds to ticks, at least one tick. Used for durations in data files that are stated in game seconds. */
export function gameSecondsToTicks(s: number): number {
  return Math.max(1, Math.round((s * 10) / CLOCK_SCALE));
}

/**
 * At speed 1 the sim runs 30 ticks per real second: motion at 3x real time, and one game day in 40 real
 * minutes (72000 ticks / 30). Speed 8 gives 5 real minutes per day with motion at 24x (T91).
 */
export const TICKS_PER_REAL_SECOND_AT_1X = 30;

/** Snapshots leave the sim worker at a steady 20 Hz regardless of sim speed. */
export const SNAPSHOT_INTERVAL_MS = 50;

/** Above this many ticks of backlog the speed caps automatically. */
export const BACKLOG_SPEED_CAP_TICKS = 50;

export const SPEEDS = [0, 1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];
