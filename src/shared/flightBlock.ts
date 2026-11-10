import type { AircraftSpec } from '@data/aircraft';
import type { CodeLetter, Stand, StandSize, StandType, Surface } from './airfield';
import { standRefusal } from './standSizes';

/**
 * Stand block rule for flights (handoff/tasks/T41-flight-schedule.md R8). A stand is blocked from
 * the arrival until the turn is over, and two blocks on one stand may not overlap.
 */

/** The 3000 tick gap Traffic.autoAssign keeps between two flights on one stand (5 game minutes). */
export const STAND_BLOCK_BUFFER_MIN = 5;

/** A stand block in game minutes, from arrival to the end of the turn plus the buffer. */
export interface BlockWindow {
  startMin: number;
  endMin: number;
}

/** The block a flight holds on its stand, given its arrival minute and turn length in minutes. */
export function blockWindow(arrMin: number, turnMin: number): BlockWindow {
  return { startMin: arrMin, endMin: arrMin + turnMin + STAND_BLOCK_BUFFER_MIN };
}

/** True when two half open block windows share any time. Windows that only touch do not overlap. */
export function blocksOverlap(a: BlockWindow, b: BlockWindow): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/** Why a flight cannot use a stand, named as the refusal code shown to the player. */
export type StandRefusal = 'standSpan' | 'standSurfaceType' | 'standClosed' | 'standUsage' | 'standNoTerminal' | 'standNoLink' | 'standBusy';

/** The stand properties the refusal rule reads, gathered once per stand. */
export interface StandFacts {
  closed: boolean;
  usage: 'any' | 'commercial' | 'ga';
  size: StandSize;
  surface: Surface;
  type: StandType;
  code: CodeLetter;
  /** True when the stand has a taxi node the aircraft can route to. */
  linked: boolean;
  /** Terminal reach check. Only called for contact stands, and only after span and surface pass, so a hook is not queried needlessly. */
  contactOk: () => boolean;
}

/** Reads the refusal facts of a stand. Closed defaults to false and usage defaults to any. */
export function standFacts(st: Stand, linked: boolean, contactOk: () => boolean): StandFacts {
  return {
    closed: st.closed === true,
    usage: st.usage ?? 'any',
    size: st.size,
    surface: st.surface,
    type: st.type,
    code: st.code,
    linked,
    contactOk,
  };
}

/** Wingspan within the stand size, then the stand surface on the type's list. */
function refuseSpanSurface(f: Pick<StandFacts, 'size' | 'surface'>, spec: AircraftSpec): 'standSpan' | 'standSurfaceType' | null {
  const r = standRefusal(f, spec);
  if (r === 'span') return 'standSpan';
  if (r === 'surface') return 'standSurfaceType';
  return null;
}

/** Contact stands need terminal reach. */
function refuseContact(f: StandFacts): 'standNoTerminal' | null {
  return f.type === 'contact' && !f.contactOk() ? 'standNoTerminal' : null;
}

/** Span and surface, then contact, for the physical fit of an aircraft type on a stand. Closed state and usage are not part of it. */
export function refuseFit(f: StandFacts, spec: AircraftSpec): 'standSpan' | 'standSurfaceType' | 'standNoTerminal' | null {
  return refuseSpanSurface(f, spec) ?? refuseContact(f);
}

/** Usage refusal: a ga only stand takes small types and a commercial only stand takes larger ones. */
export function refuseUsage(usage: 'any' | 'commercial' | 'ga', spec: AircraftSpec): 'standUsage' | null {
  const ga = spec.capacity.seatsTypical < 20;
  return (usage === 'ga' && !ga) || (usage === 'commercial' && ga) ? 'standUsage' : null;
}

/** The first reason a stand refuses this aircraft type for a flight, or null when the stand takes it. */
export function refuseStand(f: StandFacts, spec: AircraftSpec): StandRefusal | null {
  if (f.closed) return 'standClosed';
  const fit = refuseSpanSurface(f, spec);
  if (fit !== null) return fit;
  const usage = refuseUsage(f.usage, spec);
  if (usage !== null) return usage;
  const contact = refuseContact(f);
  if (contact !== null) return contact;
  if (!f.linked) return 'standNoLink';
  return null;
}

/** A flight holding a block on a stand. */
export interface PlacedBlock {
  flight: number;
  window: BlockWindow;
}

/** The first other flight whose block overlaps the window, or null. The flight named by self is ignored. */
export function refuseBlock(w: BlockWindow, others: readonly PlacedBlock[], self = -1): { code: 'standBusy'; flight: number } | null {
  for (const o of others) {
    if (o.flight !== self && blocksOverlap(w, o.window)) return { code: 'standBusy', flight: o.flight };
  }
  return null;
}
