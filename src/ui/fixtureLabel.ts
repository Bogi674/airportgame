import type { TerminalGrid } from '@shared/business';
import { fixtureLabel, fixtureNameKey } from '@shared/fixtureNames';
import { fixtureAnchor } from '@shared/terminalOps';
import { tDynamic } from './strings';

/** The name of the fixture on a grid cell (T94): its custom name, else its kind and number. Null without a fixture. */
export function fixtureLabelAt(g: TerminalGrid, cell: number, names: Readonly<Record<string, string>> | undefined): string | null {
  const anchor = cell >= 0 ? fixtureAnchor(g, cell) : -1;
  if (anchor < 0) return null;
  const id = g.fixture[anchor]!;
  const no = g.fixtureNo[anchor]!;
  return fixtureLabel(tDynamic(`fixture.${id}`), no, names?.[fixtureNameKey(id, no)]);
}
