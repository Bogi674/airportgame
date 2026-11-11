/**
 * Snapshot buffer layout. This file is the only place that knows the offsets
 * (docs/ARCHITECTURE.md section 1). Bump SNAPSHOT_VERSION on every layout change.
 */

export const SNAPSHOT_VERSION = 5;
export const SNAPSHOT_VEHICLE_CAPACITY = 1024;
export const SNAPSHOT_AIRCRAFT_CAPACITY = 256;
export const SNAPSHOT_PEOPLE_CAPACITY = 3000;

/** Header slots, Int32. */
export const enum SnapHeader {
  Version = 0,
  Tick = 1,
  AircraftCount = 2,
  VehicleCount = 3,
  PeopleCount = 4,
  Size = 8,
}

export interface SnapshotViews {
  header: Int32Array;
  aircraftId: Int32Array;
  aircraftX: Float32Array;
  aircraftY: Float32Array;
  aircraftHeading: Float32Array;
  aircraftType: Uint8Array;
  aircraftState: Uint8Array;
  aircraftLivery: Uint8Array;
  /** Bit 0 waiting on a reservation, bit 1 in or just out of a deadlock. */
  aircraftFlags: Uint8Array;
  vehicleId: Int32Array;
  vehicleX: Float32Array;
  vehicleY: Float32Array;
  vehicleHeading: Float32Array;
  vehicleKind: Uint8Array;
  peopleX: Float32Array;
  peopleY: Float32Array;
  peopleProfile: Uint8Array;
  peopleSize: Uint8Array;
  /** Cohort recipe seed, picks the person's look so the same cohort always draws the same way. */
  peopleSeed: Uint32Array;
  /** 1 while the cohort walks to a node, 0 while it waits in a queue or is served. */
  peopleState: Uint8Array;
}

const align4 = (n: number): number => (n + 3) & ~3;

const HEADER_BYTES = SnapHeader.Size * 4;
const CAP = SNAPSHOT_AIRCRAFT_CAPACITY;

const OFF_ID = HEADER_BYTES;
const OFF_X = OFF_ID + CAP * 4;
const OFF_Y = OFF_X + CAP * 4;
const OFF_HEADING = OFF_Y + CAP * 4;
const OFF_TYPE = OFF_HEADING + CAP * 4;
const OFF_STATE = OFF_TYPE + align4(CAP);
const OFF_LIVERY = OFF_STATE + align4(CAP);

const OFF_FLAGS = OFF_LIVERY + align4(CAP);
const VCAP = SNAPSHOT_VEHICLE_CAPACITY;
const OFF_VID = OFF_FLAGS + align4(CAP);
const OFF_VX = OFF_VID + VCAP * 4;
const OFF_VY = OFF_VX + VCAP * 4;
const OFF_VH = OFF_VY + VCAP * 4;
const OFF_VKIND = OFF_VH + VCAP * 4;

const PCAP = SNAPSHOT_PEOPLE_CAPACITY;
const OFF_PX = OFF_VKIND + align4(VCAP);
const OFF_PY = OFF_PX + PCAP * 4;
const OFF_PPROFILE = OFF_PY + PCAP * 4;
const OFF_PSIZE = OFF_PPROFILE + align4(PCAP);

const OFF_PSEED = OFF_PSIZE + align4(PCAP);
const OFF_PSTATE = OFF_PSEED + PCAP * 4;

export const SNAPSHOT_BYTES = OFF_PSTATE + align4(PCAP);

export function createSnapshotBuffer(): ArrayBuffer {
  return new ArrayBuffer(SNAPSHOT_BYTES);
}

/** Creates typed array views over a snapshot buffer. Call once per buffer, not per frame. */
export function createSnapshotViews(buffer: ArrayBuffer): SnapshotViews {
  return {
    header: new Int32Array(buffer, 0, SnapHeader.Size),
    aircraftId: new Int32Array(buffer, OFF_ID, CAP),
    aircraftX: new Float32Array(buffer, OFF_X, CAP),
    aircraftY: new Float32Array(buffer, OFF_Y, CAP),
    aircraftHeading: new Float32Array(buffer, OFF_HEADING, CAP),
    aircraftType: new Uint8Array(buffer, OFF_TYPE, CAP),
    aircraftState: new Uint8Array(buffer, OFF_STATE, CAP),
    aircraftLivery: new Uint8Array(buffer, OFF_LIVERY, CAP),
    aircraftFlags: new Uint8Array(buffer, OFF_FLAGS, CAP),
    vehicleId: new Int32Array(buffer, OFF_VID, VCAP),
    vehicleX: new Float32Array(buffer, OFF_VX, VCAP),
    vehicleY: new Float32Array(buffer, OFF_VY, VCAP),
    vehicleHeading: new Float32Array(buffer, OFF_VH, VCAP),
    vehicleKind: new Uint8Array(buffer, OFF_VKIND, VCAP),
    peopleX: new Float32Array(buffer, OFF_PX, PCAP),
    peopleY: new Float32Array(buffer, OFF_PY, PCAP),
    peopleProfile: new Uint8Array(buffer, OFF_PPROFILE, PCAP),
    peopleSize: new Uint8Array(buffer, OFF_PSIZE, PCAP),
    peopleSeed: new Uint32Array(buffer, OFF_PSEED, PCAP),
    peopleState: new Uint8Array(buffer, OFF_PSTATE, PCAP),
  };
}
