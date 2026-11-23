import { AIRCRAFT } from '@data/aircraft';
import { STAFF } from '@data/index';
import { STAFF_ROLE_KEYS } from '@data/schemas/staff';
import { HEADING_STEPS, PEOPLE_MODE, SnapHeader, SNAPSHOT_PEOPLE_CAPACITY, STAFF_ID_BASE, STAFF_PROFILE_BASE, type SnapshotViews } from '@shared/snapshot';
import { cosLut, sinLut, TWO_PI } from '@shared/trig';
import { mix32 } from '../cohorts/traits';
import { MAX_AIRCRAFT, type Traffic } from '../ops/traffic';
import type { Turnarounds } from '../ops/turnaround';

const RAMP_PROFILE = STAFF_PROFILE_BASE + STAFF_ROLE_KEYS.indexOf('ramp');
/** People ids of apron crew figures start past every staff slot id. */
const CREW_ID_BASE = STAFF_ID_BASE + STAFF.capacity;
/** Metres ahead of the nose tip and to each side of the centre line where the two crew figures of a turnaround stand. */
const AHEAD_M = 1.5;
const SIDE_M = 3.5;

/**
 * Adds the apron crew of every turnaround that holds one to the people sample (T81): the crew stands ahead of the
 * nose, one figure on each side of the centre line, clear of the pushback tug, facing the aircraft. Reads only.
 */
export function writeCrewSample(views: SnapshotViews, turns: Turnarounds, traffic: Traffic): void {
  let n = views.header[SnapHeader.PeopleCount]!;
  for (let i = 0; i < MAX_AIRCRAFT && n < SNAPSHOT_PEOPLE_CAPACITY; i++) {
    if (turns.crew[i] === 0 || traffic.active[i] === 0) continue;
    const spec = AIRCRAFT[traffic.type[i]!];
    if (!spec) continue;
    const h = traffic.heading[i]!;
    const fx = cosLut(h);
    const fy = sinLut(h);
    const ahead = spec.dimensions.lengthM / 2 + AHEAD_M;
    // Facing back toward the aircraft, in the heading byte of the people sample (0 is up, clockwise).
    const face = Math.round(((h + Math.PI + Math.PI / 2) * HEADING_STEPS) / TWO_PI) & (HEADING_STEPS - 1);
    for (let k = 0; k < STAFF.ramp.crewSize && n < SNAPSHOT_PEOPLE_CAPACITY; k++) {
      const side = (k - (STAFF.ramp.crewSize - 1) / 2) * 2 * SIDE_M / Math.max(1, STAFF.ramp.crewSize - 1);
      views.peopleX[n] = traffic.x[i]! + fx * ahead - fy * side;
      views.peopleY[n] = traffic.y[i]! + fy * ahead + fx * side;
      views.peopleProfile[n] = RAMP_PROFILE;
      views.peopleSize[n] = 1;
      views.peopleSeed[n] = mix32(Math.imul(turns.flightOf[i]! * 8 + k + 1, 0x85ebca6b) >>> 0);
      views.peopleHeading[n] = face;
      views.peopleId[n] = CREW_ID_BASE + i * 8 + k;
      views.peopleMode[n] = PEOPLE_MODE.Dwelling;
      n++;
    }
  }
  views.header[SnapHeader.PeopleCount] = n;
}
