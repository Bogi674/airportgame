import { hash2 } from '@shared/noise';
import { CELL_M, GRID_N, LandClass } from '@shared/site';
import { CHUNK_SIZE_M } from '@shared/math';
import type { BakeSite } from '@shared/protocol';
import { BAND_RASTER_SCALE, chunkPixelSize } from './chunks';

const rgb = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;

const BASE: number[] = [];
BASE[LandClass.Water] = rgb(214, 201, 150);
BASE[LandClass.Beach] = rgb(214, 201, 150);
BASE[LandClass.Grass] = rgb(112, 150, 84);
BASE[LandClass.Forest] = rgb(70, 106, 62);
BASE[LandClass.Wetland] = rgb(92, 128, 96);
BASE[LandClass.Farmland] = rgb(150, 170, 90);
BASE[LandClass.Village] = rgb(150, 148, 120);
BASE[LandClass.Industrial] = rgb(140, 140, 138);
BASE[LandClass.Road] = rgb(96, 96, 98);
BASE[LandClass.Rock] = rgb(128, 122, 112);

const FIELD_TINTS = [rgb(150, 170, 90), rgb(176, 168, 96), rgb(128, 156, 84), rgb(166, 150, 108)];
const CANOPY = [rgb(46, 94, 52), rgb(60, 112, 60), rgb(38, 78, 48)];
const ROOFS = [rgb(176, 96, 76), rgb(120, 116, 112), rgb(190, 176, 150), rgb(98, 112, 130)];
const WATER_SHALLOW = rgb(74, 143, 168);
const WATER_DEEP = rgb(31, 78, 110);
const FOAM = rgb(190, 222, 230);

const R = (c: number): number => (c >> 16) & 255;
const G = (c: number): number => (c >> 8) & 255;
const B = (c: number): number => c & 255;

/** Bakes terrain chunks from the site rasters. Used by the bake worker and the main thread fallback. */
export class TerrainBaker {
  private readonly shade = new Float32Array(GRID_N * GRID_N);
  private readonly seed: number;
  private owner: Uint8Array | null = null;

  constructor(private readonly site: BakeSite) {
    let h = 0;
    for (let i = 0; i < site.seed.length; i++) h = (Math.imul(h, 31) + site.seed.charCodeAt(i)) | 0;
    this.seed = h;
    this.computeShade();
  }

  /** Owned land is cleared of trees and buildings. */
  setOwner(owner: Uint8Array): void {
    this.owner = owner;
  }

  private computeShade(): void {
    const hts = this.site.heights;
    for (let j = 0; j < GRID_N; j++) {
      const j0 = j > 0 ? j - 1 : j;
      const j1 = j < GRID_N - 1 ? j + 1 : j;
      for (let i = 0; i < GRID_N; i++) {
        const i0 = i > 0 ? i - 1 : i;
        const i1 = i < GRID_N - 1 ? i + 1 : i;
        const gx = (hts[j * GRID_N + i1] - hts[j * GRID_N + i0]) / ((i1 - i0) * CELL_M || 1);
        const gy = (hts[j1 * GRID_N + i] - hts[j0 * GRID_N + i]) / ((j1 - j0) * CELL_M || 1);
        let s = 1 + 9 * (-gx * 0.7 - gy * 0.7);
        s = s < 0.7 ? 0.7 : s > 1.3 ? 1.3 : s;
        this.shade[j * GRID_N + i] = s * (1 + hts[j * GRID_N + i] / 500);
      }
    }
  }

