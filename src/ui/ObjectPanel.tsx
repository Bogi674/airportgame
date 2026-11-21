import { AIRFIELD, BUSINESS, GROUND, GSE_INDEX, STAND_ACCESS, SURFACE_SPEC } from '@data/index';
import { bagNodeNumber, bayOptions, deskOptions, standBagState, standWarnings } from './standInspector';
import { standsReached } from '@shared/roadGraph';
import { stationCategory } from '@shared/fireCover';
import { polylineLength } from '@shared/geom';
import { BAGGAGE_FIXTURE_KEYS, FIXTURE_KEYS, TICKS_PER_DAY, fixtureKey, type FixtureKey } from '@shared/business';
import { cellIndex } from '@shared/terminalOps';
import { movementsPerHour, runwayCapOf } from '@shared/towerBudget';
import { runwayWorksDays, SURFACE_ORDER, surfaceAllowsCode, surfaceChange } from '@shared/surfaceRules';
import { formatMoney, formatNumber } from './format';
import { apronArea } from '@shared/apronGeom';
import { ACCEPT_COMMERCIAL, APPROACHES, CODES, STAND_UPGRADE, SURFACES, type StandUpgrade, type Approach, type CodeLetter, type PadSide, type PushbackDir, type Runway, type Stand, type Surface, type Taxiway } from '@shared/airfield';
import { AIRCRAFT } from '@data/aircraft';
import { standRefusal } from '@shared/standSizes';
import { standFork, standLeadOut } from '@shared/standFork';
import { ClassHelp } from './ClassHelp';
import { AcceptToggles } from './AcceptToggles';
import type { Command } from '@sim/commands';
import { useState } from 'preact/hooks';
import { useGameStore } from './stores/gameStore';
import { useToolStore } from './stores/toolStore';
import { t, tDynamic, tFormat } from './strings';

interface Props {
  send(cmd: Command): void;
}

/** Zone problems of a building that the terminal panel lists, the zone keys of the sim readiness list. */
const ZONE_ISSUES = ['zoneBreach', 'transitionOrientation', 'paxCannotLeave', 'staffBypass'] as const;
/** Fixtures whose mode the player switches in the terminal panel: departure or arrival, or passenger or staff use. */
const MODE_FIXTURE_NAMES: readonly FixtureKey[] = ['passport', 'eGate', 'security'];

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

/** The taxiway connection line of a stand: the lead in taxiway by name, or a warning that flights cannot use it. */
function StandLink({ stand, linked }: { stand: Stand; linked: boolean }) {
  const af = useGameStore((s) => s.airfield);
  const lines = af.taxiways.map((t) => ({ pts: t.points }));
  const fork = linked ? standFork(stand, lines) : null;
  const out = fork ? standLeadOut(stand, lines) : null;
  if (!linked) {
    return (
      <div style="color:var(--warn)" data-testid="stand-link">
        {t('inspector.stand.noTaxiway')}
      </div>
    );
  }
  const road = standsReached(af)[af.stands.indexOf(stand)] === true;
  return (
    <div style="color:var(--muted)" data-testid="stand-link">
      {fork ? tFormat('inspector.stand.leadIn', { name: af.taxiways[fork.lane].name }) : t('inspector.stand.linked')}
      <div data-testid="stand-road" style={road ? undefined : 'color:var(--warn)'}>
        {road ? t('inspector.stand.road') : t('inspector.stand.noRoad')}
      </div>
      {stand.type === 'through' && <div data-testid="stand-lead-out">{out ? tFormat('inspector.stand.leadOut', { name: af.taxiways[out.lane].name }) : t('inspector.stand.noLeadOut')}</div>}
    </div>
  );
}

