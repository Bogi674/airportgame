import type { Pt } from './geom';

/** Translucent preview shapes drawn over the map while a build tool is active. All in meters. */
export type GhostShape =
  | { k: 'strip'; pts: Pt[]; w: number }
  | { k: 'poly'; pts: Pt[] }
  | { k: 'box'; x: number; y: number; headingDeg: number; len: number; w: number }
  | { k: 'ring'; x: number; y: number; r: number };

export interface Ghost {
  valid: boolean;
  shapes: GhostShape[];
  /** Optional text pinned near a point, for readouts such as length and heading. */
  label?: { x: number; y: number; text: string };
}
