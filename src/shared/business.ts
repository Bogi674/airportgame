/** Business state shared with the UI: terminals, airlines, the ledger, the loan and the rating. */

import { TICKS_PER_GAME_MINUTE } from './time';

/** Calendar ticks, derived from CLOCK_SCALE in time.ts: 50 ticks per game minute, 72000 per game day. */
export const TICKS_PER_MINUTE = TICKS_PER_GAME_MINUTE;
export const TICKS_PER_DAY = 24 * 60 * TICKS_PER_MINUTE;

/** The airline name the flights board shows for general aviation flights. */
export const GA_LABEL = 'GA';

/** The game starts at 06:00 on day 0. */
export const START_MINUTE = 6 * 60;

export const dayIndex = (tick: number): number => Math.floor((tick + START_MINUTE * TICKS_PER_MINUTE) / TICKS_PER_DAY);
export const minuteOfDay = (tick: number): number => Math.floor(((tick + START_MINUTE * TICKS_PER_MINUTE) % TICKS_PER_DAY) / TICKS_PER_MINUTE);

export const LEDGER_CATEGORIES = ['construction', 'land', 'landing', 'passengers', 'parking', 'rent', 'wages', 'upkeep', 'interest', 'loan', 'fuel'] as const;
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];
export const LEDGER_DAYS = 30;

/** Counted things inside terminals. Fixture ids in the grids index this list from 1. */
export const FIXTURE_KEYS = ['checkIn', 'security', 'belt', 'seating', 'toilet', 'convenience', 'quickFood', 'cafe', 'dutyFree', 'booksGifts', 'pharmacy', 'atc', 'kiosk', 'bagDrop', 'passport', 'gateDesk'] as const;
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
  kiosk: [1],
  bagDrop: [1],
  passport: [3],
  gateDesk: [3],
};
/** Cells a fixture covers. Two cell fixtures keep their direction in the terminal grid. */
export const FIXTURE_SPAN: Record<FixtureKey, 1 | 2> = {
  checkIn: 1,
  security: 1,
  belt: 1,
  seating: 1,
  toilet: 1,
  convenience: 1,
  quickFood: 1,
  cafe: 1,
  dutyFree: 1,
  booksGifts: 1,
  pharmacy: 1,
  atc: 1,
  kiosk: 1,
  bagDrop: 2,
  passport: 1,
  gateDesk: 2,
};

export const WALL = { None: 0, Wall: 1, Glass: 2, Door: 3 } as const;

/** Terminal cells are 2 m in the local frame of a building. */
export const TERMINAL_CELL_M = 2;
/**
 * A building's grid grows in steps of this many cells (64 m) when an edit reaches past it, so a
 * building has no size limit beyond land, money and clearances (docs/DESIGN_REVISION_2.md section 5).
 */
export const TERMINAL_CHUNK = 32;
/** A new building puts its first cell this far from the grid corner, so it can grow in every direction. */
export const TERMINAL_MARGIN = 40;
/** Lowest and highest floor a building can have, 0 is the apron level. */
export const TERMINAL_LEVEL_MIN = -2;
export const TERMINAL_LEVEL_MAX = 3;

