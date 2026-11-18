/**
 * Lazy loader for the terminal asset kit sprite packs. A pack is a JSON file under src/data/fixtures/sprites, loaded
 * the first time a category is requested and kept for the session. Baking reads only the packs already loaded.
 */
import { fixtureSpritePackSchema, type FixtureOp } from '../../data/schemas';

export const KIT_CATEGORIES = [
  'processing',
  'zoning',
  'baggage',
  'seating',
  'lounge',
  'washroom',
  'decoration',
  'vending',
  'screens',
  'service',
  'office',
  'circulation',
  'backOfHouse',
] as const;

export type KitCategory = (typeof KIT_CATEGORIES)[number];

export interface KitAsset {
  /** Width and depth in meters, rotation 0. */
  size: [number, number];
  ops: FixtureOp[];
}

const LOADERS: Record<KitCategory, () => Promise<{ default: unknown }>> = {
  processing: () => import('../../data/fixtures/sprites/processing.json'),
  zoning: () => import('../../data/fixtures/sprites/zoning.json'),
  baggage: () => import('../../data/fixtures/sprites/baggage.json'),
  seating: () => import('../../data/fixtures/sprites/seating.json'),
  lounge: () => import('../../data/fixtures/sprites/lounge.json'),
  washroom: () => import('../../data/fixtures/sprites/washroom.json'),
  decoration: () => import('../../data/fixtures/sprites/decoration.json'),
  vending: () => import('../../data/fixtures/sprites/vending.json'),
  screens: () => import('../../data/fixtures/sprites/screens.json'),
  service: () => import('../../data/fixtures/sprites/service.json'),
  office: () => import('../../data/fixtures/sprites/office.json'),
  circulation: () => import('../../data/fixtures/sprites/circulation.json'),
  backOfHouse: () => import('../../data/fixtures/sprites/backOfHouse.json'),
};

const assets = new Map<string, KitAsset>();
const packLoads = new Map<KitCategory, Promise<void>>();

function loadPack(cat: KitCategory): Promise<void> {
  let load = packLoads.get(cat);
  if (load === undefined) {
    load = LOADERS[cat]().then((mod) => {
      const pack = fixtureSpritePackSchema.parse(mod.default);
      for (const [id, asset] of Object.entries(pack.assets)) {
        assets.set(id, { size: asset.size, ops: asset.ops });
      }
    });
    packLoads.set(cat, load);
  }
  return load;
}

/** Loads the packs of the given categories that are not loaded yet. Each pack is fetched and parsed once. */
export async function ensurePacks(cats: readonly KitCategory[]): Promise<void> {
  await Promise.all(cats.map(loadPack));
}

/** A loaded asset by id, or undefined when its category pack is not loaded. */
export function kitAsset(id: string): KitAsset | undefined {
  return assets.get(id);
}
