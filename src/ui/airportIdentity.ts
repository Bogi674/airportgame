import type { AirportIdentity } from '@shared/protocol';

/** Brand colors offered in the new game panel (T35). The player can also pick any color. */
export const BRAND_COLORS = ['#1f6fb2', '#c8102e', '#2a9d8f', '#e76f51', '#6a4c93', '#2d6a4f', '#d4a017', '#0b3c5d'] as const;

const LETTERS = /[A-Z]/g;

/** Three letter IATA style and four letter ICAO style codes from an airport name: word initials, then later letters. */
export function codesFor(name: string): { iata: string; icao: string } {
  const words = name.toUpperCase().split(/\s+/).filter((w) => w.length > 0);
  let code = words.map((w) => w.match(LETTERS)?.[0] ?? '').join('');
  const rest = (words.join('').match(LETTERS) ?? []).join('');
  for (let i = 1; code.length < 3 && i < rest.length; i++) code += rest[i];
  const iata = code.padEnd(3, 'X').slice(0, 3);
  // X leads the ICAO style code: no real region uses it, so a generated code never names a real airport.
  return { iata, icao: `X${iata}` };
}

/** The identity of a game started before T35: named after its seed, with codes from that name and the first brand color. */
export function airportFromSeed(seed: string): AirportIdentity {
  const name = `${seed} Airfield`;
  return { name, ...codesFor(name), color: BRAND_COLORS[0] };
}
