import { AIRFIELD, SURFACE_SPEC } from '@data/index';
import { FIXTURE_KEYS, TICKS_PER_DAY } from '@shared/business';
import { runwayWorksDays, SURFACE_ORDER, surfaceAllowsCode, surfaceChange } from '@shared/surfaceRules';
import { formatMoney, formatNumber } from './format';
import { apronArea } from '@shared/apronGeom';
import { APPROACHES, CODES, SURFACES, type Approach, type CodeLetter, type PadSide, type PushbackDir, type Runway, type Surface, type Taxiway } from '@shared/airfield';
import { AIRCRAFT } from '@data/aircraft';
import { standRefusal } from '@shared/standSizes';
import { ClassHelp } from './ClassHelp';
import type { Command } from '@sim/commands';
import { useState } from 'preact/hooks';
import { useGameStore } from './stores/gameStore';
import { useToolStore } from './stores/toolStore';
import { t, tDynamic, tFormat } from './strings';

interface Props {
  send(cmd: Command): void;
}

/**
 * Class, surface and strength of a taxiway, plus reversing it and the tools to extend, trim or cut it.
 * The surface bar shows the price and works time before Apply (docs/DESIGN_REVISION_2.md section 2.5).
 */
function TaxiwayUpgrade({ x, send }: { x: Taxiway; send(cmd: Command): void }) {
  const [code, setCode] = useState<CodeLetter>(x.code);
  const [surface, setSurface] = useState<Surface>(x.surface);
  const tick = useGameStore((st) => st.tick);
  const tiers = SURFACE_SPEC[surface].pcrTiers;
  const [tier, setTier] = useState(Math.max(0, SURFACE_SPEC[x.surface].pcrTiers.indexOf(x.pcr)));
  const tierNow = Math.min(tier, tiers.length - 1);
  const mode = (m: 'extend' | 'trim' | 'cut'): void => {
    useToolStore.getState().set({ tool: x.kind === 'taxilane' ? 'taxilane' : 'taxiway', taxiMode: m, category: 'taxiway', menuTab: 'build', menuOpen: true, selection: null, hint: null, problem: null });
  };
  const pickCode = (c: CodeLetter): void => {
    setCode(c);
    // Codes above C force a paved surface in the same action.
    if (!surfaceAllowsCode(surface, c)) {
      setSurface('asphalt');
      setTier(0);
    }
  };
  const changed = surface !== x.surface || SURFACE_SPEC[surface].pcrTiers[tierNow] !== x.pcr;
  const change = changed ? surfaceChange({ ...x, code, widthM: AIRFIELD.codes[code].taxiwayWidthM }, surface, tierNow) : null;
  const daysLeft = x.works ? Math.max(0, Math.ceil((x.works.doneTick - tick) / TICKS_PER_DAY)) : 0;
  return (
    <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--line-soft);display:grid;gap:6px" data-testid="taxiway-upgrade">
      <div class="section" style="margin:0 0 2px">{t('inspector.taxiUpgrade')}</div>
      <label style="display:flex;justify-content:space-between;gap:6px">
        {t('opt.code')}
        <select data-testid="tw-class" value={code} onChange={(e) => pickCode((e.target as HTMLSelectElement).value as CodeLetter)}>
          {CODES.map((c) => (
            <option key={c} value={c}>
              {c}, {AIRFIELD.codes[c].taxiwayWidthM} m
            </option>
          ))}
        </select>
      </label>
      <div style="display:flex;flex-wrap:wrap;gap:4px" data-testid="tw-surface">
        {SURFACE_ORDER.map((sf) => (
          <button
            key={sf}
            data-testid={`tw-surface-${sf}`}
            aria-pressed={surface === sf}
            disabled={!surfaceAllowsCode(sf, code) || x.works !== undefined}
            style="flex:1 1 auto;padding:4px 8px;font-size:11px;white-space:nowrap"
            onClick={() => {
              setSurface(sf);
              setTier(0);
            }}
          >
            {tDynamic(`surface.${sf}`)}
          </button>
        ))}
      </div>
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;flex-wrap:wrap">
        <span style="color:var(--muted)">{tFormat('inspector.surfaceCurrent', { surface: tDynamic(`surface.${x.surface}`) })}</span>
        {change && <span style="color:var(--accent)">{tFormat('inspector.surfaceSelected', { surface: tDynamic(`surface.${surface}`), change: t(change.upgrade ? 'inspector.surfaceUpgrade' : 'inspector.surfaceDowngrade') })}</span>}
      </div>
      {!surfaceAllowsCode('grass', code) && <div style="color:var(--muted);font-size:11px">{t('inspector.surfaceNeedsPaved')}</div>}
      {tiers.length > 1 && (
        <label style="display:flex;justify-content:space-between;gap:6px">
          {t('inspector.runwayStrength')}
          <select data-testid="tw-tier" value={tierNow} onChange={(e) => setTier(Number((e.target as HTMLSelectElement).value))}>
            {tiers.map((pcr, i) => (
              <option key={i} value={i}>
                PCR {pcr}
              </option>
            ))}
          </select>
        </label>
      )}
      {x.works && (
        <div style="font-size:11px" data-testid="tw-works">
          {tFormat('inspector.worksUnderWay', { surface: tDynamic(`surface.${x.works.surface}`), days: daysLeft })}
        </div>
      )}
      {change && !x.works && (
        <div style="font-size:11px" data-testid="tw-cost">
          {tFormat(change.upgrade ? 'inspector.surfaceCost' : 'inspector.surfaceRefund', { cost: formatMoney(Math.abs(change.cashDelta)), days: change.days })}
        </div>
      )}
      <button data-testid="tw-apply" disabled={x.works !== undefined && changed} onClick={() => send({ type: 'reclassTaxiway', id: x.id, code, surface, tier: tierNow })}>
        {t('inspector.apply')}
      </button>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button data-testid="tw-reverse" onClick={() => send({ type: 'reverseTaxiway', id: x.id })}>
          {t('inspector.reverse')}
        </button>
        <button data-testid="tw-extend" onClick={() => mode('extend')}>
          {t('inspector.extendEnd')}
        </button>
        <button data-testid="tw-trim" onClick={() => mode('trim')}>
          {t('inspector.trimEnd')}
        </button>
        <button data-testid="tw-cut" onClick={() => mode('cut')}>
          {t('inspector.cutOut')}
        </button>
      </div>
      <ClassHelp />
    </div>
  );
}

