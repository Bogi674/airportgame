import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import airfieldCodesJson from '../src/data/airfield_codes.json';
import standSizesJson from '../src/data/stand_sizes.json';
import surfacesJson from '../src/data/surfaces.json';
import { AIRFIELD, STAND_SIZES, SURFACE_SPEC } from '../src/data/index';
import { airfieldCodesSchema, standSizesSchema, surfacesSchema } from '../src/data/schemas';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Every path to an object key in a JSON value, so each field can be removed in turn. */
function keyPaths(v: Json, prefix: string[] = []): string[][] {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return [];
  const out: string[][] = [];
  for (const [k, child] of Object.entries(v)) {
    out.push([...prefix, k]);
    out.push(...keyPaths(child, [...prefix, k]));
  }
  return out;
}

function without(v: Json, path: string[]): Json {
  const copy = structuredClone(v) as { [k: string]: Json };
  let node = copy;
  for (const k of path.slice(0, -1)) node = node[k] as { [k: string]: Json };
  delete node[path[path.length - 1]];
  return copy;
}

const FILES: [string, Json, ZodType][] = [
  ['airfield_codes.json', airfieldCodesJson as Json, airfieldCodesSchema],
  ['surfaces.json', surfacesJson as Json, surfacesSchema],
  ['stand_sizes.json', standSizesJson as Json, standSizesSchema],
];

describe('data files', () => {
  for (const [name, json, schema] of FILES) {
    it(`${name} validates`, () => {
      expect(schema.safeParse(json).success).toBe(true);
    });

    it(`${name} fails on any missing field`, () => {
      const paths = keyPaths(json);
      expect(paths.length).toBeGreaterThan(5);
      for (const p of paths) {
        const r = schema.safeParse(without(json, p));
        if (r.success) throw new Error(`${name} still validates without ${p.join('.')}`);
      }
    });

    it(`${name} rejects unknown fields`, () => {
      expect(schema.safeParse({ ...(json as object), extra: 1 }).success).toBe(false);
    });
  }
});

describe('revision 2 tables', () => {
  it('taxiway codes follow table 2.3', () => {
    const table = { A: [7.5, 13, 9.25, 0], B: [10.5, 18, 12.75, 0], C: [15, 25, 17.5, 5], D: [18, 30, 21, 5.5], E: [23, 38, 26.5, 5.5], F: [25, 42, 29.5, 7.5] } as const;
    for (const [code, [width, turn, inner, shoulder]] of Object.entries(table)) {
      const row = AIRFIELD.codes[code as keyof typeof table];
      expect(row.taxiwayWidthM).toBe(width);
      expect(row.turnRadiusM).toBe(turn);
      expect(row.turnRadiusM - row.taxiwayWidthM / 2).toBeCloseTo(inner, 6);
      expect(row.taxiwayShoulderM).toBe(shoulder);
    }
  });

  it('stand sizes follow table 3.2', () => {
    const table = { small: [30, 24, 16.5, 3, null], medium: [45, 52, 24.5, 4.5, 6], large: [80, 88, 42.5, 7.5, 6], xl: [95, 94, 50.5, 7.5, 6] } as const;
    for (const [size, [w, depth, fork, wingtip, nose]] of Object.entries(table)) {
      const s = STAND_SIZES[size as keyof typeof table];
      expect([s.widthM, s.depthM, s.forkRadiusM, s.wingtipClearanceM, s.noseClearanceM]).toEqual([w, depth, fork, wingtip, nose]);
    }
    expect(STAND_SIZES.xl.mergeable).toBe(true);
    expect(STAND_SIZES.large.mergeable || STAND_SIZES.medium.mergeable || STAND_SIZES.small.mergeable).toBe(false);
  });

  it('large and extra large stands and codes D to F are paved only', () => {
    for (const size of ['large', 'xl'] as const) expect(STAND_SIZES[size].surfaces).toEqual(['asphalt', 'concrete']);
    for (const s of ['grass', 'dirt', 'gravel'] as const) {
      expect(SURFACE_SPEC[s].allowedCodes).toEqual(['A', 'B', 'C']);
      expect(SURFACE_SPEC[s].paint).toBe('markers');
    }
    for (const s of ['asphalt', 'concrete'] as const) expect(SURFACE_SPEC[s].allowedCodes).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });
});
