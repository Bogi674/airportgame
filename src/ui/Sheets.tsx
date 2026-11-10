import { AIRCRAFT } from '@data/aircraft';
import { BUSINESS } from '@data/index';
import { LEDGER_CATEGORIES, type FeeLevel } from '@shared/business';
import type { Command } from '@sim/commands';
import { useState } from 'preact/hooks';
import type { BoardRow } from '@shared/business';
import { Icon } from './icons';
import { compassName, formatInt, formatMoney, formatNumber } from './format';
import { useGameStore } from './stores/gameStore';
import { t, tDynamic, tFormat, type StringKey } from './strings';

interface Props {
  send(cmd: Command): void;
}

const TABS = ['airlines', 'slots', 'stands', 'flights', 'finance', 'site'] as const;

function Sheet({ title, children, testId }: { title: string; children: preact.ComponentChildren; testId: string }) {
  const setSheet = useGameStore((s) => s.setSheet);
  const current = useGameStore((s) => s.sheet);
  return (
    <div data-testid={testId} role="dialog" aria-label={title} class="panel" style="position:absolute;top:56px;left:50%;transform:translateX(-50%);width:min(860px,94vw);max-height:calc(100% - 110px);overflow:auto;padding:12px 16px;z-index:20">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span class="sheet-title">{title}</span>
        <button class="round" style="width:28px;height:28px" data-testid="sheet-close" title={t('sheet.close')} aria-label={t('sheet.close')} onClick={() => setSheet(null)}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div class="tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" class="tab" data-testid={`tab-${k}`} aria-pressed={current === k} onClick={() => setSheet(k)}>
            {t(`top.${k === 'site' ? 'sites' : k}` as StringKey)}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

function AirlinesSheet({ send }: Props) {
  const b = useGameStore((s) => s.business);
  if (!b) return null;
  const max = Math.min(6, 1 + Math.floor(b.rating / 20));
  return (
    <Sheet title={t('airlines.title')} testId="sheet-airlines">
      <div style="color:var(--muted);font-size:12px;margin-bottom:8px">{tFormat('airlines.max', { n: max })}</div>
      <div style="display:grid;gap:8px">
        {b.airlines.map((a) => {
          const locked = b.rating < a.minRating && a.rotations === 0;
          return (
            <div key={a.id} data-testid={`airline-${a.id}`} style="display:grid;grid-template-columns:1.4fr 1.6fr 1fr 1.6fr;gap:10px;align-items:center;padding:8px;border:1px solid var(--line);border-radius:10px">
              <div>
                <div style="font-weight:600">{a.name}</div>
                <div style="font-size:12px;color:var(--muted)">{tDynamic(`airlines.scope.${a.scope}`)}</div>
              </div>
              <div style="font-size:12px">
                {t('airlines.fleet')}: {a.fleet.map((f) => AIRCRAFT[f].name).join(', ')}
                <div style="color:var(--muted)">{tFormat('airlines.stats', { flights: a.flights, pax: formatInt(a.pax) })}</div>
              </div>
              <label style="font-size:12px">
                {t('airlines.fee')}
                <select value={a.feeLevel} onChange={(e) => send({ type: 'setAirlineFee', airlineId: a.id, level: Number((e.target as HTMLSelectElement).value) as FeeLevel })}>
                  {[0, 1, 2].map((l) => (
                    <option key={l} value={l}>
                      {tDynamic(`airlines.fee.${l}`)}
                    </option>
                  ))}
                </select>
              </label>
              <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end">
                {locked ? (
                  <span style="color:var(--warn);font-size:12px">{tFormat('airlines.need', { n: a.minRating })}</span>
                ) : (
                  <>
                    <label style="font-size:12px">
                      {t('airlines.rotations')}
                      <input data-testid={`rot-${a.id}`} type="number" min="0" max={max} value={a.rotations} style="width:48px" onChange={(e) => send({ type: 'signAirline', airlineId: a.id, rotations: Number((e.target as HTMLInputElement).value) })} />
                    </label>
                    {a.rotations === 0 ? (
                      <button data-testid={`sign-${a.id}`} onClick={() => send({ type: 'signAirline', airlineId: a.id, rotations: 1 })}>
                        {t('airlines.sign')}
                      </button>
                    ) : (
                      <button onClick={() => send({ type: 'signAirline', airlineId: a.id, rotations: 0 })}>{t('airlines.end')}</button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

function FinanceSheet({ send }: Props) {
  const b = useGameStore((s) => s.business);
  const cash = useGameStore((s) => s.cash);
  if (!b) return null;
  const rows = [...b.history.slice(-7), b.today];
  const sum = (arr: number[]): number => arr.reduce((x, y, i) => x + (LEDGER_CATEGORIES[i] === 'loan' ? 0 : y), 0);
  const loanStep = 1_000_000;
  const canBorrow = BUSINESS.fees.loanMax - b.loan;
  return (
    <Sheet title={t('finance.title')} testId="sheet-finance">
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px">
        <span>
          {t('hud.cash')}: <strong data-testid="finance-cash">{formatMoney(cash)}</strong>
        </span>
        <span>
          {t('finance.loan')}: {formatMoney(b.loan)}
        </span>
        <span>{tFormat('finance.staff', { n: b.staff })}</span>
        <span>{t('top.rating')}: {formatNumber(b.rating)}</span>
        <span>{b.paxToday} pax, {b.flightsToday} flights today, {b.lostPaxToday} lost</span>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button data-testid="take-loan" disabled={canBorrow < loanStep} onClick={() => send({ type: 'takeLoan', amount: loanStep })}>
          {tFormat('finance.take', { amount: formatMoney(loanStep) })}
        </button>
        <button disabled={b.loan <= 0} onClick={() => send({ type: 'repayLoan', amount: Math.min(loanStep, b.loan) })}>
          {tFormat('finance.repay', { amount: formatMoney(Math.min(loanStep, b.loan)) })}
        </button>
      </div>
      <table data-testid="ledger" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr>
            <th style="text-align:left">{t('finance.last').replace('{n}', String(rows.length - 1))}</th>
            {rows.map((_, i) => (
              <th key={i} style="text-align:right">
                {i === rows.length - 1 ? t('finance.today') : `-${rows.length - 1 - i}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LEDGER_CATEGORIES.map((c, ci) => (
            <tr key={c}>
              <td>{tDynamic(`finance.cat.${c}`)}</td>
              {rows.map((r, i) => (
                <td key={i} style={`text-align:right;color:${r[ci] < 0 ? 'var(--bad)' : r[ci] > 0 ? 'var(--ok)' : 'var(--muted)'}`}>
                  {r[ci] === 0 ? '' : formatInt(r[ci])}
                </td>
              ))}
            </tr>
          ))}
          <tr style="border-top:1px solid var(--line);font-weight:600">
            <td>{t('finance.net')}</td>
            {rows.map((r, i) => (
              <td key={i} style="text-align:right">
                {formatInt(sum(r))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </Sheet>
  );
}

const clock = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Slot list: every signed rotation has an arrival slot. Busy hours are flagged. Slots are read only until the sheet is rewritten. */
function SlotsSheet() {
  const b = useGameStore((s) => s.business);
  const af = useGameStore((s) => s.airfield);
  if (!b) return null;
  const signed = b.airlines.filter((a) => a.rotations > 0);
  const perHour = new Array<number>(24).fill(0);
  for (const a of signed) for (const m of a.slots) perHour[Math.floor(m / 60)]++;
  const cap = Math.max(2, af.runways.length * 4);
  const peak = Math.max(1, ...perHour);
  return (
    <Sheet title={t('slots.title')} testId="sheet-slots">
      <div style="color:var(--muted);font-size:12px;margin-bottom:8px">{tFormat('slots.help', { cap })}</div>
      <div class="section">{t('slots.load')}</div>
      <div style="display:grid;grid-template-columns:repeat(16,1fr);gap:3px;align-items:end;height:64px;margin-bottom:12px" data-testid="slot-load">
        {perHour.slice(6, 22).map((n, i) => (
          <div key={i} title={`${String(i + 6).padStart(2, '0')}:00, ${n}`} style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;font-size:10px;color:var(--muted)">
            <div style={`width:100%;height:${Math.round((n / peak) * 40)}px;background:${n > cap ? 'var(--bad)' : 'var(--accent)'};border-radius:2px`} />
            {String(i + 6).padStart(2, '0')}
          </div>
        ))}
      </div>
      {signed.length === 0 && <div>{t('slots.empty')}</div>}
      <div style="display:grid;gap:8px">
        {signed.map((a) => (
          <div key={a.id} data-testid={`slots-${a.id}`} style="padding:8px;border:1px solid var(--line);border-radius:10px">
            <div style="font-weight:600;margin-bottom:6px">{a.name}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              {a.slots.map((m, i) => (
                <label key={i} style="font-size:12px;display:flex;gap:6px;align-items:center">
                  {i + 1}
                  <span data-testid={`slot-${a.id}-${i}`} style={perHour[Math.floor(m / 60)] > cap ? 'color:var(--bad)' : ''}>
                    {clock(m)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

const HOUR_PX = 44;

function airlineHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/**
 * Stand management: a day timeline per stand. Flights sit on the stand they are assigned to, or in the
 * unassigned lane. Click a flight to move it, unassign it or cancel it. Stands can be opened, closed and
 * limited to commercial or general aviation flights, and the auto scheduler can be switched off.
 */
function StandsSheet({ send }: Props) {
  const b = useGameStore((s) => s.business);
  const af = useGameStore((s) => s.airfield);
  const [pick, setPick] = useState<number | null>(null);
  if (!b) return null;
  const rows = b.board.filter((r) => r.flight >= 0);
  const nowMin = b.minuteOfDay;
  const unassigned = rows.filter((r) => r.standId < 0 && r.status === 'scheduled');
  const block = (r: BoardRow, lane: number) => {
    const start = Math.max(0, r.eta);
    const len = Math.max(30, r.turnMin + 10);
    const hue = airlineHue(r.airline);
    const active = r.status !== 'scheduled';
    return (
      <button
        key={r.flight}
        class="blk"
        data-testid={`flight-${r.flight}`}
        aria-pressed={pick === r.flight}
        disabled={active}
        title={`${r.airline} ${r.type}`}
        style={`left:${(start / 60) * HOUR_PX}px;width:${(len / 60) * HOUR_PX - 2}px;top:${4 + lane * 34}px;--h:${hue}`}
        onClick={() => setPick(pick === r.flight ? null : r.flight)}
      >
        <b>{r.airline.split(' ')[0]}</b>
        <span>{r.type}</span>
      </button>
    );
  };
  const lanes = (list: BoardRow[]): { r: BoardRow; lane: number }[] => {
    const ends: number[] = [];
    return list
      .slice()
      .sort((p, q) => p.eta - q.eta)
      .map((r) => {
        let lane = ends.findIndex((e) => e <= r.eta);
        if (lane < 0) lane = ends.length;
        ends[lane] = r.eta + Math.max(30, r.turnMin + 10);
        return { r, lane };
      });
  };
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const picked = rows.find((r) => r.flight === pick) ?? null;
  const gridW = 24 * HOUR_PX;
  const unLanes = lanes(unassigned);
  const unH = Math.max(1, ...unLanes.map((x) => x.lane + 1)) * 34 + 8;
  return (
    <Sheet title={t('stands.title')} testId="sheet-stands">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <label class="switch" title={t('stands.autoTip')}>
          <input data-testid="auto-stands" type="checkbox" checked={b.autoStands} onChange={(e) => send({ type: 'setAutoStands', on: (e.target as HTMLInputElement).checked })} />
          <span>{t('stands.auto')}</span>
        </label>
        <button data-testid="auto-assign" onClick={() => send({ type: 'autoAssignStands' })}>
          {t('stands.autoAssign')}
        </button>
        <span style="color:var(--muted);font-size:12px">{t('stands.help')}</span>
      </div>
      {picked && (
        <div class="panel" data-testid="flight-menu" style="padding:8px 10px;margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <b>
            {picked.airline} {picked.type}
          </b>
          <span style="color:var(--muted)">{clock(picked.eta)}</span>
          <label style="display:flex;gap:6px;align-items:center;font-size:12px">
            {t('stands.moveTo')}
            <select
              data-testid="flight-stand"
              value={picked.standId}
              onChange={(e) => {
                send({ type: 'assignStand', flight: picked.flight, standId: Number((e.target as HTMLSelectElement).value) });
                setPick(null);
              }}
            >
              <option value={-1}>{t('stands.unassigned')}</option>
              {af.stands.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number} ({s.code})
                </option>
              ))}
            </select>
          </label>
          <button
            data-testid="flight-cancel"
            onClick={() => {
              send({ type: 'cancelFlight', flight: picked.flight });
              setPick(null);
            }}
          >
            {t('stands.cancelFlight')}
          </button>
          <button onClick={() => setPick(null)}>{t('sheet.close')}</button>
        </div>
      )}
      <div class="tl-wrap">
        <div class="tl" style={`min-width:${gridW + 250}px`}>
          <div class="tl-head">
            <div class="tl-label">{t('stands.stand')}</div>
            <div class="tl-grid" style={`width:${gridW}px`}>
              {hours.map((h) => (
                <div key={h} class="tl-hour" style={`width:${HOUR_PX}px`}>
                  {String(h).padStart(2, '0')}
                </div>
              ))}
            </div>
          </div>
          <div class="tl-row" data-testid="lane-unassigned">
            <div class="tl-label">
              <b>{t('stands.unassigned')}</b>
              <span class="sub">{unassigned.length}</span>
            </div>
            <div class="tl-grid" style={`width:${gridW}px;height:${unH}px`}>
              <div class="tl-now" style={`left:${(nowMin / 60) * HOUR_PX}px`} />
              {unLanes.map((x) => block(x.r, x.lane))}
            </div>
          </div>
          {af.stands.length === 0 && <div style="padding:12px;color:var(--muted)">{t('stands.none')}</div>}
          {af.stands.map((s) => {
            const mine = lanes(rows.filter((r) => r.standId === s.id));
            const h = Math.max(1, ...mine.map((x) => x.lane + 1)) * 34 + 8;
            return (
              <div key={s.id} class="tl-row" data-testid={`stand-row-${s.id}`}>
                <div class="tl-label">
                  <b>
                    {t('stands.stand')} {s.number}
                  </b>
                  <span class="sub">
                    {s.code}, {tDynamic(`standType.${s.type}`)}
                  </span>
                  <span style="display:flex;gap:6px;align-items:center;margin-top:3px">
                    <label class="switch" title={t('stands.openTip')}>
                      <input data-testid={`stand-open-${s.id}`} type="checkbox" checked={s.closed !== true} onChange={(e) => send({ type: 'setStandProps', id: s.id, closed: !(e.target as HTMLInputElement).checked })} />
                      <span>{s.closed === true ? t('stands.closed') : t('stands.open')}</span>
                    </label>
                    <select data-testid={`stand-usage-${s.id}`} value={s.usage ?? 'any'} onChange={(e) => send({ type: 'setStandProps', id: s.id, usage: (e.target as HTMLSelectElement).value as 'any' | 'commercial' | 'ga' })}>
                      <option value="any">{t('stands.usage.any')}</option>
                      <option value="commercial">{t('stands.usage.commercial')}</option>
                      <option value="ga">{t('stands.usage.ga')}</option>
                    </select>
                  </span>
                </div>
                <div
                  class={`tl-grid${s.closed === true ? ' closed' : ''}`}
                  style={`width:${gridW}px;height:${h}px`}
                  onClick={(e) => {
                    // Clicking an empty spot places the picked flight on this stand.
                    if (picked && (e.target as HTMLElement).classList.contains('tl-grid')) {
                      send({ type: 'assignStand', flight: picked.flight, standId: s.id });
                      setPick(null);
                    }
                  }}
                >
                  <div class="tl-now" style={`left:${(nowMin / 60) * HOUR_PX}px`} />
                  {mine.map((x) => block(x.r, x.lane))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

function FlightsSheet() {
  const b = useGameStore((s) => s.business);
  const rows = b?.board ?? [];
  const eta = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return (
    <Sheet title={t('flights.title')} testId="sheet-flights">
      {rows.length === 0 ? (
        <div>{t('flights.empty')}</div>
      ) : (
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="text-align:left">
              <th>{t('flights.airline')}</th>
              <th>{t('flights.type')}</th>
              <th>{t('flights.status')}</th>
              <th>{t('flights.stand')}</th>
              <th>{t('flights.stage')}</th>
              <th>{t('flights.eta')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.airline}</td>
                <td>{r.type}</td>
                <td>{tDynamic(`status.${r.status}`)}</td>
                <td>{r.stand}</td>
                <td>{r.stageKm > 0 ? `${formatInt(r.stageKm)} km` : ''}</td>
                <td>
                  {eta(r.eta)}
                  {r.delayMin > 0 ? ` (+${r.delayMin})` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Sheet>
  );
}

function SiteSheet() {
  const site = useGameStore((s) => s.site);
  const cash = useGameStore((s) => s.cash);
  const game = useGameStore((s) => s.game);
  if (!site) return null;
  return (
    <Sheet title={t('sites.title')} testId="sheet-site">
      <div data-testid="site-info" style="line-height:1.7">
        <div>
          {t('site.seed')}: {game.seed}, {tDynamic(`site.preset.${site.preset}`)}
        </div>
        <div>
          {t('hud.cash')}: {formatMoney(cash)}
        </div>
        <div>
          {t('site.idealHeading')}: {String(site.idealHeadingDeg).padStart(3, '0')}°
        </div>
        <div>
          {t('site.climate')}: {site.climate.type}, {site.climate.tempMinC} to {site.climate.tempMaxC} °C
        </div>
        <div>
          {t('site.city')}: {tFormat('site.cityValue', { pop: formatInt(site.city.population), dist: formatNumber(site.city.distanceKm), dir: compassName(site.city.directionDeg) })}
        </div>
      </div>
    </Sheet>
  );
}

export function Sheets({ send }: Props) {
  const sheet = useGameStore((s) => s.sheet);
  if (sheet === 'airlines') return <AirlinesSheet send={send} />;
  if (sheet === 'slots') return <SlotsSheet />;
  if (sheet === 'stands') return <StandsSheet send={send} />;
  if (sheet === 'finance') return <FinanceSheet send={send} />;
  if (sheet === 'flights') return <FlightsSheet />;
  if (sheet === 'site') return <SiteSheet />;
  return null;
}

