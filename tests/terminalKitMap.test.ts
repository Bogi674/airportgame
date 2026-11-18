import { describe, expect, it } from 'vitest';
import catalogJson from '../src/data/fixtures/catalog.json';
import { FIXTURE_ASSET, TERMINAL_KIT_PACKS } from '../src/render/markings/airfieldPaint';
import { KIT_CATEGORIES } from '../src/render/sprites/fixtureKit';
import { FIXTURE_SPAN, type FixtureKey } from '../src/shared/business';

interface CatalogAsset {
  id: string;
  size: number[];
  category: string;
}

const assets = catalogJson.assets as CatalogAsset[];
const byId = new Map(assets.map((a) => [a.id, a]));
/** Fixtures whose kit asset may be smaller than the game footprint. All others must match it, see FIXTURE_SPAN. */
const FITS_KEYS: readonly FixtureKey[] = ['seating', 'toilet'];
const entries = Object.entries(FIXTURE_ASSET) as [FixtureKey, string][];

describe('terminal kit map', () => {
  it('maps every key to a catalog asset', () => {
    for (const [, asset] of entries) expect(byId.has(asset)).toBe(true);
  });

  it('keeps kit footprints equal to the game footprint or inside it', () => {
    for (const [key, id] of entries) {
      const [w, d] = byId.get(id)?.size ?? [0, 0];
      if (FITS_KEYS.includes(key)) {
        expect(w <= 2 && d <= 2, key).toBe(true);
      } else {
        expect([w, d], key).toEqual(FIXTURE_SPAN[key] === 2 ? [4, 2] : [2, 2]);
      }
    }
  });

  it('draws only from loaded terminal kit packs', () => {
    for (const [key, asset] of entries) {
      const category = byId.get(asset)?.category ?? '';
      expect(TERMINAL_KIT_PACKS, key).toContain(category);
      expect(KIT_CATEGORIES, key).toContain(category);
    }
  });
});
