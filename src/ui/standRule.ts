import type { AircraftSpec } from '@data/aircraft';
import type { FlightCategory, Stand } from '@shared/airfield';
import type { BusinessPayload } from '@shared/business';
import { refuseStand, standFacts, type StandRefusal } from '@shared/flightBlock';

/**
 * The shared stand rule for one stand, one aircraft type and one flight category, using the linked and contact facts the
 * business payload carries per stand index. Null when the stand takes the aircraft.
 */
export function standRefusalAt(b: Pick<BusinessPayload, 'standLinked' | 'standContact'>, index: number, st: Stand, spec: AircraftSpec, cat: FlightCategory): StandRefusal | null {
  return refuseStand(standFacts(st, b.standLinked[index] === 1, () => b.standContact[index] === 1), spec, cat);
}
