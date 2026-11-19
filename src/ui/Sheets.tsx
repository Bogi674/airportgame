import { AIRCRAFT } from '@data/aircraft';
import { BUSINESS, GSE } from '@data/index';
import { causeOwner, isVehicleCause, VEHICLE_CAUSE } from '@shared/turnaround';
import { LEDGER_CATEGORIES } from '@shared/business';
import type { Command } from '@sim/commands';
import { useEffect, useRef, useState } from 'preact/hooks';
import { GA_LABEL, type BoardRow, type BusinessPayload } from '@shared/business';
import { AirlinesSheet, PlannerSheet } from './Planner';
import type { Stand } from '@shared/airfield';
import { blockWindow, blocksOverlap, refuseBlock, type BlockWindow, type PlacedBlock, type StandRefusal } from '@shared/flightBlock';
import { standRefusalAt } from './standRule';
import { AcceptToggles } from './AcceptToggles';
import { Icon } from './icons';
import { compassName, formatInt, formatMoney, formatNumber } from './format';
import { useGameStore } from './stores/gameStore';
import { noticeText, t, tDynamic, tFormat, type StringKey } from './strings';

interface Props {
  send(cmd: Command): void;
}

const TABS = ['airlines', 'slots', 'stands', 'flights', 'finance', 'site'] as const;

export function Sheet({ title, children, testId }: { title: string; children: preact.ComponentChildren; testId: string }) {
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
      {b.paxDay.length > 0 && (
        <div data-testid="pax-satisfaction" style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px;font-size:12px">
          <span>
            {tFormat('finance.paxSat', {
              sat: formatNumber(b.paxDay[0]!),
              queue: formatNumber(b.paxDay[1]!),
              walk: formatNumber(b.paxDay[2]!),
              unmet: formatNumber(b.paxDay[3]!),
              missed: formatNumber(b.paxDay[4]!),
            })}
          </span>
          <span>
            {tFormat('finance.paxVisits', {
              hunger: formatNumber(b.paxDay[5]!),
              thirst: formatNumber(b.paxDay[6]!),
              toilet: formatNumber(b.paxDay[7]!),
              rest: formatNumber(b.paxDay[8]!),
              shop: formatNumber(b.paxDay[9]!),
              spend: formatMoney(b.paxDay[10]!),
            })}
          </span>
        </div>
      )}
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

export const clock = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const HOUR_PX = 72;
/** A block shows its aircraft code only when it is this wide in pixels: the code is 32 px, plus 6 px padding and 2 px border. */
const LABEL_MIN_PX = 40;

export function airlineHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** Pointer travel in pixels before a press on a block becomes a drag, so a plain click still selects. */
export const DRAG_START_PX = 4;
/** Smallest hit area of a block in pixels, so a short turn stays easy to grab. */
const MIN_HIT_PX = 24;
export const ROW_PX = 34;

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
  const refusal = standRefusalAt(b, i, stands[i], AIRCRAFT[r.typeIdx], r.airline === GA_LABEL ? 'ga' : 'commercial');
  if (refusal !== null) return { code: refusal, flight: -1 };
  const others: PlacedBlock[] = spans.filter((o) => o.standId === standId && o.flight !== r.flight).map((o) => ({ flight: o.flight, window: { startMin: o.startMin, endMin: o.endMin } }));
  const clash = refuseBlock(blockWindow(r.startMin, r.turnMin), others, r.flight);
  return clash === null ? null : { code: clash.code, flight: clash.flight };
}

const faultText = (f: RowFault): string => (f.code === 'standBusy' ? tFormat('stands.conflict', { flight: f.flight }) : noticeText(f.code, {}));

/** The row element under a pointer, its stand id (-1 for unassigned) and its top edge. */
export function rowUnder(e: PointerEvent): { id: number; top: number } | null {
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
  const timelineRef = useRef<HTMLDivElement>(null);
  const scrolledToNow = useRef(false);
  const showNotice = useGameStore((s) => s.showNotice);
  // Unmounting mid drag must not leave a key listener or a captured pointer behind.
  useEffect(
    () => () => {
      const d = dragRef.current;
      if (d !== null) releaseDrag(dragRef, d);
    },
    [],
  );
  // Open the timeline one hour before the present, once, so the player's own scrolling is kept after that.
  useEffect(() => {
    const el = timelineRef.current;
    if (!el || !b || scrolledToNow.current) return;
    scrolledToNow.current = true;
    el.scrollLeft = Math.max(0, (b.minuteOfDay / 60 - 1) * HOUR_PX);
  });
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
    const title = shown !== null ? faultText(shown) : `${r.airline} ${r.type}, ${clock(w.startMin)} to ${clock(w.endMin)}`;
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
          {drawn >= LABEL_MIN_PX && <span class="blk-code">{r.type}</span>}
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
      <div ref={timelineRef} class="tl-wrap" style={`--hour-px:${HOUR_PX}px`}>
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
                    <AcceptToggles stand={s} send={send} />
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
              <th>{t('flights.delay')}</th>
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
                <td data-testid="flight-delay">{delayText(r.cause)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Sheet>
  );
}

/** The delay cause of a flight with its owner, such as "Waiting for the belt loader (airport)", or nothing (T63). */
export function delayText(cause: number): string {
  const owner = causeOwner(cause);
  if (owner === null) return '';
  const what = isVehicleCause(cause) ? tFormat('delay.vehicle', { vehicle: (GSE[cause - VEHICLE_CAUSE]?.name ?? '').toLowerCase() }) : tDynamic(`delay.${cause}`);
  return tFormat('delay.withOwner', { what, owner: t(owner === 'airline' ? 'delay.owner.airline' : 'delay.owner.airport') });
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
  if (sheet === 'slots') return <PlannerSheet send={send} />;
  if (sheet === 'stands') return <StandsSheet send={send} />;
  if (sheet === 'finance') return <FinanceSheet send={send} />;
  if (sheet === 'flights') return <FlightsSheet />;
  if (sheet === 'site') return <SiteSheet />;
  return null;
}

