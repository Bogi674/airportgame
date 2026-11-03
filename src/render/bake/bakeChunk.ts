import { CHUNK_SIZE_M } from '@shared/math';
import { BAND_RASTER_SCALE, chunkPixelSize } from '../chunks';

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/**
 * Placeholder chunk baker for the M0 skeleton: a 64 m grid with a heavier line at 512 m
 * boundaries. Real terrain, pavement and markings replace this in later milestones.
 * Shared by the bake worker and the main thread fallback.
 */
export function bakeChunkPlaceholder(ctx: Ctx2D, band: number, cx: number, cy: number): void {
  const px = chunkPixelSize(band);
  const scale = BAND_RASTER_SCALE[band];
  ctx.fillStyle = (cx + cy) % 2 === 0 ? '#2b3a2f' : '#2f4034';
  ctx.fillRect(0, 0, px, px);
  ctx.strokeStyle = '#3c5043';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const gridM = 64;
  for (let m = gridM; m < CHUNK_SIZE_M; m += gridM) {
    const p = Math.round(m * scale) + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, px);
    ctx.moveTo(0, p);
    ctx.lineTo(px, p);
  }
  ctx.stroke();
  ctx.strokeStyle = '#5a7562';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, px - 2, px - 2);
}
