import type { Pt } from './geom';

export type Surface = 'dirt' | 'gravel' | 'grass' | 'asphalt' | 'concrete';
export const SURFACES: readonly Surface[] = ['dirt', 'gravel', 'grass', 'asphalt', 'concrete'];
export type CodeLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export const CODES: readonly CodeLetter[] = ['A', 'B', 'C', 'D', 'E', 'F'];
export type Approach = 'visual' | 'nonPrecision' | 'precision';
export const APPROACHES: readonly Approach[] = ['visual', 'nonPrecision', 'precision'];
export type TaxiKind = 'taxiway' | 'taxilane' | 'rapidExit';
export type StandType = 'contact' | 'remotePushback' | 'remoteThrough' | 'gaTieDown';
export const STAND_TYPES: readonly StandType[] = ['contact', 'remotePushback', 'remoteThrough', 'gaTieDown'];
export type PushbackDir = 'left' | 'right' | 'straight' | 'none';

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
  closed: boolean;
  /** Player setting. */
  userMaxCode: CodeLetter;
  /** Effective maximum code after separation checks. */
  maxCode: CodeLetter;
  speedKmh: number;
  name: string;
}

export interface Apron {
  id: number;
  /** What it cost to build, used for demolition refunds. */
  cost: number;
  polygon: Pt[];
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
  code: CodeLetter;
  surface: Surface;
  pushback: PushbackDir;
}

export interface HoldingPoint {
  x: number;
  y: number;
  runwayId: number;
  taxiwayId: number;
  distM: number;
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
}

export const EMPTY_AIRFIELD: AirfieldPayload = { version: 0, runways: [], taxiways: [], aprons: [], stands: [], holding: [], entries: [] };

/** Compass heading to a unit vector in world space. North is -y. */
export function compassVector(deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a), y: -Math.cos(a) };
}
