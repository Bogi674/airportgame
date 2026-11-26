import { create } from 'zustand';
import type { Command } from '@sim/commands';

/**
 * One demolish act waiting for the player's yes (owner, 2026-11-25): every single, line and area demolish opens the
 * same confirm window with what goes and what it pays back, and only Demolish sends its commands.
 */
export interface DemolishRequest {
  /** What goes, such as "Runway 09/27" or "37 items". */
  what: string;
  /** Extra lines under the name: the removed length, the counts per type, a warning. */
  lines?: string[];
  /** Cash paid back by the sim for this act; 0 shows "No refund". */
  refund: number;
  /** Commands sent in order when the player confirms. */
  commands: Command[];
  /** Runs after the commands are sent, to clear a tool or a selection. */
  after?: () => void;
}

interface DemolishState {
  pending: DemolishRequest | null;
  ask(r: DemolishRequest): void;
  cancel(): void;
}

export const useDemolishStore = create<DemolishState>((set) => ({
  pending: null,
  ask: (pending) => set({ pending }),
  cancel: () => set({ pending: null }),
}));

/** Opens the demolish confirm for a request. Tools and panels call this instead of sending a demolish command. */
export const askDemolish = (r: DemolishRequest): void => useDemolishStore.getState().ask(r);
