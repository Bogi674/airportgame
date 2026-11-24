import { describe, expect, it, vi } from 'vitest';
import type { StateCreator } from 'zustand/vanilla';
import { fixtureKey } from '@shared/business';
import { cellIndex, cornerWorld } from '@shared/terminalOps';
import type { ServiceRoad } from '@shared/airfield';
import { useGameStore } from '../src/ui/stores/gameStore';
import { useToolStore } from '../src/ui/stores/toolStore';
import { ToolController } from '../src/ui/tools/controller';
import { buildTestAirport, buildTestTerminal, ownedSim } from './helpers';

// The UI stores run without a renderer here: zustand's vanilla store stands in for the hook.
vi.mock('zustand', async () => {
  const { createStore } = await import('zustand/vanilla');
  return {
    create: <T>(init: StateCreator<T>) => {
      const store = createStore<T>(init);
      return Object.assign(() => store.getState(), store);
    },
  };
});

const NO_MODS = { shift: false, alt: false, ctrl: false };

function rig(zoom: number): ToolController {
  return new ToolController({ send: () => undefined, setGhost: () => undefined, zoom: () => zoom, setHighlight: () => undefined, setCursor: () => undefined, setGuide: () => undefined });
}

describe('select picks the topmost item (T90)', () => {
  it('a fixture beside a curb road selects the fixture, not the road within the pick tolerance', () => {
    const sim = ownedSim();
    sim.cash = 100_000_000;
    buildTestAirport(sim, { standsPerRow: 2 });
    expect(buildTestTerminal(sim)).toEqual([]);
    const g = sim.business.grids[0]!;
    let at = -1;
    for (let i = 0; i < g.fixture.length && at < 0; i++) if (g.fixture[i]! > 0 && fixtureKey(g.fixture[i]!) === 'checkIn') at = i;
    expect(at).toBeGreaterThanOrEqual(0);
    const cx = g.x0 + (at % g.w);
    const cy = g.y0 + Math.floor(at / g.w);
    expect(cellIndex(g, cx, cy)).toBe(at);
    const p = cornerWorld(g, cx + 0.5, cy + 0.5);
    // A road whose edge passes 2 m from the click, well inside the 8 m pick tolerance.
    const road = { id: 41, points: [{ x: p.x - 50, y: p.y + 6 }, { x: p.x + 50, y: p.y + 6 }] } as ServiceRoad;
    const af = useGameStore.getState().airfield;
    useGameStore.setState({ airfield: { ...af, roads: [road], runways: [], taxiways: [], aprons: [], stands: [] }, terminalGrids: sim.business.grids });
    useToolStore.getState().set({ tool: 'select', selection: null, fixturePick: null, propPick: null });
    const c = rig(1);
    c.up(p, NO_MODS);
    const st = useToolStore.getState();
    expect(st.selection).toEqual({ kind: 'terminal', id: g.id });
    expect(st.fixturePick).not.toBeNull();
  });
});
