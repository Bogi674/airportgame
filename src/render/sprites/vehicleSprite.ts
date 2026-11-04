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

const PPM = 8;
const cache: (VehicleSprite | undefined)[] = [];

/** Top down vehicle at true size from the catalog, nose toward +x. Baked once per kind. */
export function vehicleSprite(kind: number): VehicleSprite {
  const hit = cache[kind];
  if (hit) return hit;
  const spec = GSE[kind];
  const pad = 1;
  const w = Math.ceil((spec.lengthM + pad * 2) * PPM);
  const h = Math.ceil((spec.widthM + pad * 2) * PPM);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(PPM, PPM);
    ctx.translate(w / PPM / 2, h / PPM / 2);
    const L = spec.lengthM;
    const W = spec.widthM;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(-L / 2 + 0.25, -W / 2 + 0.25, L, W);
    ctx.fillStyle = COLORS[spec.id] ?? '#aaa';
    ctx.fillRect(-L / 2, -W / 2, L, W);
    // Cab at the front and a dark roof line so the heading reads at low zoom.
    ctx.fillStyle = 'rgba(20,30,40,0.55)';
    ctx.fillRect(L / 2 - Math.min(2, L * 0.3), -W / 2 + 0.2, Math.min(2, L * 0.3) - 0.15, W - 0.4);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 0.08;
    ctx.strokeRect(-L / 2, -W / 2, L, W);
  }
  const sprite = { canvas, ppm: PPM, width: w, height: h };
  cache[kind] = sprite;
  return sprite;
}
