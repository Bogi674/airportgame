import type { GameOptions } from '@shared/protocol';
import { ACCEPT_COMMERCIAL, ACCEPT_GA, type CodeLetter } from '@shared/airfield';
import { sizeCode, sizeForCode } from '@shared/standSizes';
import { packTyped, unpackTyped } from './pack';
import { ROT_STEP } from '@shared/terminalOps';
import { BAGGAGE, GROUND, NEEDS, PROFILES } from '@data/index';
import { NEED_COUNT } from '@data/schemas/needs';
import { FLAG_SLOW } from '../cohorts/cohorts';
import { FIXTURE_KEYS } from '@shared/business';
import { LEGACY_SERVICE_COUNT, SERVICE_KEYS, V33_SERVICE_COUNT, type ServiceSave } from '../terminal/serviceNodes';
import { TRAIT, TRAIT_COUNT, memberSeedOf, writeTraits } from '../cohorts/traits';

/** Bump on every change to the saved shape and add a migration for the old version. */
export const SAVE_VERSION = 43;

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
  /** Ground vehicles, since version 21 (T63). */
  vehicles?: unknown;
  /** Turnaround task lists, since version 21 (T63). */
  turnarounds?: unknown;
  /** Baggage network, since version 23 (T43). */
  baggage?: unknown;
  /** Airport staff, since version 31 (T68). */
  staff?: unknown;
  cleaning?: unknown;
  /** The event director (T50), since version 41. */
  events?: unknown;
  /** Set by the migration to version 33 (T78): legacy belts become carousels on restore. Never written by a save. */
  convertBelts?: boolean;
  /**
   * Set by the migration to version 35 (T74): array cells of the one cell security lanes per grid index. Sim.restore
   * removes them and refunds their cost, since a lane now has the kit footprint. Never written by a save.
   */
  legacyLanes?: number[][];
  /** Set by the migration to version 36 (T76): seating and toilet fixtures become props on restore. Never written by a save. */
  convertProps?: boolean;
  /** Set by the migration to version 39 (T32): shop fixtures become tenant units on restore. Never written by a save. */
  convertShops?: boolean;
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
  // Version 19 to 20: supporting buildings, fuel stock and orders, fire grace, and fuel owed per aircraft (T65).
  // Older saves have none of them and start their 7 days of fire grace on the day they load (user, 2026-11-18).
  if (save.version < 20) {
    const b = (save as { business?: { day?: number; fireGraceUntil?: number } }).business;
    if (b) b.fireGraceUntil = (b.day ?? 0) + GROUND.fire.graceDays;
    save.version = 20;
  }
  // Version 20 to 21: vehicles and turnaround task lists are saved, and airline flights run task lists (T63). Older saves
  // have no vehicles on the apron, and their aircraft already on stands finish on the timer they had, as no slot is tasked.
  if (save.version < 21) save.version = 21;
  // Version 21 to 22: flights carry a stable serial (T43). Traffic derives serials for saves without them.
  if (save.version < 22) save.version = 22;
  // Version 22 to 23: the baggage network is saved (T43). Older saves have no baggage key and get drop points from their grids on load.
  if (save.version < 23) save.version = 23;
  // Version 23 to 24: bag batches, machine tokens and the daily missing bag counters are saved inside the baggage key (T43). Older saves have none and start with no bags in flight.
  if (save.version < 24) save.version = 24;
  // Version 24 to 25: arrival bag batches and the daily claim wait counters are saved in the baggage flow (T43). Older saves load them as zero.
  if (save.version < 25) save.version = 25;
  // Version 25 to 26: stands gained upgrades, upgrade works and a gate desk (T66). Older stands load with no upgrades, no works and the nearest gate desk.
  if (save.version < 26) save.version = 26;
  // Version 26 to 27: cohorts gained the walk they are on (T54). Older cohorts load with no walk.
  if (save.version < 27) {
    const co = (save as { cohorts?: { hi?: number; arrays?: Record<string, string> } }).cohorts;
    if (co?.arrays && typeof co.hi === 'number') co.arrays.walkStart = packTyped(new Int32Array(co.hi).fill(-1));
    save.version = 27;
  }
  // Version 27 to 28: fixtures keep an anchor offset, a level and a mode, security lanes a direction (T75).
  if (save.version < 28) {
    type OldGrid = { w?: number; zone?: string; fixture: string; fixtureRot?: string; fixtureOff?: string; fixtureLevel?: string; fixtureMode?: string };
    const business = (save as { business?: { grids?: OldGrid[] } }).business;
    const SECURITY = 2;
    for (const g of business?.grids ?? []) {
      const fixture = unpackTyped(g.fixture, Uint8Array);
      const n = fixture.length;
      const rotLayer = g.fixtureRot ? unpackTyped(g.fixtureRot, Uint8Array) : new Uint8Array(n);
      const zone = g.zone ? unpackTyped(g.zone, Uint8Array) : new Uint8Array(n);
      const w = g.w ?? 160;
      const h = n / w;
      const off = new Uint8Array(n);
      const level = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (rotLayer[i] >= 5) off[i] = 1;
        if (fixture[i] > 0) level[i] = 1;
      }
      const zoneAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? -1 : zone[y * w + x]);
      for (let i = 0; i < n; i++) {
        if (fixture[i] !== SECURITY || rotLayer[i] !== 0) continue;
        const x = i % w;
        const y = Math.floor(i / w);
        const here = zone[i];
        let found = 0;
        for (let rot = 0; rot < 4; rot++) {
          const [sx, sy] = ROT_STEP[(rot + 3) % 4];
          const ahead = zoneAt(x + sx, y + sy);
          const behind = zoneAt(x - sx, y - sy);
          if (((here === 0 || here === 1) && ahead === 3) || ((behind === 0 || behind === 1) && here === 3)) {
            found = rot;
            break;
          }
        }
        rotLayer[i] = 1 + found;
      }
      g.fixtureRot = packTyped(rotLayer);
      g.fixtureOff = packTyped(off);
      g.fixtureLevel = packTyped(level);
      g.fixtureMode = packTyped(new Uint8Array(n));
    }
    save.version = 28;
  }
  // Version 28 to 29: cohort members with traits seeds, needs and satisfaction, and the visit state of sub cohorts (T67). Older cohorts get seeded members, full satisfaction and no visit.
  if (save.version < 29) {
    const co = (save as { cohorts?: { hi?: number; arrays?: Record<string, string> } }).cohorts;
    const arrays = co?.arrays;
    if (arrays && typeof co.hi === 'number' && arrays.recipeSeed && arrays.size) {
      const hi = co.hi;
      const m = PROFILES.maxGroup;
      const recipe = unpackTyped(arrays.recipeSeed, Uint32Array);
      const size = unpackTyped(arrays.size, Uint8Array);
      const profile = arrays.profile ? unpackTyped(arrays.profile, Uint8Array) : new Uint8Array(hi);
      const memberSeed = new Uint32Array(hi * m);
      const memberSat = new Uint8Array(hi * m);
      const memberNeed = new Uint16Array(hi * m * NEED_COUNT);
      const traits = new Float64Array(TRAIT_COUNT);
      const flags = arrays.flags ? unpackTyped(arrays.flags, Uint8Array) : new Uint8Array(hi);
      for (let c = 0; c < hi; c++) {
        for (let i = 0; i < size[c]!; i++) {
          const seed = memberSeedOf(recipe[c]!, i);
          writeTraits(seed, profile[c]!, traits);
          const b = c * m + i;
          memberSeed[b] = seed;
          memberSat[b] = NEEDS.satisfaction.start;
          memberNeed[b * NEED_COUNT + NEED_COUNT - 1] = Math.floor(traits[TRAIT.Desire]! * 1000);
          if (traits[TRAIT.Slow] === 1) flags[c] = flags[c]! | FLAG_SLOW;
        }
      }
      arrays.flags = packTyped(flags);
      arrays.memberSeed = packTyped(memberSeed);
      arrays.memberSat = packTyped(memberSat);
      arrays.memberNeed = packTyped(memberNeed);
      arrays.needTick = packTyped(new Int32Array(hi).fill((save as { tick?: number }).tick ?? 0));
      arrays.parent = packTyped(new Int32Array(hi).fill(-1));
      arrays.waitStart = packTyped(new Int32Array(hi).fill(-1));
      arrays.target = packTyped(new Int32Array(hi).fill(-1));
      arrays.visitNeed = packTyped(new Uint8Array(hi));
    }
    save.version = 29;
  }
  // Version 29 to 30: cohorts save the day counters of passenger satisfaction and its 30 day ring (T67). Older saves start with both empty.
  if (save.version < 30) save.version = 30;
  // Version 30 to 31: the arrival journey (T20). eGate and customs anchors became service nodes, so each saved service table gets an empty row per such anchor, inserted in cell order. Cohorts gain the serial and born slot arrays, the arrival counters and the arrivals rng, and baggage gains the carousel delivery rows; all are optional and start empty.
  if (save.version < 31) {
    const biz = (save as { business?: { grids?: { fixture?: string; fixtureRot?: string }[]; service?: ServiceSave[] } }).business;
    const grids = biz?.grids ?? [];
    const tables = biz?.service ?? [];
    for (let i = 0; i < tables.length; i++) {
      const g = grids[i];
      if (g?.fixture === undefined || g.fixtureRot === undefined) continue;
      tables[i] = insertNewServiceRows(tables[i]!, unpackTyped(g.fixture, Uint8Array), unpackTyped(g.fixtureRot, Uint8Array), LEGACY_SERVICE_IDS, V31_SERVICE_IDS).table;
    }
    save.version = 31;
  }
  // Version 31 to 32: airport staff as individuals (T68). Older saves have none; the first staffing pass hires the running shift on its stations.
  if (save.version < 32) save.version = 32;
  // Version 32 to 33: baggage trains and carousel sizes (T78). A carousel keeps its size in widthCells, so every saved
  // carousel becomes the medium size it was drawn as. Vehicles gain the trip arrays, which start empty.
  if (save.version < 33) {
    const nodes = (save as { baggage?: { nodes?: { kind: string; spec: { widthCells: number } | null }[] } }).baggage?.nodes ?? [];
    const medium = BAGGAGE.carousel.sizes[BAGGAGE.carousel.defaultSize].w;
    for (const n of nodes) if (n.kind === 'carousel' && n.spec) n.spec.widthCells = medium;
    // Legacy belts become carousels once the sim has the grids, see Sim.restore.
    (save as { convertBelts?: boolean }).convertBelts = true;
    save.version = 33;
  }
  // Version 33 to 34: security exits became service nodes (T80). Each saved service table gets an empty row per exit
  // anchor, inserted in cell order, and the node index every saved cohort holds moves to the renumbered row.
  if (save.version < 34) {
    const biz = (save as { business?: { grids?: { fixture?: string; fixtureRot?: string }[]; service?: ServiceSave[] } }).business;
    const grids = biz?.grids ?? [];
    const tables = biz?.service ?? [];
    const remaps: (Int32Array | null)[] = [];
    for (let i = 0; i < tables.length; i++) {
      const g = grids[i];
      remaps.push(null);
      if (g?.fixture === undefined || g.fixtureRot === undefined) continue;
      const out = insertNewServiceRows(tables[i]!, unpackTyped(g.fixture, Uint8Array), unpackTyped(g.fixtureRot, Uint8Array), V31_SERVICE_IDS, ALL_SERVICE_IDS);
      tables[i] = out.table;
      remaps[i] = out.newIndexOfOld;
    }
    const co = (save as { cohorts?: { hi?: number; arrays?: Record<string, string> } }).cohorts;
    if (co?.arrays?.node !== undefined && co.arrays.building !== undefined && remaps.some((r) => r !== null)) {
      const node = unpackTyped(co.arrays.node, Int32Array);
      const building = unpackTyped(co.arrays.building, Uint8Array);
      for (let c = 0; c < node.length; c++) {
        const map = remaps[building[c]!];
        if (map && node[c]! >= 0 && node[c]! < map.length) node[c] = map[node[c]!]!;
      }
      co.arrays.node = packTyped(node);
    }
    save.version = 34;
  }
  // Version 34 to 35: fixture levels and upgrade works (T74). The business gains the works list, which starts empty.
  // A security lane is now 2 by 8 cells, so every saved one cell lane, an anchor with no tail beside it, is listed
  // for removal on restore.
  if (save.version < 35) {
    const grids = (save as { business?: { grids?: { w?: number; fixture?: string; fixtureRot?: string }[] } }).business?.grids ?? [];
    const security = FIXTURE_KEYS.indexOf('security') + 1;
    const lanes: number[][] = [];
    for (const g of grids) {
      const cells: number[] = [];
      if (g.fixture !== undefined && g.w !== undefined) {
        const fixture = unpackTyped(g.fixture, Uint8Array);
        const rot = g.fixtureRot !== undefined ? unpackTyped(g.fixtureRot, Uint8Array) : new Uint8Array(fixture.length);
        const w = g.w;
        for (let c = 0; c < fixture.length; c++) {
          if (fixture[c] !== security || rot[c]! >= ANCHOR_ROT_LIMIT) continue;
          const [ax, ay] = ROT_STEP[rot[c]! > 0 ? rot[c]! - 1 : 0]!;
          const x = (c % w) + ax;
          const tail = (Math.floor(c / w) + ay) * w + x;
          const hasTail = x >= 0 && x < w && tail >= 0 && tail < fixture.length && fixture[tail] === security && rot[tail]! >= ANCHOR_ROT_LIMIT;
          if (!hasTail) cells.push(c);
        }
      }
      lanes.push(cells);
    }
    if (lanes.some((l) => l.length > 0)) (save as { legacyLanes?: number[][] }).legacyLanes = lanes;
    save.version = 35;
  }
  // Version 35 to 36: props on the 0.5 m grid (T76). Grids gain a props list, which loads empty, and every seating and
  // toilet fixture becomes props on restore, since both are props now.
  if (save.version < 36) {
    (save as { convertProps?: boolean }).convertProps = true;
    save.version = 36;
  }
  // Version 36 to 37: apron crews (T81). Turnarounds gain the crew held per aircraft, which loads as none, so a
  // turnaround saved before chocks claims its crew on the next step and one saved after chocks runs on without one.
  if (save.version < 37) save.version = 37;
  // Version 37 to 38: cleaners and terminal dirt (T81). The save gains the dirt of every room, which an older save
  // lacks, so its rooms load clean; the cleaner role and its janitor room stations are hired by the first pass.
  if (save.version < 38) save.version = 38;
  // Version 38 to 39: tenant units (T32). The business gains the tenants block, which loads with no units, and every
  // shop fixture becomes a unit over its cells with a generated tenant on restore.
  if (save.version < 39) {
    (save as { convertShops?: boolean }).convertShops = true;
    save.version = 39;
  }
  // Version 39 to 40: prop effects (T82). The business gains the vending sales of the running day, which loads as none,
  // and the ledger gains the vending and ad income rows, which older ledgers count as zero.
  if (save.version < 40) save.version = 40;
  // Version 40 to 41: the event director (T50). Older saves load with nothing planned, so the next game day draws
  // the first event, and the ledger gains the incidents row after the T82 rows. A weather event planned for later
  // today in the old business fields is dropped; one already under way keeps its end tick.
  if (save.version < 41) save.version = 41;
  // Version 41 to 42: game options gain the mode and the airport identity (T35). Older saves have neither and load as
  // a career; the UI names their airport from the seed. The opening airlines of older saves were all made before the
  // first was added, so their ids repeated (0, 0, 0, 3, 3, 3, 6); every airline takes its index as id, which is how the
  // commands and the flights already address them.
  if (save.version < 42) {
    const airlines = (save as { business?: { airlines?: { id: number }[] } }).business?.airlines;
    if (airlines) airlines.forEach((a, i) => (a.id = i));
    save.version = 42;
  }
  if (save.version < 43) {
    // T87: aircraft hold claims on whole runs of two way pavement instead of per block counters. The counters go;
    // Traffic.loadState sees no claims and claims again from where each aircraft stands.
    const arrays = (save as { traffic?: { arrays?: Record<string, unknown> } }).traffic?.arrays;
    if (arrays) for (const k of ['curBlock', 'prevBlock', 'nextBlock', 'blockCount', 'blockDir', 'blockLast']) delete arrays[k];
    save.version = 43;
  }
  return save as SaveData;
}

