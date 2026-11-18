/**
 * Why a turnaround runs past its planned time (T63). A vehicle cause is VEHICLE_CAUSE plus the vehicle kind;
 * the other causes are fixed codes. The sim stores the code per flight, the UI names it and its owner.
 */
export const VEHICLE_CAUSE = 1;
/** Vehicle kinds stay below this, so vehicle causes never reach the fixed codes. */
const VEHICLE_CAUSE_END = 40;
export const CAUSE_CREW_LEAVING = 40;
export const CAUSE_FUEL = 41;
export const CAUSE_BOARDING = 42;
export const CAUSE_ATC = 43;

/** True when the cause is a vehicle that was not docked when its task could start. */
export function isVehicleCause(code: number): boolean {
  return code >= VEHICLE_CAUSE && code < VEHICLE_CAUSE_END;
}

/** Who answers for a delay: the airline only for passengers late to the gate (user, 2026-11-18), the airport for the rest. */
export function causeOwner(code: number): 'airport' | 'airline' | null {
  if (code === 0) return null;
  return code === CAUSE_BOARDING ? 'airline' : 'airport';
}
