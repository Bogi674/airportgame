import { describe, expect, it } from 'vitest';
import catalogJson from '../src/data/fixtures/catalog.json';
import { FIXTURE_ASSET, FIXTURE_LEVEL_ASSET, KIT_FLOW_TURN, STAFF_DOOR_ASSET, TERMINAL_KIT_PACKS } from '../src/render/markings/airfieldPaint';
import { KIT_CATEGORIES } from '../src/render/sprites/fixtureKit';
import { footprintOf, type FixtureKey } from '../src/shared/business';

interface CatalogAsset {
  id: string;
  size: number[];
  category: string;
}

/** A kit asset of a fixture at one level. */
interface KitEntry {
  key: FixtureKey;
  level: number;
  asset: string;
}

const assets = catalogJson.assets as CatalogAsset[];
const byId = new Map(assets.map((a) => [a.id, a]));
/** Fixture levels whose kit asset may be smaller than the game footprint. All others must match it, see FIXTURE_FOOTPRINT. */
const FITS_KEYS: readonly [FixtureKey, number][] = [
  ['seating', 1],
  ['toilet', 1],
  ['securityExit', 3],
  // The level 2 check in desk is 3 m of art on two cells (Revision 6, whole cells).
  ['checkIn', 2],
  // The 3.6 m wide travelator pairs sit in a 4 m wide footprint (T77).
  ['travelator', 1],
  ['travelator', 2],
  ['travelator', 3],
];
const entries: KitEntry[] = [
  ...(Object.entries(FIXTURE_ASSET) as [FixtureKey, string][]).map(([key, asset]) => ({ key, level: 1, asset })),
  ...(Object.entries(FIXTURE_LEVEL_ASSET) as [FixtureKey, readonly string[]][]).flatMap(([key, list]) => list.map((asset, i) => ({ key, level: i + 1, asset }))),
];

describe('terminal kit map', () => {
  it('maps every key to a catalog asset', () => {
    for (const { asset } of entries) expect(byId.has(asset)).toBe(true);
  });

  it('keeps kit footprints equal to the game footprint or inside it', () => {
    for (const { key, level, asset } of entries) {
      const [sw, sd] = byId.get(asset)?.size ?? [0, 0];
      // Art that flows along its x axis is drawn a quarter turn round, so its sides swap (the security lane, T74).
      const turned = (KIT_FLOW_TURN[key] ?? 0) % 180 !== 0;
      const [w, d] = turned ? [sd, sw] : [sw, sd];
      const [along, across] = footprintOf(key, level);
      if (FITS_KEYS.some(([k, l]) => k === key && l === level)) {
        expect(w <= along * 2 && d <= across * 2, asset).toBe(true);
      } else {
        expect([w, d], asset).toEqual([along * 2, across * 2]);
      }
    }
  });

  it('draws only from loaded terminal kit packs', () => {
    for (const { asset } of entries) {
      const category = byId.get(asset)?.category ?? '';
      expect(TERMINAL_KIT_PACKS, asset).toContain(category);
      expect(KIT_CATEGORIES, asset).toContain(category);
    }
  });

  it('loads the staff door from the zoning pack', () => {
    const category = byId.get(STAFF_DOOR_ASSET)?.category ?? '';
    expect(TERMINAL_KIT_PACKS).toContain(category);
  });
});
