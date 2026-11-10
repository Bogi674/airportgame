import { AIRCRAFT } from '@data/aircraft';
import { BUSINESS } from '@data/index';
import { LEDGER_CATEGORIES, type FeeLevel } from '@shared/business';
import type { Command } from '@sim/commands';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { BoardRow, BusinessPayload, OfferRow } from '@shared/business';
import type { Stand } from '@shared/airfield';
import { blockWindow, blocksOverlap, refuseBlock, type BlockWindow, type PlacedBlock, type StandRefusal } from '@shared/flightBlock';
import { standRefusalAt } from './standRule';
import { Icon } from './icons';
import { compassName, formatInt, formatMoney, formatNumber } from './format';
import { useGameStore } from './stores/gameStore';
import { noticeText, t, tDynamic, tFormat, type StringKey } from './strings';

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
/** Grid columns of an offer row: type, arrival, turnaround, stage and the stand select. */
const OFFER_COLS = 'display:grid;grid-template-columns:70px 64px 90px 90px 1fr;gap:8px;align-items:center;font-size:12px';

/** The refusal of the first stand when every stand refuses the offer's aircraft, otherwise null. */
function allStandsRefuse(o: OfferRow, b: BusinessPayload, stands: Stand[]): StandRefusal | null {
  let first: StandRefusal | null = null;
  for (let i = 0; i < stands.length; i++) {
    const r = standRefusalAt(b, i, stands[i], AIRCRAFT[o.typeIdx]);
    if (r === null) return null;
    if (first === null) first = r;
  }
  return first;
}

/** The reason the offers list is empty, or null when it has rows. */
function offersEmptyKey(b: BusinessPayload, runways: number, stands: number): StringKey | null {
  if (b.airlines.every((a) => a.rotations <= 0)) return 'slots.noAirline';
  if (runways === 0) return 'slots.noRunway';
  if (stands === 0) return 'slots.noStand';
  if (b.offers.length === 0) return 'slots.noOffers';
  return null;
}

/**
 * Flight offers: every signed airline offers its scheduled flights for the day. A stand select per row
 * assigns the stand. The load bar counts landings and takeoffs per hour against the tower budget. No time is editable.
 */
