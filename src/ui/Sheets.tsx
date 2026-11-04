import { AIRCRAFT } from '@data/aircraft';
import { BUSINESS } from '@data/index';
import { LEDGER_CATEGORIES, type FeeLevel } from '@shared/business';
import type { Command } from '@sim/commands';
import { Icon } from './icons';
import { compassName, formatInt, formatMoney, formatNumber } from './format';
import { useGameStore } from './stores/gameStore';
import { t, tDynamic, tFormat, type StringKey } from './strings';

interface Props {
  send(cmd: Command): void;
}

const TABS = ['airlines', 'slots', 'flights', 'finance', 'site'] as const;

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
const SLOT_OPTIONS: number[] = [];
for (let m = 6 * 60; m <= 21 * 60; m += 15) SLOT_OPTIONS.push(m);

/** Slot manager: every signed rotation has an arrival slot the player can move. Busy hours are flagged. */
function SlotsSheet({ send }: Props) {
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
                  <select
                    data-testid={`slot-${a.id}-${i}`}
                    value={m}
                    style={perHour[Math.floor(m / 60)] > cap ? 'border-color:var(--bad)' : ''}
                    onChange={(e) => send({ type: 'setSlot', airlineId: a.id, index: i, minute: Number((e.target as HTMLSelectElement).value) })}
                  >
                    {(SLOT_OPTIONS.includes(m) ? SLOT_OPTIONS : [...SLOT_OPTIONS, m].sort((x, y) => x - y)).map((o) => (
                      <option key={o} value={o}>
                        {clock(o)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        ))}
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
  if (sheet === 'slots') return <SlotsSheet send={send} />;
  if (sheet === 'finance') return <FinanceSheet send={send} />;
  if (sheet === 'flights') return <FlightsSheet />;
  if (sheet === 'site') return <SiteSheet />;
  return null;
}

