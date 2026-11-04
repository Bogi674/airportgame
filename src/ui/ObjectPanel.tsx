import { AIRFIELD } from '@data/index';
import { FIXTURE_KEYS } from '@shared/business';
import { APPROACHES, CODES, type Approach, type CodeLetter, type Runway, type Surface } from '@shared/airfield';
import type { Command } from '@sim/commands';
import { useState } from 'preact/hooks';
import { useGameStore } from './stores/gameStore';
import { useToolStore } from './stores/toolStore';
import { t, tDynamic, tFormat } from './strings';

interface Props {
  send(cmd: Command): void;
}

/** Class, approach and strength of a runway. Changes are applied together and priced by the sim. */
function RunwayUpgrade({ r, send }: { r: Runway; send(cmd: Command): void }) {
  const [code, setCode] = useState<CodeLetter>(r.code);
  const [approach, setApproach] = useState<Approach>(r.approach);
  const tiers = AIRFIELD.surfaces[r.surface].pcrTiers;
  const [tier, setTier] = useState(Math.max(0, tiers.indexOf(r.pcr)));
  const paved = r.surface === 'asphalt' || r.surface === 'concrete';
  const apply = (): void => {
    if (code !== r.code || approach !== r.approach) send({ type: 'reclassRunway', id: r.id, code, approach });
    if (tiers[tier] !== r.pcr) send({ type: 'resurface', kind: 'runway', id: r.id, surface: r.surface, tier });
  };
  return (
    <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--line-soft);display:grid;gap:4px" data-testid="runway-upgrade">
      <label style="display:flex;justify-content:space-between;gap:6px">
        {t('inspector.runwayClass')}
        <select data-testid="rw-class" value={code} onChange={(e) => setCode((e.target as HTMLSelectElement).value as CodeLetter)}>
          {CODES.map((c) => (
            <option key={c} value={c}>
              {c}, {AIRFIELD.codes[c].runwayWidthM} m
            </option>
          ))}
        </select>
      </label>
      <label style="display:flex;justify-content:space-between;gap:6px">
        {t('inspector.runwayApproach')}
        <select data-testid="rw-approach" value={approach} onChange={(e) => setApproach((e.target as HTMLSelectElement).value as Approach)}>
          {APPROACHES.filter((a) => a === 'visual' || paved).map((a) => (
            <option key={a} value={a}>
              {tDynamic(`approach.${a}`)}
            </option>
          ))}
        </select>
      </label>
      {tiers.length > 1 && (
        <label style="display:flex;justify-content:space-between;gap:6px">
          {t('inspector.runwayStrength')}
          <select data-testid="rw-tier" value={tier} onChange={(e) => setTier(Number((e.target as HTMLSelectElement).value))}>
            {tiers.map((pcr, i) => (
              <option key={i} value={i}>
                PCR {pcr}
              </option>
            ))}
          </select>
        </label>
      )}
      <div style="color:var(--muted);font-size:11px">{t('inspector.runwayUpgradeHint')}</div>
      <button data-testid="rw-apply" onClick={apply}>
        {t('inspector.apply')}
      </button>
    </div>
  );
}

/** Inspector for the selected airfield object, with segment properties, resurfacing and demolition. */
export function ObjectPanel({ send }: Props) {
  const selection = useToolStore((s) => s.selection);
  const af = useGameStore((s) => s.airfield);
  const biz = useGameStore((st) => st.business);
  if (!selection) return null;
  const { kind, id } = selection;
  if (kind === 'terminal') {
    const term = biz?.terminals.find((x) => x.id === id);
    if (!biz || !term) return null;
    const rows: { id: number; key: (typeof FIXTURE_KEYS)[number] }[] = FIXTURE_KEYS.map((k, i) => ({ id: i + 1, key: k }));
    return (
      <div data-testid="terminal-panel" style="position:absolute;right:12px;top:52px;width:280px;padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:10px;line-height:1.5">
        <div style="font-weight:600">{t('inspector.terminal')} {term.id}</div>
        <div>{tFormat('terminal.summary', { cells: term.cells, area: term.cells * 4 })}</div>
        <div>{tFormat('terminal.capacity', { dep: biz.depCapacity, arr: biz.arrCapacity })}</div>
        <div>{tFormat('terminal.leased', { n: term.leased })}</div>
        {rows
          .filter((r) => term.counts[r.key] > 0)
          .map((r) => (
            <div key={r.key} style="display:flex;justify-content:space-between">
              <span>{tDynamic(`fixture.${r.id}`)}</span>
              <span data-testid={`count-${r.key}`}>{term.counts[r.key]}</span>
            </div>
          ))}
        <div style="margin-top:4px;color:var(--muted);font-size:12px">{t('inspector.terminalHint')}</div>
        <button
          data-testid="demolish"
          style="margin-top:8px"
          onClick={() => {
            send({ type: 'demolishTerminal', id });
            useToolStore.getState().set({ selection: null });
          }}
        >
          {t('inspector.demolish')}
        </button>
      </div>
    );
  }
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
        <RunwayUpgrade key={`${r.id}-${r.code}-${r.approach}-${r.pcr}`} r={r} send={send} />
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
        <label style="display:flex;gap:6px;align-items:center">
          {t('inspector.preferred')}
          <select data-testid="prop-preferred" value={x.preferred ?? 0} onChange={(e) => send({ type: 'setTaxiwayProps', id, preferred: Number((e.target as HTMLSelectElement).value) })}>
            <option value={0}>{t('inspector.preferred.none')}</option>
            <option value={1}>{t('inspector.preferred.forward')}</option>
            <option value={-1}>{t('inspector.preferred.reverse')}</option>
          </select>
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
        {x.type === 'contact' && <div style="color:var(--warn)">{t('inspector.contactWarn')}</div>}
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
      style="position:absolute;right:12px;top:52px;width:260px;padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:10px;line-height:1.5"
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
            send({ type: 'demolish', kind: kind as 'runway' | 'taxiway' | 'apron' | 'stand', id });
            useToolStore.getState().set({ selection: null });
          }}
        >
          {t('inspector.demolish')}
        </button>
      </div>
    </div>
  );
}
