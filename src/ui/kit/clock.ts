/** Hand angles of the analog clock in degrees clockwise from 12, for a time of day in seconds (design revision 6, 3.5). */
export interface HandAngles {
  hour: number;
  minute: number;
  second: number;
}

const DAY_S = 86_400;

/**
 * Hour, minute and second hand angles. With `minuteStep` set the second hand jumps once per game minute,
 * which revision 6 section 10 asks for at 8x so the hand does not flicker.
 */
export function clockAngles(daySeconds: number, minuteStep = false): HandAngles {
  const s = ((daySeconds % DAY_S) + DAY_S) % DAY_S;
  const sec = s % 60;
  const min = (s / 60) % 60;
  const hr = (s / 3600) % 12;
  return {
    hour: hr * 30,
    minute: min * 6,
    second: minuteStep ? 0 : Math.floor(sec) * 6,
  };
}
