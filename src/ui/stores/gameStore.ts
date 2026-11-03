import { create } from 'zustand';
import type { PerfReport } from '@shared/protocol';
import type { AirfieldPayload } from '@shared/airfield';
import { EMPTY_AIRFIELD } from '@shared/airfield';
import type { SitePayload } from '@shared/site';
import type { Speed } from '@shared/time';

interface GameState extends PerfReport {
  tick: number;
  speed: Speed;
  error: string | null;
  site: SitePayload | null;
  owner: Uint8Array | null;
  cash: number;
  selectedParcel: number;
  parcelOverlay: boolean;
  notice: { code: string; args: Record<string, string> } | null;
  airfield: AirfieldPayload;
  canUndo: boolean;
  canRedo: boolean;
  setPerf(report: PerfReport, tick: number): void;
  setSpeed(speed: Speed): void;
  setError(message: string | null): void;
  setSite(site: SitePayload): void;
  setOwnership(owner: Uint8Array, cash: number): void;
  selectParcel(id: number): void;
  toggleParcelOverlay(): void;
  setNotice(code: string | null): void;
  setAirfield(airfield: AirfieldPayload, canUndo: boolean, canRedo: boolean): void;
}

/** UI state only. The sim owns game state (hard rule: Zustand for UI state only). */
export const useGameStore = create<GameState>((set) => ({
  tick: 0,
  speed: 1,
  error: null,
  site: null,
  owner: null,
  cash: 0,
  selectedParcel: -1,
  parcelOverlay: false,
  notice: null,
  airfield: EMPTY_AIRFIELD,
  canUndo: false,
  canRedo: false,
  simMsPerTick: 0,
  tickBacklog: 0,
  aircraftCount: 0,
  setPerf: (report, tick) => set({ ...report, tick }),
  setSpeed: (speed) => set({ speed }),
  setError: (error) => set({ error }),
  setSite: (site) => set({ site, owner: null, selectedParcel: -1, notice: null, airfield: EMPTY_AIRFIELD, canUndo: false, canRedo: false }),
  setOwnership: (owner, cash) => set({ owner, cash }),
  selectParcel: (selectedParcel) => set({ selectedParcel }),
  toggleParcelOverlay: () => set((s) => ({ parcelOverlay: !s.parcelOverlay })),
  setNotice: (code) => {
    if (code === null) {
      set({ notice: null });
      return;
    }
    // Events look like `code|key=value|key=value`.
    const parts = code.split('|');
    const args: Record<string, string> = {};
    for (let i = 1; i < parts.length; i++) {
      const eq = parts[i].indexOf('=');
      if (eq > 0) args[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
    }
    set({ notice: { code: parts[0], args } });
  },
  setAirfield: (airfield, canUndo, canRedo) => set({ airfield, canUndo, canRedo }),
}));
