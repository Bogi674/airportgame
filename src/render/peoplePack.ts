import { PEOPLE } from '@data/index';
import { pickRecipe, RECIPE_COUNT } from './sprites/peopleRecipes';
import { opsBounds, personOps, type ShapeOp } from './sprites/peopleShapes';

/** Clearance in meters kept around each figure's footprint when a group is packed. */
export const PACK_MARGIN_M = 0.05;
/** Half the side in meters of a queue cell, which is 2 m, so a packed group stays inside its cell. */
export const CELL_HALF_M = 0.95;
/** Atlas column of the figure drawn for a group. Frame 1 is the standing pose. */
export const FIGURE_FRAME = 1;
const FOOTPRINT_DETAIL = 2;

/** Per recipe footprint at FOOTPRINT_DETAIL and FIGURE_FRAME: minX, minY, maxX, maxY in meters from the origin. */
const FOOTPRINTS = buildFootprints();

function buildFootprints(): Float32Array {
  const out = new Float32Array(RECIPE_COUNT * 4);
  const ops: ShapeOp[] = [];
  for (let r = 0; r < RECIPE_COUNT; r++) {
    ops.length = 0;
    personOps(PEOPLE.recipes[r]!, FIGURE_FRAME, FOOTPRINT_DETAIL, false, ops);
    const b = opsBounds(ops);
    out[r * 4] = b.minX;
    out[r * 4 + 1] = b.minY;
    out[r * 4 + 2] = b.maxX;
    out[r * 4 + 3] = b.maxY;
  }
  return out;
}

/** Writes minX, minY, maxX, maxY of a recipe's footprint into out. */
export function recipeFootprint(recipe: number, out: Float32Array): void {
  const r = recipe * 4;
  out[0] = FOOTPRINTS[r]!;
  out[1] = FOOTPRINTS[r + 1]!;
  out[2] = FOOTPRINTS[r + 2]!;
  out[3] = FOOTPRINTS[r + 3]!;
}

/**
 * Lays out the figures of one cohort group in local block coordinates in meters, forward is minus y. Returns how
 * many members were placed. A single figure is centred on the origin. Larger groups are packed in rows from the
 * corner of the cell, and a member that would leave the cell is dropped with the rest of the group.
 */
export function packGroup(profile: number, seed: number, size: number, outX: Float32Array, outY: Float32Array, outRecipe: Uint8Array): number {
  if (size === 1) {
    const recipe = pickRecipe(profile, seed, 0);
    const r = recipe * 4;
    outX[0] = -(FOOTPRINTS[r]! + FOOTPRINTS[r + 2]!) / 2;
    outY[0] = -(FOOTPRINTS[r + 1]! + FOOTPRINTS[r + 3]!) / 2;
    outRecipe[0] = recipe;
    return 1;
  }
  let x = -CELL_HALF_M;
  let y = -CELL_HALF_M;
  let rowH = 0;
  let placed = 0;
  for (let m = 0; m < size; m++) {
    const recipe = pickRecipe(profile, seed, m);
    const r = recipe * 4;
    const w = FOOTPRINTS[r + 2]! - FOOTPRINTS[r]! + 2 * PACK_MARGIN_M;
    const l = FOOTPRINTS[r + 3]! - FOOTPRINTS[r + 1]! + 2 * PACK_MARGIN_M;
    if (x + w > CELL_HALF_M) {
      x = -CELL_HALF_M;
      y += rowH;
      rowH = 0;
    }
    if (y + l > CELL_HALF_M) break;
    outX[placed] = x + PACK_MARGIN_M - FOOTPRINTS[r]!;
    outY[placed] = y + PACK_MARGIN_M - FOOTPRINTS[r + 1]!;
    outRecipe[placed] = recipe;
    placed++;
    x += w;
    rowH = Math.max(rowH, l);
  }
  return placed;
}