/** Stand upgrades with cost and state, the gate desk choice and the warnings that follow from them (T66). */
function StandAccess({ stand, index, send }: { stand: Stand; index: number; send(cmd: Command): void }) {
  const biz = useGameStore((s) => s.business);
  const cash = useGameStore((s) => s.cash);
  const desks = deskOptions(biz?.gateDesks ?? []);
  const nowIndex = biz?.standGate[index] ?? -1;
  const now = desks.find((d) => d.index === nowIndex);
  const built = stand.upgrades ?? 0;
  const warnings = standWarnings({
    commercial: (stand.accepts & ACCEPT_COMMERCIAL) !== 0,
    gateDeskCount: desks.length,
    far: biz?.standFar[index] === 1,
    busBay: (built & STAND_UPGRADE.busBay) !== 0,
    busOwned: (biz?.fleet[GSE_INDEX.bus] ?? 0) > 0,
  });
  const assigned = stand.gate ? desks.find((d) => d.building === stand.gate?.building && d.x === stand.gate.x && d.y === stand.gate.y) : undefined;
  const pick = (value: string): void => {
    const d = desks.find((o) => `${o.building}:${o.x}:${o.y}` === value);
    send({ type: 'setStandGate', id: stand.id, building: d ? d.building : -1, x: d ? d.x : 0, y: d ? d.y : 0 });
  };
  return (
    <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--line-soft);display:grid;gap:4px" data-testid="stand-access">
      <div class="section" style="margin:0 0 2px">{t('inspector.stand.upgrades')}</div>
      {(Object.keys(STAND_UPGRADE) as StandUpgrade[]).map((u) => {
        const spec = STAND_ACCESS.upgrades[u];
        const isBuilt = (built & STAND_UPGRADE[u]) !== 0;
        const running = stand.upgradeWorks;
        const inWorks = running?.upgrade === u;
        const reason = running ? t('inspector.stand.upgradeBusy') : cash < spec.cost ? t('inspector.stand.upgradeNoCash') : undefined;
        return (
          <div key={u} data-testid={`stand-upgrade-${u}`} style="display:flex;justify-content:space-between;gap:6px;align-items:center">
            <span>
              {t(`inspector.stand.upgrade.${u}`)}
              <span style="color:var(--muted);font-size:11px;display:block">{tFormat('inspector.stand.upgradeCost', { cost: formatMoney(spec.cost), days: spec.days })}</span>
            </span>
            {isBuilt ? (
              <span>{t('inspector.stand.upgradeBuilt')}</span>
            ) : inWorks && running ? (
              <span>{tFormat('inspector.stand.upgradeWorks', { day: Math.floor(running.doneTick / TICKS_PER_DAY) })}</span>
            ) : (
              <button data-testid={`stand-build-${u}`} disabled={reason !== undefined} title={reason} onClick={() => send({ type: 'startStandUpgrade', id: stand.id, upgrade: u })}>
                {t('inspector.stand.upgradeBuild')}
              </button>
            )}
          </div>
        );
      })}
      <label style="display:flex;justify-content:space-between;gap:6px;margin-top:4px">
        {t('inspector.stand.gate')}
        <select data-testid="stand-gate" value={assigned ? `${assigned.building}:${assigned.x}:${assigned.y}` : ''} onChange={(e) => pick((e.target as HTMLSelectElement).value)}>
          <option value="">{t('inspector.stand.gateAuto')}</option>
          {desks.map((d) => (
            <option key={`${d.building}:${d.x}:${d.y}`} value={`${d.building}:${d.x}:${d.y}`}>
              {tFormat('inspector.stand.gateDesk', { building: d.building, n: d.number })}
            </option>
          ))}
        </select>
      </label>
      {now && (
        <div style="color:var(--muted);font-size:11px" data-testid="stand-gate-now">
          {tFormat('inspector.stand.gateNow', { building: now.building, n: now.number })}
        </div>
      )}
      {warnings.map((w) => (
        <div key={w} style="color:var(--warn)" data-testid={`stand-warn-${w}`}>
          {t(`inspector.stand.warn.${w}`)}
        </div>
      ))}
      <StandBaggage stand={stand} index={index} send={send} />
    </div>
  );
}

