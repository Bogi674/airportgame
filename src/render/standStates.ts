import { ACCEPT_COMMERCIAL, type AirfieldPayload } from '@shared/airfield';
import { standsReached } from '@shared/roadGraph';
import { endpoint } from '@shared/validate';
import { standForks } from '@shared/standFork';
import { standSlot } from '@shared/standGeom';

/**
 * Connection state badges of stands on the map (docs/DESIGN_REVISION_4.md section 2.3). Only the states
 * the game can compute today: no taxiway lead in, and a parked box that breaks a taxiway clearance
 * (user, 2026-11-17), and a stand taking commercial flights that no depot reaches by road (T60).
 * Further states join when their systems exist.
 */

export type StandStateKind = 'noTaxiway' | 'clearance' | 'noRoad';

export interface StandState {
  id: number;
  kind: StandStateKind;
  /** World point of the badge: the middle of the stand box. */
  x: number;
  y: number;
}

/** The flagged stands of an airfield, in stand order. A stand with no lead in wins over a clearance breach. */
export function standStates(af: AirfieldPayload): StandState[] {
  const forks = standForks(af.stands, af.taxiways.map((t) => ({ pts: t.points })));
  const breaches = new Set(af.clearanceBreaches ?? []);
  const reached = standsReached(af);
  const out: StandState[] = [];
  af.stands.forEach((s, i) => {
    const kind: StandStateKind | null = !forks[i] ? 'noTaxiway' : breaches.has(s.id) ? 'clearance' : (s.accepts & ACCEPT_COMMERCIAL) !== 0 && !reached[i] ? 'noRoad' : null;
    const slot = standSlot(s.size);
    if (!kind || !slot) return;
    const p = endpoint(s.x, s.y, s.headingDeg, (slot.near + slot.far) / 2);
    out.push({ id: s.id, kind, x: p.x, y: p.y });
  });
  return out;
}
