/** Business state shared with the UI: terminals, airlines, the ledger, the loan and the rating. */

export type ModuleKind = 'checkIn' | 'security' | 'belt' | 'seating' | 'toilet';
export const MODULE_KINDS: readonly ModuleKind[] = ['checkIn', 'security', 'belt', 'seating', 'toilet'];
export type ShopKind = 'convenience' | 'quickFood' | 'cafe' | 'dutyFree' | 'booksGifts' | 'pharmacy';
export const SHOP_KINDS: readonly ShopKind[] = ['convenience', 'quickFood', 'cafe', 'dutyFree', 'booksGifts', 'pharmacy'];

export const TICKS_PER_DAY = 864000;
export const TICKS_PER_MINUTE = 600;
/** The game starts at 06:00 on day 0. */
export const START_MINUTE = 6 * 60;

export const dayIndex = (tick: number): number => Math.floor((tick + START_MINUTE * TICKS_PER_MINUTE) / TICKS_PER_DAY);
export const minuteOfDay = (tick: number): number => Math.floor(((tick + START_MINUTE * TICKS_PER_MINUTE) % TICKS_PER_DAY) / TICKS_PER_MINUTE);

export const LEDGER_CATEGORIES = ['construction', 'land', 'landing', 'passengers', 'parking', 'rent', 'wages', 'upkeep', 'interest', 'loan'] as const;
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];
export const LEDGER_DAYS = 30;

export interface Shop {
  kind: ShopKind;
  leased: boolean;
}

export interface Terminal {
  id: number;
  cx: number;
  cy: number;
  w: number;
  d: number;
  headingDeg: number;
  cost: number;
  modules: Record<ModuleKind, number>;
  shops: Shop[];
}

export type AirlineScope = 'regional' | 'national';
export type FeeLevel = 0 | 1 | 2;

export interface Airline {
  id: number;
  name: string;
  scope: AirlineScope;
  livery: number;
  /** Aircraft type indexes the airline flies. */
  fleet: number[];
  minRating: number;
  /** Rotations per day under contract, 0 when not signed. */
  rotations: number;
  feeLevel: FeeLevel;
  flights: number;
  pax: number;
}

export type WeatherKind = 'clear' | 'rain' | 'fog' | 'wind';

export interface BusinessPayload {
  version: number;
  day: number;
  minuteOfDay: number;
  terminals: Terminal[];
  airlines: Airline[];
  rating: number;
  satisfaction: number;
  onTimePct: number;
  loan: number;
  staff: number;
  weather: WeatherKind;
  depCapacity: number;
  arrCapacity: number;
  /** Ledger history, newest day last, one row of LEDGER_CATEGORIES.length numbers per day, plus today. */
  history: number[][];
  today: number[];
  paxToday: number;
  flightsToday: number;
  lostPaxToday: number;
}
