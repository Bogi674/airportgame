import { create } from 'zustand';
import type { AirfieldPayload } from '@shared/airfield';
import { EMPTY_AIRFIELD } from '@shared/airfield';
import type { BusinessPayload, TerminalGrid } from '@shared/business';
import type { OverlayData, OverlayKind } from '@shared/overlay';
import type { AirportIdentity, GameMode, PerfReport } from '@shared/protocol';
import { airportFromSeed } from '../airportIdentity';
import type { Preset, SitePayload } from '@shared/site';
import type { Speed } from '@shared/time';

export type Sheet = 'airlines' | 'finance' | 'flights' | 'slots' | 'stands' | 'site' | 'staff' | 'tenants' | null;
export interface Alert {
  id: number;
  text: string;
  tone: 'info' | 'warn';
}

/** Severity groups of the alert center (T36). */
export type AlertSeverity = 'critical' | 'warning' | 'info';

/** One row of the alert center: repeats of the same text merge into it with a count (T36). */
export interface LoggedAlert {
  id: number;
  text: string;
  severity: AlertSeverity;
  count: number;
  /** Game tick of the latest repeat. */
  tick: number;
  /** Number of the stand the alert is about, for the jump to location, or null. */
  stand: string | null;
}

/** Rows the alert center keeps, newest first. */
const ALERT_LOG_MAX = 60;

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
  /** Terminal overlay data from the last publish, null until the UI subscribes and the first minute arrives. */
  overlayData: OverlayData[] | null;
  sheet: Sheet;
  alerts: Alert[];
  /** The alert center log, newest first, its unread count and whether its panel is open (T36). */
  alertLog: LoggedAlert[];
  unread: number;
  alertsOpen: boolean;
  pauseOpen: boolean;
  guideHidden: boolean;
  debugOverlay: boolean;
  walkOverlay: boolean;
  /** The terminal overlay picked, one at a time. */
  overlay: OverlayKind;
  setOverlay(kind: OverlayKind): void;
  /** The overlay list opened by key O or the top bar button. */
  overlayMenuOpen: boolean;
  toggleOverlayMenu(): void;
  closeOverlayMenu(): void;
  quality: 'auto' | 'low' | 'medium' | 'high';
  setQuality(q: 'auto' | 'low' | 'medium' | 'high'): void;
  crash: { message: string; tick: number; seed: string; commands: unknown[] } | null;
  setCrash(c: { message: string; tick: number; seed: string; commands: unknown[] } | null): void;
  toggleDebugOverlay(): void;
  toggleWalkOverlay(): void;
  /** The running game: seed, preset and the options of the new game panel (T35). */
  game: GameInfo;
  setScreen(screen: 'menu' | 'game'): void;
  setPerf(report: PerfReport, tick: number): void;
  setSpeed(speed: Speed): void;
  setError(message: string | null): void;
  setSite(site: SitePayload): void;
  setOwnership(owner: Uint8Array, cash: number): void;
  selectParcel(id: number): void;
  toggleParcelOverlay(): void;
  setNotice(code: string | null): void;
  /** Shows a notice for NOTICE_MS. A newer notice replaces it and restarts the hold. */
  showNotice(code: string): void;
  setAirfield(airfield: AirfieldPayload, canUndo: boolean, canRedo: boolean): void;
  setBusiness(b: BusinessPayload): void;
  setTerminalGrids(g: TerminalGrid[]): void;
  setOverlayData(o: OverlayData[] | null): void;
  setSheet(sheet: Sheet): void;
  pushAlert(text: string, tone?: 'info' | 'warn'): void;
  dismissAlert(id: number): void;
  logAlert(text: string, severity: AlertSeverity, tick: number, stand: string | null): void;
  toggleAlerts(): void;
  clearAlertLog(): void;
  setPauseOpen(open: boolean): void;
  setGuideHidden(hidden: boolean): void;
  setGame(game: GameInfo): void;
}

/** The running game as the UI knows it (T35). */
export interface GameInfo {
  seed: string;
  preset: Preset;
  mode: GameMode;
  airport: AirportIdentity;
}

let alertId = 1;

