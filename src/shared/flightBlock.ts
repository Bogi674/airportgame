import type { AircraftSpec } from '@data/aircraft';
import { acceptBit, type CodeLetter, type FlightCategory, type Stand, type StandSize, type StandType, type Surface } from './airfield';
import { standRefusal } from './standSizes';

/**
 * Stand block rule for flights (task T41 R8). A stand is blocked from
 * the arrival until the turn is over, and two blocks on one stand may not overlap.
 */

/**
 * The gap Traffic.autoAssign keeps between two flights on one stand, in game minutes. Taxi in and push back are
 * physical and take longer on the calendar than they used to, so the buffer covers them.
 */
export const STAND_BLOCK_BUFFER_MIN = 30;

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
  /** Flight categories the stand takes, as accepts bits. */
  accepts: number;
  size: StandSize;
  surface: Surface;
  type: StandType;
  code: CodeLetter;
  /** True when the stand has a taxi node the aircraft can route to. */
  linked: boolean;
  /** Terminal reach check. Only called for contact stands, and only after span and surface pass, so a hook is not queried needlessly. */
  contactOk: () => boolean;
}

/** Reads the refusal facts of a stand. Closed defaults to false. */
export function standFacts(st: Stand, linked: boolean, contactOk: () => boolean): StandFacts {
  return {
    closed: st.closed === true,
    accepts: st.accepts,
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

/** Span and surface, then contact, for the physical fit of an aircraft type on a stand. Closed state and accepted categories are not part of it. */
export function refuseFit(f: StandFacts, spec: AircraftSpec): 'standSpan' | 'standSurfaceType' | 'standNoTerminal' | null {
  return refuseSpanSurface(f, spec) ?? refuseContact(f);
}

/** Category refusal: the stand must take the flight's category (user, 2026-11-17). */
export function refuseUsage(accepts: number, cat: FlightCategory): 'standUsage' | null {
  return (accepts & acceptBit(cat)) === 0 ? 'standUsage' : null;
}

/** The first reason a stand refuses this aircraft type for a flight of a category, or null when the stand takes it. */
export function refuseStand(f: StandFacts, spec: AircraftSpec, cat: FlightCategory): StandRefusal | null {
  if (f.closed) return 'standClosed';
  const fit = refuseSpanSurface(f, spec);
  if (fit !== null) return fit;
  const usage = refuseUsage(f.accepts, cat);
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