  /** Bakes one chunk to pixels, row by row, little endian RGBA. */
  bake(band: number, cx: number, cy: number): ImageData {
    const px = chunkPixelSize(band);
    const scale = BAND_RASTER_SCALE[band];
    const img = new ImageData(px, px);
    const out = new Uint32Array(img.data.buffer);
    const x0 = cx * CHUNK_SIZE_M;
    const y0 = cy * CHUNK_SIZE_M;
    const detail = scale >= 1;
    const hts = this.site.heights;
    const cls = this.site.landClass;
    const pid = this.site.parcelId;
    const shade = this.shade;
    const seed = this.seed;
    const maxIdx = GRID_N - 1;

    for (let py = 0; py < px; py++) {
      const wy = y0 + (py + 0.5) / scale;
      const gyf = wy / CELL_M - 0.5;
      let j0 = Math.floor(gyf);
      const ty = gyf - j0;
      let j1 = j0 + 1;
      if (j0 < 0) j0 = 0;
      if (j1 > maxIdx) j1 = maxIdx;
      if (j0 > maxIdx) j0 = maxIdx;
      for (let pxl = 0; pxl < px; pxl++) {
        const wx = x0 + (pxl + 0.5) / scale;
        const gxf = wx / CELL_M - 0.5;
        let i0 = Math.floor(gxf);
        const tx = gxf - i0;
        let i1 = i0 + 1;
        if (i0 < 0) i0 = 0;
        if (i1 > maxIdx) i1 = maxIdx;
        if (i0 > maxIdx) i0 = maxIdx;
        const o00 = j0 * GRID_N + i0;
        const o10 = j0 * GRID_N + i1;
        const o01 = j1 * GRID_N + i0;
        const o11 = j1 * GRID_N + i1;
        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;
        const h = hts[o00] * w00 + hts[o10] * w10 + hts[o01] * w01 + hts[o11] * w11;

        let r: number;
        let g: number;
        let b: number;
        if (h < 0) {
          const t = h < -6 ? 1 : -h / 6;
          const wc = h > -0.25 ? FOAM : 0;
          r = R(WATER_SHALLOW) + (R(WATER_DEEP) - R(WATER_SHALLOW)) * t;
          g = G(WATER_SHALLOW) + (G(WATER_DEEP) - G(WATER_SHALLOW)) * t;
          b = B(WATER_SHALLOW) + (B(WATER_DEEP) - B(WATER_SHALLOW)) * t;
          if (wc !== 0) {
            const f = (h + 0.25) / 0.25;
            r += (R(FOAM) - r) * f * 0.6;
            g += (G(FOAM) - g) * f * 0.6;
            b += (B(FOAM) - b) * f * 0.6;
          }
        } else {
          const c00 = BASE[cls[o00]];
          const c10 = BASE[cls[o10]];
          const c01 = BASE[cls[o01]];
          const c11 = BASE[cls[o11]];
          r = R(c00) * w00 + R(c10) * w10 + R(c01) * w01 + R(c11) * w11;
          g = G(c00) * w00 + G(c10) * w10 + G(c01) * w01 + G(c11) * w11;
          b = B(c00) * w00 + B(c10) * w10 + B(c01) * w01 + B(c11) * w11;
          const ci = Math.floor(wx / CELL_M);
          const cj = Math.floor(wy / CELL_M);
          const co = (cj > maxIdx ? maxIdx : cj) * GRID_N + (ci > maxIdx ? maxIdx : ci);
          let c = cls[co];
          if (this.owner !== null && this.owner[pid[co]] === 1 && (c === LandClass.Forest || c === LandClass.Village || c === LandClass.Industrial)) c = LandClass.Grass;
          if (c === LandClass.Farmland) {
            const tint = FIELD_TINTS[pid[co] & 3];
            r = r * 0.4 + R(tint) * 0.6;
            g = g * 0.4 + G(tint) * 0.6;
            b = b * 0.4 + B(tint) * 0.6;
            if (detail) {
              const dir = (pid[co] >> 2) & 3;
              const u = dir === 0 ? wx : dir === 1 ? wy : dir === 2 ? wx + wy : wx - wy;
              if (Math.floor(u / 5) % 2 === 0) {
                r *= 0.94;
                g *= 0.94;
                b *= 0.94;
              }
            }
          } else if (detail && c === LandClass.Forest) {
            const tx0 = Math.floor(wx / 8);
            const ty0 = Math.floor(wy / 8);
            let hit = -1;
            let shadow = false;
            for (let dy = -1; dy <= 1 && hit < 0; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const gx2 = tx0 + dx;
                const gy2 = ty0 + dy;
                if (hash2(seed, gx2, gy2) > 0.7) continue;
                const cxt = (gx2 + 0.5 + (hash2(seed + 1, gx2, gy2) - 0.5) * 0.6) * 8;
                const cyt = (gy2 + 0.5 + (hash2(seed + 2, gx2, gy2) - 0.5) * 0.6) * 8;
                const rad = 2.6 + 1.8 * hash2(seed + 3, gx2, gy2);
                const ddx = wx - cxt;
                const ddy = wy - cyt;
                if (ddx * ddx + ddy * ddy < rad * rad) {
                  hit = Math.floor(hash2(seed + 4, gx2, gy2) * 3);
                  break;
                }
                const sdx = ddx - 1.4;
                const sdy = ddy - 1.4;
                if (sdx * sdx + sdy * sdy < rad * rad) shadow = true;
              }
            }
            if (hit >= 0) {
              const cc = CANOPY[hit];
              r = R(cc);
              g = G(cc);
              b = B(cc);
            } else if (shadow) {
              r *= 0.7;
              g *= 0.7;
              b *= 0.7;
            }
          } else if (detail && (c === LandClass.Village || c === LandClass.Industrial)) {
            const lot = c === LandClass.Village ? 14 : 34;
            const lw = c === LandClass.Village ? 8 : 24;
            const lh = c === LandClass.Village ? 10 : 16;
            const lx = Math.floor(wx / lot);
            const ly = Math.floor(wy / lot);
            const ox = wx - lx * lot - 3;
            const oy = wy - ly * lot - 2;
            const hasHouse = hash2(seed + 5, lx, ly) < 0.85;
            if (hasHouse && ox >= lw && ox < lw + 1.6 && oy >= 1.2 && oy < lh + 1.6) {
              // Short dark strip along the south east sides, so the house sits on the ground.
              r *= 0.72;
              g *= 0.72;
              b *= 0.72;
            } else if (hasHouse && oy >= lh && oy < lh + 1.6 && ox >= 1.2 && ox < lw + 1.6) {
              r *= 0.72;
              g *= 0.72;
              b *= 0.72;
            }
            if (ox >= 0 && ox < lw && oy >= 0 && oy < lh && hasHouse) {
              const roof = ROOFS[Math.floor(hash2(seed + 6, lx, ly) * 4)];
              const edge = ox < 1 || oy < 1 || ox > lw - 1 || oy > lh - 1;
              const k = edge ? 0.75 : 1;
              r = R(roof) * k;
              g = G(roof) * k;
              b = B(roof) * k;
            }
          }
          const m = shade[co];
          r *= m;
          g *= m;
          b *= m;
        }
        r = r > 255 ? 255 : r;
        g = g > 255 ? 255 : g;
        b = b > 255 ? 255 : b;
        out[py * px + pxl] = 0xff000000 | (b << 16) | (g << 8) | r;
      }
    }
    return img;
  }
}
