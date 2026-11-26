import { BAGGAGE_FIXTURE_KEYS, fixtureKey, type TerminalGrid } from '@shared/business';
import { propAt, propCost, propSpec } from '@shared/props';
import { cellIndex, fixtureAnchor } from '@shared/terminalOps';
import type { Command } from '@sim/commands';
import { fixtureLabelAt } from './fixtureLabel';
import { useGameStore } from './stores/gameStore';
import { useToolStore } from './stores/toolStore';
import { askDemolish } from './stores/demolishStore';
import { t, tDynamic } from './strings';

type Rot = 0 | 1 | 2 | 3;

/** What the item popup and the inspector offer for one picked fixture or prop (T86). */
export interface ItemTarget {
  /** Stable key of the picked item, so a confirm open for one item closes when another is picked. */
  key: string;
  name: string;
  /** Cash the sim pays back when the item is demolished: a prop's full price, nothing for a fixture. */
  refund: number;
  relocate(): void;
  rotate(): void;
  /** Opens the demolish confirm for the item; the pick clears once it is demolished. */
  demolish(): void;
}

/**
 * The fixture or prop picked with the select tool, with its edit actions, or null when nothing editable is picked.
 * A baggage fixture is edited from its own node panel, so it gets no target here.
 */
export function itemTarget(
  grids: readonly TerminalGrid[],
  fixturePick: { building: number; x: number; y: number } | null,
  propPick: { building: number; x: number; y: number } | null,
  send: (c: Command) => void,
): ItemTarget | null {
  const set = useToolStore.getState().set;
  if (propPick) {
    const g = grids.find((x) => x.id === propPick.building);
    const i = g ? propAt(g.props, propPick.x, propPick.y) : -1;
    const prop = g && i >= 0 ? g.props[i]! : null;
    if (!g || !prop) return null;
    const name = propSpec(prop.asset)?.name ?? prop.asset;
    const { x, y } = propPick;
    return {
      key: `p${g.id}:${prop.x}:${prop.y}`,
      name,
      refund: propCost(prop.asset),
      relocate: () => set({ moving: { kind: 'prop', building: g.id, x, y, asset: prop.asset, rot: prop.rot }, tool: 'terminal', tSub: 'move', hint: 'hint.terminal.move', problem: null, buy: null, pickAt: null }),
      rotate: () => send({ type: 'moveProp', building: g.id, x, y, toX: prop.x, toY: prop.y, rot: ((prop.rot + 1) % 4) as Rot }),
      demolish: () => askDemolish({ what: name, refund: propCost(prop.asset), commands: [{ type: 'removeProp', building: g.id, x, y }], after: () => set({ propPick: null, pickAt: null }) }),
    };
  }
  if (!fixturePick) return null;
  const g = grids.find((x) => x.id === fixturePick.building);
  const cell = g ? cellIndex(g, fixturePick.x, fixturePick.y) : -1;
  const f = g && cell >= 0 ? g.fixture[cell]! : 0;
  if (!g || f === 0 || BAGGAGE_FIXTURE_KEYS.includes(fixtureKey(f))) return null;
  const anchor = fixtureAnchor(g, cell);
  const code = g.fixtureRot[anchor] ?? 0;
  const name = fixtureLabelAt(g, cell, useGameStore.getState().business?.fixtureNames) ?? tDynamic(`fixture.${f}`);
  const { x, y } = fixturePick;
  return {
    key: `f${g.id}:${x}:${y}`,
    name,
    refund: 0,
    relocate: () =>
      set({
        moving: { kind: 'fixture', building: g.id, x, y, f, level: g.fixtureLevel[anchor] ?? 1, mode: g.fixtureMode[anchor] ?? 0, rot: (code === 0 ? 0 : code - 1) as Rot },
        tool: 'terminal',
        tSub: 'move',
        hint: 'hint.terminal.move',
        problem: null,
        buy: null,
        pickAt: null,
      }),
    rotate: () => send({ type: 'moveFixture', building: g.id, x, y, toX: x, toY: y, rot: ((code === 0 ? 1 : code) % 4) as Rot }),
    demolish: () => askDemolish({ what: name, lines: [t('demolish.fixtureNote')], refund: 0, commands: [{ type: 'removeFixture', building: g.id, x, y }], after: () => set({ fixturePick: null, pickAt: null }) }),
  };
}
