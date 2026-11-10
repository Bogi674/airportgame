import { create } from 'zustand';
import type { Approach, CodeLetter, StandSize, StandType, Surface } from '@shared/airfield';
import type { Problem } from '@shared/validate';

export type Tool = 'select' | 'runway' | 'taxiway' | 'taxilane' | 'rapidExit' | 'parallel' | 'turnPad' | 'apron' | 'stands' | 'gaBlock' | 'terminal' | 'demolish';

export type TerminalSub = 'foundation' | 'floor' | 'wall' | 'door' | 'fixture' | 'erase' | 'zone';

/** Snap mode of a placement tool: the construction grid, or free placement. */
export type SnapMode = 'grid' | 'free';

/**
 * The tools that place on the construction grid (handoff/tasks/T42-grid-snapping.md, R3). The runway
 * and taxiway tools use it as their lowest priority snap, after their own node, end and segment snaps.
 */
export const GRID_TOOLS: readonly Tool[] = ['runway', 'taxiway', 'taxilane', 'apron', 'stands', 'gaBlock', 'terminal'];

/** Snap mode of one tool: grid unless the player switched that tool to free. */
export function snapModeOf(modes: Partial<Record<Tool, SnapMode>>, tool: Tool): SnapMode {
  return modes[tool] ?? 'grid';
}

export interface Selection {
  kind: 'runway' | 'taxiway' | 'apron' | 'stand' | 'terminal';
  id: number;
}

interface ToolState {
  tool: Tool;
  /** Open category of the left toolbar, its tab in the bottom build menu, and whether the menu is shown. */
  category: string | null;
  menuTab: string;
  menuOpen: boolean;
  /** Runway tool mode: build a new one, or extend or shorten an existing one at an end. */
  runwayMode: 'new' | 'extend' | 'shorten';
  /** Taxiway tool mode: build, extend from an end, trim an end back, or cut a section out. */
  taxiMode: 'new' | 'extend' | 'trim' | 'cut';
  /** Whether the bottom options panel is shown. The left rail toggles it. */
  barOpen: boolean;
  code: CodeLetter;
  surface: Surface;
  tier: number;
  approach: Approach;
  standType: StandType;
  standSize: StandSize;
  /** Apron tool: free polygon or rectangle (docs/DESIGN_REVISION_2.md section 4). */
  apronMode: 'polygon' | 'rect';
  standCount: number;
  exitAngle: 30 | 45 | 90;
  connectors: number;
  gaCount: number;
  /** Rotation of stand rows, GA blocks and new terminals in degrees, relative to the nearest runway (or the site axis). */
  rowHeading: number;
  /** Where the confirm or cancel popup is shown on screen, or null. */
  confirmAt: { x: number; y: number } | null;
  /** Terminal sub tool and its options. */
  tSub: TerminalSub;
  floorType: 1 | 2 | 3;
  wallType: 1 | 2;
  fixtureId: number;
  zoneType: 1 | 2 | 3 | 4;
  selection: Selection | null;
  /** Id of the construction grid offered near the cursor, or null when the cursor is out of reach of every grid. Set by the tool controller. */
  gridId: string | null;
  /** Snap mode per placement tool, persistent, with Alt as a temporary override while held. */
  snapMode: Partial<Record<Tool, SnapMode>>;
  /** True while Alt is held, so the context bar shows the live snap mode. */
  altHeld: boolean;
  /** What the active tool wants the player to do next. */
  hint: string | null;
  /** Why the preview is invalid, with the parcels to buy when land is the problem. */
  problem: Problem | null;
  buy: { ids: number[]; cost: number } | null;
  set(partial: Partial<Omit<ToolState, 'set'>>): void;
}

export const useToolStore = create<ToolState>((set) => ({
  tool: 'select',
  category: null,
  menuTab: '',
  menuOpen: false,
  runwayMode: 'new',
  taxiMode: 'new',
  barOpen: true,
  code: 'C',
  surface: 'asphalt',
  tier: 1,
  approach: 'precision',
  standType: 'remote',
  standSize: 'medium',
  apronMode: 'polygon',
  standCount: 4,
  exitAngle: 30,
  connectors: 3,
  gaCount: 6,
  rowHeading: 0,
  confirmAt: null,
  tSub: 'foundation',
  floorType: 2,
  wallType: 1,
  fixtureId: 1,
  zoneType: 1,
  selection: null,
  gridId: null,
  snapMode: {},
  altHeld: false,
  hint: null,
  problem: null,
  buy: null,
  set: (partial) => set(partial),
}));