/** UI state only. The sim owns game state (hard rule: Zustand for UI state only). */
/** How long a notice stays on screen. */
const NOTICE_MS = 4000;
/** The one timer that clears the notice, so an older timer never hides a newer notice. */
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useGameStore = create<GameState>((set, get) => ({
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
  overlayData: null,
  sheet: null,
  alerts: [],
  alertLog: [],
  unread: 0,
  alertsOpen: false,
  pauseOpen: false,
  guideHidden: false,
  debugOverlay: false,
  walkOverlay: false,
  overlay: 'none',
  overlayMenuOpen: false,
  quality: ((): 'auto' | 'low' | 'medium' | 'high' => {
    try {
      const v = localStorage.getItem('airfield.quality');
      return v === 'low' || v === 'medium' || v === 'high' ? v : 'auto';
    } catch {
      return 'auto';
    }
  })(),
  setQuality: (quality) => {
    try {
      localStorage.setItem('airfield.quality', quality);
    } catch {
      /* the choice then lasts for this session */
    }
    set({ quality });
  },
  crash: null,
  setCrash: (crash) => set({ crash }),
  toggleDebugOverlay: () => set((s) => ({ debugOverlay: !s.debugOverlay })),
  toggleWalkOverlay: () => set((s) => ({ walkOverlay: !s.walkOverlay })),
  setOverlay: (overlay) => set({ overlay }),
  toggleOverlayMenu: () => set((s) => ({ overlayMenuOpen: !s.overlayMenuOpen })),
  closeOverlayMenu: () => set({ overlayMenuOpen: false }),
  game: { seed: 'GOLDEN-0001', preset: 'flatCoastal', mode: 'career', airport: airportFromSeed('GOLDEN-0001') },
  simMsPerTick: 0,
  tickBacklog: 0,
  aircraftCount: 0,
  standsFree: 0,
  setScreen: (screen) => set({ screen }),
  setPerf: (report, tick) => set({ ...report, tick }),
  setSpeed: (speed) => set({ speed }),
  setError: (error) => set({ error }),
  setSite: (site) => set({ site, owner: null, selectedParcel: -1, notice: null, airfield: EMPTY_AIRFIELD, canUndo: false, canRedo: false, business: null, terminalGrids: [], alerts: [], alertLog: [], unread: 0, alertsOpen: false, sheet: null }),
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
  toggleParcelOverlay: () => set((s) => ({ parcelOverlay: !s.parcelOverlay, selectedParcel: -1 })),
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
  showNotice: (code) => {
    if (noticeTimer !== undefined) clearTimeout(noticeTimer);
    get().setNotice(code);
    noticeTimer = setTimeout(() => {
      noticeTimer = undefined;
      set({ notice: null });
    }, NOTICE_MS);
  },
  setAirfield: (airfield, canUndo, canRedo) => set({ airfield, canUndo, canRedo }),
  setBusiness: (business) => set({ business }),
  setTerminalGrids: (terminalGrids) => set({ terminalGrids }),
  setOverlayData: (overlayData) => set({ overlayData }),
  setSheet: (sheet) => set({ sheet }),
  pushAlert: (text, tone = 'info') => set((s) => ({ alerts: [...s.alerts.slice(-19), { id: alertId++, text, tone }] })),
  dismissAlert: (id) => set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),
  logAlert: (text, severity, tick, stand) =>
    set((s) => {
      const old = s.alertLog.find((a) => a.text === text);
      const row: LoggedAlert = old ? { ...old, count: old.count + 1, tick } : { id: alertId++, text, severity, count: 1, tick, stand };
      const rest = s.alertLog.filter((a) => a !== old);
      return { alertLog: [row, ...rest].slice(0, ALERT_LOG_MAX), unread: s.alertsOpen ? 0 : s.unread + 1 };
    }),
  toggleAlerts: () => set((s) => ({ alertsOpen: !s.alertsOpen, unread: 0 })),
  clearAlertLog: () => set({ alertLog: [], unread: 0 }),
  setPauseOpen: (pauseOpen) => set({ pauseOpen }),
  setGuideHidden: (guideHidden) => set({ guideHidden }),
  setGame: (game) => set({ game }),
}));
