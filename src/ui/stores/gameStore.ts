import { create } from 'zustand';
import type { AirfieldPayload } from '@shared/airfield';
import { EMPTY_AIRFIELD } from '@shared/airfield';
import type { BusinessPayload, TerminalGrid } from '@shared/business';
import type { PerfReport } from '@shared/protocol';
import type { Preset, SitePayload } from '@shared/site';
import type { Speed } from '@shared/time';

export type Sheet = 'airlines' | 'finance' | 'flights' | 'site' | null;
export interface Alert {
  id: number;
  text: string;
  tone: 'info' | 'warn';
}

interface GameState extends PerfReport {
  screen: 'menu' | 'game';
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
  business: BusinessPayload | null;
  terminalGrids: TerminalGrid[];
  sheet: Sheet;
  alerts: Alert[];
  pauseOpen: boolean;
  guideHidden: boolean;
  game: { seed: string; preset: Preset };
  setScreen(screen: 'menu' | 'game'): void;
  setPerf(report: PerfReport, tick: number): void;
  setSpeed(speed: Speed): void;
  setError(message: string | null): void;
  setSite(site: SitePayload): void;
  setOwnership(owner: Uint8Array, cash: number): void;
  selectParcel(id: number): void;
  toggleParcelOverlay(): void;
  setNotice(code: string | null): void;
  setAirfield(airfield: AirfieldPayload, canUndo: boolean, canRedo: boolean): void;
  setBusiness(b: BusinessPayload): void;
  setTerminalGrids(g: TerminalGrid[]): void;
  setSheet(sheet: Sheet): void;
  pushAlert(text: string, tone?: 'info' | 'warn'): void;
  dismissAlert(id: number): void;
  setPauseOpen(open: boolean): void;
  setGuideHidden(hidden: boolean): void;
  setGame(seed: string, preset: Preset): void;
}

let alertId = 1;

/** UI state only. The sim owns game state (hard rule: Zustand for UI state only). */
export const useGameStore = create<GameState>((set) => ({
  screen: 'menu',
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
  business: null,
  terminalGrids: [],
  sheet: null,
  alerts: [],
  pauseOpen: false,
  guideHidden: false,
  game: { seed: 'GOLDEN-0001', preset: 'flatCoastal' },
  simMsPerTick: 0,
  tickBacklog: 0,
  aircraftCount: 0,
  setScreen: (screen) => set({ screen }),
  setPerf: (report, tick) => set({ ...report, tick }),
  setSpeed: (speed) => set({ speed }),
  setError: (error) => set({ error }),
  setSite: (site) => set({ site, owner: null, selectedParcel: -1, notice: null, airfield: EMPTY_AIRFIELD, canUndo: false, canRedo: false, business: null, terminalGrids: [], alerts: [], sheet: null }),
  setOwnership: (owner, cash) =>
    set((s) => {
      // Cash changes with every fee. Keep the old array when ownership did not change, so nothing re-bakes.
      const old = s.owner;
      if (old && old.length === owner.length) {
        let same = true;
        for (let i = 0; i < owner.length; i++) {
          if (old[i] !== owner[i]) {
            same = false;
            break;
          }
        }
        if (same) return { cash };
      }
      return { owner, cash };
    }),
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
  setBusiness: (business) => set({ business }),
  setTerminalGrids: (terminalGrids) => set({ terminalGrids }),
  setSheet: (sheet) => set({ sheet }),
  pushAlert: (text, tone = 'info') => set((s) => ({ alerts: [...s.alerts.slice(-19), { id: alertId++, text, tone }] })),
  dismissAlert: (id) => set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),
  setPauseOpen: (pauseOpen) => set({ pauseOpen }),
  setGuideHidden: (guideHidden) => set({ guideHidden }),
  setGame: (seed, preset) => set({ game: { seed, preset } }),
}));
