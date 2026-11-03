import type { City, Climate, ClimateType, Preset } from '@shared/site';
import { cosLut, sinLut } from '@shared/trig';
import { SITE_M } from '@shared/site';
import type { Rng } from '../rng';

const DEG_TO_RAD = Math.PI / 180;

function pickClimate(rng: Rng, preset: Preset): ClimateType {
  const r = rng.next();
  if (preset === 'flatCoastal') {
    if (r < 0.4) return 'maritime';
    if (r < 0.7) return 'temperate';
    if (r < 0.9) return 'tropical';
    return 'arid';
  }
  if (r < 0.5) return 'temperate';
  if (r < 0.9) return 'continental';
  return 'maritime';
}

export function generateClimate(rng: Rng, preset: Preset): Climate {
  const type = pickClimate(rng, preset);
  const j = (lo: number, hi: number): number => Math.round(rng.range(lo, hi));
  const elevationM = preset === 'flatCoastal' ? j(2, 40) : j(50, 600);
  switch (type) {
    case 'tropical':
      return { type, tempMinC: j(18, 23), tempMaxC: j(30, 36), rainDays: j(120, 200), fogDays: j(2, 10), snowDays: 0, elevationM };
    case 'arid':
      return { type, tempMinC: j(2, 12), tempMaxC: j(34, 44), rainDays: j(15, 50), fogDays: j(0, 6), snowDays: 0, elevationM };
    case 'continental':
      return { type, tempMinC: j(-22, -8), tempMaxC: j(26, 34), rainDays: j(70, 120), fogDays: j(10, 30), snowDays: j(30, 80), elevationM };
    case 'maritime':
      return { type, tempMinC: j(-2, 5), tempMaxC: j(18, 25), rainDays: j(140, 220), fogDays: j(25, 60), snowDays: j(0, 8), elevationM };
    default:
      return { type, tempMinC: j(-8, 2), tempMaxC: j(26, 32), rainDays: j(90, 150), fogDays: j(8, 30), snowDays: j(5, 35), elevationM };
  }
}

export function generateCity(rng: Rng, preset: Preset): City {
  const population = Math.floor(60000 * (1 + 40 * rng.next() * rng.next()));
  const growthPctPerYear = Math.round(rng.range(-0.5, 3.0) * 10) / 10;
  const distanceKm = Math.round(rng.range(4, 22) * 10) / 10;
  const directionDeg = rng.int(0, 359);
  const incomeIndex = Math.round(rng.range(0.5, 1.5) * 100) / 100;
  const tourismShare = Math.round(rng.range(0.05, preset === 'flatCoastal' ? 0.5 : 0.3) * 100) / 100;
  const businessShare = Math.round(rng.range(0.1, 0.5) * 100) / 100;
  const a = directionDeg * DEG_TO_RAD;
  const x = SITE_M / 2 + distanceKm * 1000 * sinLut(a);
  const y = SITE_M / 2 - distanceKm * 1000 * cosLut(a);
  return { population, growthPctPerYear, distanceKm, directionDeg, incomeIndex, tourismShare, businessShare, x, y };
}
