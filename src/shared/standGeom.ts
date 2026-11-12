import { AIRCRAFT, standGeometry, type AircraftSpec } from '@data/aircraft';
import { STAND_MARKINGS, STAND_SIZES } from '@data/index';
import type { StandSize } from './airfield';
import { sizeForSpan } from './standSizes';

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
