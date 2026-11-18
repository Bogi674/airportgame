/** Pure helpers of the stand inspector: gate desk labels and the warnings of a stand (T66). */

export interface DeskRef {
  building: number;
  x: number;
  y: number;
}

export interface DeskOption extends DeskRef {
  /** Index in the payload desk list, which `standGate` refers to. */
  index: number;
  /** Desk number inside its terminal, from 1 in cell order (row by row). */
  number: number;
}

/** Desks ordered by terminal id then cell order (row, then column), numbered from 1 inside each terminal. */
export function deskOptions(desks: readonly DeskRef[]): DeskOption[] {
  const sorted = desks.map((d, index) => ({ ...d, index, number: 0 })).sort((a, b) => a.building - b.building || a.y - b.y || a.x - b.x);
  const seen = new Map<number, number>();
  for (const d of sorted) {
    const n = (seen.get(d.building) ?? 0) + 1;
    seen.set(d.building, n);
    d.number = n;
  }
  return sorted;
}

export type StandWarning = 'noGate' | 'farNoBay' | 'farNoBus';

export interface WarningFacts {
  /** The stand takes commercial flights. */
  commercial: boolean;
  gateDeskCount: number;
  far: boolean;
  busBay: boolean;
  busOwned: boolean;
}

/** Warnings of a stand in display order. A far stand is only far when a gate desk exists. */
export function standWarnings(f: WarningFacts): StandWarning[] {
  const out: StandWarning[] = [];
  if (f.commercial && f.gateDeskCount === 0) out.push('noGate');
  if (f.far && !f.busBay) out.push('farNoBay');
  if (f.far && f.busBay && !f.busOwned) out.push('farNoBus');
  return out;
}
