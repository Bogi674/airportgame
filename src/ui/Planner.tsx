import { AIRCRAFT } from '@data/aircraft';
import { MARKET } from '@data/index';
import type { Command } from '@sim/commands';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Airline, BusinessPayload, FeeLevel, FlightSeries } from '@shared/business';
import type { Stand } from '@shared/airfield';
import { DAY_MIN, blockMin, operatesOn, seriesClash, weekdayOf } from '@shared/seriesPlan';
import { standRefusalAt } from './standRule';
import { DRAG_START_PX, HOUR_PX, ROW_PX, Sheet, airlineHue, clock, rowUnder } from './Sheets';
import { formatInt } from './format';
import { useGameStore } from './stores/gameStore';
import { noticeText, t, tDynamic, tFormat } from './strings';

interface Props {
  send(cmd: Command): void;
}

const WINDOW_MIN = MARKET.series.windowMin;
const STEP_MIN = MARKET.series.slotStepMin;
const DAYS = [0, 1, 2, 3, 4, 5, 6];

const daysText = (days: number): string =>
  days === 0b1111111
    ? DAYS.map((d) => tDynamic(`day.${d}`)).join(' ')
    : DAYS.filter((d) => operatesOn(days, d))
        .map((d) => tDynamic(`day.${d}`))
        .join(' ');

/** Signed and open airlines, with the series offer, satisfaction and fees (T62). */
export function AirlinesSheet({ send }: Props) {
  const b = useGameStore((s) => s.business);
  if (!b) return null;
  return (
    <Sheet title={t('airlines.title')} testId="sheet-airlines">
      <div style="color:var(--muted);font-size:12px;margin-bottom:8px" data-testid="airline-stars">
        {tFormat('airlines.stars', { n: b.stars, pax: b.paxScore, air: b.airlineScore })}
      </div>
      <div style="display:grid;gap:8px">
        {b.airlines.map((a) => (
          <AirlineRow key={a.id} a={a} b={b} send={send} />
        ))}
      </div>
    </Sheet>
  );
}

