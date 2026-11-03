import { AIRCRAFT } from '@data/aircraft';
import { BUSINESS } from '@data/index';
import { LEDGER_CATEGORIES, type FeeLevel } from '@shared/business';
import type { Command } from '@sim/commands';
import { compassName, formatInt, formatMoney, formatNumber } from './format';
import { useGameStore } from './stores/gameStore';
import { t, tDynamic, tFormat } from './strings';

interface Props {
  send(cmd: Command): void;
}

function Sheet({ title, children, testId }: { title: string; children: preact.ComponentChildren; testId: string }) {
  const setSheet = useGameStore((s) => s.setSheet);
  return (
    <div
      data-testid={testId}
      role="dialog"
      aria-label={title}
      style="position:absolute;top:56px;left:50%;transform:translateX(-50%);width:min(860px,94vw);max-height:calc(100% - 110px);overflow:auto;padding:14px 16px;background:#10161cf8;border:1px solid #2c3a45;border-radius:8px;z-index:20"
    >
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="font-size:15px">{title}</strong>
        <button data-testid="sheet-close" onClick={() => setSheet(null)}>
          {t('sheet.close')}
        </button>
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
      <div style="color:#9fb4c4;font-size:12px;margin-bottom:8px">{tFormat('airlines.max', { n: max })}</div>
      <div style="display:grid;gap:8px">
        {b.airlines.map((a) => {
          const locked = b.rating < a.minRating && a.rotations === 0;
          return (
            <div key={a.id} data-testid={`airline-${a.id}`} style="display:grid;grid-template-columns:1.4fr 1.6fr 1fr 1.6fr;gap:10px;align-items:center;padding:8px;border:1px solid #2c3a45;border-radius:6px">
              <div>
                <div style="font-weight:600">{a.name}</div>
                <div style="font-size:12px;color:#9fb4c4">{tDynamic(`airlines.scope.${a.scope}`)}</div>
              </div>
              <div style="font-size:12px">
                {t('airlines.fleet')}: {a.fleet.map((f) => AIRCRAFT[f].name).join(', ')}
                <div style="color:#9fb4c4">{tFormat('airlines.stats', { flights: a.flights, pax: formatInt(a.pax) })}</div>
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
                  <span style="color:#ffcf8f;font-size:12px">{tFormat('airlines.need', { n: a.minRating })}</span>
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
                <td key={i} style={`text-align:right;color:${r[ci] < 0 ? '#ffb4ad' : r[ci] > 0 ? '#a8e6a1' : '#6c7c88'}`}>
                  {r[ci] === 0 ? '' : formatInt(r[ci])}
                </td>
              ))}
            </tr>
          ))}
          <tr style="border-top:1px solid #2c3a45;font-weight:600">
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
  if (sheet === 'finance') return <FinanceSheet send={send} />;
  if (sheet === 'flights') return <FlightsSheet />;
  if (sheet === 'site') return <SiteSheet />;
  return null;
}

