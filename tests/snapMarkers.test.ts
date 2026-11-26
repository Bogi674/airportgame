import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIRFIELD } from '@data/index';
import type { StateCreator } from 'zustand/vanilla';
import type { Taxiway } from '@shared/airfield';
import type { Command } from '@sim/commands';
import type { Ghost, GhostShape } from '@shared/ghost';
import { snapStand } from '@shared/standSnap';
import { useGameStore } from '../src/ui/stores/gameStore';
import { useToolStore } from '../src/ui/stores/toolStore';
import { ToolController } from '../src/ui/tools/controller';
import { markShape, markTip, type SnapMarkKind } from '../src/ui/tools/snapMark';

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

/** A code C taxiway along y = 0 from x = -500 to 500. */
const taxi = (): Taxiway =>
  ({
    id: 7,
    cost: 0,
    kind: 'taxiway',
    points: [
      { x: -500, y: 0 },
      { x: 500, y: 0 },
    ],
    code: 'C',
    widthM: 23,
    surface: 'asphalt',
    pcr: 50,
    condition: 100,
    oneWay: false,
    name: 'A',
  }) as Taxiway;

function rig(zoom = 1): { c: ToolController; ghosts: (Ghost | null)[]; sent: Command[] } {
  const ghosts: (Ghost | null)[] = [];
  const sent: Command[] = [];
  const c = new ToolController({
    send: (cmd) => sent.push(cmd),
    setGhost: (g) => ghosts.push(g),
    zoom: () => zoom,
    setHighlight: () => undefined,
    setCursor: () => undefined,
    setGuide: () => undefined,
  });
  return { c, ghosts, sent };
}

const markers = (g: Ghost | null | undefined): GhostShape[] => (g ? g.shapes.filter((s) => s.k === 'marker' && s.shape !== 'dot') : []);

describe('snap markers (T70)', () => {
  it('every snap kind has a marker, and every kind but the grid has a tooltip', () => {
    const kinds: SnapMarkKind[] = ['node', 'end', 'segment', 'vertex', 'runwayEdge', 'centerline', 'guide', 'angle', 'grid', 'apronEdge', 'leadIn'];
    for (const kind of kinds) {
      const m = { kind, p: { x: 1, y: 2 }, label: 'J1' };
      expect(markShape(m)).toMatchObject({ k: 'marker', x: 1, y: 2 });
      if (kind === 'grid') expect(markTip(m)).toBeNull();
      else expect(markTip(m)).toBeTruthy();
    }
    expect(markShape({ kind: 'grid', p: { x: 0, y: 0 } })).toMatchObject({ shape: 'plus' });
  });

  it('the taxiway snap radius is 20 m and the other tools use 16 px with an 8 m floor', () => {
    expect(AIRFIELD.taxiwayTool.snapRadiusM).toBe(20);
    expect(AIRFIELD.snapTool).toMatchObject({ radiusPx: 16, minRadiusM: 8, dragStartPx: 8 });
  });

  it('a stand snap reports the centerline point its lead in joins', () => {
    const s = snapStand({ x: 40, y: 70 }, 'medium', [taxi()], null);
    expect(s?.join).toEqual({ x: 40, y: 0 });
  });
});

describe('drawing tools show their snap target (T70)', () => {
  beforeEach(() => {
    const af = useGameStore.getState().airfield;
    useGameStore.setState({ airfield: { ...af, taxiways: [taxi()], runways: [], aprons: [], stands: [] } });
    useToolStore.getState().set({ tool: 'taxiway', taxiMode: 'new', snapMode: {}, gridId: null, standHeading: null });
  });

  it('the stand tool marks the lead in join with the taxiway name', () => {
    useToolStore.getState().set({ tool: 'stands' });
    const { c, ghosts } = rig();
    c.move({ x: 40, y: 70 }, NO_MODS);
    const g = ghosts[ghosts.length - 1];
    expect(markers(g)).toEqual([{ k: 'marker', x: 40, y: 0, shape: 'diamond', label: undefined }]);
    expect(g?.tip?.text).toContain('A');
  });

  it('the apron polygon tool marks a vertex snap with a tooltip', () => {
    useToolStore.getState().set({ tool: 'apron', apronMode: 'polygon', snapMode: { apron: 'free' } });
    const { c, ghosts } = rig();
    c.move({ x: 503, y: 2 }, NO_MODS);
    const g = ghosts[ghosts.length - 1];
    expect(markers(g)).toEqual([{ k: 'marker', x: 500, y: 0, shape: 'square', label: undefined }]);
    expect(g?.tip?.text).toBeTruthy();
  });

  it('a click adds one taxiway point and a press and drag adds a whole segment', () => {
    const { c, sent } = rig();
    c.down({ x: 0, y: 300 }, NO_MODS);
    c.up({ x: 0, y: 300 }, NO_MODS);
    expect(c.gestureActive).toBe(true);
    c.cancel();
    c.down({ x: 200, y: 300 }, NO_MODS);
    c.move({ x: 200, y: 250 }, NO_MODS);
    c.move({ x: 200, y: 160 }, NO_MODS);
    c.up({ x: 200, y: 160 }, NO_MODS);
    c.confirm();
    const build = sent.find((s) => s.type === 'buildTaxiway');
    expect(build && 'points' in build ? build.points : null).toEqual([
      { x: 200, y: 300 },
      { x: 200, y: 160 },
    ]);
  });

  it('a drag that ends on the taxiway snaps its release point onto the centerline', () => {
    const { c, ghosts } = rig();
    c.down({ x: 100, y: 200 }, NO_MODS);
    c.move({ x: 104, y: 9 }, NO_MODS);
    const g = ghosts[ghosts.length - 1];
    // The drag is about one degree off square to the taxiway, so the end slides to meet it square.
    expect(markers(g)).toEqual([{ k: 'marker', x: 100, y: 0, shape: 'diamond', label: undefined }]);
    expect(g?.shapes.some((s) => s.k === 'strip')).toBe(true);
  });
});
