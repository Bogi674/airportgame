import { create } from 'zustand';
import type { Approach, CodeLetter, StandType, Surface } from '@shared/airfield';
import type { Problem } from '@shared/validate';

export type Tool = 'select' | 'runway' | 'taxiway' | 'taxilane' | 'rapidExit' | 'parallel' | 'apron' | 'stands' | 'gaBlock' | 'terminal' | 'demolish';

export type TerminalSub = 'foundation' | 'floor' | 'wall' | 'door' | 'fixture' | 'erase';

export interface Selection {
  kind: 'runway' | 'taxiway' | 'apron' | 'stand' | 'terminal';
  id: number;
}

interface ToolState {
  tool: Tool;
  /** Whether the bottom options panel is shown. The left rail toggles it. */
  barOpen: boolean;
  code: CodeLetter;
  surface: Surface;
  tier: number;
  approach: Approach;
  standType: StandType;
  standCode: CodeLetter;
  standCount: number;
  exitAngle: 30 | 45 | 90;
  connectors: number;
  gaCount: number;
  /** Compass heading of stand rows and GA blocks. */
  rowHeading: number;
  /** Terminal sub tool and its options. */
  tSub: TerminalSub;
  floorType: 1 | 2 | 3;
  wallType: 1 | 2;
  fixtureId: number;
  selection: Selection | null;
  /** What the active tool wants the player to do next. */
  hint: string | null;
  /** Why the preview is invalid, with the parcels to buy when land is the problem. */
  problem: Problem | null;
  buy: { ids: number[]; cost: number } | null;
  set(partial: Partial<Omit<ToolState, 'set'>>): void;
}

export const useToolStore = create<ToolState>((set) => ({
  tool: 'select',
  barOpen: true,
  code: 'C',
  surface: 'asphalt',
  tier: 1,
  approach: 'precision',
  standType: 'remotePushback',
  standCode: 'C',
  standCount: 4,
  exitAngle: 30,
  connectors: 3,
  gaCount: 6,
  rowHeading: 0,
  tSub: 'foundation',
  floorType: 2,
  wallType: 1,
  fixtureId: 1,
  selection: null,
  hint: null,
  problem: null,
  buy: null,
  set: (partial) => set(partial),
}));
