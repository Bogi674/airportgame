import { create } from 'zustand';
import type { PerfReport } from '@shared/protocol';
import type { Speed } from '@shared/time';

interface GameState extends PerfReport {
  tick: number;
  speed: Speed;
  error: string | null;
  setPerf(report: PerfReport, tick: number): void;
  setSpeed(speed: Speed): void;
  setError(message: string | null): void;
}

/** UI state only. The sim owns game state (hard rule: Zustand for UI state only). */
export const useGameStore = create<GameState>((set) => ({
  tick: 0,
  speed: 1,
  error: null,
  simMsPerTick: 0,
  tickBacklog: 0,
  aircraftCount: 0,
  setPerf: (report, tick) => set({ ...report, tick }),
  setSpeed: (speed) => set({ speed }),
  setError: (error) => set({ error }),
}));
