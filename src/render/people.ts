import { PEOPLE } from '@data/index';
import { HEADING_STEPS, SnapHeader, SNAPSHOT_PEOPLE_CAPACITY, type SnapshotViews } from '@shared/snapshot';
import { TICK_SECONDS } from '@shared/time';
import { PeopleAtlasCache, peopleTierForZoom } from './sprites/peopleAtlas';
import { PeopleSelection } from './peopleSelect';
import { packGroup } from './peoplePack';
import { PeopleMotion } from './peopleMotion';

/** Figures outside the visible bounds by more than this margin in meters are skipped. */
const BOUNDS_MARGIN_M = 1;
const SHADOW_ROW = PEOPLE.recipes.length;
/** One group slot per value of the uint8 cohort size. */
const GROUP_SLOTS = 256;

/**
 * Passengers as a render sample (hard rule 6). Each snapshot cohort draws as a group of up to size figures
 * from the baked atlas, packed inside its queue cell and turned by the cohort heading. The figure count is capped
 * by setCap, and the nearest cohorts win when over it.
 */
export class People {
  private cap = SNAPSHOT_PEOPLE_CAPACITY;
  private readonly selection = new PeopleSelection();
  private readonly atlases = new PeopleAtlasCache();
  private readonly headingCos = new Float32Array(HEADING_STEPS);
  private readonly headingSin = new Float32Array(HEADING_STEPS);
  private readonly groupX = new Float32Array(GROUP_SLOTS);
  private readonly groupY = new Float32Array(GROUP_SLOTS);
  private readonly groupRecipe = new Uint8Array(GROUP_SLOTS);
  private readonly motion = new PeopleMotion();
  private readonly pos = new Float32Array(2);

  constructor() {
    for (let i = 0; i < HEADING_STEPS; i++) {
      const a = (i / HEADING_STEPS) * 2 * Math.PI;
      this.headingCos[i] = Math.cos(a);
      this.headingSin[i] = Math.sin(a);
    }
  }

  /** Caps the number of figures drawn per frame. */
  setCap(cap: number): void {
    this.cap = cap;
  }

  /**
   * Draws the snapshot cohorts, blended from prev to curr by alpha. a to f is the world to screen matrix,
   * minX to maxY the visible world bounds in meters.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    prev: SnapshotViews | null,
    curr: SnapshotViews,
    alpha: number,
    zoom: number,
    camX: number,
    camY: number,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): void {
    const tier = peopleTierForZoom(zoom);
    if (tier < 0) return;
    this.motion.index(prev);
    const currTick = curr.header[SnapHeader.Tick];
    const prevTick = prev ? prev.header[SnapHeader.Tick] : currTick;
    const gameSeconds = (prevTick + (currTick - prevTick) * alpha) * TICK_SECONDS;
    const count = Math.min(curr.header[SnapHeader.PeopleCount], SNAPSHOT_PEOPLE_CAPACITY);
    const drawn = this.selection.select(curr.peopleX, curr.peopleY, curr.peopleSize, count, camX, camY, this.cap);
    const atlas = this.atlases.get(tier);
    const detail = PEOPLE.tiers[tier].detail;
    const cell = PEOPLE.cellM;
    const cellPx = atlas.cellPx;
    const x0 = minX - BOUNDS_MARGIN_M;
    const y0 = minY - BOUNDS_MARGIN_M;
    const x1 = maxX + BOUNDS_MARGIN_M;
    const y1 = maxY + BOUNDS_MARGIN_M;
    for (let k = 0; k < drawn; k++) {
      const i = this.selection.order[k];
      this.motion.position(curr, i, alpha, this.pos);
      const px = this.pos[0];
      const py = this.pos[1];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      const profile = curr.peopleProfile[i];
      const seed = curr.peopleSeed[i];
      const mode = curr.peopleMode[i];
      const placed = packGroup(profile, seed, curr.peopleSize[i], this.groupX, this.groupY, this.groupRecipe);
      const heading = curr.peopleHeading[i];
      const cos = this.headingCos[heading];
      const sin = this.headingSin[heading];
      for (let m = 0; m < placed; m++) {
        const ox = this.groupX[m];
        const oy = this.groupY[m];
        ctx.setTransform(a, b, c, d, e, f);
        ctx.translate(px + cos * ox - sin * oy, py + sin * ox + cos * oy);
        if (detail === 2) {
          ctx.drawImage(atlas.canvas, 0, SHADOW_ROW * cellPx, cellPx, cellPx, -cell / 2, -cell / 2, cell, cell);
        }
        ctx.transform(cos, sin, -sin, cos, 0, 0);
        const frame = this.motion.walkFrame(mode, gameSeconds, profile, seed, m);
        ctx.drawImage(atlas.canvas, frame * cellPx, this.groupRecipe[m] * cellPx, cellPx, cellPx, -cell / 2, -cell / 2, cell, cell);
      }
    }
  }
}