/** Baggage bay choice of a commercial stand, its arrival carousel and the warnings that follow (T43). */
function StandBaggage({ stand, index, send }: { stand: Stand; index: number; send(cmd: Command): void }) {
  const info = useGameStore((s) => s.business?.baggage);
  const bays = info?.bays ?? [];
  const bayId = info?.standBay[index] ?? -1;
  const state = standBagState({ commercial: (stand.accepts & ACCEPT_COMMERCIAL) !== 0, bayId, bays });
  if (!state.visible) return null;
  const options = bayOptions(bays);
  const now = options.find((o) => o.id === bayId);
  const nodes = info?.nodes ?? [];
  const select = (id: number): void => useToolStore.getState().set({ tool: 'select', selection: { kind: 'bagNode', id } });
  return (
    <div style="display:grid;gap:4px" data-testid="stand-baggage">
      <label style="display:flex;justify-content:space-between;gap:6px">
        {t('inspector.stand.bay')}
        <select data-testid="stand-bay" value={String(bayId)} onChange={(e) => send({ type: 'setStandBay', standId: stand.id, bayId: Number((e.target as HTMLSelectElement).value) })}>
          <option value="-1">{t('inspector.stand.bayNone')}</option>
          {options.map((o) => (
            <option key={o.id} value={String(o.id)}>
              {tFormat('inspector.stand.bayOption', { n: o.number, building: o.building, used: o.used, total: o.total })}
            </option>
          ))}
        </select>
      </label>
      {now && state.carousel !== null && (
        <div style="color:var(--muted);font-size:11px" data-testid="stand-carousel">
          {tFormat('inspector.stand.carousel', { n: bagNodeNumber(nodes, state.carousel) })}
        </div>
      )}
      {now && state.warning === 'bayNoCarousel' && (
        <div style="color:var(--warn)" data-testid="stand-warn-bayNoCarousel">
          {tFormat('inspector.stand.bayNoCarousel', { n: now.number })}
        </div>
      )}
      {now && (
        <button data-testid="stand-bay-select" onClick={() => select(now.id)}>
          {t('inspector.stand.selectBay')}
        </button>
      )}
      {state.warning === 'noBay' && (
        <div style="color:var(--warn)" data-testid="stand-warn-noBay">
          {t('inspector.stand.warn.noBay')}
        </div>
      )}
    </div>
  );
}