function AirlineRow({ a, b, send }: { a: Airline; b: BusinessPayload; send(cmd: Command): void }) {
  const locked = b.rating < a.minRating && !a.signed;
  const count = b.series.filter((s) => s.airline === a.id).length;
  const offer = MARKET.series.onSigning[a.scope] + MARKET.series.perStar * b.stars;
  const hub = b.destinations[a.hub]?.name;
  return (
    <div data-testid={`airline-${a.id}`} style="display:grid;grid-template-columns:1.4fr 1.6fr 1fr 1.6fr;gap:10px;align-items:center;padding:8px;border:1px solid var(--line);border-radius:10px">
      <div style="min-width:0">
        <div style="font-weight:600">{a.name}</div>
        <div style="font-size:12px;color:var(--muted)">
          {tDynamic(`airlines.scope.${a.scope}`)}
          {hub ? `, ${tFormat('airlines.hub', { hub })}` : ''}
        </div>
      </div>
      <div style="font-size:12px;min-width:0">
        {t('airlines.fleet')}: {a.fleet.map((f) => AIRCRAFT[f].name).join(', ')}
        <div style="color:var(--muted)">{tFormat('airlines.stats', { flights: a.flights, pax: formatInt(a.pax) })}</div>
        {a.signed && (
          <div style="color:var(--muted)" data-testid={`airline-happy-${a.id}`}>
            {t('airlines.happiness')}: {Math.round(a.happiness)}, {tFormat('airlines.series', { n: count })}
          </div>
        )}
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
      <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap">
        {locked ? (
          <span style="color:var(--warn);font-size:12px">{tFormat('airlines.need', { n: a.minRating })}</span>
        ) : a.signed ? (
          <button onClick={() => send({ type: 'signAirline', airlineId: a.id, sign: false })}>{t('airlines.end')}</button>
        ) : (
          <>
            <span style="font-size:12px;color:var(--muted)">{tFormat('airlines.offer', { n: offer })}</span>
            <button data-testid={`sign-${a.id}`} onClick={() => send({ type: 'signAirline', airlineId: a.id, sign: true })}>
              {t('airlines.sign')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface Drag {
  pointerId: number;
  series: FlightSeries;
  el: HTMLElement;
  startX: number;
  startY: number;
  /** Pointer offset from the block's left edge, in px, so the block keeps its grip point. */
  grabPx: number;
  started: boolean;
}

interface Drop {
  row: number;
  minute: number;
  fault: string | null;
}

/** Why the series cannot go on the stand at the minute, as the planner previews it. The sim decides on drop. */
function previewFault(b: BusinessPayload, stands: Stand[], s: FlightSeries, standId: number, minute: number): string | null {
  const i = stands.findIndex((x) => x.id === standId);
  if (i < 0) return 'standNoLink';
  const r = standRefusalAt(b, i, stands[i], AIRCRAFT[s.typeIdx], 'commercial');
  if (r !== null) return r;
  const clash = seriesClash(s.days, s.turnMin, minute, standId, b.series, s.id);
  return clash === null ? null : `seriesBusy|dest=${b.destinations[clash.dest]?.name ?? ''}`;
}

const faultText = (code: string): string => {
  const [name, ...rest] = code.split('|');
  const args: Record<string, string> = {};
  for (const p of rest) {
    const [k, v] = p.split('=');
    args[k] = v;
  }
  return noticeText(name, args);
};

/**
 * The weekly planner (T61, docs/DESIGN_REVISION_4.md section 3.2): day tabs over the stand timeline.
 * A series is dragged onto a stand row at its arrival minute; one drop places it on all its
 * operating days. Blocks show the stand time of the picked day, and a week strip per stand shows how
 * full each day is.
 */
export function PlannerSheet({ send }: Props) {
  const b = useGameStore((s) => s.business);
  const af = useGameStore((s) => s.airfield);
  const showNotice = useGameStore((s) => s.showNotice);
  const [day, setDay] = useState<number | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const justDragged = useRef(false);
  useEffect(
    () => () => {
      const d = dragRef.current;
      if (d && d.el.hasPointerCapture(d.pointerId)) d.el.releasePointerCapture(d.pointerId);
      dragRef.current = null;
    },
    [],
  );
  if (!b) return null;
  const today = weekdayOf(b.day);
  const shown = day ?? today;
  const signed = new Set(b.airlines.filter((a) => a.signed).map((a) => a.id));
  const mine = b.series.filter((s) => signed.has(s.airline));
  const unplaced = mine.filter((s) => s.minute < 0);
  const gridW = 24 * HOUR_PX;
  const nameOf = (s: FlightSeries): string => `${b.airlines[s.airline]?.name ?? ''} ${AIRCRAFT[s.typeIdx].icaoType}`;
  const dest = (s: FlightSeries): string => b.destinations[s.dest]?.name ?? '';

  const targetAt = (e: PointerEvent, d: Drag): Drop | null => {
    const row = rowUnder(e);
    if (row === null || row.id < 0) return null;
    const grid = document.querySelector<HTMLElement>(`[data-row="${row.id}"] .tl-grid`);
    if (!grid) return null;
    const left = grid.getBoundingClientRect().left;
    const raw = ((e.clientX - d.grabPx - left) / HOUR_PX) * 60;
    const minute = ((Math.round(raw / STEP_MIN) * STEP_MIN) % DAY_MIN + DAY_MIN) % DAY_MIN;
    return { row: row.id, minute, fault: previewFault(b, af.stands, d.series, row.id, minute) };
  };

  const onDown = (e: PointerEvent, s: FlightSeries): void => {
    if (e.button !== 0 || dragRef.current !== null) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    justDragged.current = false;
    dragRef.current = { pointerId: e.pointerId, series: s, el, startX: e.clientX, startY: e.clientY, grabPx: e.clientX - el.getBoundingClientRect().left, started: false };
  };
  const onMove = (e: PointerEvent): void => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_START_PX) return;
      d.started = true;
      justDragged.current = true;
      d.el.style.opacity = '0.4';
    }
    setDrop(targetAt(e, d));
  };
  const onUp = (e: PointerEvent): void => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (d.el.hasPointerCapture(d.pointerId)) d.el.releasePointerCapture(d.pointerId);
    d.el.style.opacity = '';
    dragRef.current = null;
    const target = d.started ? targetAt(e, d) : null;
    setDrop(null);
    if (!target) return;
    if (target.fault !== null) {
      showNotice(target.fault);
      return;
    }
    send({ type: 'placeSeries', seriesId: d.series.id, standId: target.row, minute: target.minute });
  };

  const block = (s: FlightSeries, startMin: number, lenMin: number, faded: boolean) => {
    const w = (lenMin / 60) * HOUR_PX;
    const bad = s.minute >= 0 && af.stands.findIndex((x) => x.id === s.standId) >= 0 && previewFault(b, af.stands, s, s.standId, s.minute) !== null;
    return (
      <button
        key={`${s.id}-${startMin}`}
        class="blk"
        data-testid={`series-${s.id}`}
        data-bad={bad ? 'true' : undefined}
        aria-pressed={pick === s.id}
        title={`${nameOf(s)}, ${dest(s)}, ${clock(s.minute)}`}
        style={`left:${(startMin / 60) * HOUR_PX}px;top:4px;width:${Math.max(8, w)}px;--h:${airlineHue(b.airlines[s.airline]?.name ?? '')};${faded ? 'opacity:0.5' : ''}`}
        onPointerDown={(e) => onDown(e, s)}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onClick={() => {
          if (justDragged.current) {
            justDragged.current = false;
            return;
          }
          setPick(pick === s.id ? null : s.id);
        }}
      >
        {w >= 40 && <span class="blk-code">{AIRCRAFT[s.typeIdx].icaoType}</span>}
      </button>
    );
  };

  const picked = mine.find((s) => s.id === pick) ?? null;
  const renewable = picked !== null && picked.endDay - b.day <= MARKET.series.renewalWeeks * 7;
  return (
    <Sheet title={t('slots.title')} testId="sheet-slots">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <div style="display:flex;gap:4px" role="tablist">
          {DAYS.map((d) => (
            <button key={d} data-testid={`day-${d}`} aria-pressed={d === shown} onClick={() => setDay(d)} style={d === today ? 'font-weight:700' : ''}>
              {tDynamic(`day.${d}`)}
            </button>
          ))}
        </div>
        <label class="switch" title={t('stands.autoTip')}>
          <input data-testid="auto-plan" type="checkbox" checked={b.autoStands} onChange={(e) => send({ type: 'setAutoStands', on: (e.target as HTMLInputElement).checked })} />
          <span>{t('stands.auto')}</span>
        </label>
        <span style="color:var(--muted);font-size:12px">{t('slots.help')}</span>
      </div>
      {signed.size === 0 && <div>{t('slots.noAirline')}</div>}
      {signed.size > 0 && af.stands.length === 0 && <div>{t('slots.noStand')}</div>}
      {picked && (
        <div class="panel" data-testid="series-menu" style="padding:8px 10px;margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px">
          <b>
            {nameOf(picked)} {dest(picked)}
          </b>
          <span>{formatInt(b.destinations[picked.dest]?.km ?? 0)} km</span>
          <span>
            {t('slots.days')}: {daysText(picked.days)}
          </span>
          <span>{tFormat('slots.window', { from: clock(picked.winMin), to: clock((picked.winMin + WINDOW_MIN) % DAY_MIN) })}</span>
          <span>{tFormat('slots.until', { day: picked.endDay })}</span>
          {picked.minute >= 0 && <button onClick={() => send({ type: 'unplaceSeries', seriesId: picked.id })}>{t('slots.unplace')}</button>}
          {renewable && <button onClick={() => send({ type: 'renewSeries', seriesId: picked.id })}>{t('slots.renew')}</button>}
          <button
            data-testid="series-cancel"
            onClick={() => {
              send({ type: 'cancelSeries', seriesId: picked.id });
              setPick(null);
            }}
          >
            {t('slots.cancel')}
          </button>
          <button onClick={() => setPick(null)}>{t('sheet.close')}</button>
        </div>
      )}
      {unplaced.length > 0 && (
        <div data-testid="lane-unplaced" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
          <b style="font-size:12px">{t('slots.unplaced')}</b>
          {unplaced.map((s) => (
            <button
              key={s.id}
              class="blk"
              data-testid={`series-${s.id}`}
              aria-pressed={pick === s.id}
              title={`${t('slots.days')}: ${daysText(s.days)}`}
              style={`position:relative;--h:${airlineHue(b.airlines[s.airline]?.name ?? '')}`}
              onPointerDown={(e) => onDown(e, s)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onClick={() => {
                if (justDragged.current) {
                  justDragged.current = false;
                  return;
                }
                setPick(pick === s.id ? null : s.id);
              }}
            >
              <span class="blk-code">
                {AIRCRAFT[s.typeIdx].icaoType} {dest(s)} {clock(s.winMin)}
              </span>
            </button>
          ))}
        </div>
      )}
      <div class="tl-wrap" style={`--hour-px:${HOUR_PX}px`}>
        <div class="tl" style={`min-width:${gridW + 250}px`}>
          <div class="tl-head">
            <div class="tl-label">{t('stands.stand')}</div>
            <div class="tl-grid" style={`width:${gridW}px`}>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} class="tl-hour" style={`width:${HOUR_PX}px`}>
                  {String(h).padStart(2, '0')}
                </div>
              ))}
            </div>
          </div>
          {af.stands.map((st) => {
            const here = mine.filter((s) => s.standId === st.id && s.minute >= 0);
            const todays = here.filter((s) => operatesOn(s.days, shown));
            // Blocks of the day before that run past midnight show their tail at the start of the row.
            const tails = here.filter((s) => operatesOn(s.days, (shown + 6) % 7) && s.minute + blockMin(s.turnMin) > DAY_MIN);
            const load = DAYS.map((d) => here.filter((s) => operatesOn(s.days, d)).reduce((n, s) => n + blockMin(s.turnMin), 0) / DAY_MIN);
            const ghost = drop?.row === st.id ? drop : null;
            const len = dragRef.current ? blockMin(dragRef.current.series.turnMin) : 0;
            return (
              <div key={st.id} class="tl-row" data-testid={`plan-row-${st.id}`} data-row={st.id}>
                <div class="tl-label">
                  <b>
                    {t('stands.stand')} {st.number}
                  </b>
                  <span class="sub">
                    {st.code}, {tDynamic(`standType.${st.type}`)}
                  </span>
                  <span title={t('slots.week')} style="display:flex;gap:2px;margin-top:3px">
                    {load.map((f, d) => (
                      <span key={d} title={tDynamic(`day.${d}`)} style={`width:10px;height:10px;border-radius:2px;border:1px solid var(--line);background:color-mix(in srgb, var(--accent) ${Math.round(Math.min(1, f) * 100)}%, transparent)`} />
                    ))}
                  </span>
                </div>
                <div class={`tl-grid${st.closed === true ? ' closed' : ''}`} data-drop={ghost ? (ghost.fault === null ? 'ok' : 'bad') : undefined} style={`width:${gridW}px;height:${ROW_PX + 8}px`}>
                  {tails.map((s) => block(s, 0, s.minute + blockMin(s.turnMin) - DAY_MIN, true))}
                  {todays.map((s) => block(s, s.minute, Math.min(blockMin(s.turnMin), DAY_MIN - s.minute), false))}
                  {ghost && (
                    <div
                      data-testid={ghost.fault === null ? 'drop-ok' : 'drop-bad'}
                      title={ghost.fault === null ? clock(ghost.minute) : faultText(ghost.fault)}
                      style={`position:absolute;top:4px;height:28px;left:${(ghost.minute / 60) * HOUR_PX}px;width:${(len / 60) * HOUR_PX}px;border-radius:8px;border:2px dashed ${ghost.fault === null ? 'var(--accent)' : 'var(--bad)'};pointer-events:none;z-index:3`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}