function SlotsSheet({ send }: Props) {
  const b = useGameStore((s) => s.business);
  const af = useGameStore((s) => s.airfield);
  if (!b) return null;
  const signed = b.airlines.filter((a) => a.rotations > 0);
  const perHour = new Array<number>(24).fill(0);
  for (const o of b.offers) {
    perHour[Math.floor(o.arrMin / 60) % 24]++;
    perHour[Math.floor((o.arrMin + o.turnMin) / 60) % 24]++;
  }
  const peak = Math.max(1, ...perHour);
  const emptyKey = offersEmptyKey(b, af.runways.length, af.stands.length);
  return (
    <Sheet title={t('slots.title')} testId="sheet-slots">
      <div style="color:var(--muted);font-size:12px;margin-bottom:8px">{tFormat('slots.help', { cap: b.movementBudget })}</div>
      <div class="section">{tFormat('slots.load', { cap: b.movementBudget })}</div>
      <div style="display:grid;grid-template-columns:repeat(24,1fr);gap:3px;align-items:end;height:64px;margin-bottom:12px" data-testid="slot-load">
        {perHour.map((n, h) => (
          <div key={h} title={`${String(h).padStart(2, '0')}:00, ${n}`} style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;font-size:10px;color:var(--muted)">
            <div style={`width:100%;height:${Math.round((n / peak) * 40)}px;background:${n > b.movementBudget ? 'var(--bad)' : 'var(--accent)'};border-radius:2px`} />
            {String(h).padStart(2, '0')}
          </div>
        ))}
      </div>
      {emptyKey !== null && <div>{t(emptyKey)}</div>}
      {emptyKey === null && (
        <div style="display:grid;gap:8px">
          {signed.map((a) => {
            const rows = b.offers.filter((o) => o.airline === a.id);
            if (rows.length === 0) return null;
            return (
              <div key={a.id} data-testid={`slots-${a.id}`} style="padding:8px;border:1px solid var(--line);border-radius:10px">
                <div style="font-weight:600;margin-bottom:6px">{a.name}</div>
                <div style={`${OFFER_COLS};color:var(--muted);margin-bottom:4px`}>
                  <span>{t('slots.type')}</span>
                  <span>{t('slots.arrival')}</span>
                  <span>{t('slots.turnaround')}</span>
                  <span>{t('slots.stage')}</span>
                  <span>{t('slots.stand')}</span>
                </div>
                {rows.map((o) => {
                  const bad = allStandsRefuse(o, b, af.stands);
                  return (
                    <div key={o.flight} data-testid={`offer-row-${o.flight}`} style="margin-bottom:4px">
                      <div style={OFFER_COLS}>
                        <span>{o.type}</span>
                        <span>{clock(o.arrMin)}</span>
                        <span>{o.turnMin} min</span>
                        <span>{formatInt(o.stageKm)} km</span>
                        <select
                          data-testid={`offer-stand-${o.flight}`}
                          style="min-width:0"
                          value={o.standId}
                          onChange={(e) => send({ type: 'assignStand', flight: o.flight, standId: Number((e.target as HTMLSelectElement).value) })}
                        >
                          <option value={-1}>{t('slots.auto')}</option>
                          {af.stands.map((st, i) => (
                            <option key={st.id} value={st.id} disabled={st.id !== o.standId && standRefusalAt(b, i, st, AIRCRAFT[o.typeIdx]) !== null}>
                              {st.number}
                            </option>
                          ))}
                        </select>
                      </div>
                      {bad !== null && (
                        <div data-testid={`offer-bad-${o.flight}`} style="color:var(--bad);font-size:12px">
                          {noticeText(bad, {})}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

const HOUR_PX = 44;

function airlineHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** Pointer travel in pixels before a press on a block becomes a drag, so a plain click still selects. */
const DRAG_START_PX = 4;
/** Smallest hit area of a block in pixels, so a short turn stays easy to grab. */
const MIN_HIT_PX = 24;
const ROW_PX = 34;

type FaultCode = StandRefusal | 'standBusy';

/** Why a flight cannot hold a stand row: the stand rule first, then a clash with another block on that row. */
interface RowFault {
  code: FaultCode;
  /** The flight whose block clashes, -1 when the stand itself refuses. */
  flight: number;
}

interface DragState {
  pointerId: number;
  row: BoardRow;
  el: HTMLElement;
  startX: number;
  startY: number;
  /** Top of the block before any transform, in client pixels. */
  baseTop: number;
  started: boolean;
  /** Stand id under the pointer, -1 for the unassigned lane, null for none. */
  target: number | null;
  onKey: (e: KeyboardEvent) => void;
}

interface DropState {
  flight: number;
  row: number;
  fault: RowFault | null;
}

/** A block as the stand rule sees it: absolute game minutes and the flight that holds it. */
interface Span {
  flight: number;
  standId: number;
  startMin: number;
  endMin: number;
}

/** Four numbers per block from the payload, see BusinessPayload.standBlocks. */
function decodeStandBlocks(list: number[]): Span[] {
  const out: Span[] = [];
  for (let i = 0; i + 3 < list.length; i += 4) out.push({ standId: list[i], flight: list[i + 1], startMin: list[i + 2], endMin: list[i + 3] });
  return out;
}

/** Where a block is drawn: minute of the day from arrival and the nominal turnaround. */
const drawWindow = (r: BoardRow): BlockWindow => blockWindow(r.eta, r.turnMin);

/** Clears the DOM and the listeners of a drag. It reads refs and the element only, so it is safe during unmount. */
function releaseDrag(ref: { current: DragState | null }, d: DragState): void {
  d.el.style.transform = '';
  d.el.style.pointerEvents = '';
  if (d.el.hasPointerCapture(d.pointerId)) d.el.releasePointerCapture(d.pointerId);
  window.removeEventListener('keydown', d.onKey);
  ref.current = null;
}

/** Lane packing: each block takes the first lane where no other block overlaps its window. */
function packLanes(list: BoardRow[]): { r: BoardRow; lane: number }[] {
  const lanes: BlockWindow[][] = [];
  return list
    .slice()
    .sort((p, q) => p.eta - q.eta || p.flight - q.flight)
    .map((r) => {
      const w = drawWindow(r);
      let lane = lanes.findIndex((ws) => ws.every((o) => !blocksOverlap(o, w)));
      if (lane < 0) {
        lane = lanes.length;
        lanes.push([]);
      }
      lanes[lane].push(w);
      return { r, lane };
    });
}

/** The fault of one flight on a stand: the stand rule, then a clash with another flight's block. Null when it may hold the stand. */
function rowFault(b: BusinessPayload, stands: Stand[], standId: number, r: BoardRow, spans: Span[]): RowFault | null {
  const i = stands.findIndex((s) => s.id === standId);
  if (i < 0) return { code: 'standNoLink', flight: -1 };
  const refusal = standRefusalAt(b, i, stands[i], AIRCRAFT[r.typeIdx]);
  if (refusal !== null) return { code: refusal, flight: -1 };
  const others: PlacedBlock[] = spans.filter((o) => o.standId === standId && o.flight !== r.flight).map((o) => ({ flight: o.flight, window: { startMin: o.startMin, endMin: o.endMin } }));
  const clash = refuseBlock(blockWindow(r.startMin, r.turnMin), others, r.flight);
  return clash === null ? null : { code: clash.code, flight: clash.flight };
}

const faultText = (f: RowFault): string => (f.code === 'standBusy' ? tFormat('stands.conflict', { flight: f.flight }) : noticeText(f.code, {}));

/** The row element under a pointer, its stand id (-1 for unassigned) and its top edge. */
function rowUnder(e: PointerEvent): { id: number; top: number } | null {
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-row]');
  if (!el) return null;
  return { id: Number(el.dataset.row), top: el.getBoundingClientRect().top };
}

/**
 * Stand management: a day timeline per stand. Blocks are the true stay of each flight, red when a stand
 * refuses it or another block sits on the same stand. Drag a block onto a stand row with the pointer, or
 * click it and pick a stand in the menu. Stands can be opened, closed and limited to commercial or general
 * aviation flights, and the auto scheduler can be switched off.
 */
function StandsSheet({ send }: Props) {
  const b = useGameStore((s) => s.business);
  const af = useGameStore((s) => s.airfield);
  const [pick, setPick] = useState<number | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const [dragFlight, setDragFlight] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const justDragged = useRef(false);
  const showNotice = useGameStore((s) => s.showNotice);
  // Unmounting mid drag must not leave a key listener or a captured pointer behind.
  useEffect(
    () => () => {
      const d = dragRef.current;
      if (d !== null) releaseDrag(dragRef, d);
    },
    [],
  );
  if (!b) return null;
  const rows = b.board.filter((r) => r.flight >= 0);
  const spans = decodeStandBlocks(b.standBlocks);
  const nowMin = b.minuteOfDay;
  const unassigned = rows.filter((r) => r.standId < 0 && r.status === 'scheduled');
  const gridW = 24 * HOUR_PX;

  const endDrag = (d: DragState): void => {
    releaseDrag(dragRef, d);
    setDrop(null);
    setDragFlight(null);
  };

  const onBlockDown = (e: PointerEvent, r: BoardRow): void => {
    if (r.status !== 'scheduled' || e.button !== 0 || dragRef.current !== null) return;
    const el = e.currentTarget as HTMLElement;
    const d: DragState = {
      pointerId: e.pointerId,
      row: r,
      el,
      startX: e.clientX,
      startY: e.clientY,
      baseTop: el.getBoundingClientRect().top,
      started: false,
      target: null,
      onKey: (k: KeyboardEvent) => {
        if (k.key === 'Escape') endDrag(d);
      },
    };
    // Capture at press time, so the pointerup always reaches this block even when the pointer leaves it.
    el.setPointerCapture(e.pointerId);
    justDragged.current = false;
    dragRef.current = d;
    window.addEventListener('keydown', d.onKey);
  };

  const onBlockMove = (e: PointerEvent): void => {
    const d = dragRef.current;
    if (d === null || e.pointerId !== d.pointerId) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_START_PX) return;
      d.started = true;
      justDragged.current = true;
      d.el.style.pointerEvents = 'none';
      setDragFlight(d.row.flight);
    }
    // The block keeps its time and only moves vertically, onto the top of the row under the pointer.
    const under = rowUnder(e);
    d.el.style.transform = `translateY(${under === null ? e.clientY - d.startY : under.top + 4 - d.baseTop}px)`;
    const next = under === null ? null : under.id;
    if (next === d.target) return;
    d.target = next;
    setDrop(next === null ? null : { flight: d.row.flight, row: next, fault: next < 0 ? null : rowFault(b, af.stands, next, d.row, spans) });
  };

  const onBlockUp = (e: PointerEvent): void => {
    const d = dragRef.current;
    if (d === null || e.pointerId !== d.pointerId) return;
    const under = d.started ? rowUnder(e) : null;
    endDrag(d);
    if (under === null) return;
    if (under.id < 0) {
      if (d.row.standId >= 0) send({ type: 'assignStand', flight: d.row.flight, standId: -1 });
      return;
    }
    const fault = rowFault(b, af.stands, under.id, d.row, spans);
    if (fault !== null) {
      showNotice(fault.code);
      return;
    }
    send({ type: 'assignStand', flight: d.row.flight, standId: under.id });
  };

  const onBlockCancel = (e: PointerEvent): void => {
    const d = dragRef.current;
    if (d !== null && e.pointerId === d.pointerId) endDrag(d);
  };

  const dropMark = (id: number): 'ok' | 'bad' | undefined => (drop?.row === id ? (drop.fault === null ? 'ok' : 'bad') : undefined);
  const dropTestId = (id: number): string | undefined => (drop?.row === id ? (drop.fault === null ? 'drop-ok' : 'drop-bad') : undefined);

  const renderBlock = (r: BoardRow, lane: number, fault: RowFault | null) => {
    const w = drawWindow(r);
    const left = (w.startMin / 60) * HOUR_PX;
    const drawn = ((w.endMin - w.startMin) / 60) * HOUR_PX;
    const active = r.status !== 'scheduled';
    const shown = drop?.flight === r.flight ? drop.fault : fault;
    const title = shown !== null ? faultText(shown) : `${r.airline} ${r.type}`;
    return (
      <div
        key={r.flight}
        class="blk-hit"
        data-testid={`offer-${r.flight}`}
        onClick={() => {
          // A click ends a press that was not a drag, and a drag never selects.
          if (active || justDragged.current) {
            justDragged.current = false;
            return;
          }
          setPick(pick === r.flight ? null : r.flight);
        }}
        style={`left:${left}px;top:${4 + lane * ROW_PX}px;width:${Math.max(MIN_HIT_PX, drawn)}px`}
        onPointerDown={(e) => onBlockDown(e, r)}
        onPointerMove={onBlockMove}
        onPointerUp={onBlockUp}
        onPointerCancel={onBlockCancel}
      >
        <button
          class="blk"
          data-testid={`flight-${r.flight}`}
          data-bad={shown !== null ? 'true' : undefined}
          aria-pressed={pick === r.flight}
          disabled={active}
          title={title}
          style={`left:0;top:0;width:${drawn}px;--h:${airlineHue(r.airline)}`}
        >
          <b>{r.airline.split(' ')[0]}</b>
          <span>{r.type}</span>
        </button>
      </div>
    );
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const picked = rows.find((r) => r.flight === pick) ?? null;
  const unLanes = packLanes(unassigned);
  const unH = Math.max(1, ...unLanes.map((x) => x.lane + 1)) * ROW_PX + 8;
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
        {dragFlight !== null && <span style="color:var(--accent);font-size:12px">{t('stands.dragHint')}</span>}
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
          <div class="tl-row" data-testid="lane-unassigned" data-row={-1}>
            <div class="tl-label">
              <b>{t('stands.unassigned')}</b>
              <span class="sub">{unassigned.length}</span>
            </div>
            <div class="tl-grid" data-testid={dropTestId(-1)} data-drop={dropMark(-1)} style={`width:${gridW}px;height:${unH}px`}>
              <div class="tl-now" style={`left:${(nowMin / 60) * HOUR_PX}px`} />
              {unLanes.map((x) => renderBlock(x.r, x.lane, null))}
            </div>
          </div>
          {af.stands.length === 0 && <div style="padding:12px;color:var(--muted)">{t('stands.none')}</div>}
          {af.stands.map((s) => {
            const mine = packLanes(rows.filter((r) => r.standId === s.id));
            const h = Math.max(1, ...mine.map((x) => x.lane + 1)) * ROW_PX + 8;
            return (
              <div key={s.id} class="tl-row" data-testid={`stand-row-${s.id}`} data-row={s.id}>
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
                  data-testid={dropTestId(s.id)}
                  data-drop={dropMark(s.id)}
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
                  {mine.map((x) => renderBlock(x.r, x.lane, rowFault(b, af.stands, s.id, x.r, spans)))}
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
              <th>{t('flights.offBlock')}</th>
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
                <td>{eta(r.offBlockMin)}</td>
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
  if (sheet === 'stands') return <StandsSheet send={send} />;
  if (sheet === 'finance') return <FinanceSheet send={send} />;
  if (sheet === 'flights') return <FlightsSheet />;
  if (sheet === 'site') return <SiteSheet />;
  return null;
}