/** Panel of a selected baggage node: buffer, read only connections, warnings, Fix automatically and Remove. */
function BagNodePanel({ id, send }: { id: number; send(cmd: Command): void }) {
  const info = useGameStore((s) => s.business?.baggage);
  const nodes = info?.nodes ?? [];
  const node = nodes.find((n) => n.id === id);
  if (!node) return null;
  const label = (other: number): { kind: string; n: number } => {
    const o = nodes.find((x) => x.id === other);
    return { kind: o ? t(`inspector.bag.kind.${o.kind}`) : '', n: bagNodeNumber(nodes, other) };
  };
  return (
    <div data-testid="bag-panel" style="position:absolute;right:12px;top:52px;width:280px;padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:10px;line-height:1.5">
      <div style="font-weight:600">{t(`inspector.bag.kind.${node.kind}`)}</div>
      <div style="color:var(--muted);font-size:11px" data-testid="bag-id">
        {tFormat('inspector.bag.id', { id: node.id })}
      </div>
      <div data-testid="bag-buffer">{tFormat('inspector.bag.buffer', { held: node.held, capacity: node.capacity })}</div>
      <div class="section" style="margin:4px 0 2px">{t('inspector.bag.connections')}</div>
      {node.links.length === 0 && <div style="color:var(--muted)">{t('inspector.bag.none')}</div>}
      {node.links.map((l) => {
        const outgoing = l.from === node.id;
        const other = label(outgoing ? l.to : l.from);
        return (
          <div key={`${l.from}:${l.to}`} data-testid="bag-link" style="display:flex;justify-content:space-between">
            <span>{tFormat(outgoing ? 'inspector.bag.to' : 'inspector.bag.from', other)}</span>
            <span style="color:var(--muted)">{t(l.mode === 'auto' ? 'inspector.bag.auto' : 'inspector.bag.manual')}</span>
          </div>
        );
      })}
      {node.warnings.map((w) => (
        <div key={w} style="color:var(--warn)" data-testid={`bag-warn-${w}`}>
          {t(`inspector.bag.warn.${w}`)}
        </div>
      ))}
      <div style="display:flex;gap:6px;margin-top:6px">
        <button data-testid="bag-fix" onClick={() => send({ type: 'fixBaggageNode', id })}>
          {t('inspector.bag.fix')}
        </button>
        {node.kind !== 'drop' && (
          <button
            data-testid="bag-remove"
            onClick={() => {
              send({ type: 'removeBaggageNode', id });
              useToolStore.getState().set({ selection: null });
            }}
          >
            {t('inspector.bag.remove')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Inspector for the selected airfield object, with segment properties, resurfacing and demolition. */
export function ObjectPanel({ send }: Props) {
  const selection = useToolStore((s) => s.selection);
  const af = useGameStore((s) => s.airfield);
  const biz = useGameStore((st) => st.business);
  const grids = useGameStore((st) => st.terminalGrids);
  const fixturePick = useToolStore((s) => s.fixturePick);
  if (!selection) return null;
  const { kind, id } = selection;
  if (kind === 'bagNode') return <BagNodePanel id={id} send={send} />;
  if (kind === 'terminal') {
    const term = biz?.terminals.find((x) => x.id === id);
    if (!biz || !term) return null;
    const rows: { id: number; key: (typeof FIXTURE_KEYS)[number] }[] = FIXTURE_KEYS.map((k, i) => ({ id: i + 1, key: k })).filter((r) => !BAGGAGE_FIXTURE_KEYS.includes(r.key));
    // The fixture block shows only the fixture picked in this terminal, read from the grid so it follows edits.
    const pick = fixturePick?.building === id ? fixturePick : null;
    const grid = pick ? grids.find((x) => x.id === id) : undefined;
    const cell = pick && grid ? cellIndex(grid, pick.x, pick.y) : -1;
    const fixtureId = grid && cell >= 0 ? grid.fixture[cell] : 0;
    const fixtureName = fixtureId > 0 ? fixtureKey(fixtureId) : null;
    const zoneIssueKeys = ZONE_ISSUES.filter((k) => biz.readiness.includes(k));
    return (
      <div data-testid="terminal-panel" style="position:absolute;right:12px;top:52px;width:280px;padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:10px;line-height:1.5">
        <div style="font-weight:600">{t('inspector.terminal')} {term.id}</div>
        <div>{tFormat('terminal.summary', { cells: term.cells, area: term.cells * 4 })}</div>
        <div>{tFormat('terminal.arrivals', { n: biz.arrDay[0] ?? 0 })}</div>
        <div>{tFormat('terminal.leased', { n: term.leased })}</div>
        {rows
          .filter((r) => term.counts[r.key] > 0)
          .map((r) => (
            <div key={r.key} style="display:flex;justify-content:space-between">
              <span>{tDynamic(`fixture.${r.id}`)}</span>
              <span data-testid={`count-${r.key}`}>{term.counts[r.key]}</span>
            </div>
          ))}
        {zoneIssueKeys.map((k) => (
          <div key={k} data-testid={`zone-issue-${k}`} style="color:var(--warn, var(--bad));font-size:12px">
            {tDynamic(`ready.${k}`)}
          </div>
        ))}
        {pick && grid && cell >= 0 && fixtureName !== null && (
          <div data-testid="fixture-block" style="margin-top:6px;border-top:1px solid var(--line);padding-top:6px">
            <div style="font-weight:600">{tDynamic(`fixture.${fixtureId}`)}</div>
            {fixtureName === 'securityExit' && <div data-testid="fixture-level">{tFormat('inspector.level', { n: grid.fixtureLevel[cell] })}</div>}
            {MODE_FIXTURE_NAMES.includes(fixtureName) && (
              <div style="display:flex;gap:4px;margin-top:4px">
                {[0, 1].map((m) => (
                  <button
                    key={m}
                    data-testid={`fixture-mode-${m}`}
                    aria-pressed={grid.fixtureMode[cell] === m}
                    onClick={() => send({ type: 'terminalBuild', building: grid.id, ox: grid.ox, oy: grid.oy, headingDeg: grid.headingDeg, edit: { op: 'mode', x0: pick.x, y0: pick.y, x1: pick.x + 1, y1: pick.y + 1, variant: m } })}
                  >
                    {tDynamic(fixtureName === 'security' ? `opt.use.${m}` : `opt.mode.${m}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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
  if (kind === 'building') {
    const b = af.buildings?.find((x) => x.id === id);
    if (!b) return null;
    const m3 = (l: number): string => formatNumber(Math.round(l / 1000));
    return (
      <div
        data-testid="object-panel"
        style="position:absolute;right:12px;top:52px;width:260px;max-height:calc(100vh - 52px - 290px);overflow-y:auto;padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:10px;line-height:1.5"
      >
        <div style="font-weight:600">{tDynamic(`building.${b.kind}`)}</div>
        <div data-testid="building-upkeep">{tFormat('inspector.upkeep', { cost: formatMoney(Math.round(b.cost * GROUND.buildingUpkeepShare)) })}</div>
        {b.kind === 'fire' && (
          <>
            <div data-testid="fire-vehicles">{tFormat('inspector.fireVehicles', { n: b.fireVehicles ?? 0, max: GROUND.fire.maxVehicles, cat: stationCategory(b) })}</div>
            <div data-testid="fire-airport">{tFormat('inspector.fireAirport', { cat: biz?.fireCategory ?? 0 })}</div>
            {(biz?.fireGraceDays ?? 0) > 0 && <div style="color:var(--warn)">{tFormat('inspector.fireGrace', { days: biz?.fireGraceDays ?? 0 })}</div>}
            <button data-testid="fire-buy" disabled={(b.fireVehicles ?? 0) >= GROUND.fire.maxVehicles} onClick={() => send({ type: 'buyFireVehicle', id })}>
              {tFormat('inspector.fireBuy', { cost: formatMoney(GROUND.fire.vehicleCost) })}
            </button>
          </>
        )}
        {b.kind === 'fuelFarm' && <div data-testid="fuel-stock">{tFormat('inspector.fuelStock', { stock: m3(biz?.fuelStockL ?? 0), cap: m3(biz?.fuelCapacityL ?? 0), inbound: m3(biz?.fuelInboundL ?? 0) })}</div>}
        {b.kind === 'catering' && <div>{tFormat('inspector.cateringTrucks', { n: GROUND.catering.trucks })}</div>}
        {(b.kind === 'staff' || b.kind === 'cleaning' || b.kind === 'workshop') && <div style="color:var(--muted);font-size:11px">{t('inspector.buildingLater')}</div>}
        <button
          data-testid="demolish"
          style="margin-top:6px"
          onClick={() => {
            send({ type: 'demolish', kind: 'building', id });
            useToolStore.getState().set({ selection: null });
          }}
        >
          {t('inspector.demolish')}
        </button>
      </div>
    );
  }
  if (kind === 'road' || kind === 'depot') {
    const road = kind === 'road' ? af.roads?.find((x) => x.id === id) : undefined;
    const depot = kind === 'depot' ? af.depots?.find((x) => x.id === id) : undefined;
    if (!road && !depot) return null;
    const owned = (biz?.fleet ?? []).reduce((a, b) => a + b, 0);
    const reached = standsReached(af).filter((r) => r).length;
    return (
      <div
        data-testid="object-panel"
        style="position:absolute;right:12px;top:52px;width:260px;max-height:calc(100vh - 52px - 290px);overflow-y:auto;padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:10px;line-height:1.5"
      >
        <div style="font-weight:600">{t(road ? 'inspector.road' : 'inspector.depot')}</div>
        {road && <div data-testid="road-length">{tFormat('inspector.roadLength', { len: Math.round(polylineLength(road.points)) })}</div>}
        {depot && <div data-testid="depot-fleet">{tFormat('inspector.depotFleet', { owned, capacity: (af.depots?.length ?? 0) * GROUND.depot.capacity })}</div>}
        <div data-testid="road-stands">{tFormat('inspector.depotStands', { n: reached, total: af.stands.length })}</div>
        <button
          data-testid="demolish"
          style="margin-top:6px"
          onClick={() => {
            send({ type: 'demolish', kind, id });
            useToolStore.getState().set({ selection: null });
          }}
        >
          {t('inspector.demolish')}
        </button>
      </div>
    );
  }
  if (kind === 'tower') {
    const tw = af.towers?.find((x) => x.id === id);
    if (!tw) return null;
    const max = BUSINESS.tower.levels.length;
    const queue = biz?.atcQueue ?? 0;
    const outrankedBy = biz?.towerLevel ?? 0;
    const cap = runwayCapOf(tw.level);
    return (
      <div
        data-testid="object-panel"
        style="position:absolute;right:12px;top:52px;width:260px;max-height:calc(100vh - 52px - 290px);overflow-y:auto;padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:10px;line-height:1.5"
      >
        <div style="font-weight:600">{tFormat('inspector.title', { kind: t('inspector.tower'), name: '' }).trim()}</div>
        <div data-testid="tower-level">
          {t('inspector.towerLevel')}: {tFormat('inspector.towerLevelValue', { level: tw.level, max })}
        </div>
        {outrankedBy > tw.level && <div style="color:var(--muted);font-size:11px">{tFormat('inspector.towerOutranked', { level: outrankedBy })}</div>}
        <div data-testid="tower-budget">
          {t('inspector.towerBudget')}: {movementsPerHour(tw.level)}
        </div>
        <div data-testid="tower-runways">
          {t('inspector.towerRunways')}: {cap === -1 ? t('inspector.unlimited') : cap}
        </div>
        <div data-testid="tower-queue" style={queue > 0 ? 'color:var(--warn)' : undefined}>
          {t('inspector.towerQueue')}: {queue}
        </div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button data-testid="tower-upgrade" disabled={tw.level >= max} onClick={() => send({ type: 'upgradeTower', id })}>
            {tFormat('inspector.towerUpgrade', { cost: formatMoney(BUSINESS.tower.upgradeCost) })}
          </button>
          <button
            data-testid="demolish"
            onClick={() => {
              send({ type: 'demolishTower', id });
              useToolStore.getState().set({ selection: null });
            }}
          >
            {t('inspector.demolish')}
          </button>
        </div>
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
    const lines = af.taxiways.map((t) => ({ pts: t.points }));
    // A pass through stand with a lead out is left forward, so it has no push back side (T72).
    const leavesForward = standFork(x, lines) !== null && standLeadOut(x, lines) !== null;
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
        {/* Connection states (docs/DESIGN_REVISION_4.md section 2.3): the taxiway lead in decides whether the stand can be booked. */}
        <StandLink stand={x} linked={biz?.standLinked[af.stands.indexOf(x)] === 1} />
        {af.clearanceBreaches?.includes(x.id) && (
          <div style="color:var(--warn)" data-testid="stand-clearance-breach">
            {t('inspector.stand.clearanceBreach')}
          </div>
        )}
        <div style="margin-top:4px">
          <div>{t('inspector.accepts')}</div>
          <AcceptToggles stand={x} send={send} />
        </div>
        {!leavesForward && (
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
        )}
        <StandAccess stand={x} index={af.stands.indexOf(x)} send={send} />
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
