import { AIRCRAFT } from '@data/aircraft';
import { STAFF } from '@data/index';
import { STAFF_ROLE_KEYS } from '@data/schemas/staff';
import { HEADING_STEPS, PEOPLE_MODE, SnapHeader, SNAPSHOT_PEOPLE_CAPACITY, STAFF_ID_BASE, STAFF_PROFILE_BASE, type SnapshotViews } from '@shared/snapshot';
import { atan2Det, cosLut, sinLut, TWO_PI } from '@shared/trig';
import { mix32 } from '../cohorts/traits';
import { MAX_AIRCRAFT, type Traffic } from '../ops/traffic';
import type { Turnarounds } from '../ops/turnaround';

const RAMP_PROFILE = STAFF_PROFILE_BASE + STAFF_ROLE_KEYS.indexOf('ramp');
/** People ids of apron crew figures start past every staff slot id. */
const CREW_ID_BASE = STAFF_ID_BASE + STAFF.capacity;
/** Metres behind the nose tip, and out from the side of the fuselage, where the crew figures of a turnaround stand: beside the nose, clear of the pushback tug ahead and of the stop bar labels on the centre line. */
const BEHIND_NOSE_M = 2;
const SIDE_GAP_M = 3.5;
/** Least metres from the centre line, past the stop bar labels of every type. */
const MIN_SIDE_M = 6;
/** Metres between two crew figures on the same side. */
const CREW_STEP_M = 1.5;

/**
 * Adds the apron crew of every turnaround that holds one to the people sample (T81): the crew stands beside the nose,
 * one figure on each side of the fuselage, facing the aircraft. Reads only.
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
    const ahead = spec.dimensions.lengthM / 2 - BEHIND_NOSE_M;
    const out = Math.max(MIN_SIDE_M, spec.dimensions.fuselageWidthM / 2 + SIDE_GAP_M);
    for (let k = 0; k < STAFF.ramp.crewSize && n < SNAPSHOT_PEOPLE_CAPACITY; k++) {
      // Sides alternate; a third and later figure stands a step further back on its side.
      const side = k % 2 === 0 ? -out : out;
      const along = ahead - (k >> 1) * CREW_STEP_M;
      views.peopleX[n] = traffic.x[i]! + fx * along - fy * side;
      views.peopleY[n] = traffic.y[i]! + fy * along + fx * side;
      // Facing the fuselage, in the heading byte of the people sample, whose 0 faces up (world angle minus a quarter turn).
      const face = Math.round(((atan2Det(-fx * side, fy * side) + Math.PI / 2) * HEADING_STEPS) / TWO_PI) & (HEADING_STEPS - 1);
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
