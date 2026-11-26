import { dayIndex, minuteOfDay } from '@shared/business';
const money = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

export const formatMoney = (v: number): string => money.format(v);
export const formatNumber = (v: number): string => num.format(v);
export const formatInt = (v: number): string => int.format(v);

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassName = (deg: number): string => COMPASS[Math.round(deg / 45) % 8];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatClock(tick: number): string {
  const d = new Date(Date.UTC(2027, 0, 1 + dayIndex(tick)));
  const m = minuteOfDay(tick);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const DAYS = ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

/** Money in the compact top bar form, such as $12.3M or -$6.4K. */
export const formatMoneyShort = (v: number): string => `${v < 0 ? '-' : ''}$${compact.format(Math.abs(v))}`;

/** Game time of day, HH:MM. */
export function formatTime(tick: number): string {
  const m = minuteOfDay(tick);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Game date with its weekday, such as Tue 12 Mar 2027. The calendar starts on Friday 1 January 2027. */
export function formatDate(tick: number): string {
  const day = dayIndex(tick);
  const d = new Date(Date.UTC(2027, 0, 1 + day));
  return `${DAYS[day % 7]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Seconds since midnight of the game clock, for the analog clock hands. */
export const daySeconds = (tick: number): number => minuteOfDay(tick) * 60;
