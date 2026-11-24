import { GSE } from '@data/index';

const COLORS: Record<string, string> = {
  tug: '#d9a21b',
  tractor: '#c2452d',
  cart: '#8a96a0',
  beltloader: '#e6e8ea',
  catering: '#d8dde2',
  dispenser: '#cf5c1d',
  refueller: '#e2e5e8',
  gpu: '#2f7fc1',
  bus: '#e1b12c',
  stairs: '#cfd3d6',
};

export interface VehicleSprite {
  canvas: HTMLCanvasElement;
  ppm: number;
  width: number;
  height: number;
}

/** Bake resolutions in px per m, from the overview bake to the close up (T45). */
const PPM_LEVELS = [8, 16, 32, 64] as const;
/** Largest on screen magnification of a bake before the next finer one is used, as for map chunks. */
const MAX_MAGNIFY = 1.25;
const cache = new Map<number, VehicleSprite>();

/** The coarsest bake resolution magnified at most 1.25 times at a device zoom in px per m, or the finest. */
export function vehicleBakePpm(deviceZoom: number): number {
  for (const p of PPM_LEVELS) if (deviceZoom <= p * MAX_MAGNIFY) return p;
  return PPM_LEVELS[PPM_LEVELS.length - 1];
}

/** Top down vehicle at true size from the catalog, nose toward +x. Baked once per kind and resolution. */
export function vehicleSprite(kind: number, ppm: number = PPM_LEVELS[0]): VehicleSprite {
  const key = kind * 256 + ppm;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = GSE[kind];
  const pad = 1;
  const w = Math.ceil((spec.lengthM + pad * 2) * ppm);
  const h = Math.ceil((spec.widthM + pad * 2) * ppm);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(ppm, ppm);
    ctx.translate(w / ppm / 2, h / ppm / 2);
    const L = spec.lengthM;
    const W = spec.widthM;
    ctx.fillStyle = COLORS[spec.id] ?? '#aaa';
    ctx.fillRect(-L / 2, -W / 2, L, W);
    // Cab at the front and a dark roof line so the heading reads at low zoom.
    ctx.fillStyle = 'rgba(20,30,40,0.55)';
    ctx.fillRect(L / 2 - Math.min(2, L * 0.3), -W / 2 + 0.2, Math.min(2, L * 0.3) - 0.15, W - 0.4);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 0.08;
    ctx.strokeRect(-L / 2, -W / 2, L, W);
  }
  const sprite = { canvas, ppm, width: w, height: h };
  cache.set(key, sprite);
  return sprite;
}
