import { PEOPLE } from '@data/index';
import { HEADING_STEPS, SnapHeader, SNAPSHOT_PEOPLE_CAPACITY, type SnapshotViews } from '@shared/snapshot';
import { PeopleAtlasCache, peopleTierForZoom } from './sprites/peopleAtlas';
import { PeopleSelection } from './peopleSelect';
import { FIGURE_FRAME, packGroup } from './peoplePack';

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
   * Draws the snapshot cohorts. a to f is the world to screen matrix, minX to maxY the visible world
   * bounds in meters.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    views: SnapshotViews,
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
    const count = Math.min(views.header[SnapHeader.PeopleCount], SNAPSHOT_PEOPLE_CAPACITY);
    const drawn = this.selection.select(views.peopleX, views.peopleY, views.peopleSize, count, camX, camY, this.cap);
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
      const px = views.peopleX[i];
      const py = views.peopleY[i];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      const placed = packGroup(views.peopleProfile[i], views.peopleSeed[i], views.peopleSize[i], this.groupX, this.groupY, this.groupRecipe);
      const heading = views.peopleHeading[i];
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
        ctx.drawImage(atlas.canvas, FIGURE_FRAME * cellPx, this.groupRecipe[m] * cellPx, cellPx, cellPx, -cell / 2, -cell / 2, cell, cell);
      }
    }
  }
}
