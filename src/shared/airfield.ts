import type { Pt } from './geom';
import type { RunwayObstacles } from './obstacles';

export type Surface = 'dirt' | 'gravel' | 'grass' | 'asphalt' | 'concrete';
export const SURFACES: readonly Surface[] = ['dirt', 'gravel', 'grass', 'asphalt', 'concrete'];
export type CodeLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export const CODES: readonly CodeLetter[] = ['A', 'B', 'C', 'D', 'E', 'F'];
export type Approach = 'visual' | 'nonPrecision' | 'precision';
export const APPROACHES: readonly Approach[] = ['visual', 'nonPrecision', 'precision'];
export type TaxiKind = 'taxiway' | 'taxilane' | 'rapidExit';
/** Contact stands sit at a terminal with jet bridges, remote stands do not (docs/DESIGN_REVISION_2.md 3.5). */
export type StandType = 'contact' | 'remote';
export const STAND_TYPES: readonly StandType[] = ['contact', 'remote'];
/** The four stand sizes (docs/DESIGN_REVISION_2.md section 3.1). */
export type StandSize = 'small' | 'medium' | 'large' | 'xl';
export const STAND_SIZES_ORDER: readonly StandSize[] = ['small', 'medium', 'large', 'xl'];
/** Push back along the left or right fork arc, or the side away from the departure route. */
export type PushbackDir = 'left' | 'right' | 'auto';

export const codeIndex = (c: CodeLetter): number => CODES.indexOf(c);

export interface Runway {
  id: number;
  /** What it cost to build, used for demolition refunds. */
  cost: number;
  /** Threshold A, then threshold B. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Compass heading from threshold A to B in whole degrees, 0 to 359. */
  headingDeg: number;
  lengthM: number;
  widthM: number;
  shoulderM: number;
  code: CodeLetter;
  approach: Approach;
  surface: Surface;
  pcr: number;
  condition: number;
  /** Designators such as 09 and 27, with L or R for parallel runways. */
  nameA: string;
  nameB: string;
  /** Works in progress: the runway is closed until `doneTick`. */
  works?: { doneTick: number };
}

export interface Taxiway {
  id: number;
  /** What it cost to build, used for demolition refunds. */
  cost: number;
  kind: TaxiKind;
  points: Pt[];
  code: CodeLetter;
  widthM: number;
  surface: Surface;
  pcr: number;
  condition: number;
  oneWay: boolean;
  /** Preferred direction along the points: 0 none, 1 forward, -1 reverse. Routing avoids the other way but may use it. */
  preferred?: number;
  closed: boolean;
  /** Player setting. */
  userMaxCode: CodeLetter;
  /** Effective maximum code after separation checks. */
  maxCode: CodeLetter;
  speedKmh: number;
  name: string;
  /** Surface works in progress: the taxiway is closed until `doneTick`, then takes the new surface. */
  works?: Works;
  /** Holding positions the player moved further out than the default, per runway and side. */
  holds?: HoldSetting[];
}

/** A holding position moved out by the player: never closer than the default for the runway. */
export interface HoldSetting {
  runwayId: number;
  /** Side of the runway centerline, see `runwaySide`. */
  side: 1 | -1;
  distM: number;
}

/** Which side of a runway's centerline a point is on: 1 left of the heading from threshold A, -1 right. */
export function runwaySide(r: Pick<Runway, 'x1' | 'y1' | 'x2' | 'y2'>, x: number, y: number): 1 | -1 {
  return (r.x2 - r.x1) * (y - r.y1) - (r.y2 - r.y1) * (x - r.x1) < 0 ? 1 : -1;
}

/** A surface change under construction (docs/DESIGN_REVISION_2.md section 2.5). */
export interface Works {
  surface: Surface;
  pcr: number;
  /** Value of the finished pavement, the new build cost. */
  cost: number;
  doneTick: number;
}

export interface Apron {
  id: number;
  /** What it cost to build, used for demolition refunds. */
  cost: number;
  /** Outer ring. */
  polygon: Pt[];
  /** Pieces cut out of it (docs/DESIGN_REVISION_2.md section 4). */
  holes?: Pt[][];
  /** Shown in the inspector, such as Apron 1. */
  name?: string;
  surface: Surface;
  pcr: number;
  condition: number;
}

export interface Stand {
  id: number;
  /** What it cost to build, used for demolition refunds. */
  cost: number;
  number: string;
  x: number;
  y: number;
  /** Compass heading the aircraft nose points to when parked. */
  headingDeg: number;
  type: StandType;
  size: StandSize;
  /** Largest code of the size, for routing. */
  code: CodeLetter;
  surface: Surface;
  pushback: PushbackDir;
  /** Closed stands take no aircraft. */
  closed?: boolean;
  /** Which flights may use the stand. Missing means any. */
  usage?: 'any' | 'commercial' | 'ga';
}

export interface HoldingPoint {
  x: number;
  y: number;
  runwayId: number;
  taxiwayId: number;
  /** Distance from the runway centerline. */
  distM: number;
  side: 1 | -1;
  /** The default distance for the runway, the closest the point may be. */
  minM: number;
}

export interface RunwayEntry {
  x: number;
  y: number;
  runwayId: number;
  taxiwayId: number;
  /** Takeoff distance available heading toward threshold B and toward A. */
  todaTowardB: number;
  todaTowardA: number;
}

/** Everything the renderer and UI need to know about the airfield. */
export interface AirfieldPayload {
  version: number;
  runways: Runway[];
  taxiways: Taxiway[];
  aprons: Apron[];
  stands: Stand[];
  holding: HoldingPoint[];
  entries: RunwayEntry[];
  /** Obstacle surface results per runway, derived from the terrain, land and buildings. */
  obstacles?: RunwayObstacles[];
}

export const EMPTY_AIRFIELD: AirfieldPayload = { version: 0, runways: [], taxiways: [], aprons: [], stands: [], holding: [], entries: [] };

/** Compass heading to a unit vector in world space. North is -y. */
export function compassVector(deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a), y: -Math.cos(a) };
}
