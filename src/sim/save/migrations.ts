import type { GameOptions } from '@shared/protocol';
import type { CodeLetter } from '@shared/airfield';
import { sizeCode, sizeForCode } from '@shared/standSizes';

/** Bump on every change to the saved shape and add a migration for the old version. */
export const SAVE_VERSION = 9;

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
  return save as SaveData;
}