/** "09 left", "27 right", or "none" for the turn pads line in the runway inspector (task T01 spec). */
function padText(des: string, side: PadSide | undefined): string {
  if (!side) return t('inspector.padNone');
  return `${des} ${t(side === 'left' ? 'inspector.padLeft' : 'inspector.padRight')}`;
}

/** Class, approach and strength of a runway. Changes are applied together and priced by the sim. */
function RunwayUpgrade({ r, send }: { r: Runway; send(cmd: Command): void }) {
  const [code, setCode] = useState<CodeLetter>(r.code);
  const [approach, setApproach] = useState<Approach>(r.approach);
  const tiers = SURFACE_SPEC[r.surface].pcrTiers;
  const [tier, setTier] = useState(Math.max(0, tiers.indexOf(r.pcr)));
  const [surface, setSurface] = useState<Surface>(r.surface);
  const surfTiers = SURFACE_SPEC[surface].pcrTiers;
  const paved = surface === 'asphalt' || surface === 'concrete';
  const tick = useGameStore((st) => st.tick);
  const t3 = Math.min(tier, surfTiers.length - 1);
  const resurfacing = surface !== r.surface || surfTiers[t3] !== r.pcr;
  // How long the edit closes the runway, shown before Apply.
  const days = runwayWorksDays(r, { code, approach, surface: resurfacing ? surface : undefined });
  const daysLeft = r.works ? Math.max(0, Math.ceil((r.works.doneTick - tick) / TICKS_PER_DAY)) : 0;
  const apply = (): void => {
    if (code !== r.code || approach !== r.approach) send({ type: 'reclassRunway', id: r.id, code, approach });
    const t2 = Math.min(tier, surfTiers.length - 1);
    if (surface !== r.surface || surfTiers[t2] !== r.pcr) send({ type: 'resurface', kind: 'runway', id: r.id, surface, tier: t2 });
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
      <label style="display:flex;justify-content:space-between;gap:6px">
        {t('inspector.surfaceLabel')}
        <select data-testid="rw-surface" value={surface} onChange={(e) => { setSurface((e.target as HTMLSelectElement).value as Surface); setTier(0); }}>
          {SURFACES.map((x) => (
            <option key={x} value={x}>
              {tDynamic(`surface.${x}`)}
            </option>
          ))}
        </select>
      </label>
      {surfTiers.length > 1 && (
        <label style="display:flex;justify-content:space-between;gap:6px">
          {t('inspector.runwayStrength')}
          <select data-testid="rw-tier" value={Math.min(tier, surfTiers.length - 1)} onChange={(e) => setTier(Number((e.target as HTMLSelectElement).value))}>
            {surfTiers.map((pcr, i) => (
              <option key={i} value={i}>
                PCR {pcr}
              </option>
            ))}
          </select>
        </label>
      )}
      <div style="color:var(--muted);font-size:11px">{t('inspector.runwayUpgradeHint')}</div>
      {r.works && (
        <div style="font-size:11px;color:var(--warn)" data-testid="rw-works">
          {tFormat('inspector.runwayWorks', { days: daysLeft })}
        </div>
      )}
      {days > 0 && (
        <div style="font-size:11px" data-testid="rw-works-preview">
          {tFormat('inspector.runwayWorksPreview', { days })}
        </div>
      )}
      <button data-testid="rw-apply" onClick={apply}>
        {t('inspector.apply')}
      </button>
      <ClassHelp />
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
    const obs = af.obstacles?.find((o) => o.runwayId === r.id);
    // Usable approach per landing direction after the obstacle surfaces (docs/GAME_DESIGN.md section 6).
    const dirLine = (des: string, ap: typeof r.approach): string =>
      tFormat(ap === r.approach ? 'inspector.approachDir' : 'inspector.approachDirLimited', { des, approach: tDynamic(`approach.${ap}`) });
    body = (
      <>
        <div>{tFormat('inspector.size', { len: r.lengthM, w: r.widthM })}</div>
        <div>
          {r.code}, {tDynamic(`approach.${r.approach}`)}, {String(r.headingDeg).padStart(3, '0')}°
        </div>
        <div>{tFormat('inspector.pcr', { n: r.pcr, surface: tDynamic(`surface.${r.surface}`) })}</div>
        <div>{tFormat('inspector.condition', { n: Math.round(r.condition) })}</div>
        <div>{tFormat('inspector.holding', { n: af.holding.filter((h) => h.runwayId === r.id).length })}</div>
        <div data-testid="runway-pads">
          {tFormat('inspector.turnPads', { a: padText(r.nameA, r.pads?.a), b: padText(r.nameB, r.pads?.b) })}
        </div>
        {(r.pads?.a || r.pads?.b) && (
          <div style="font-size:11px" data-testid="runway-pad-remove">
            {(['a', 'b'] as const).map((end) => {
              if (!r.pads?.[end]) return null;
              return (
                <button key={end} data-testid={`pad-remove-${end}`} style="margin-right:6px" onClick={() => send({ type: 'turnPad', runwayId: r.id, end, side: null })}>
                  {tFormat('inspector.removePad', { des: end === 'a' ? r.nameA : r.nameB })}
                </button>
              );
            })}
          </div>
        )}
        {obs && (
          <div data-testid="runway-obstacles" style={obs.penetrations.length > 0 ? 'color:var(--warn)' : undefined}>
            <div>{dirLine(r.nameA, obs.approachA)}</div>
            <div>{dirLine(r.nameB, obs.approachB)}</div>
            {obs.penetrations.length > 0 && <div style="font-size:11px">{tFormat('inspector.obstacles', { n: obs.penetrations.length, m: obs.penetrations[0].byM })}</div>}
          </div>
        )}
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
        <TaxiwayUpgrade key={`${x.id}-${x.code}-${x.surface}-${x.pcr}-${x.points.length}`} x={x} send={send} />
      </>
    );
  } else if (kind === 'apron') {
    const x = af.aprons.find((o) => o.id === id);
    if (!x) return null;
    name = x.name ?? String(x.id);
    body = (
      <>
        <div data-testid="apron-area">{tFormat('inspector.apronArea', { area: formatNumber(Math.round(apronArea(x))) })}</div>
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
          {tFormat('inspector.standInfo', { type: tDynamic(`standType.${x.type}`), size: tDynamic(`standSize.${x.size}`), surface: tDynamic(`surface.${x.surface}`) })}
        </div>
        {/* Types this stand cannot take, with the reason (docs/DESIGN_REVISION_2.md section 3.1). */}
        {AIRCRAFT.filter((a) => standRefusal(x, a) === 'surface').length > 0 && (
          <div style="color:var(--muted);font-size:11px" data-testid="stand-refused">
            {tFormat('inspector.standSurfaceRefused', { types: AIRCRAFT.filter((a) => standRefusal(x, a) === 'surface').map((a) => a.icaoType).join(', ') })}
          </div>
        )}
        <label style="display:flex;justify-content:space-between;gap:6px;margin-top:4px">
          {t('inspector.pushback')}
          <select data-testid="stand-pushback" value={x.pushback} onChange={(e) => send({ type: 'setStandProps', id: x.id, pushback: (e.target as HTMLSelectElement).value as PushbackDir })}>
            {(['auto', 'left', 'right'] as const).map((d) => (
              <option key={d} value={d}>
                {tDynamic(`pushback.${d}`)}
              </option>
            ))}
          </select>
        </label>
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
  const tiers = cur ? SURFACE_SPEC[cur.surface].pcrTiers : [];
  const tierIdx = cur ? Math.max(0, tiers.indexOf(cur.pcr)) : 0;
  return (
    <div
      data-testid="object-panel"
      style="position:absolute;right:12px;top:52px;width:260px;max-height:calc(100vh - 52px - 290px);overflow-y:auto;padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:10px;line-height:1.5"
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
