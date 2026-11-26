import { ACCEPT_COMMERCIAL, type AirfieldPayload } from '@shared/airfield';
import { baysReached, standsReached } from '@shared/roadGraph';
import { standForks } from '@shared/standFork';

/** Which items have the access they need: a stand its taxiway lead in and, for commercial stands, a road from a depot; a bay its road. */
export interface AccessSnapshot {
  taxi: Map<number, boolean>;
  road: Map<number, boolean>;
  bay: Map<number, boolean>;
}

export function accessSnapshot(af: AirfieldPayload): AccessSnapshot {
  const forks = standForks(af.stands, af.taxiways.map((t) => ({ pts: t.points })));
  const roads = standsReached(af);
  const bays = baysReached(af);
  const snap: AccessSnapshot = { taxi: new Map(), road: new Map(), bay: new Map() };
  af.stands.forEach((s, i) => {
    snap.taxi.set(s.id, !!forks[i]);
    if ((s.accepts & ACCEPT_COMMERCIAL) !== 0) snap.road.set(s.id, roads[i] === true);
  });
  (af.bayAnchors ?? []).forEach((b, i) => snap.bay.set(b.bay, bays[i] === true));
  return snap;
}

/** An item that had its access before a demolish and has lost it after. */
export interface LostAccess {
  kind: 'taxiway' | 'road' | 'bay';
  /** Stand number, or the bay id. */
  name: string;
}

/** Items that lost their access between two snapshots. Items removed by the demolish itself are not listed. */
export function lostAccess(before: AccessSnapshot, after: AccessSnapshot, af: AirfieldPayload): LostAccess[] {
  const out: LostAccess[] = [];
  for (const s of af.stands) {
    if (before.taxi.get(s.id) === true && after.taxi.get(s.id) === false) out.push({ kind: 'taxiway', name: s.number });
    else if (before.road.get(s.id) === true && after.road.get(s.id) === false) out.push({ kind: 'road', name: s.number });
  }
  for (const [bay, ok] of after.bay) if (!ok && before.bay.get(bay) === true) out.push({ kind: 'bay', name: String(bay) });
  return out;
}