/** One floor of one terminal building: the floor, fixtures and walls the player laid. */
export interface TerminalGrid {
  id: number;
  /** Building this floor belongs to. Floors of one building share it. */
  building: number;
  /** Floor index: 0 is the apron level, negative floors are basements, positive floors are upper floors. */
  level: number;
  /** World position of the grid corner and the heading of its x axis (compass degrees). */
  ox: number;
  oy: number;
  headingDeg: number;
  /** Logical cell of array cell (0, 0) and the array size in cells. Logical cells never move as the grid grows. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  floor: Uint8Array;
  /** Painted zone per cell, see ZONE. */
  zone: Uint8Array;
  fixture: Uint8Array;
  /**
   * Footprint of a fixture per cell: 0 for an empty cell or a one cell fixture, 1 + rot on the anchor of a two cell
   * fixture and 5 + rot on its tail. Rot 0 to 3 is the direction from anchor to tail: +column, +row, -column, -row.
   */
  fixtureRot: Uint8Array;
  /** Horizontal wall edges, (h + 1) rows of w columns. Index row * w + column, the edge above that cell. */
  hWall: Uint8Array;
  /** Vertical wall edges, h rows of (w + 1) columns. Index row * (w + 1) + column, the edge left of that cell. */
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

export type AirlineScope = 'regional' | 'national' | 'international';
export type FeeLevel = 0 | 1 | 2;

export interface Airline {
  id: number;
  name: string;
  scope: AirlineScope;
  livery: number;
  /** Aircraft type indexes the airline flies. */
  fleet: number[];
  minRating: number;
  /** True while the airline has a contract with the airport. */
  signed: boolean;
  /** Destination index of the airline's home base. */
  hub: number;
  /** Airline satisfaction 0 to 100 (D14). */
  happiness: number;
  /** Weeks in a row below the cancel and the end thresholds of D14. */
  lowWeeks: number;
  veryLowWeeks: number;
  feeLevel: FeeLevel;
  flights: number;
  pax: number;
}

/** A generated airport the airlines fly to (docs/DESIGN_REVISION_4.md section 3.4). Rebuilt from the seed, never saved. */
export interface Destination {
  id: number;
  name: string;
  /** Great circle distance from the site in km. */
  km: number;
  bearingDeg: number;
  /** 1 (small) to 5 (large), also the demand weight. */
  size: number;
  /** Index into the region list of market.json. */
  region: number;
}

/**
 * A flight series under contract (section 3.1): one aircraft type to one destination on fixed
 * weekdays. The player places it once with a stand and an arrival minute, and it flies on every
 * operating day at that time until it expires or is cancelled.
 */
export interface FlightSeries {
  id: number;
  airline: number;
  dest: number;
  typeIdx: number;
  /** Operating weekdays as bits, Monday is bit 0. */
  days: number;
  /** Start of the preferred arrival window, minute of the day. */
  winMin: number;
  /** First and last game day of the contract, as day indexes; the series flies while startDay <= day < endDay. */
  startDay: number;
  endDay: number;
  /** Placed stand and arrival minute of the day, -1 while unplaced. */
  standId: number;
  minute: number;
  /** Nominal turnaround in minutes. */
  turnMin: number;
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
  /** Stage length of the flight in km, 0 for test flights. */
  stageKm: number;
  /** Flight index for commands, the stand id it is assigned to or sits on (-1 for none) and its stay in minutes. */
  flight: number;
  standId: number;
  turnMin: number;
  /** Scheduled off block, minute of the day: the scheduled arrival plus the nominal turnaround. */
  offBlockMin: number;
  /** Index of the aircraft in the aircraft data list, for the stand rule. */
  typeIdx: number;
  /** Arrival in absolute game minutes, unwrapped, as the stand rule compares it. */
  startMin: number;
}

export interface BusinessPayload {
  board: BoardRow[];
  /** Flight series of every signed airline (T61). */
  series: FlightSeries[];
  /** The destination network of the seed (T62). */
  destinations: Destination[];
  /** Airport stars from the rating (D27) and the two experiences behind the rating, in percent. */
  stars: number;
  paxScore: number;
  airlineScore: number;
  /** 1 or 0 per stand, indexed like airfield.data.stands: a taxi node reaches the stand. */
  standLinked: number[];
  /** 1 or 0 per stand, indexed like airfield.data.stands: a contact stand has a terminal in reach, others are 1. */
  standContact: number[];
  /** Landings plus takeoffs the tower allows per rolling hour across every runway, 0 without a tower. */
  movementBudget: number;
  /** Four numbers per flight that holds a stand (Scheduled, Inbound or OnGround): stand id, flight, start and end in absolute game minutes. Uncapped, the numbers the stand rule compares. */
  standBlocks: number[];
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
  /** When false flights only use stands assigned to them. */
  autoStands: boolean;
  /** Highest ATC tower level on the site, 0 when none stands. */
  towerLevel: number;
  /** Landings and takeoffs waiting for the tower's rolling hour movement budget. */
  atcQueue: number;
  /** Vehicles owned by catalog index of the ground vehicle list. */
  fleet: number[];
  /** Fuel in the farms, what they hold and what tankers bring, in liters (T65). */
  fuelStockL: number;
  fuelCapacityL: number;
  fuelInboundL: number;
  /** The airport's fire category and the game days of grace left before a shortfall refuses flights (T65). */
  fireCategory: number;
  fireGraceDays: number;
  /** 1 when ground handling keeps up, up to 1.6 when it is short of vehicles. */
  serviceSlowdown: number;
  arrCapacity: number;
  /** Passengers the passport booths can clear per hour. */
  intlCapacity: number;
  /** Ledger history, newest day last, one row of LEDGER_CATEGORIES.length numbers per day, plus today. */
  history: number[][];
  today: number[];
  paxToday: number;
  flightsToday: number;
  lostPaxToday: number;
}
