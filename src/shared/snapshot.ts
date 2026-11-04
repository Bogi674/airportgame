/**
 * Snapshot buffer layout. This file is the only place that knows the offsets
 * (docs/ARCHITECTURE.md section 1). Bump SNAPSHOT_VERSION on every layout change.
 */

export const SNAPSHOT_VERSION = 2;
export const SNAPSHOT_VEHICLE_CAPACITY = 1024;
export const SNAPSHOT_AIRCRAFT_CAPACITY = 256;

/** Header slots, Int32. */
export const enum SnapHeader {
  Version = 0,
  Tick = 1,
  AircraftCount = 2,
  VehicleCount = 3,
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
  vehicleId: Int32Array;
  vehicleX: Float32Array;
  vehicleY: Float32Array;
  vehicleHeading: Float32Array;
  vehicleKind: Uint8Array;
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

const VCAP = SNAPSHOT_VEHICLE_CAPACITY;
const OFF_VID = OFF_LIVERY + align4(CAP);
const OFF_VX = OFF_VID + VCAP * 4;
const OFF_VY = OFF_VX + VCAP * 4;
const OFF_VH = OFF_VY + VCAP * 4;
const OFF_VKIND = OFF_VH + VCAP * 4;

export const SNAPSHOT_BYTES = OFF_VKIND + align4(VCAP);

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
    vehicleId: new Int32Array(buffer, OFF_VID, VCAP),
    vehicleX: new Float32Array(buffer, OFF_VX, VCAP),
    vehicleY: new Float32Array(buffer, OFF_VY, VCAP),
    vehicleHeading: new Float32Array(buffer, OFF_VH, VCAP),
    vehicleKind: new Uint8Array(buffer, OFF_VKIND, VCAP),
  };
}
