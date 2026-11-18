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

/** Baggage helpers of the inspectors (T43). They take the derived payload facts and never read the sim. */
export interface BagBayLike {
  id: number;
  building: number;
  slots: number;
  stands: readonly number[];
  carousel: number | null;
}

export interface BagNodeLike {
  id: number;
  kind: 'drop' | 'machine' | 'bay' | 'carousel';
  building: number;
  cells: readonly (readonly [number, number])[];
}

export interface BayOption {
  id: number;
  building: number;
  /** Bay number inside its terminal, from 1 in id order. */
  number: number;
  used: number;
  total: number;
}

/** Every bay in terminal then id order, numbered per terminal, with the stands assigned out of the slot count. */
export function bayOptions(bays: readonly BagBayLike[]): BayOption[] {
  const sorted = bays.slice().sort((a, b) => a.building - b.building || a.id - b.id);
  const seen = new Map<number, number>();
  return sorted.map((b) => {
    const n = (seen.get(b.building) ?? 0) + 1;
    seen.set(b.building, n);
    return { id: b.id, building: b.building, number: n, used: b.stands.length, total: b.slots };
  });
}

/** Number of a node among the nodes of its kind in its terminal, from 1 in id order. 0 when the node is unknown. */
export function bagNodeNumber(nodes: readonly BagNodeLike[], id: number): number {
  const node = nodes.find((n) => n.id === id);
  if (!node) return 0;
  return nodes.filter((n) => n.kind === node.kind && n.building === node.building && n.id <= id).length;
}

export type StandBagWarning = 'noBay' | 'bayNoCarousel';

export interface StandBagFacts {
  commercial: boolean;
  /** Bay id of the stand, -1 for none. */
  bayId: number;
  bays: readonly BagBayLike[];
}

export interface StandBagState {
  /** GA stands show no baggage section at all. */
  visible: boolean;
  warning: StandBagWarning | null;
  /** Carousel id fed by the stand's bay, null when there is none. */
  carousel: number | null;
}

/** What the stand inspector shows for baggage. A commercial stand without a bay loses every checked bag. */
export function standBagState(f: StandBagFacts): StandBagState {
  if (!f.commercial) return { visible: false, warning: null, carousel: null };
  const bay = f.bayId < 0 ? undefined : f.bays.find((b) => b.id === f.bayId);
  if (!bay) return { visible: true, warning: 'noBay', carousel: null };
  return { visible: true, warning: bay.carousel === null ? 'bayNoCarousel' : null, carousel: bay.carousel };
}

/** The node whose cell is the given logical cell of a terminal, or null. */
export function bagNodeAt(nodes: readonly BagNodeLike[], building: number, x: number, y: number): BagNodeLike | null {
  return nodes.find((n) => n.building === building && n.cells.some((c) => c[0] === x && c[1] === y)) ?? null;
}
