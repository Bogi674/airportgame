import type { GameOptions } from '@shared/protocol';

/** Bump on every change to the saved shape and add a migration for the old version. */
export const SAVE_VERSION = 3;

export interface SaveData {
  version: number;
  seed: string;
  options: GameOptions;
  tick: number;
  gameSeconds: number;
  cash: number;
  rng: number;
  parcelOwner: string;
  airfield: unknown;
  traffic: unknown;
  business: unknown;
}

/** Brings any older save up to the current shape. Newer saves are refused with a clear message. */
export function migrate(raw: unknown): SaveData {
  const save = raw as { version?: number };
  if (typeof save !== 'object' || save === null || typeof save.version !== 'number') throw new Error('This is not an Airfield Tycoon save');
  if (save.version > SAVE_VERSION) throw new Error(`This save was made by a newer version (save format ${save.version}, this game reads ${SAVE_VERSION})`);
  // Version 1 to 2: terminals gained a zone layer and airlines gained slots. Both default on load.
  if (save.version < 2) save.version = 2;
  // Version 2 to 3: taxiways gained optional surface works. Older saves have none under way.
  if (save.version < 3) save.version = 3;
  return save as SaveData;
}
