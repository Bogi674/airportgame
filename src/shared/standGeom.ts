import { AIRCRAFT, standGeometry, type AircraftSpec } from '@data/aircraft';
import { STAND_MARKINGS, STAND_SIZES } from '@data/index';
import type { Stand, StandSize } from './airfield';
import { sizeForSpan } from './standSizes';
import { atan2Det, cosLut, PI, sinLut } from './trig';

/**
 * Stand geometry shared by the sim and the painter (docs/DESIGN_REVISION_2.md section 3). The stand
 * slot is the stand boundary in meters along the heading from the stop point: `far` is the nose limit,
 * just ahead of the nose gear, and the slot runs back toward the taxilane by the size's depth.
 */

/** Types drawn on a stand: those whose own size it is, else the largest that fit, longest first. */
export function standTypes(size: StandSize): AircraftSpec[] {
  const own = AIRCRAFT.filter((a) => sizeForSpan(a.dimensions.wingspanM) === size);
  const pool = own.length > 0 ? own : AIRCRAFT.filter((a) => a.dimensions.wingspanM <= STAND_SIZES[size].maxSpanM);
  const seen = new Set<string>();
  const out: AircraftSpec[] = [];
  for (const a of pool.slice().sort((p, q) => q.dimensions.lengthM - p.dimensions.lengthM || q.dimensions.wingspanM - p.dimensions.wingspanM)) {
    if (seen.has(a.icaoType)) continue;
    seen.add(a.icaoType);
    out.push(a);
    if (out.length >= STAND_MARKINGS.maxStopBars) break;
  }
  return out;
}

/** Along the heading from the stand point: the stop bar of the k-th type of a stand, nose gear on it. */
export function stopBarOffset(size: StandSize, k: number): number {
  return -k * STAND_SIZES[size].stopBarGapM;
}

/** Index of the stop bar a type stops on: its own bar, else the first bar of a type no longer than it, else the last. */
export function stopBarIndex(size: StandSize, type: AircraftSpec): number {
  const types = standTypes(size);
  const own = types.findIndex((a) => a.icaoType === type.icaoType);
  if (own >= 0) return own;
  const shorter = types.findIndex((a) => a.dimensions.lengthM <= type.dimensions.lengthM);
  return shorter >= 0 ? shorter : Math.max(0, types.length - 1);
}

/** Signed meters along the stand heading from the stand point to the centre of the type parked with its nose gear on its stop bar. */
function parkedAlongM(size: StandSize, type: AircraftSpec): number {
  return stopBarOffset(size, stopBarIndex(size, type)) + standGeometry(type).noseGearM - type.dimensions.lengthM / 2;
}

/** The same offset read back from `parkedCentre` of a stand at the origin facing heading 0 (toward -y), so the pose has one definition. */
export function parkedOffsetM(size: StandSize, type: AircraftSpec): number {
  return -parkedCentre({ x: 0, y: 0, headingDeg: 0, size }, type).y;
}

export interface ParkedPose {
  x: number;
  y: number;
  /** Radians, nose along the stand heading. */
  heading: number;
}

/** World centre and heading of a type parked on a stand with its nose gear exactly on the stop bar the painter draws. */
export function parkedCentre(stand: Pick<Stand, 'x' | 'y' | 'headingDeg' | 'size'>, type: AircraftSpec): ParkedPose {
  const a = (stand.headingDeg * PI) / 180;
  const dx = sinLut(a);
  const dy = -cosLut(a);
  const along = parkedAlongM(stand.size, type);
  return { x: stand.x + dx * along, y: stand.y + dy * along, heading: atan2Det(dy, dx) };
}

export interface StandSlot {
  /** Along the heading from the stop point, toward the taxilane when negative. */
  near: number;
  /** Along the heading from the stop point: the nose limit. */
  far: number;
  widthM: number;
}

/** The stand slot of a size, or null when no aircraft type is rated for it. */
export function standSlot(size: StandSize): StandSlot | null {
  const types = standTypes(size);
  if (types.length === 0) return null;
  const spec = STAND_SIZES[size];
  const far = (spec.noseClearanceM ?? spec.wingtipClearanceM) + standGeometry(types[0]).noseGearM;
  return { near: far - spec.depthM, far, widthM: spec.widthM };
}
