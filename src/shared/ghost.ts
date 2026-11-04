import type { Runway, Stand } from './airfield';
import type { Pt } from './geom';

/** Translucent preview shapes drawn over the map while a build tool is active. All in meters. */
export type GhostShape =
  | { k: 'strip'; pts: Pt[]; w: number }
  | { k: 'poly'; pts: Pt[] }
  | { k: 'box'; x: number; y: number; headingDeg: number; len: number; w: number }
  | { k: 'ring'; x: number; y: number; r: number }
  /** A snap marker drawn at a fixed size on screen: a node dot, or the active target (docs/DESIGN_REVISION_2.md 2.2). */
  | { k: 'marker'; x: number; y: number; shape: 'dot' | 'ring' | 'square' | 'diamond'; label?: string };

/** Objects drawn the way they will look once built, so the preview matches the result. */
export interface GhostPreview {
  runway?: Runway;
  stands?: Stand[];
  /** Lead-in lines and lead-on curves of the new stands. */
  leadIns?: Pt[][];
}

export interface Ghost {
  valid: boolean;
  shapes: GhostShape[];
  preview?: GhostPreview;
  /** Optional text pinned near a point, for readouts such as length and heading. */
  label?: { x: number; y: number; text: string };
  /** Snap tooltip next to the cursor, such as "Snap to J1". */
  tip?: { x: number; y: number; text: string };
  /** Snap tone: the new arm in snapping cyan instead of the default preview blue. */
  tone?: 'snap';
}
