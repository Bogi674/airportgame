import type { GuideLine } from '@shared/airfieldGeom';
import type { Pt } from '@shared/geom';
import type { GhostShape, MarkerShape } from '@shared/ghost';
import { tDynamic, tFormat } from '../strings';

/**
 * What a drawing tool snapped to (task T70). The taxiway kinds come from `findSnap`, the others from
 * the shared vertex, runway edge, centerline, guide, angle and grid snaps, the apron rectangle edges
 * and the stand lead in.
 */
export type SnapMarkKind = 'node' | 'end' | 'segment' | 'vertex' | 'runwayEdge' | 'centerline' | 'guide' | 'angle' | 'grid' | 'apronEdge' | 'leadIn';

export interface SnapMark {
  kind: SnapMarkKind;
  p: Pt;
  /** A node label such as J1, a heading for an angle step, or a taxiway name for a lead in. */
  label?: string;
}

const SHAPE: Record<SnapMarkKind, MarkerShape> = {
  node: 'ring',
  end: 'square',
  segment: 'diamond',
  vertex: 'square',
  runwayEdge: 'diamond',
  centerline: 'diamond',
  guide: 'ring',
  angle: 'ring',
  grid: 'plus',
  apronEdge: 'diamond',
  leadIn: 'diamond',
};

/** The marker drawn at a snap target. Only a node shows its label inside the marker. */
export function markShape(m: SnapMark): GhostShape {
  return { k: 'marker', x: m.p.x, y: m.p.y, shape: SHAPE[m.kind], label: m.kind === 'node' && m.label ? m.label : undefined };
}

/** The tooltip of a snap target, or null for a grid node, which snaps on every move and stays quiet. */
export function markTip(m: SnapMark): string | null {
  switch (m.kind) {
    case 'node':
      return tFormat('ghost.snapNode', { label: m.label ?? '' });
    case 'end':
      return tFormat('ghost.snapEnd', {});
    case 'segment':
      return tFormat('ghost.snapSegment', {});
    case 'vertex':
      return tFormat('ghost.snapVertex', {});
    case 'runwayEdge':
      return tFormat('ghost.snapRunwayEdge', {});
    case 'centerline':
      return tFormat('ghost.snapCenterline', {});
    case 'guide':
      return m.label ?? tFormat('ghost.snapGuide', {});
    case 'angle':
      return tFormat('ghost.snapAngle', { hdg: m.label ?? '' });
    case 'apronEdge':
      return tFormat('ghost.snapApronEdge', {});
    case 'leadIn':
      return m.label ? tFormat('ghost.snapLeadInNamed', { name: m.label }) : tFormat('ghost.snapLeadIn', {});
    case 'grid':
      return null;
  }
}

/** What an alignment guide follows, for its tooltip: one guide, or both where two cross (T84). */
export function guideTip(lines: readonly GuideLine[]): string {
  const one = (l: GuideLine): string => tDynamic(`ghost.guide.${l.kind}${l.square ? 'Square' : ''}`);
  if (lines.length < 2) return one(lines[0]);
  return tFormat('ghost.guide.both', { a: one(lines[0]), b: one(lines[1]) });
}
