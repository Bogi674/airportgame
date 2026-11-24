import type { Building, Depot, Runway, ServiceRoad, Stand, Tower } from './airfield';
import type { Pt } from './geom';

/** Translucent preview shapes drawn over the map while a build tool is active. All in meters. */
export type GhostShape =
  | { k: 'strip'; pts: Pt[]; w: number }
  | { k: 'poly'; pts: Pt[] }
  | { k: 'box'; x: number; y: number; headingDeg: number; len: number; w: number }
  | { k: 'ring'; x: number; y: number; r: number }
  /** A faint aircraft outline, red when it clashes (the taxiway tool's wingtip envelope). */
  | { k: 'envelope'; polys: Pt[][]; clash: boolean }
  /** Obstacle surfaces of a runway: approach trapezoids, transitional edges and penetrations. */
  | { k: 'surfaces'; approachA: Pt[]; approachB: Pt[]; transitional: Pt[][]; hits: Pt[] }
  /** A red band over a stretch that breaks a clearance. */
  | { k: 'clash'; pts: Pt[]; w: number }
  /** A snap marker drawn at a fixed size on screen: a node dot, the active target, or a grid node (docs/DESIGN_REVISION_2.md 2.2, T70). */
  | { k: 'marker'; x: number; y: number; shape: MarkerShape; label?: string }
  /**
   * A terminal fixture drawn with its kit sprite (T85): fixture id, level and footprint code as on the grid, the world
   * center of its footprint and the heading of the building's x axis.
   */
  | { k: 'fixture'; f: number; level: number; code: number; x: number; y: number; headingDeg: number }
  /** A prop drawn with its kit sprite (T85): asset, quarter turns, world center and the building heading. */
  | { k: 'prop'; asset: string; rot: number; x: number; y: number; headingDeg: number }
  /** A hatched area an item needs clear, its use area (T85). blocked draws it red. */
  | { k: 'hatch'; pts: Pt[]; blocked: boolean }
  /** A cell a transition fixture paints with a zone when placed (T87), tinted in that zone's overlay color. */
  | { k: 'zoneCell'; pts: Pt[]; zone: number }
  /**
   * A label pinned at a fixed size on screen, outlined in a zone's color (T87): the intake or exit side of a transition
   * fixture. The arrow points along the flow, given as a world direction. A label that would overlap one drawn earlier
   * is left out.
   */
  | { k: 'zoneTag'; x: number; y: number; text: string; zone: number; dx: number; dy: number };

/** Screen shapes of snap markers: node dots, and the ring, square, diamond or plus of the active target. */
export type MarkerShape = 'dot' | 'ring' | 'square' | 'diamond' | 'plus';

/** Objects drawn the way they will look once built, so the preview matches the result. */
export interface GhostPreview {
  runway?: Runway;
  /** New stands, drawn with their forks and markings on the existing taxiways. */
  stands?: Stand[];
  /** New ATC towers, drawn with the same painting as built ones. */
  towers?: Tower[];
  /** A service road being drawn and a depot being placed (T60). */
  roads?: ServiceRoad[];
  depots?: Depot[];
  buildings?: Building[];
}

export interface Ghost {
  valid: boolean;
  shapes: GhostShape[];
  preview?: GhostPreview;
  /** Optional text pinned near a point, for readouts such as length and heading. */
  label?: { x: number; y: number; text: string };
  /** Small readouts pinned to points, such as edge lengths. */
  tags?: { x: number; y: number; text: string }[];
  /** Snap tooltip next to the cursor, such as "Snap to J1". */
  tip?: { x: number; y: number; text: string };
  /** Snap tone: the new arm in snapping cyan instead of the default preview blue. Remove: amber, a legal cut. */
  tone?: 'snap' | 'remove';
}
