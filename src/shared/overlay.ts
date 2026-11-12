/** Largest value a Uint16 overlay field holds. Also the marker for an unreachable gate. */
export const OVERLAY_MAX = 65535;

/** The terminal overlay the player picked. One at a time, `none` shows no overlay. */
export type OverlayKind = 'none' | 'density' | 'queue' | 'walk';

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
}
