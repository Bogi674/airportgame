import { AIRFIELD } from '@data/index';
import { CODES, type CodeLetter, type Surface } from '@shared/airfield';
import type { Command } from '@sim/commands';
import { useGameStore } from './stores/gameStore';
import { useToolStore } from './stores/toolStore';
import { t, tDynamic, tFormat } from './strings';

interface Props {
  send(cmd: Command): void;
}

/** Inspector for the selected airfield object, with segment properties, resurfacing and demolition. */
export function ObjectPanel({ send }: Props) {
  const selection = useToolStore((s) => s.selection);
  const af = useGameStore((s) => s.airfield);
  if (!selection) return null;
  const { kind, id } = selection;
  let body;
  let name;
  if (kind === 'runway') {
    const r = af.runways.find((x) => x.id === id);
    if (!r) return null;
    name = `${r.nameA}/${r.nameB}`;
    const entries = af.entries.filter((e) => e.runwayId === r.id);
    body = (
      <>
        <div>{tFormat('inspector.size', { len: r.lengthM, w: r.widthM })}</div>
        <div>
          {r.code}, {tDynamic(`approach.${r.approach}`)}, {String(r.headingDeg).padStart(3, '0')}°
        </div>
        <div>{tFormat('inspector.pcr', { n: r.pcr, surface: tDynamic(`surface.${r.surface}`) })}</div>
        <div>{tFormat('inspector.condition', { n: Math.round(r.condition) })}</div>
        <div>{tFormat('inspector.holding', { n: af.holding.filter((h) => h.runwayId === r.id).length })}</div>
        {entries.map((e, i) => {
          const tw = af.taxiways.find((x) => x.id === e.taxiwayId);
          return (
            <div key={i} style="font-size:11px">
              {tw?.name ?? ''}: {e.todaTowardB} m / {e.todaTowardA} m
            </div>
          );
        })}
      </>
    );
  } else if (kind === 'taxiway') {
    const x = af.taxiways.find((o) => o.id === id);
    if (!x) return null;
    name = x.name;
    body = (
      <>
        <div>
          {tDynamic(`tool.${x.kind}`)}, {x.code}, {x.widthM} m
        </div>
        <div>{tFormat('inspector.maxCode', { n: x.maxCode })}</div>
        <div>{tFormat('inspector.pcr', { n: x.pcr, surface: tDynamic(`surface.${x.surface}`) })}</div>
        <div>{tFormat('inspector.condition', { n: Math.round(x.condition) })}</div>
        <label style="display:block">
          <input data-testid="prop-oneway" type="checkbox" checked={x.oneWay} onChange={(e) => send({ type: 'setTaxiwayProps', id, oneWay: (e.target as HTMLInputElement).checked })} /> {t('inspector.oneWay')}
        </label>
        <label style="display:block">
          <input data-testid="prop-closed" type="checkbox" checked={x.closed} onChange={(e) => send({ type: 'setTaxiwayProps', id, closed: (e.target as HTMLInputElement).checked })} /> {t('inspector.closed')}
        </label>
        <label style="display:flex;gap:6px;align-items:center">
          {t('opt.code')}
          <select value={x.userMaxCode} onChange={(e) => send({ type: 'setTaxiwayProps', id, userMaxCode: (e.target as HTMLSelectElement).value as CodeLetter })}>
            {CODES.filter((c) => CODES.indexOf(c) <= CODES.indexOf(x.code)).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label style="display:flex;gap:6px;align-items:center">
          {tFormat('inspector.speed', { n: x.speedKmh })}
          <input type="range" min="5" max="80" step="5" value={x.speedKmh} onChange={(e) => send({ type: 'setTaxiwayProps', id, speedKmh: Number((e.target as HTMLInputElement).value) })} />
        </label>
      </>
    );
  } else if (kind === 'apron') {
    const x = af.aprons.find((o) => o.id === id);
    if (!x) return null;
    name = String(x.id);
    body = (
      <>
        <div>{tFormat('inspector.pcr', { n: x.pcr, surface: tDynamic(`surface.${x.surface}`) })}</div>
        <div>{tFormat('inspector.condition', { n: Math.round(x.condition) })}</div>
      </>
    );
  } else {
    const x = af.stands.find((o) => o.id === id);
    if (!x) return null;
    name = x.number;
    body = (
      <>
        <div>
          {tFormat('inspector.standInfo', { type: tDynamic(`standType.${x.type}`), code: x.code, surface: tDynamic(`surface.${x.surface}`), pb: x.pushback })}
        </div>
        {x.type === 'contact' && <div style="color:#ffcf8f">{t('inspector.contactWarn')}</div>}
      </>
    );
  }
  const canResurface = kind !== 'stand';
  const surfaceOf = (): { surface: Surface; pcr: number } | null => {
    if (kind === 'runway') return af.runways.find((x) => x.id === id) ?? null;
    if (kind === 'taxiway') return af.taxiways.find((x) => x.id === id) ?? null;
    if (kind === 'apron') return af.aprons.find((x) => x.id === id) ?? null;
    return null;
  };
  const cur = surfaceOf();
  const tiers = cur ? AIRFIELD.surfaces[cur.surface].pcrTiers : [];
  const tierIdx = cur ? Math.max(0, tiers.indexOf(cur.pcr)) : 0;
  return (
    <div
      data-testid="object-panel"
      style="position:absolute;left:62px;top:236px;width:230px;padding:8px 10px;background:#10161cf2;border:1px solid #2c3a45;border-radius:6px;line-height:1.5"
    >
      <div style="font-weight:600">{tFormat('inspector.title', { kind: tDynamic(`inspector.${kind}`), name })}</div>
      {body}
      <div style="display:flex;gap:6px;margin-top:6px">
        {canResurface && cur && (
          <button
            data-testid="resurface"
            onClick={() => send({ type: 'resurface', kind: kind as 'runway' | 'taxiway' | 'apron', id, surface: cur.surface, tier: Math.min(tierIdx + (cur.pcr === tiers[tiers.length - 1] ? 0 : 1), tiers.length - 1) })}
          >
            {t('inspector.resurface')}
          </button>
        )}
        <button
          data-testid="demolish"
          onClick={() => {
            send({ type: 'demolish', kind, id });
            useToolStore.getState().set({ selection: null });
          }}
        >
          {t('inspector.demolish')}
        </button>
      </div>
    </div>
  );
}
