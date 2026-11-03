import { CHUNK_SIZE_M } from '@shared/math';
import { SnapHeader, type SnapshotViews } from '@shared/snapshot';
import { Camera } from './camera';
import { createChunkBaker } from './bake/chunkBaker';
import { bandForZoom, ChunkCache, chunkKey, chunkPixelSize, BAND_RASTER_SCALE, CHUNKS_PER_SIDE } from './chunks';

const MAX_BACKING = 4096;
const MARKER_LENGTH_M = 40;

/** Pre-baked stand in for the aircraft sprites that arrive with the sprite baker in M3. */
function bakeMarker(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#e8eef2';
    g.beginPath();
    g.moveTo(62, 32);
    g.lineTo(6, 8);
    g.lineTo(18, 32);
    g.lineTo(6, 56);
    g.closePath();
    g.fill();
  }
  return c;
}

/** Canvas 2D renderer. Static layer from baked chunks, dynamic layer from interpolated snapshots. */
export class Renderer {
  readonly camera = new Camera();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly chunks: ChunkCache;
  private readonly baker: ReturnType<typeof createChunkBaker>;
  private readonly marker = bakeMarker();
  private readonly bounds = new Float64Array(4);
  private readonly resizeObserver: ResizeObserver;
  private dpr = 1;
  private qualityDprCap = 2;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.baker = createChunkBaker((key, image) => this.chunks.deliver(key, image));
    this.chunks = new ChunkCache(this.baker);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  setQualityDprCap(cap: number): void {
    this.qualityDprCap = cap;
    this.resize();
  }

  /** Re-reads size and pixel ratio. Caps each backing dimension at 4096. */
  resize(): void {
    const cssW = Math.max(1, this.canvas.clientWidth);
    const cssH = Math.max(1, this.canvas.clientHeight);
    let dpr = Math.min(window.devicePixelRatio || 1, this.qualityDprCap);
    dpr = Math.min(dpr, MAX_BACKING / cssW, MAX_BACKING / cssH);
    this.dpr = dpr;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.camera.setViewport(cssW, cssH);
  }

  /**
   * Draws one frame. `alpha` is the interpolation factor between `prev` and `curr`.
   * `prev` may be null before the second snapshot arrives.
   */
  render(prev: SnapshotViews | null, curr: SnapshotViews | null, alpha: number): void {
    const ctx = this.ctx;
    const cam = this.camera;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#10161c';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const c = Math.cos(cam.rotation);
    const s = Math.sin(cam.rotation);
    const z = cam.zoom * this.dpr;
    const e = (cam.width / 2) * this.dpr - z * (c * cam.x - s * cam.y);
    const f = (cam.height / 2) * this.dpr - z * (s * cam.x + c * cam.y);

    this.drawChunks(z * c, z * s, -z * s, z * c, e, f);
    if (curr) this.drawAircraft(prev, curr, alpha, z * c, z * s, -z * s, z * c, e, f);
  }

  private drawChunks(a: number, b: number, cc: number, d: number, e: number, f: number): void {
    const cam = this.camera;
    const band = bandForZoom(cam.zoom);
    cam.visibleBounds(this.bounds);
    const minCx = Math.floor(this.bounds[0] / CHUNK_SIZE_M);
    const minCy = Math.floor(this.bounds[1] / CHUNK_SIZE_M);
    const maxCx = Math.floor(this.bounds[2] / CHUNK_SIZE_M);
    const maxCy = Math.floor(this.bounds[3] / CHUNK_SIZE_M);
    this.chunks.update(band, minCx, minCy, maxCx, maxCy);

    const ctx = this.ctx;
    const px = chunkPixelSize(band);
    const inv = 1 / BAND_RASTER_SCALE[band];
    for (let cy = Math.max(0, minCy); cy <= Math.min(CHUNKS_PER_SIDE - 1, maxCy); cy++) {
      for (let cx = Math.max(0, minCx); cx <= Math.min(CHUNKS_PER_SIDE - 1, maxCx); cx++) {
        const entry = this.chunks.get(chunkKey(band, cx, cy));
        if (!entry || !entry.image) continue;
        // One transform per chunk: world meters, chunk origin, raster scale folded in.
        ctx.setTransform(
          a * inv,
          b * inv,
          cc * inv,
          d * inv,
          a * cx * CHUNK_SIZE_M + cc * cy * CHUNK_SIZE_M + e,
          b * cx * CHUNK_SIZE_M + d * cy * CHUNK_SIZE_M + f,
        );
        ctx.drawImage(entry.image, 0, 0, px, px);
      }
    }
  }

  private drawAircraft(
    prev: SnapshotViews | null,
    curr: SnapshotViews,
    alpha: number,
    a: number,
    b: number,
    cc: number,
    d: number,
    e: number,
    f: number,
  ): void {
    const ctx = this.ctx;
    const n = curr.header[SnapHeader.AircraftCount];
    const pn = prev ? prev.header[SnapHeader.AircraftCount] : 0;
    const k = MARKER_LENGTH_M / 64;
    for (let i = 0; i < n; i++) {
      let x = curr.aircraftX[i];
      let y = curr.aircraftY[i];
      let h = curr.aircraftHeading[i];
      // Match the previous snapshot by aircraft id, assuming the same index order.
      if (prev && i < pn && prev.aircraftId[i] === curr.aircraftId[i]) {
        const px = prev.aircraftX[i];
        const py = prev.aircraftY[i];
        // Skip interpolation across a site wrap.
        if (Math.abs(x - px) < 1000 && Math.abs(y - py) < 1000) {
          x = px + (x - px) * alpha;
          y = py + (y - py) * alpha;
        }
        h = curr.aircraftHeading[i];
      }
      const ch = Math.cos(h);
      const sh = Math.sin(h);
      // World matrix times sprite rotation, sprite centered, 40 m long.
      const ma = (a * ch + cc * sh) * k;
      const mb = (b * ch + d * sh) * k;
      const mc = (-a * sh + cc * ch) * k;
      const md = (-b * sh + d * ch) * k;
      const wx = a * x + cc * y + e;
      const wy = b * x + d * y + f;
      ctx.setTransform(ma, mb, mc, md, wx - (ma + mc) * 32, wy - (mb + md) * 32);
      ctx.drawImage(this.marker, 0, 0);
    }
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.baker.dispose();
    this.chunks.dispose();
  }
}
