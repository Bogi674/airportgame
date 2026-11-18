import type { GameOptions } from '@shared/protocol';
import { ACCEPT_COMMERCIAL, ACCEPT_GA, type CodeLetter } from '@shared/airfield';
import { sizeCode, sizeForCode } from '@shared/standSizes';
import { packTyped, unpackTyped } from './pack';

/** Bump on every change to the saved shape and add a migration for the old version. */
export const SAVE_VERSION = 19;

/** Saves before version 15 counted 600 ticks per game minute, 12 times the 50 of today. */
const OLD_CLOCK_RATIO = 12;
/** AcState.Turnaround in ops/traffic.ts, the one aircraft state whose timer counts calendar time. */
const TURNAROUND_STATE = 4;

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
  // Version 13 to 14: traffic saves the GA arrival clock and its rng. Older saves load with the clock at zero.
  if (save.version < 14) save.version = 14;
  // Version 14 to 15: the calendar runs 12 times faster than motion (CLOCK_SCALE in shared/time.ts). The tick counter keeps its value, so the day number of an old save jumps. Waits that were set on the old calendar are shortened to the same number of game minutes on the new one: works, flight arrival times and retries, turnaround lengths and timers, delays, the GA clock and the weather.
  if (save.version < 15) {
    const old = save as {
      tick: number;
      airfield?: { runways?: { works?: { doneTick: number } }[]; taxiways?: { works?: { doneTick: number } }[] };
      traffic?: { arrays?: Record<string, string>; gaNextTick?: number };
      business?: { weatherStart?: number; weatherEnd?: number };
    };
    const now = old.tick;
    const later = (t: number): number => (t > now ? now + Math.round((t - now) / OLD_CLOCK_RATIO) : t);
    const af = old.airfield;
    for (const item of [...(af?.runways ?? []), ...(af?.taxiways ?? [])]) {
      if (item.works) item.works.doneTick = later(item.works.doneTick);
    }
    const arrays = old.traffic?.arrays;
    if (arrays?.fEta && arrays.fTurn && arrays.fDelay && arrays.fRetryAt && arrays.timer && arrays.state) {
      const rescale = (key: string, f: (v: number, k: number) => number): void => {
        const a = unpackTyped(arrays[key], Int32Array);
        for (let k = 0; k < a.length; k++) a[k] = f(a[k], k);
        arrays[key] = packTyped(a);
      };
      const state = unpackTyped(arrays.state, Uint8Array);
      rescale('fEta', later);
      rescale('fRetryAt', later);
      rescale('fTurn', (v) => Math.round(v / OLD_CLOCK_RATIO));
      rescale('fDelay', (v) => Math.round(v / OLD_CLOCK_RATIO));
      rescale('timer', (v, k) => (state[k] === TURNAROUND_STATE ? Math.round(v / OLD_CLOCK_RATIO) : v));
    }
    if (old.traffic && typeof old.traffic.gaNextTick === 'number') old.traffic.gaNextTick = later(old.traffic.gaNextTick);
    if (old.business) {
      if (typeof old.business.weatherStart === 'number') old.business.weatherStart = later(old.business.weatherStart);
      if (typeof old.business.weatherEnd === 'number') old.business.weatherEnd = later(old.business.weatherEnd);
    }
    save.version = 15;
  }
  // Version 15 to 16: the stand usage setting became the accepts bits (user, 2026-11-17). GA only and commercial only keep their meaning. Any meant GA on small remote stands and commercial everywhere.
  if (save.version < 16) {
    const af = (save as { airfield?: { stands?: Record<string, unknown>[] } }).airfield;
    for (const st of af?.stands ?? []) {
      const usage = st.usage;
      const both = ACCEPT_GA | ACCEPT_COMMERCIAL;
      st.accepts = usage === 'ga' ? ACCEPT_GA : usage === 'commercial' ? ACCEPT_COMMERCIAL : st.size === 'small' && st.type === 'remote' ? both : ACCEPT_COMMERCIAL;
      delete st.usage;
    }
    save.version = 16;
  }
  // Version 16 to 17: a taxiway may name the line it is a section of (T71). Older taxiways have none and are their own line.
  if (save.version < 17) save.version = 17;
  // Version 17 to 18: daily rotations become flight series (docs/DESIGN_REVISION_4.md section 3.5). Each rotation flies
  // daily at its old slot, on its remembered stand when it had one, to the destination nearest its scope's typical
  // stage. The destination is stored as a negative stage in km and resolved when the market loads.
  if (save.version < 18) {
    const b = (save as { business?: { day?: number; airlines?: Record<string, unknown>[]; market?: unknown } }).business;
    if (b?.airlines && b.market === undefined) {
      const day = typeof b.day === 'number' ? b.day : 0;
      const series: Record<string, number>[] = [];
      let next = 1;
      for (const a of b.airlines) {
        if (!('rotations' in a)) continue;
        const rotations = typeof a.rotations === 'number' ? a.rotations : 0;
        const slots = (a.slots as number[] | undefined) ?? [];
        const prefs = (a.standPrefs as number[] | undefined) ?? [];
        const fleet = (a.fleet as number[] | undefined) ?? [];
        const id = a.id as number;
        const stage = a.scope === 'regional' ? 525 : 1450;
        for (let k = 0; k < rotations && fleet.length > 0; k++) {
          const slot = slots[k] ?? 360;
          const stand = prefs[k] ?? -1;
          series.push({ id: next++, airline: id, dest: -stage, typeIdx: fleet[(id + k) % fleet.length], days: 127, winMin: slot, startDay: day, endDay: day + 26 * 7, standId: stand, minute: stand >= 0 ? slot : -1, turnMin: 0 });
        }
        a.signed = rotations > 0;
        a.hub = -1;
        a.happiness = 60;
        a.lowWeeks = 0;
        a.veryLowWeeks = 0;
        if (a.minRating === 70) a.scope = 'international';
        delete a.rotations;
        delete a.slots;
        delete a.standPrefs;
      }
      b.market = { series, nextSeries: next };
    }
    save.version = 18;
  }
  // Version 18 to 19: the airfield gained service roads and depots, and vehicles live in depots (T60, user 2026-11-18).
  // Older saves have neither, so their fleet is emptied; building a depot brings its starter set.
  if (save.version < 19) {
    const b = (save as { business?: { fleet?: number[] } }).business;
    if (b?.fleet) b.fleet = b.fleet.map(() => 0);
    save.version = 19;
  }
  return save as SaveData;
}
