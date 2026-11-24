/** Key of a custom fixture name in the business names map: the fixture id and its number (T94). */
export const fixtureNameKey = (fixtureId: number, no: number): string => `${fixtureId}:${no}`;

/** The name a fixture shows: its custom name, else the kind name and its number (no number when it has none yet). */
export function fixtureLabel(kindName: string, no: number, custom: string | undefined): string {
  if (custom !== undefined && custom !== '') return custom;
  return no > 0 ? `${kindName} ${no}` : kindName;
}
