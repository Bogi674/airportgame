import { PEOPLE } from '@data/index';
import { STAFF_PROFILE_BASE } from '@shared/snapshot';
import { pickRecipe, staffRecipe, STAFF_LOOKS, RECIPE_COUNT } from './sprites/peopleRecipes';
import { opsBounds, personOps, type ShapeOp } from './sprites/peopleShapes';

/** Clearance in meters kept around each figure's footprint when a group is packed. */
export const PACK_MARGIN_M = PEOPLE.motion.memberMarginM;
/** Half the side in meters of a queue cell, which is 2 m, so a packed group stays inside its cell. */
export const CELL_HALF_M = PEOPLE.motion.cellHalfM;
/** Atlas column of the figure drawn for a group. Frame 1 is the standing pose. */
export const FIGURE_FRAME = 1;
const FOOTPRINT_DETAIL = 2;

/** Per recipe footprint at FOOTPRINT_DETAIL and FIGURE_FRAME: minX, minY, maxX, maxY in meters from the origin. */
const FOOTPRINTS = buildFootprints();

function buildFootprints(): Float32Array {
  const rows = RECIPE_COUNT + STAFF_LOOKS.length;
  const out = new Float32Array(rows * 4);
  const ops: ShapeOp[] = [];
  for (let r = 0; r < rows; r++) {
    ops.length = 0;
    personOps(r < RECIPE_COUNT ? PEOPLE.recipes[r]! : STAFF_LOOKS[r - RECIPE_COUNT]!, FIGURE_FRAME, FOOTPRINT_DETAIL, false, ops);
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
 * many members were placed. A single figure, and a staff member whatever the size, is centred on the origin. Larger groups are packed in rows from the
 * corner of the cell, and a member that would leave the cell is dropped with the rest of the group.
 */
export function packGroup(profile: number, seed: number, size: number, outX: Float32Array, outY: Float32Array, outRecipe: Uint8Array): number {
  if (size === 1 || profile >= STAFF_PROFILE_BASE) {
    const recipe = profile >= STAFF_PROFILE_BASE ? staffRecipe(profile - STAFF_PROFILE_BASE, seed) : pickRecipe(profile, seed, 0);
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

/**
 * Lays out a queued group single file along its forward axis, centred in its 2 m cell, so a line of groups reads as
 * one line of people (PX1). A group too long for one file stands in two files side by side, and a member that would
 * leave the cell is dropped with the rest. Same frame and outputs as packGroup.
 */
export function packFile(profile: number, seed: number, size: number, outX: Float32Array, outY: Float32Array, outRecipe: Uint8Array): number {
  if (size === 1 || profile >= STAFF_PROFILE_BASE) return packGroup(profile, seed, size, outX, outY, outRecipe);
  let total = 0;
  for (let m = 0; m < size; m++) {
    const r = pickRecipe(profile, seed, m) * 4;
    total += FOOTPRINTS[r + 3]! - FOOTPRINTS[r + 1]! + 2 * PACK_MARGIN_M;
  }
  const files = total > 2 * CELL_HALF_M ? 2 : 1;
  const perFile = Math.ceil(size / files);
  let placed = 0;
  for (let f = 0; f < files; f++) {
    const first = f * perFile;
    const last = Math.min(size, first + perFile);
    let len = 0;
    let width = 0;
    for (let m = first; m < last; m++) {
      const r = pickRecipe(profile, seed, m) * 4;
      len += FOOTPRINTS[r + 3]! - FOOTPRINTS[r + 1]! + 2 * PACK_MARGIN_M;
      width = Math.max(width, FOOTPRINTS[r + 2]! - FOOTPRINTS[r]! + 2 * PACK_MARGIN_M);
    }
    if (len > 2 * CELL_HALF_M) break;
    // File centres sit half a figure width either side of the cell centre line.
    const cx = files === 1 ? 0 : (f === 0 ? -0.5 : 0.5) * width;
    let y = -len / 2;
    for (let m = first; m < last; m++) {
      const recipe = pickRecipe(profile, seed, m);
      const r = recipe * 4;
      outX[placed] = cx - (FOOTPRINTS[r]! + FOOTPRINTS[r + 2]!) / 2;
      outY[placed] = y + PACK_MARGIN_M - FOOTPRINTS[r + 1]!;
      outRecipe[placed] = recipe;
      placed++;
      y += FOOTPRINTS[r + 3]! - FOOTPRINTS[r + 1]! + 2 * PACK_MARGIN_M;
    }
  }
  return placed > 0 ? placed : packGroup(profile, seed, size, outX, outY, outRecipe);
}

/**
 * Lays out a seated group side by side along its row of seats, one seat pitch apart and centred on the run (PX2).
 * Same frame and outputs as packGroup; every member is placed.
 */
export function packSeated(profile: number, seed: number, size: number, outX: Float32Array, outY: Float32Array, outRecipe: Uint8Array): number {
  for (let m = 0; m < size; m++) {
    const recipe = profile >= STAFF_PROFILE_BASE ? staffRecipe(profile - STAFF_PROFILE_BASE, seed) : pickRecipe(profile, seed, m);
    outX[m] = (m - (size - 1) / 2) * PEOPLE.motion.seatPitchM;
    outY[m] = 0;
    outRecipe[m] = recipe;
  }
  return size;
}
