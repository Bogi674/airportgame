import { FIXTURE_SPAN, fixtureKey } from '@shared/business';
import { ROT_STEP, type TerminalEdit } from '@shared/terminalOps';

/** Direction from anchor to tail of a two cell fixture: 0 +column, 1 +row, 2 -column, 3 -row. */
export type FixtureRot = 0 | 1 | 2 | 3;

export function nextFixtureRot(r: FixtureRot): FixtureRot {
  return ((r + 1) % 4) as FixtureRot;
}

/** True when the fixture takes two cells, so it has a rotation. */
export function isTwoCell(fixtureId: number): boolean {
  return FIXTURE_SPAN[fixtureKey(fixtureId)] === 2;
}

/** Terminal fixture edit over a cell rectangle. The rotation only matters for two cell fixtures. */
export function fixtureEdit(x0: number, y0: number, x1: number, y1: number, fixtureId: number, rot: FixtureRot): TerminalEdit {
  return { op: 'fixture', x0, y0, x1, y1, variant: fixtureId, rot };
}

/** Cells an edit covers on screen: a two cell fixture also covers the tail of each anchor. */
export function footprintRect(e: TerminalEdit): { x0: number; y0: number; x1: number; y1: number } {
  if (e.op !== 'fixture' || !isTwoCell(e.variant)) return { x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 };
  const [dx, dy] = ROT_STEP[e.rot ?? 0];
  return { x0: e.x0 + Math.min(0, dx), y0: e.y0 + Math.min(0, dy), x1: e.x1 + Math.max(0, dx), y1: e.y1 + Math.max(0, dy) };
}
