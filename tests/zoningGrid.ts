import { FIXTURE_KEYS, FLOOR, type FixtureKey, type TerminalGrid } from '@shared/business';
import { ensureCells, newGrid, planEdit, type Env, type TerminalEdit } from '@shared/terminalOps';

const env: Env = { ctx: {} as Env['ctx'], af: {} as Env['af'], others: [] };

function apply(g: TerminalGrid, e: TerminalEdit): void {
  const plan = planEdit(g, e, env);
  if (plan.problem) throw new Error(`edit refused: ${plan.problem.code}`);
  plan.apply();
}

/** A grid with tile floor on the logical cells [0, w) by [0, h) and no zones, walls or fixtures. */
export function grid(w: number, h: number): TerminalGrid {
  const g = newGrid(1, 0, 0, 0);
  ensureCells(g, 0, 0, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g.floor[y * g.w + x] = FLOOR.Tile;
  return g;
}

/** Paints zone cells [x0, x1) by [y0, y1). */
export function paint(g: TerminalGrid, x0: number, y0: number, x1: number, y1: number, zone: number): void {
  apply(g, { op: 'zone', x0, y0, x1, y1, variant: zone });
}

/** Places one fixture with its anchor at (x, y). */
export function put(g: TerminalGrid, key: FixtureKey, x: number, y: number, rot: 0 | 1 | 2 | 3, level = 1, mode = 0): void {
  apply(g, { op: 'fixture', x0: x, y0: y, x1: x + 1, y1: y + 1, variant: FIXTURE_KEYS.indexOf(key) + 1, rot, level, mode });
}

/** Sets one wall edge: the edge above cell (x, y) when horizontal, else the edge left of it. Type 0 removes it. */
export function wall(g: TerminalGrid, horizontal: boolean, x: number, y: number, type: number): void {
  const [x1, y1] = horizontal ? [x + 1, y] : [x, y + 1];
  apply(g, { op: type === 0 ? 'removeWall' : 'wall', x0: x, y0: y, x1, y1, variant: type });
}
