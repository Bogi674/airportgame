import { CELL_M, GRID_N, ParcelType, type SitePayload } from '@shared/site';

/**
 * Builds a Path2D of the cell edges where a label raster changes value. Runs of collinear
 * edges merge into one segment. Edges on the site border are skipped.
 */
export function edgesPath(label: ArrayLike<number>): Path2D {
  const path = new Path2D();
  for (let j = 1; j < GRID_N; j++) {
    let runStart = -1;
    for (let i = 0; i <= GRID_N; i++) {
      const differs = i < GRID_N && label[j * GRID_N + i] !== label[(j - 1) * GRID_N + i];
      if (differs && runStart < 0) runStart = i;
      else if (!differs && runStart >= 0) {
        path.moveTo(runStart * CELL_M, j * CELL_M);
        path.lineTo(i * CELL_M, j * CELL_M);
        runStart = -1;
      }
    }
  }
  for (let i = 1; i < GRID_N; i++) {
    let runStart = -1;
    for (let j = 0; j <= GRID_N; j++) {
      const differs = j < GRID_N && label[j * GRID_N + i] !== label[j * GRID_N + i - 1];
      if (differs && runStart < 0) runStart = j;
      else if (!differs && runStart >= 0) {
        path.moveTo(i * CELL_M, runStart * CELL_M);
        path.lineTo(i * CELL_M, j * CELL_M);
        runStart = -1;
      }
    }
  }
  return path;
}

/** Tint colours per parcel type, RGB. */
const TINT: Record<number, [number, number, number]> = {
  [ParcelType.Farmland]: [225, 220, 80],
  [ParcelType.ScrubForest]: [60, 175, 90],
  [ParcelType.Village]: [235, 90, 90],
  [ParcelType.Industrial]: [175, 110, 225],
  [ParcelType.Road]: [235, 235, 235],
  [ParcelType.Wetland]: [60, 190, 205],
  [ParcelType.Protected]: [255, 60, 60],
};

/** Parcel tint, boundaries, fence and selection outline. Rebuilt only when ownership or selection changes. */
export class ParcelOverlay {
  private readonly tint: HTMLCanvasElement;
  private readonly tintCtx: CanvasRenderingContext2D;
  private readonly boundaries: Path2D;
  private fence = new Path2D();
  private selected = new Path2D();
  private readonly cellLabel = new Uint8Array(GRID_N * GRID_N);
  private readonly selLabel = new Uint8Array(GRID_N * GRID_N);

  constructor(private readonly site: SitePayload) {
    this.tint = document.createElement('canvas');
    this.tint.width = GRID_N;
    this.tint.height = GRID_N;
    const ctx = this.tint.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.tintCtx = ctx;
    this.boundaries = edgesPath(site.parcelId);
  }

  setOwner(owner: Uint8Array): void {
    const site = this.site;
    const img = new ImageData(GRID_N, GRID_N);
    const px = new Uint32Array(img.data.buffer);
    for (let o = 0; o < px.length; o++) {
      const p = site.parcelId[o];
      this.cellLabel[o] = owner[p];
      if (owner[p] === 1) continue;
      const type = site.parcelType[p];
      const c = TINT[type];
      const i = o % GRID_N;
      const j = (o - i) / GRID_N;
      // Protected land is hatched.
      const alpha = type === ParcelType.Protected ? ((i + j) % 4 < 2 ? 150 : 40) : 85;
      px[o] = (alpha << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
    }
    this.tintCtx.putImageData(img, 0, 0);
    this.fence = edgesPath(this.cellLabel);
  }

  setSelected(id: number): void {
    if (id < 0) {
      this.selected = new Path2D();
      return;
    }
    const pid = this.site.parcelId;
    for (let o = 0; o < pid.length; o++) this.selLabel[o] = pid[o] === id ? 1 : 0;
    this.selected = edgesPath(this.selLabel);
  }

  /** Draws in world meters with the camera matrix already folded into `m`. */
  draw(ctx: CanvasRenderingContext2D, m: DOMMatrix2DInit, zoom: number, showTint: boolean): void {
    const { a, b, c, d, e, f } = m as { a: number; b: number; c: number; d: number; e: number; f: number };
    ctx.lineJoin = 'round';
    if (showTint) {
      ctx.setTransform(a * CELL_M, b * CELL_M, c * CELL_M, d * CELL_M, e, f);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.tint, 0, 0);
      ctx.setTransform(a, b, c, d, e, f);
      ctx.strokeStyle = 'rgba(20,24,28,0.55)';
      ctx.lineWidth = Math.max(0.8 / zoom, 0.6);
      ctx.stroke(this.boundaries);
    }
    ctx.setTransform(a, b, c, d, e, f);
    const fenceW = Math.max(2.5, 2.4 / zoom);
    ctx.strokeStyle = 'rgba(20,24,28,0.8)';
    ctx.lineWidth = fenceW * 1.9;
    ctx.stroke(this.fence);
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = fenceW;
    ctx.stroke(this.fence);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(3, 3 / zoom);
    ctx.stroke(this.selected);
  }
}
