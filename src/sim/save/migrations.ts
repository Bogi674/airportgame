import type { GameOptions } from '@shared/protocol';
import type { CodeLetter } from '@shared/airfield';
import { sizeCode, sizeForCode } from '@shared/standSizes';
import { packTyped, unpackTyped } from './pack';

/** Bump on every change to the saved shape and add a migration for the old version. */
export const SAVE_VERSION = 13;

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
  // Version 3 to 4: the four stand types became four sizes, each contact or remote (docs/DESIGN_REVISION_2.md 3.1).
  if (save.version < 4) {
    const af = (save as { airfield?: { stands?: Record<string, unknown>[] } }).airfield;
    for (const st of af?.stands ?? []) {
      const size = sizeForCode(st.code as CodeLetter);
      st.size = size;
      st.code = sizeCode(size);
      st.type = st.type === 'contact' && size !== 'small' ? 'contact' : 'remote';
      st.pushback = st.pushback === 'left' || st.pushback === 'right' ? st.pushback : 'auto';
    }
    save.version = 4;
  }
  // Version 4 to 5: aprons gained names and holes (docs/DESIGN_REVISION_2.md section 4). Older aprons have no holes.
  if (save.version < 5) {
    const af = (save as { airfield?: { aprons?: Record<string, unknown>[]; apronNumber?: number } }).airfield;
    (af?.aprons ?? []).forEach((a, k) => {
      a.name = `Apron ${k + 1}`;
    });
    if (af) af.apronNumber = af.aprons?.length ?? 0;
    save.version = 5;
  }
  // Version 5 to 6: terminal grids grow and store their bounds. Older grids load as the fixed 160 by 160 grid.
  if (save.version < 6) save.version = 6;
  // Version 6 to 7: taxiways gained optional holding position settings, runways optional works and turn pads. Older saves keep the defaults and have no works.
  if (save.version < 7) save.version = 7;
  // Version 7 to 8: the airfield gained ATC towers. Older saves have none, and loading defaults them to an empty list.
  if (save.version < 8) save.version = 8;
  // Version 8 to 9: traffic gained the junction request table. Older saves load with no open requests.
  if (save.version < 9) save.version = 9;
  // Version 9 to 10: airlines remember a stand per rotation and flights carry their rotation index. Older saves load with no remembered stands.
  if (save.version < 10) save.version = 10;
  // Version 10 to 11: every terminal grid is one floor of a building and carries a building id and a floor level. Older grids are their own building on level 0.
  if (save.version < 11) {
    const business = (save as { business?: { grids?: Record<string, unknown>[] } }).business;
    for (const g of business?.grids ?? []) {
      g.building = g.id;
      g.level = 0;
    }
    save.version = 11;
  }
  // Version 11 to 12: terminal grids gained a fixture footprint layer, zero on every cell. Older grids have no two cell fixtures.
  if (save.version < 12) {
    const business = (save as { business?: { grids?: { fixture: string; fixtureRot?: string }[] } }).business;
    for (const g of business?.grids ?? []) {
      g.fixtureRot ??= packTyped(new Uint8Array(unpackTyped(g.fixture, Uint8Array).length));
    }
    save.version = 12;
  }
  // Version 12 to 13: service nodes save their queues and the service rng. Older saves load with empty queues.
  if (save.version < 13) save.version = 13;
  return save as SaveData;
}
