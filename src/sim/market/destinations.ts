import { MARKET } from '@data/index';
import type { Destination } from '@shared/business';
import type { Rng } from '../rng';

/**
 * The procedural destination network of a seed (docs/DESIGN_REVISION_4.md section 3.4, D16): named
 * airports at a distance and bearing from the site, each with a size that is also its demand weight
 * and a region from its bearing. Built from its own RNG stream, so it never shifts other streams and
 * is rebuilt identically on load. The international flag is drawn from a second stream, `intlRng`, after
 * the loop, so the names and distances of older seeds stay as they were (T20).
 */
export function generateDestinations(rng: Rng, intlRng: Rng): Destination[] {
  const d = MARKET.destinations;
  const syl = d.syllables;
  const used = new Set<string>();
  const out: Destination[] = [];
  const sector = 360 / d.regions.length;
  for (let id = 0; id < d.count; id++) {
    let name = '';
    for (let tries = 0; tries < 30; tries++) {
      name = `${syl.start[rng.int(0, syl.start.length - 1)]}${syl.middle[rng.int(0, syl.middle.length - 1)]}${syl.end[rng.int(0, syl.end.length - 1)]}`;
      if (!used.has(name)) break;
    }
    // Names that still repeat after the tries get a number, so every destination stays unique.
    if (used.has(name)) name = `${name} ${id + 1}`;
    used.add(name);
    // Distances are uniform in km, rounded to whole kilometres; bearings in whole degrees.
    const km = Math.round(rng.range(d.minKm, d.maxKm));
    const bearingDeg = rng.int(0, 359);
    const size = rng.int(d.minSize, d.maxSize);
    // Regions are equal sectors of the compass, the first centred on north.
    const region = Math.floor((((bearingDeg + sector / 2) % 360) + 360) % 360 / sector) % d.regions.length;
    out.push({ id, name, km, bearingDeg, size, region, international: false });
  }
  for (let id = 0; id < out.length; id++) out[id].international = intlRng.next() < d.internationalShare;
  return out;
}

/**
 * A destination for a flight within the stage band and the type's range, picked by demand weight.
 * Falls back to the in range destination closest to the band when none lies inside it. Returns -1
 * when no destination is in range at all.
 */
export function pickDestination(rng: Rng, list: readonly Destination[], lo: number, hi: number, maxKm: number, avoid: ReadonlySet<number>): number {
  let total = 0;
  for (const x of list) if (x.km >= lo && x.km <= Math.min(hi, maxKm) && !avoid.has(x.id)) total += x.size;
  if (total > 0) {
    let r = rng.next() * total;
    for (const x of list) {
      if (x.km < lo || x.km > Math.min(hi, maxKm) || avoid.has(x.id)) continue;
      r -= x.size;
      if (r < 0) return x.id;
    }
  }
  let best = -1;
  let bestD = Infinity;
  for (const x of list) {
    if (x.km > maxKm) continue;
    const dist = x.km < lo ? lo - x.km : x.km > hi ? x.km - hi : 0;
    if (dist < bestD) {
      bestD = dist;
      best = x.id;
    }
  }
  return best;
}
