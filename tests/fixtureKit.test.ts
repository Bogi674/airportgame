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
import { FIXTURE_KEYS, checkInSpan, footprintOf } from '../src/shared/business';
import { dropOutCell } from '../src/shared/baggageNodes';
import { frontStep } from '../src/shared/useArea';
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

  it('gives every leveled family levels 1 to 3, with one footprint except the check in desk', () => {
    const families = new Map<string, { levels: number[]; size: string }>();
    for (const a of catalog.assets) {
      if (a.level === null || a.category !== 'processing') continue;
      const f = families.get(a.family) ?? { levels: [], size: a.size.join('x') };
      f.levels.push(a.level);
      // Revision 6: the check in desk grows with its level, every other processing family keeps one footprint.
      if (a.family !== 'checkIn') expect(a.size.join('x'), a.id).toBe(f.size);
      families.set(a.family, f);
    }
    for (const [name, f] of families) expect(f.levels.sort(), name).toEqual([1, 2, 3]);
  });
});

/** The three check in desks of Revision 6 and the security lane level 1 that replaced the old art. */
const DESKS = catalog.assets.filter((a) => a.family === 'checkIn');

describe('check in desk sizes (Revision 6)', () => {
  it('draws 2 x 2, 3 x 2 and 4 x 2 m of art on 1 x 1, 2 x 1 and 2 x 1 whole cells', () => {
    expect(DESKS.map((a) => a.size)).toEqual([[2, 2], [3, 2], [4, 2]]);
    expect(DESKS.map((a) => a.cells)).toEqual([[1, 1], [2, 1], [2, 1]]);
    for (const a of DESKS) {
      expect(checkInSpan(a.level!)).toEqual(a.cells);
      expect(footprintOf('checkIn', a.level!)).toEqual(a.cells);
      // The art fits its cells, and a 3 m desk leaves its last meter walkable.
      expect(a.size[0]).toBeLessThanOrEqual(a.cells![0]! * 2);
    }
  });

  it('carries the service points of the agent and the passenger', () => {
    for (const a of DESKS) expect(a.service).toEqual({ agent: [0.3, 0.4], passenger: [1.0, 1.85] });
  });

  it('keeps every stat, game key and confirm entry of the old desks', () => {
    expect(DESKS.map((a) => a.stats.serviceTimeS)).toEqual([120, 105, 95]);
    for (const a of DESKS) {
      expect(a.gameKey).toBe('checkIn');
      expect(a.stats.servers).toBe(1);
    }
    expect(DESKS.map((a) => a.confirm)).toEqual([[], ['serviceTimeS'], ['serviceTimeS']]);
  });

  it('keeps solid parts inside the art size, only floor layer and swing parts may leave it', () => {
    for (const a of [...DESKS, catalog.assets.find((x) => x.id === 'security.l1')!]) {
      const [w, h] = a.size;
      for (const op of packs[a.category].assets[a.id].ops) {
        if (('fl' in op && op.fl === 1) || ('swing' in op && op.swing === 1)) continue;
        for (const [x, y] of solidPoints(op)) {
          expect(x, a.id).toBeGreaterThanOrEqual(-0.001);
          expect(y, a.id).toBeGreaterThanOrEqual(-0.001);
          expect(x, a.id).toBeLessThanOrEqual(w + 0.001);
          expect(y, a.id).toBeLessThanOrEqual(h + 0.001);
        }
      }
    }
  });

  it('puts the out ramp on the cell behind the left cell for every level and rotation', () => {
    for (const a of DESKS) {
      expect(a.ramps).toEqual([{ cell: [0, -1], dir: 'out' }]);
      for (const rot of [0, 1, 2, 3] as const) {
        const [back] = [frontStep(rot)];
        expect(dropOutCell(10, 10, rot), `${a.id} rot ${rot}`).toEqual([10 - back[0], 10 - back[1]]);
      }
    }
  });

  it('runs the belt lane from x 0.6 to 1.4 m on the back row, in line with the ramp stub', () => {
    for (const a of DESKS) {
      const lane = packs.processing.assets[a.id].ops.find((op) => op.k === 'r' && op.y === 0 && Math.abs(op.x - 0.6) < 1e-6 && Math.abs(op.w - 0.8) < 1e-6);
      expect(lane, a.id).toBeDefined();
    }
  });

  it('simplifies the security lane level 1 and leaves levels 2 and 3 as they were', () => {
    const l1 = packs.processing.assets['security.l1'];
    const l2 = packs.processing.assets['security.l2'];
    expect(l1.size).toEqual([16, 4]);
    expect(l1.ops.length).toBeLessThan(l2.ops.length);
    const sec = catalog.assets.filter((a) => a.family === 'security');
    expect(sec.map((a) => a.stats.staff)).toEqual([4, 5, 4]);
    expect(sec.map((a) => a.stats.throughputPerHour)).toEqual([300, 360, 450]);
  });
});
