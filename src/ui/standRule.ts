import type { AircraftSpec } from '@data/aircraft';
import type { Stand } from '@shared/airfield';
import type { BusinessPayload } from '@shared/business';
import { refuseStand, standFacts, type StandRefusal } from '@shared/flightBlock';

/**
 * The shared stand rule for one stand and one aircraft type, using the linked and contact facts the
 * business payload carries per stand index. Null when the stand takes the aircraft.
 */
export function standRefusalAt(b: Pick<BusinessPayload, 'standLinked' | 'standContact'>, index: number, st: Stand, spec: AircraftSpec): StandRefusal | null {
  return refuseStand(standFacts(st, b.standLinked[index] === 1, () => b.standContact[index] === 1), spec);
}
