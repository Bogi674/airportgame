/** Largest value a Uint16 overlay field holds. Also the marker for an unreachable gate. */
export const OVERLAY_MAX = 65535;

/** The terminal overlay the player picked. One at a time, `none` shows no overlay. */
export type OverlayKind = 'none' | 'density' | 'queue' | 'walk' | 'zones' | 'staffing' | 'baggage';

/** Link flag bits of the baggage load overlay. */
export const BAG_LINK_FLOW = 1;
export const BAG_LINK_ARRIVAL = 2;
/** Node flag bit of the baggage load overlay: the buffer is full and blocks the node upstream (back pressure). */
export const BAG_NODE_BLOCKED = 1;

/**
 * The Baggage load overlay of one building (docs/BAGGAGE.md 6.1, T78). Points are logical cell coordinates, cell centers
 * at half cells. Link k runs through points linkStart[k] to linkStart[k + 1] - 1. Load is in percent of the link capacity.
 */
export interface BagOverlay {
  linkPts: Float32Array;
  linkStart: Int32Array;
  linkLoad: Uint16Array;
  linkFlags: Uint8Array;
  /** Node centers, x then y per node. */
  nodePos: Float32Array;
  /** Buffer fill of each node in percent. */
  nodeFill: Uint16Array;
  nodeFlags: Uint8Array;
}

/**
 * Read only view of one terminal building for the debug overlays. Density, queue, wait and gate distance are
 * derived on demand and never saved or hashed. Index i of the node arrays is service node i of the table, and
 * index i of the gate arrays is the i-th gate desk in table order.
 */
export interface OverlayData {
  building: number;
  w: number;
  h: number;
  /** People per 2 m cell, cell index as cellIndex gives it. */
  density: Uint16Array;
  /** Array cell index of each service node anchor, -1 when outside the grid. */
  nodeCell: Int32Array;
  nodeQueue: Uint16Array;
  /** Seconds a new arrival would wait, rounded and clamped. */
  nodeWaitS: Uint16Array;
  /** Array cell index of each gate desk anchor. */
  gateCell: Int32Array;
  /** Walking distance in metres from the curb to each gate desk, OVERLAY_MAX when unreachable. */
  gateDistM: Uint16Array;
  /** Array cell index of each staffed station anchor of the building: service points and screening machines (T68). */
  stationCell: Int32Array;
  /** Officers each station needs. */
  stationNeed: Uint8Array;
  /** Officers on duty at each station. */
  stationPresent: Uint8Array;
  /** The baggage network, missing for a building without one. */
  bag?: BagOverlay;
}
