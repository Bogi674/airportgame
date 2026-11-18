import { describe, expect, it } from 'vitest';
import catalogJson from '../src/data/fixtures/catalog.json';
import backOfHouse from '../src/data/fixtures/sprites/backOfHouse.json';
import baggage from '../src/data/fixtures/sprites/baggage.json';
import circulation from '../src/data/fixtures/sprites/circulation.json';
import decoration from '../src/data/fixtures/sprites/decoration.json';
import lounge from '../src/data/fixtures/sprites/lounge.json';
import office from '../src/data/fixtures/sprites/office.json';
import processing from '../src/data/fixtures/sprites/processing.json';
import screens from '../src/data/fixtures/sprites/screens.json';
import seating from '../src/data/fixtures/sprites/seating.json';
import service from '../src/data/fixtures/sprites/service.json';
import vending from '../src/data/fixtures/sprites/vending.json';
import washroom from '../src/data/fixtures/sprites/washroom.json';
import zoning from '../src/data/fixtures/sprites/zoning.json';
import { FIXTURE_KEYS } from '../src/shared/business';
import { fixtureCatalogSchema, fixtureSpritePackSchema, type FixtureOp } from '../src/data/schemas';

const PACKS = { backOfHouse, baggage, circulation, decoration, lounge, office, processing, screens, seating, service, vending, washroom, zoning };
const catalog = fixtureCatalogSchema.parse(catalogJson);
const packs = Object.fromEntries(Object.entries(PACKS).map(([k, v]) => [k, fixtureSpritePackSchema.parse(v)]));

/** Points of a solid op, used to check that it stays near its footprint. */
function solidPoints(op: FixtureOp): Array<[number, number]> {
  switch (op.k) {
    case 'r':
      return [[op.x, op.y], [op.x + op.w, op.y + op.h]];
    case 'c':
      return [[op.x - op.r, op.y - op.r], [op.x + op.r, op.y + op.r]];
    case 'p':
      return op.p;
    case 'l':
      return [[op.x1, op.y1], [op.x2, op.y2]];
    default:
      return [];
  }
}

describe('terminal asset kit', () => {
  it('has one sprite pack per category and one sprite per asset', () => {
    expect(Object.keys(packs).sort()).toEqual(catalog.categories.map((c) => c.id).sort());
    for (const a of catalog.assets) {
      const sprite = packs[a.category].assets[a.id];
      expect(sprite, a.id).toBeDefined();
      expect(sprite.size).toEqual(a.size);
    }
    const total = Object.values(packs).reduce((n, p) => n + Object.keys(p.assets).length, 0);
    expect(total).toBe(catalog.assets.length);
  });

  it('uses unique ids and existing fixture keys', () => {
    const ids = catalog.assets.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of catalog.assets) if (a.gameKey !== null) expect(FIXTURE_KEYS as readonly string[]).toContain(a.gameKey);
  });

  it('lists only stats that exist as proposals to confirm', () => {
    for (const a of catalog.assets) for (const k of a.confirm) expect(Object.keys(a.stats), `${a.id} ${k}`).toContain(k);
  });

  it('keeps solid parts within 0.6 m of the footprint', () => {
    for (const a of catalog.assets) {
      const [w, h] = a.size;
      for (const op of packs[a.category].assets[a.id].ops) {
        for (const [x, y] of solidPoints(op)) {
          expect(x, a.id).toBeGreaterThanOrEqual(-0.6);
          expect(y, a.id).toBeGreaterThanOrEqual(-0.6);
          expect(x, a.id).toBeLessThanOrEqual(w + 0.6);
          expect(y, a.id).toBeLessThanOrEqual(h + 0.6);
        }
      }
    }
  });

  it('gives every leveled family levels 1 to 3 with the same footprint', () => {
    const families = new Map<string, { levels: number[]; size: string }>();
    for (const a of catalog.assets) {
      if (a.level === null || a.category !== 'processing') continue;
      const f = families.get(a.family) ?? { levels: [], size: a.size.join('x') };
      f.levels.push(a.level);
      expect(a.size.join('x'), a.id).toBe(f.size);
      families.set(a.family, f);
    }
    for (const [name, f] of families) expect(f.levels.sort(), name).toEqual([1, 2, 3]);
  });
});
