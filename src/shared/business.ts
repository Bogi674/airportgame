/** Business state shared with the UI: terminals, airlines, the ledger, the loan and the rating. */

export const TICKS_PER_DAY = 864000;
export const TICKS_PER_MINUTE = 600;
/** The game starts at 06:00 on day 0. */
export const START_MINUTE = 6 * 60;

export const dayIndex = (tick: number): number => Math.floor((tick + START_MINUTE * TICKS_PER_MINUTE) / TICKS_PER_DAY);
export const minuteOfDay = (tick: number): number => Math.floor(((tick + START_MINUTE * TICKS_PER_MINUTE) % TICKS_PER_DAY) / TICKS_PER_MINUTE);

export const LEDGER_CATEGORIES = ['construction', 'land', 'landing', 'passengers', 'parking', 'rent', 'wages', 'upkeep', 'interest', 'loan'] as const;
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];
export const LEDGER_DAYS = 30;

/** Counted things inside terminals. Fixture ids in the grids index this list from 1. */
export const FIXTURE_KEYS = ['checkIn', 'security', 'belt', 'seating', 'toilet', 'convenience', 'quickFood', 'cafe', 'dutyFree', 'booksGifts', 'pharmacy', 'atc'] as const;
export type FixtureKey = (typeof FIXTURE_KEYS)[number];
export const FIXTURE_COUNT = FIXTURE_KEYS.length;
export const SHOP_FIXTURE_KEYS: readonly FixtureKey[] = ['convenience', 'quickFood', 'cafe', 'dutyFree', 'booksGifts', 'pharmacy'];
export const isShopFixture = (id: number): boolean => id >= 6 && id <= 11;
/** Cells of control room a tower needs before it counts (a 2 by 2 cab). */
export const ATC_MIN_CELLS = 4;
export const fixtureKey = (id: number): FixtureKey => FIXTURE_KEYS[id - 1];
export type ShopKind = FixtureKey;

export const FLOOR = { None: 0, Concrete: 1, Tile: 2, Carpet: 3 } as const;
/** Zones a player paints on terminal floor. 0 is unzoned. */
export const ZONES = ['none', 'public', 'commercial', 'secure', 'staff'] as const;
export type ZoneKey = (typeof ZONES)[number];
export const ZONE = { None: 0, Public: 1, Commercial: 2, Secure: 3, Staff: 4 } as const;
/** Zones each fixture may sit in, the first is what an unzoned cell becomes when the fixture is placed. */
export const FIXTURE_ZONES: Record<FixtureKey, readonly number[]> = {
  checkIn: [1],
  security: [1, 3],
  belt: [1, 4],
  seating: [3, 1],
  toilet: [3, 1, 4],
  convenience: [2, 3],
  quickFood: [2, 3],
  cafe: [2, 3],
  dutyFree: [2, 3],
  booksGifts: [2, 3],
  pharmacy: [2, 3],
  atc: [4],
};

export const WALL = { None: 0, Wall: 1, Glass: 2, Door: 3 } as const;

/** Terminal grid: 160 by 160 cells of 2 m in the local frame of a building. */
export const TERMINAL_GRID = 160;
export const TERMINAL_CELL_M = 2;
/** A new building puts its first cell this far from the grid corner, so it can grow in every direction. */
export const TERMINAL_MARGIN = 40;

/** One terminal building: the floor, fixtures and walls the player laid. */
export interface TerminalGrid {
  id: number;
  /** World position of the grid corner and the heading of its x axis (compass degrees). */
  ox: number;
  oy: number;
  headingDeg: number;
  floor: Uint8Array;
  /** Painted zone per cell, see ZONE. */
  zone: Uint8Array;
  fixture: Uint8Array;
  /** Horizontal wall edges, (grid + 1) rows of grid columns. Index y * grid + x. */
  hWall: Uint8Array;
  /** Vertical wall edges, grid rows of (grid + 1) columns. Index y * (grid + 1) + x. */
  vWall: Uint8Array;
  /** 1 when a shop fixture has a tenant. */
  leased: Uint8Array;
  /** Money spent on this building, for demolition refunds. */
  cost: number;
}

/** A building in the business payload: counts only, the grids travel separately. */
export interface Terminal {
  id: number;
  cells: number;
  counts: Record<FixtureKey, number>;
  /** Cells per zone, indexed by ZONE. */
  zones: number[];
  leased: number;
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
  /** Arrival slot of each rotation, minute of the day, in the order the player sees them. */
  slots: number[];
  feeLevel: FeeLevel;
  flights: number;
  pax: number;
}

export type WeatherKind = 'clear' | 'rain' | 'fog' | 'wind';

export interface BoardRow {
  airline: string;
  type: string;
  /** Aircraft state name for flights in progress, or `scheduled`. */
  status: string;
  stand: string;
  /** Scheduled arrival, minute of the day. */
  eta: number;
  delayMin: number;
}

export interface BusinessPayload {
  board: BoardRow[];
  version: number;
  day: number;
  minuteOfDay: number;
  terminals: Terminal[];
  terminalVersion: number;
  airlines: Airline[];
  rating: number;
  satisfaction: number;
  onTimePct: number;
  loan: number;
  staff: number;
  weather: WeatherKind;
  /** Missing parts that stop flights, keys for the UI checklist. Empty when ready. */
  readiness: string[];
  depCapacity: number;
  arrCapacity: number;
  /** Ledger history, newest day last, one row of LEDGER_CATEGORIES.length numbers per day, plus today. */
  history: number[][];
  today: number[];
  paxToday: number;
  flightsToday: number;
  lostPaxToday: number;
}
