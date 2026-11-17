import { STAND_BLOCK_BUFFER_MIN } from './flightBlock';
import type { FlightSeries } from './business';

/**
 * The weekly planner rule (docs/DESIGN_REVISION_4.md section 3.2): a placed series holds its stand
 * from the arrival minute for its turnaround plus the stand block buffer on every operating day,
 * and two series on one stand may not share any minute of the week. Blocks that run past midnight,
 * or past Sunday into Monday, wrap. Sim and planner use the same rule, so a drop the planner shows
 * green is accepted.
 */

export const DAY_MIN = 24 * 60;
export const WEEK_MIN = 7 * DAY_MIN;
/** Monday is bit 0. */
export const ALL_DAYS = 0b1111111;

/** Weekday of a game day index: day 0 is a Monday. */
export function weekdayOf(day: number): number {
  return ((day % 7) + 7) % 7;
}

/** True when the series operates on the weekday (0 Monday to 6 Sunday). */
export function operatesOn(days: number, weekday: number): boolean {
  return (days & (1 << weekday)) !== 0;
}

/** Number of operating days per week. */
export function frequency(days: number): number {
  let n = 0;
  for (let d = 0; d < 7; d++) if (operatesOn(days, d)) n++;
  return n;
}

/** Length of the stand block in minutes. */
export function blockMin(turnMin: number): number {
  return turnMin + STAND_BLOCK_BUFFER_MIN;
}

/** True when two week intervals [a, a + al) and [b, b + bl) overlap, with wrap at the end of the week. */
function weekOverlap(a: number, al: number, b: number, bl: number): boolean {
  for (const shift of [-WEEK_MIN, 0, WEEK_MIN]) {
    const s = b + shift;
    if (a < s + bl && s < a + al) return true;
  }
  return false;
}

/**
 * The first placed series on the stand whose week blocks overlap the candidate placement, or null.
 * The series named by `self` is ignored, so a placed series can be moved within its own block.
 */
export function seriesClash(days: number, turnMin: number, minute: number, standId: number, placed: readonly FlightSeries[], self = -1): FlightSeries | null {
  const len = blockMin(turnMin);
  for (const o of placed) {
    if (o.id === self || o.standId !== standId || o.minute < 0) continue;
    const ol = blockMin(o.turnMin);
    for (let d = 0; d < 7; d++) {
      if (!operatesOn(days, d)) continue;
      for (let e = 0; e < 7; e++) {
        if (operatesOn(o.days, e) && weekOverlap(d * DAY_MIN + minute, len, e * DAY_MIN + o.minute, ol)) return o;
      }
    }
  }
  return null;
}

/** True when the arrival minute lies inside the preferred window, which may wrap past midnight. */
export function inWindow(winMin: number, windowLen: number, minute: number): boolean {
  const off = (((minute - winMin) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return off < windowLen;
}

/** True while the contract covers the day. */
export function seriesActive(s: Pick<FlightSeries, 'startDay' | 'endDay'>, day: number): boolean {
  return day >= s.startDay && day < s.endDay;
}
