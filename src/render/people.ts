import { PEOPLE } from '@data/index';
import { SnapHeader, SNAPSHOT_PEOPLE_CAPACITY, type SnapshotViews } from '@shared/snapshot';
import { PeopleAtlasCache, peopleTierForZoom } from './sprites/peopleAtlas';
import { memberHash, pickRecipe } from './sprites/peopleRecipes';
import { PeopleSelection } from './peopleSelect';

/** Member offsets in meters for a cohort of more than one figure. Members past six stack on the first slots. */
const SLOTS: readonly (readonly [number, number])[] = [
  [-0.6, -0.35],
  [0, -0.35],
  [0.6, -0.35],
  [-0.6, 0.35],
  [0, 0.35],
  [0.6, 0.35],
];
const HEADINGS = 256;
/** Figures outside the visible bounds by more than this margin in meters are skipped. */
const BOUNDS_MARGIN_M = 1;
const SHADOW_ROW = PEOPLE.recipes.length;

/**
 * Passengers as a render sample (hard rule 6). Each snapshot cohort draws as up to size figures
 * from the baked atlas. The figure count is capped by setCap, and the nearest cohorts win when over it.
 */
export class People {
  private cap = SNAPSHOT_PEOPLE_CAPACITY;
  private readonly selection = new PeopleSelection();
  private readonly atlases = new PeopleAtlasCache();
  private readonly headingCos = new Float32Array(HEADINGS);
  private readonly headingSin = new Float32Array(HEADINGS);

  constructor() {
    for (let i = 0; i < HEADINGS; i++) {
      const a = (i / HEADINGS) * 2 * Math.PI;
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
   * bounds in meters, and walkClockS the walking clock that drives the gait frame.
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
    walkClockS: number,
  ): void {
    const tier = peopleTierForZoom(zoom);
    if (tier < 0) return;
    const count = Math.min(views.header[SnapHeader.PeopleCount], SNAPSHOT_PEOPLE_CAPACITY);
    const drawn = this.selection.select(views.peopleX, views.peopleY, views.peopleSize, count, camX, camY, this.cap);
    const atlas = this.atlases.get(tier);
    const detail = PEOPLE.tiers[tier].detail;
    const cell = PEOPLE.cellM;
    const cellPx = atlas.cellPx;
    const walkStep = Math.floor(walkClockS * 2);
    const x0 = minX - BOUNDS_MARGIN_M;
    const y0 = minY - BOUNDS_MARGIN_M;
    const x1 = maxX + BOUNDS_MARGIN_M;
    const y1 = maxY + BOUNDS_MARGIN_M;
    for (let k = 0; k < drawn; k++) {
      const i = this.selection.order[k];
      const px = views.peopleX[i];
      const py = views.peopleY[i];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      const seed = views.peopleSeed[i];
      const profile = views.peopleProfile[i];
      const size = views.peopleSize[i];
      const walking = views.peopleState[i] === 1;
      const heading = memberHash(seed, 7) & (HEADINGS - 1);
      const cos = this.headingCos[heading];
      const sin = this.headingSin[heading];
      for (let m = 0; m < size; m++) {
        const slot = size === 1 ? undefined : SLOTS[m % SLOTS.length];
        const ox = slot ? slot[0] : 0;
        const oy = slot ? slot[1] : 0;
        const fx = px + ox;
        const fy = py + oy;
        ctx.setTransform(a, b, c, d, e, f);
        ctx.translate(fx, fy);
        if (detail === 2) {
          ctx.drawImage(atlas.canvas, 0, SHADOW_ROW * cellPx, cellPx, cellPx, -cell / 2, -cell / 2, cell, cell);
        }
        ctx.transform(cos, sin, -sin, cos, 0, 0);
        const recipe = pickRecipe(profile, seed, m);
        const frame = walking ? (walkStep + (seed & 3)) & 3 : 1;
        ctx.drawImage(atlas.canvas, frame * cellPx, recipe * cellPx, cellPx, cellPx, -cell / 2, -cell / 2, cell, cell);
      }
    }
  }
}
