import { REFUND_SHARE } from '@shared/apronPricing';
import type { AirfieldPayload } from '@shared/airfield';
import { propTotals } from '@shared/props';
import type { TerminalGrid } from '@shared/business';
import type { DemolishRequest } from './stores/demolishStore';
import { t, tDynamic, tFormat } from './strings';

/** Kinds of airfield object the whole object demolish removes. */
export type AirfieldKind = 'runway' | 'taxiway' | 'apron' | 'stand' | 'road' | 'depot' | 'building' | 'tower';

/** Display name of an airfield object, such as "Runway 09/27" or "Taxiway B". */
export function objectName(af: AirfieldPayload, kind: AirfieldKind, id: number): string | null {
  const title = (k: string, name: string): string => tFormat('inspector.title', { kind: tDynamic(`inspector.${k}`), name }).trim();
  switch (kind) {
    case 'runway': {
      const r = af.runways.find((x) => x.id === id);
      return r ? title('runway', `${r.nameA}/${r.nameB}`) : null;
    }
    case 'taxiway': {
      const x = af.taxiways.find((q) => q.id === id);
      return x ? title('taxiway', x.name) : null;
    }
    case 'apron': {
      const x = af.aprons.find((q) => q.id === id);
      return x ? x.name ?? title('apron', String(x.id)) : null;
    }
    case 'stand': {
      const x = af.stands.find((q) => q.id === id);
      return x ? title('stand', x.number) : null;
    }
    case 'road':
      return af.roads?.some((q) => q.id === id) ? t('inspector.road') : null;
    case 'depot':
      return af.depots?.some((q) => q.id === id) ? t('inspector.depot') : null;
    case 'tower':
      return af.towers?.some((q) => q.id === id) ? t('inspector.tower') : null;
    case 'building': {
      const b = af.buildings?.find((q) => q.id === id);
      return b ? tDynamic(`building.${b.kind}`) : null;
    }
  }
}

/** What the object cost, the base of its refund. */
function objectCost(af: AirfieldPayload, kind: AirfieldKind, id: number): number {
  const list: readonly { id: number; cost: number }[] =
    kind === 'runway' ? af.runways : kind === 'taxiway' ? af.taxiways : kind === 'apron' ? af.aprons : kind === 'stand' ? af.stands : kind === 'road' ? af.roads ?? [] : kind === 'depot' ? af.depots ?? [] : kind === 'tower' ? af.towers ?? [] : af.buildings ?? [];
  return list.find((x) => x.id === id)?.cost ?? 0;
}

/** Refund the sim pays for demolishing a whole airfield object: the refund share of what it cost. */
export const objectRefund = (af: AirfieldPayload, kind: AirfieldKind, id: number): number => Math.round(objectCost(af, kind, id) * REFUND_SHARE);

/** The confirm request that demolishes a whole airfield object, or null when it is gone. */
export function objectDemolish(af: AirfieldPayload, kind: AirfieldKind, id: number, after?: () => void): DemolishRequest | null {
  const what = objectName(af, kind, id);
  if (!what) return null;
  return {
    what,
    refund: objectRefund(af, kind, id),
    commands: [kind === 'tower' ? { type: 'demolishTower', id } : { type: 'demolish', kind, id }],
    after,
  };
}

/** The confirm request that demolishes a whole terminal building: a quarter of its build and furnishing cost comes back. */
export function terminalDemolish(g: TerminalGrid, after?: () => void): DemolishRequest {
  return {
    what: tFormat('inspector.title', { kind: t('inspector.terminal'), name: String(g.id) }),
    lines: [t('demolish.terminalNote')],
    refund: Math.round((g.cost + propTotals(g).cost) * REFUND_SHARE),
    commands: [{ type: 'demolishTerminal', id: g.id }],
    after,
  };
}
