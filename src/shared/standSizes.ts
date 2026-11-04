import { STAND_SIZES } from '@data/index';
import type { AircraftSpec } from '@data/aircraft';
import { STAND_SIZES_ORDER, type CodeLetter, type Stand, type StandSize } from './airfield';

/**
 * Stand size rules (docs/DESIGN_REVISION_2.md section 3): a type belongs to the smallest size whose
 * span covers it, a stand takes any type up to its size, and the stand surface must be on the type's list.
 */

/** Largest code of a size, used for routing and the lead in. */
export const sizeCode = (size: StandSize): CodeLetter => {
  const codes = STAND_SIZES[size].codes;
  return codes[codes.length - 1];
};

/** The smallest size whose span range covers a wingspan, or null when even the largest is too small. */
export function sizeForSpan(spanM: number): StandSize | null {
  for (const s of STAND_SIZES_ORDER) if (spanM <= STAND_SIZES[s].maxSpanM) return s;
  return null;
}

/** Size for an aircraft code letter, for older saves that stored a code. */
export function sizeForCode(code: CodeLetter): StandSize {
  for (const s of STAND_SIZES_ORDER) if (STAND_SIZES[s].codes.includes(code)) return s;
  return 'xl';
}

/** Why a type cannot use a stand, or null when it can. */
export function standRefusal(stand: Pick<Stand, 'size' | 'surface'>, a: AircraftSpec): 'span' | 'surface' | null {
  if (a.dimensions.wingspanM > STAND_SIZES[stand.size].maxSpanM) return 'span';
  if (!a.surfaces.includes(stand.surface)) return 'surface';
  return null;
}