/** Fixture ids of the service keys that existed before save versions 31 and 34, and of all service keys. */
const LEGACY_SERVICE_IDS: readonly number[] = SERVICE_KEYS.slice(0, LEGACY_SERVICE_COUNT).map((k) => FIXTURE_KEYS.indexOf(k) + 1);
const V31_SERVICE_IDS: readonly number[] = SERVICE_KEYS.slice(0, V33_SERVICE_COUNT).map((k) => FIXTURE_KEYS.indexOf(k) + 1);
const ALL_SERVICE_IDS: readonly number[] = SERVICE_KEYS.map((k) => FIXTURE_KEYS.indexOf(k) + 1);
/** fixtureRot below this marks the anchor of a fixture, as in serviceNodes. */
const ANCHOR_ROT_LIMIT = 5;

/**
 * Rebuilds a saved service table whose nodes are the anchors of `oldIds` for the node set of `newIds`: the row of every
 * old node moves to its new index, and each anchor of a new kind gets an empty row. Both lists are in ascending cell
 * order. Also returns the new index of every old node, null when nothing moved.
 */
function insertNewServiceRows(old: ServiceSave, fixture: Uint8Array, rot: Uint8Array, oldIds: readonly number[], newIds: readonly number[]): { table: ServiceSave; newIndexOfOld: Int32Array | null } {
  const oldIndexOfNew: number[] = [];
  let oldCount = 0;
  for (let c = 0; c < fixture.length; c++) {
    if (rot[c]! >= ANCHOR_ROT_LIMIT) continue;
    const id = fixture[c]!;
    if (!newIds.includes(id)) continue;
    if (oldIds.includes(id)) oldIndexOfNew.push(oldCount++);
    else oldIndexOfNew.push(-1);
  }
  if (oldCount !== old.count || oldIndexOfNew.length === oldCount) return { table: old, newIndexOfOld: null };
  const count = oldIndexOfNew.length;
  const newIndexOfOld = new Int32Array(oldCount);
  for (let k = 0; k < count; k++) if (oldIndexOfNew[k]! >= 0) newIndexOfOld[oldIndexOfNew[k]!] = k;
  const slots = oldCount > 0 ? Math.floor(unpackTyped(old.qCohort, Int32Array).length / oldCount) : 0;
  const rows = (text: string, ctor: Int32ArrayConstructor | Uint16ArrayConstructor, per: number, fill: number): string => {
    const src = unpackTyped(text, ctor as Int32ArrayConstructor);
    const out = new ctor(count * per).fill(fill);
    for (let k = 0; k < count; k++) {
      const from = oldIndexOfNew[k]!;
      if (from >= 0) for (let j = 0; j < per; j++) out[k * per + j] = src[from * per + j]!;
    }
    return packTyped(out);
  };
  const table = {
    ...old,
    count,
    queueLen: rows(old.queueLen, Int32Array, 1, 0),
    busyUntil: rows(old.busyUntil, Int32Array, 1, 0),
    serving: rows(old.serving, Int32Array, 1, -1),
    servingSize: rows(old.servingSize, Int32Array, 1, 0),
    qCohort: rows(old.qCohort, Int32Array, slots, 0),
    qSize: rows(old.qSize, Int32Array, slots, 0),
    qHead: rows(old.qHead, Uint16Array, 1, 0),
    qCount: rows(old.qCount, Uint16Array, 1, 0),
  };
  return { table, newIndexOfOld };
}
