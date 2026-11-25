import { BAGGAGE, BUSINESS, GROUND, GSE, STAND_SIZES } from '@data/index';
import { BUILDING_KINDS, STAND_SIZES_ORDER, type StandSize } from '@shared/airfield';
import { isLeveled, levelCost, MAX_FIXTURE_LEVEL, type LeveledKey } from '@shared/fixtureLevels';
import type { FixtureKey } from '@shared/business';
import { FIXTURE_KEYS } from '@shared/business';
import { TRAVELATOR_ASSETS, travelatorCost } from '@shared/travelator';
import type { BagKind } from '@shared/baggageNodes';
import { bagCost } from './tools/baggageTool';
import type { Command } from '@sim/commands';
import { formatMoney } from './format';
import { Icon, type IconName } from './icons';
import { useGameStore, type Sheet } from './stores/gameStore';
import { TENANT_CATEGORY_KEYS } from '@data/schemas/tenants';
import { useToolStore, type LineKind, type TerminalSub, type Tool } from './stores/toolStore';
import { t, tDynamic, tFormat, type StringKey } from './strings';
import { Thumb } from './thumbs';
import { PropThumb } from './PropThumb';
import { PROP_CATEGORIES, propCost, propsOfCategory } from '@shared/props';
import { useState } from 'preact/hooks';
import { Chevron, TitleBar, type Group } from './kit';

type ToolState = ReturnType<typeof useToolStore.getState>;

interface Item {
  id: string;
  thumb: string;
  icon: IconName;
  /** Not built yet: shown dimmed and cannot be picked. */
  locked?: boolean;
  /** What picking the card does. */
  run?: (s: ToolState) => void;
  active?: (s: ToolState) => boolean;
  /** Ground vehicle id for fleet cards. */
  gse?: string;
  /** Price in cash for fixtures, shown on the card. */
  price?: number;
  /** Prop asset whose kit sprite is the thumbnail (T76). */
  asset?: string;
  /** Card name from data, used instead of a string key. */
  name?: string;
  /** Variants of the item (design revision 6 section 5.5): the tile opens a tray of them instead of arming the tool. */
  variants?: Variant[];
  /** A demolish tile, drawn in the danger color. */
  danger?: boolean;
  /** String key of the variant chip, such as "3 levels" or "4 sizes". */
  variantChip?: StringKey;
}

/** One variant in a tray: it arms the item's tool with this variant, through the tool store field the variant lives in. */
export interface Variant {
  id: string;
  thumb: string;
  /** Short name and one key fact shown on the radio card. */
  name: string;
  fact: string;
  price: number;
  pick: (s: ToolState) => void;
  on: (s: ToolState) => boolean;
}

interface Tab {
  id: string;
  items: Item[];
  /** String key prefix of the tab and its cards when it differs from `<category>.<tab>`, for tabs moved between categories by revision 6. */
  key?: string;
}

export interface Category {
  id: string;
  icon: IconName;
  /** Rail group of design revision 6 section 5.4: it colors the rail icon and the flyout title bar. */
  group: Group;
  /** No system yet: dimmed on the rail with a "Coming later" tooltip, and it opens nothing. */
  locked?: boolean;
  testId: string;
  /** Tool picked when the category opens. */
  tool: Tool | null;
  tabs: Tab[];
}

const fixture = (key: string): number => FIXTURE_KEYS.indexOf(key as (typeof FIXTURE_KEYS)[number]) + 1;
const fixturePrice = (key: string): number => {
  const m = (BUSINESS.modules as Record<string, { cost: number }>)[key];
  return m?.cost ?? 0;
};

const fx = (key: string, thumb: string, icon: IconName = 'fixture'): Item => {
  const item: Item = {
    id: key,
    thumb,
    icon,
    price: fixturePrice(key),
    run: (s) => s.set({ tool: 'terminal', tSub: 'fixture', fixtureId: fixture(key) }),
    active: (s) => s.tool === 'terminal' && s.tSub === 'fixture' && s.fixtureId === fixture(key),
  };
  // Leveled fixtures (T74) come in three levels: they are the variants of the tile.
  if (isLeveled(key as FixtureKey)) {
    const levels: Variant[] = [];
    for (let l = 1; l <= MAX_FIXTURE_LEVEL; l++) {
      const level = l as 1 | 2 | 3;
      levels.push({
        id: `${key}-${l}`,
        thumb,
        name: tDynamic(`opt.level.${key}.${l}`),
        fact: tFormat('menu.variant.level', { n: l }),
        price: levelCost(key as LeveledKey, l),
        pick: (s) => s.set({ tool: 'terminal', tSub: 'fixture', fixtureId: fixture(key), fixtureLevel: level }),
        on: (s) => s.tool === 'terminal' && s.tSub === 'fixture' && s.fixtureId === fixture(key) && s.fixtureLevel === level,
      });
    }
    item.variants = levels;
    item.variantChip = 'menu.variant.levels';
  }
  return item;
};

/** A stand tile whose variants are the four stand sizes. */
const standTile = (type: 'remote' | 'contact' | 'through'): Item => ({
  id: type,
  thumb: 'stand',
  icon: 'stands',
  run: (s) => s.set({ tool: 'stands', standType: type }),
  active: (s) => s.tool === 'stands' && s.standType === type,
  variantChip: 'menu.variant.sizes',
  variants: STAND_SIZES_ORDER.map((z: StandSize) => ({
    id: `${type}-${z}`,
    thumb: 'stand',
    name: tDynamic(`menu.variant.${z}`),
    fact: tFormat('menu.variant.span', { m: STAND_SIZES[z].maxSpanM }),
    price: STAND_SIZES[z].cost[type],
    pick: (s) => s.set({ tool: 'stands', standType: type, standSize: z }),
    on: (s) => s.tool === 'stands' && s.standType === type && s.standSize === z,
  })),
});

/** A tenant unit card (T32): zoning is free, so it shows no price. */
const unit = (key: string, category: number): Item => ({
  id: key,
  thumb: 'shop',
  icon: 'fixture',
  run: (s) => s.set({ tool: 'terminal', tSub: 'unit', unitCategory: category, hint: 'hint.terminal.unit', problem: null, buy: null }),
  active: (s) => s.tool === 'terminal' && s.tSub === 'unit' && s.unitCategory === category,
});

const bag = (kind: BagKind, thumb: string): Item => ({
  id: kind,
  thumb,
  icon: 'fixture',
  price: bagCost(kind, BAGGAGE.footprints.bay.widths[0]),
  run: (s) => s.set({ tool: 'terminal', tSub: 'bagNode', bagKind: kind, hint: 'hint.terminal.bagNode', problem: null, buy: null }),
  active: (s) => s.tool === 'terminal' && s.tSub === 'bagNode' && s.bagKind === kind,
});

const sub = (id: string, tSub: TerminalSub, thumb: string, icon: IconName): Item => ({
  id,
  thumb,
  icon,
  run: (s) => s.set({ tool: 'terminal', tSub, wallRemove: false }),
  active: (s) => s.tool === 'terminal' && s.tSub === tSub && !(tSub === 'wall' && s.wallRemove),
});

/** Demolish tile of terminal walls (DEM2): the wall tool, removing the walls along the stroke. */
const wallDemolish: Item = {
  id: 'wallDemolish',
  thumb: 'erase',
  icon: 'bulldoze',
  danger: true,
  run: (s) => s.set({ tool: 'terminal', tSub: 'wall', wallRemove: true, hint: 'hint.lineDemolish.wall', problem: null, buy: null }),
  active: (s) => s.tool === 'terminal' && s.tSub === 'wall' && s.wallRemove,
};

const prop = (id: string, name: string): Item => ({
  id,
  thumb: 'prop',
  icon: 'fixture',
  asset: id,
  name,
  price: propCost(id),
  run: (s) => s.set({ tool: 'terminal', tSub: 'prop', propAsset: id, hint: 'hint.terminal.prop', problem: null, buy: null }),
  active: (s) => s.tool === 'terminal' && s.tSub === 'prop' && s.propAsset === id,
});

/**
 * A Demolish tile of a laid object (DEM2): it arms line demolish, which works like the build tool of the object but
 * removes the section the stroke runs over.
 */
const lineDemolish = (kind: LineKind): Item => ({
  id: kind === 'road' ? 'roadDemolish' : 'demolish',
  thumb: kind === 'runway' ? 'runwayShorten' : 'taxiCut',
  icon: 'bulldoze',
  danger: true,
  run: (s) => s.set({ tool: 'lineDemolish', lineKind: kind, hint: `hint.lineDemolish.${kind}`, problem: null, buy: null }),
  active: (s) => s.tool === 'lineDemolish' && s.lineKind === kind,
});

const sheet = (id: string, target: Sheet, icon: IconName): Item => ({ id, thumb: id, icon, run: () => useGameStore.getState().setSheet(target) });

const gse = (id: string): Item => ({ id, thumb: id, icon: 'handling', gse: id });

const locked = (id: string, icon: IconName): Item => ({ id, thumb: id, icon, locked: true });

export const CATEGORIES: Category[] = [
  {
    id: 'runway',
    icon: 'runway',
    group: 'air',
    testId: 'tool-runway',
    tool: 'runway',
    tabs: [
      {
        id: 'build',
        items: [
          { id: 'new', thumb: 'runway', icon: 'runway', run: (s) => s.set({ tool: 'runway', runwayMode: 'new' }), active: (s) => s.tool === 'runway' && s.runwayMode === 'new' },
          { id: 'extend', thumb: 'runwayExtend', icon: 'runway', run: (s) => s.set({ tool: 'runway', runwayMode: 'extend' }), active: (s) => s.tool === 'runway' && s.runwayMode === 'extend' },
          { id: 'turnPad', thumb: 'turnPad', icon: 'rapidExit', run: (s) => s.set({ tool: 'turnPad' }), active: (s) => s.tool === 'turnPad' },
          lineDemolish('runway'),
        ],
      },
      { id: 'upgrade', items: [{ id: 'upgrade', thumb: 'runway', icon: 'select', run: (s) => s.set({ tool: 'select', hint: 'hint.runwayUpgrade' }) }] },
    ],
  },
  {
    id: 'taxiway',
    icon: 'taxiway',
    group: 'air',
    testId: 'tool-taxiway',
    tool: 'taxiway',
    tabs: [
      {
        id: 'build',
        items: [
          { id: 'new', thumb: 'taxiway', icon: 'taxiway', run: (s) => s.set({ tool: 'taxiway', taxiMode: 'new' }), active: (s) => s.tool === 'taxiway' && s.taxiMode === 'new' },
          { id: 'extend', thumb: 'taxiway', icon: 'taxiway', run: (s) => s.set({ tool: 'taxiway', taxiMode: 'extend' }), active: (s) => s.tool === 'taxiway' && s.taxiMode === 'extend' },
          lineDemolish('taxiway'),
        ],
      },
      {
        id: 'special',
        items: [
          { id: 'taxilane', thumb: 'taxiway', icon: 'taxilane', run: (s) => s.set({ tool: 'taxilane', taxiMode: 'new' }), active: (s) => s.tool === 'taxilane' },
          { id: 'rapidExit', thumb: 'rapidExit', icon: 'rapidExit', run: (s) => s.set({ tool: 'rapidExit' }), active: (s) => s.tool === 'rapidExit' },
          { id: 'parallel', thumb: 'parallel', icon: 'parallel', run: (s) => s.set({ tool: 'parallel' }), active: (s) => s.tool === 'parallel' },
        ],
      },
    ],
  },
  {
    id: 'apron',
    icon: 'apron',
    group: 'air',
    testId: 'tool-apron',
    tool: 'apron',
    // One menu for every apron tool (T84): build, extend and remove are its tabs.
    tabs: [
      { id: 'build', items: [{ id: 'apron', thumb: 'apron', icon: 'apron', run: (s) => s.set({ tool: 'apron' }), active: (s) => s.tool === 'apron' }] },
      { id: 'extend', items: [{ id: 'apronExtend', thumb: 'apron', icon: 'apron', run: (s) => s.set({ tool: 'apronExtend' }), active: (s) => s.tool === 'apronExtend' }] },
      { id: 'remove', items: [{ id: 'apronRemove', thumb: 'apron', icon: 'demolish', run: (s) => s.set({ tool: 'apronRemove' }), active: (s) => s.tool === 'apronRemove' }] },
    ],
  },
  {
    id: 'stand',
    icon: 'stands',
    group: 'air',
    testId: 'tool-stands',
    tool: 'stands',
    tabs: [
      {
        id: 'commercial',
        items: [
          standTile('remote'),
          standTile('contact'),
          standTile('through'),
        ],
      },
      { id: 'ga', items: [{ id: 'gaBlock', thumb: 'gaBlock', icon: 'gaBlock', run: (s) => s.set({ tool: 'gaBlock' }), active: (s) => s.tool === 'gaBlock' }] },
      { id: 'manage', items: [sheet('standManagement', 'stands', 'flights')] },
    ],
  },
  { id: 'navaids', icon: 'navaids', group: 'air', locked: true, testId: 'tool-navaids', tool: null, tabs: [] },
  {
    id: 'terminal',
    icon: 'terminal',
    group: 'trm',
    testId: 'tool-terminal',
    tool: 'terminal',
    tabs: [
      { id: 'structure', items: [sub('foundation', 'foundation', 'foundation', 'foundation'), sub('floor', 'floor', 'floor', 'floor'), sub('wall', 'wall', 'wall', 'wall'), sub('door', 'door', 'door', 'door'), wallDemolish] },
      { id: 'baggage', items: [bag('machine', 'bagDrop'), bag('bay', 'bagDrop'), bag('carousel', 'belt')] },
      { id: 'circulation', items: [{ ...fx('travelator', 'belt'), price: travelatorCost(1), asset: TRAVELATOR_ASSETS[0] }] },
    ],
  },
  {
    id: 'stations',
    icon: 'stations',
    group: 'trm',
    testId: 'tool-stations',
    tool: 'terminal',
    tabs: [
      { id: 'processing', key: 'terminal.processing', items: [fx('checkIn', 'checkIn'), fx('security', 'security'), fx('kiosk', 'kiosk'), fx('bagDrop', 'bagDrop'), fx('passport', 'passport'), fx('gateDesk', 'gateDesk')] },
      {
        id: 'transitions',
        key: 'terminal.transitions',
        items: [
          fx('securityExit', 'security'),
          fx('eGate', 'passport'),
          fx('customs', 'passport'),
          {
            id: 'staffDoor',
            thumb: 'door',
            icon: 'door',
            run: (s) => s.set({ tool: 'terminal', tSub: 'door', doorType: 4, hint: 'hint.terminal.door', problem: null, buy: null }),
            active: (s) => s.tool === 'terminal' && s.tSub === 'door' && s.doorType === 4,
          },
        ],
      },
    ],
  },
  {
    id: 'furnish',
    icon: 'fixture',
    group: 'trm',
    testId: 'tool-furnish',
    tool: 'terminal',
    tabs: PROP_CATEGORIES.map((cat) => ({ id: cat, items: propsOfCategory(cat).map((a) => prop(a.id, a.name)) })),
  },
  {
    id: 'commercial',
    icon: 'commercial',
    group: 'trm',
    testId: 'tool-commercial',
    tool: 'terminal',
    tabs: [{ id: 'shops', key: 'terminal.shops', items: [...TENANT_CATEGORY_KEYS.map((k, c) => unit(k, c)), { ...sheet('tenants', 'tenants', 'finance'), thumb: 'shop' }] }],
  },
  {
    id: 'flightops',
    icon: 'flightops',
    group: 'ops',
    testId: 'tool-flightops',
    tool: null,
    tabs: [
      { id: 'scheduling', items: [sheet('airlines', 'airlines', 'airlines'), sheet('slots', 'slots', 'flightops'), sheet('standManagement', 'stands', 'flights'), sheet('board', 'flights', 'flights')] },
      { id: 'atc', items: [{ id: 'tower', thumb: 'tower', icon: 'tower', run: (s) => s.set({ tool: 'tower' }), active: (s) => s.tool === 'tower' }] },
      // Ground handling joins flight operations in revision 6 section 5.4; its tabs keep their string keys.
      {
        id: 'depot',
        key: 'handling.depot',
        items: [
          { id: 'depot', thumb: 'depot', icon: 'handling', price: GROUND.depot.cost, run: (s) => s.set({ tool: 'depot' }), active: (s) => s.tool === 'depot' },
          { id: 'road', thumb: 'road', icon: 'taxiway', run: (s) => s.set({ tool: 'road' }), active: (s) => s.tool === 'road' },
          lineDemolish('road'),
        ],
      },
      {
        id: 'services',
        key: 'handling.services',
        items: BUILDING_KINDS.map((kind) => ({
          id: kind,
          thumb: kind === 'fuelFarm' ? 'fuelFarm' : 'depot',
          icon: 'handling' as IconName,
          price: GROUND.buildings[kind].cost,
          run: (s: ToolState) => s.set({ tool: 'building', buildingKind: kind }),
          active: (s: ToolState) => s.tool === 'building' && s.buildingKind === kind,
        })),
      },
      { id: 'baggage', key: 'handling.baggage', items: [gse('tractor'), gse('cart'), gse('beltloader')] },
      { id: 'fuel', key: 'handling.fuel', items: [gse('refueller'), gse('dispenser')] },
      { id: 'catering', key: 'handling.catering', items: [gse('catering')] },
      { id: 'boarding', key: 'handling.boarding', items: [gse('stairs'), gse('bus')] },
      { id: 'power', key: 'handling.power', items: [gse('gpu'), gse('tug')] },
    ],
  },
  {
    id: 'infra',
    icon: 'infra',
    group: 'ops',
    testId: 'tool-infra',
    tool: null,
    tabs: [{ id: 'landside', items: [locked('curbside', 'infra'), locked('parking', 'infra'), locked('busStop', 'infra'), locked('road', 'infra'), locked('taxiRank', 'infra'), locked('train', 'infra'), locked('subway', 'infra')] }],
  },
  {
    id: 'staff',
    icon: 'staff',
    group: 'ops',
    testId: 'tool-staff',
    tool: null,
    tabs: [{ id: 'admin', items: [sheet('staff', 'staff', 'staff'), sheet('finance', 'finance', 'finance'), sheet('airlines', 'airlines', 'airlines'), sheet('site', 'site', 'site')] }],
  },
  {
    id: 'zoning',
    icon: 'zoning',
    group: 'tool',
    testId: 'tool-zoning',
    tool: 'terminal',
    tabs: [
      {
        id: 'zones',
        items: [1, 2, 3, 4, 5].map((z) => ({
          id: ['public', 'commercial', 'secure', 'staff', 'international'][z - 1],
          thumb: ['zonePublic', 'zoneCommercial', 'zoneSecure', 'zoneStaff', 'zoneInternational'][z - 1],
          icon: 'zoning' as IconName,
          run: (s: ToolState) => s.set({ tool: 'terminal', tSub: 'zone', zoneType: z as 1 | 2 | 3 | 4 | 5 }),
          active: (s: ToolState) => s.tool === 'terminal' && s.tSub === 'zone' && s.zoneType === z,
        })),
      },
    ],
  },
  {
    // Bulldoze of design revision 6 (DEM3): one item by click, or a box with a type checklist.
    id: 'bulldoze',
    icon: 'bulldoze',
    group: 'tool',
    testId: 'tool-demolish',
    tool: 'demolish',
    tabs: [
      {
        id: 'modes',
        items: [
          { id: 'single', thumb: 'single', icon: 'select', danger: true, run: (s) => s.set({ tool: 'demolish', bulldozeMode: 'single', areaBox: null, hint: 'hint.demolish', problem: null, buy: null }), active: (s) => s.tool === 'demolish' && s.bulldozeMode === 'single' },
          { id: 'area', thumb: 'area', icon: 'area', danger: true, run: (s) => s.set({ tool: 'demolish', bulldozeMode: 'area', areaBox: null, hint: 'hint.areaBulldoze', problem: null, buy: null }), active: (s) => s.tool === 'demolish' && s.bulldozeMode === 'area' },
        ],
      },
    ],
  },
];

const fresh = { barOpen: true, selection: null, hint: null, problem: null, buy: null } as const;

/**
 * Opens a tab of the flyout. In a category whose tabs are modes of one tool, such as the apron's
 * build, extend and remove (T84), the tab also picks its tool, so the tab and the tool never disagree.
 */
function pickTab(c: Category, tab: Tab): void {
  const s = useToolStore.getState();
  s.set({ menuTab: tab.id });
  if (c.id !== 'apron') return;
  const first = tab.items.find((i) => i.run && !i.locked);
  if (first?.run) first.run(useToolStore.getState());
}

/** Opens a category in the left toolbar: its default tool, its first tab, and the flyout beside the rail. */
export function openCategory(c: Category): void {
  if (c.locked) return;
  const s = useToolStore.getState();
  if (s.category === c.id) {
    s.set({ menuOpen: !s.menuOpen });
    return;
  }
  s.set({ ...fresh, category: c.id, menuTab: c.tabs[0].id, menuOpen: true, ...(c.tool ? { tool: c.tool } : {}) });
  // The first card of the first tab is the natural starting choice.
  const first = c.tabs[0].items.find((i) => i.run && !i.gse && !i.locked);
  if (first?.run && c.tool) first.run(useToolStore.getState());
  if (c.id === 'zoning') useToolStore.getState().set({ tSub: 'zone' });
}

/** String key prefix of a tab and its cards. */
const tabKey = (c: Category, tab: Tab): string => tab.key ?? `${c.id}.${tab.id}`;

/** Card name of an item: data name, ground vehicle name, the remove card, or its string key. */
function itemName(c: Category, tab: Tab, it: Item): string {
  const spec = it.gse ? GSE.find((v) => v.id === it.gse) : undefined;
  if (spec) return spec.name;
  if (it.name) return it.name;
  return tDynamic(`menu.${tabKey(c, tab)}.${it.id}` as StringKey);
}

/** Coin glyph beside prices, the only use of the gold token. */
export function Coin({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style="flex:none">
      <circle cx="12" cy="12" r="10" fill="var(--gold)" stroke="var(--gold-deep)" stroke-width="2" />
      <path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4" fill="none" stroke="var(--gold-deep)" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  );
}

/** How many cards a player picks before the footer legend hides (revision 6 section 5.5). */
const LEGEND_PICKS = 5;
const LEGEND_KEY = 'airfield.flyoutPicks';
function readPicks(): number {
  try {
    return Number(localStorage.getItem(LEGEND_KEY) ?? '0') || 0;
  } catch {
    return 0;
  }
}
function countPick(): number {
  const n = readPicks() + 1;
  try {
    localStorage.setItem(LEGEND_KEY, String(n));
  } catch {
    /* private mode: the legend stays for this session */
  }
  return n;
}

/**
 * Flyout of the open category beside the left rail (design revision 6 section 5.5): a title bar in the group color, tabs as a
 * segmented control and a two column tile grid. A tile with variants opens a tray under its row; it steps aside while a side sheet is open.
 */
export function BuildMenu({ send }: { send(cmd: Command): void }) {
  const s = useToolStore();
  const biz = useGameStore((g) => g.business);
  const sheetOpen = useGameStore((g) => g.sheet !== null);
  const [tray, setTray] = useState<string | null>(null);
  const [picks, setPicks] = useState(readPicks);
  const cat = CATEGORIES.find((c) => c.id === s.category);
  if (!cat || cat.locked || !s.menuOpen || sheetOpen || cat.tabs.length === 0) return null;
  const tab = cat.tabs.find((x) => x.id === s.menuTab) ?? cat.tabs[0];
  const pick = (run: () => void): void => {
    run();
    if (picks < LEGEND_PICKS) setPicks(countPick());
  };
  // Tiles go in rows of two; an open tray sits under the row of its tile and spans both columns.
  const cells: preact.ComponentChildren[] = [];
  const open = tab.items.find((it) => it.id === tray && it.variants);
  tab.items.forEach((it, i) => {
    const idx = it.gse ? GSE.findIndex((v) => v.id === it.gse) : -1;
    const owned = biz && idx >= 0 ? biz.fleet[idx] : 0;
    const price = it.gse ? BUSINESS.gse[it.gse]?.price ?? 0 : it.price ?? 0;
    const on = it.active ? it.active(s) : false;
    const trayOpen = tray === it.id && !!it.variants;
    cells.push(
      <div key={it.id} class={`card${on ? ' on' : ''}${trayOpen ? ' tray-open' : ''}${it.locked ? ' locked' : ''}${it.danger ? ' g-bad danger' : ''}`}>
        <button
          class="card-main"
          data-testid={`card-${it.id}`}
          aria-pressed={on}
          aria-expanded={it.variants ? trayOpen : undefined}
          title={it.locked ? t('menu.soon') : itemName(cat, tab, it)}
          disabled={it.locked || (!it.run && !it.gse)}
          onClick={() => {
            if (it.variants) {
              setTray(trayOpen ? null : it.id);
              if (!on && it.run) it.run(useToolStore.getState());
              return;
            }
            setTray(null);
            if (it.run) pick(() => it.run?.(useToolStore.getState()));
          }}
        >
          <div class="thumb">
            {it.asset ? <PropThumb asset={it.asset} /> : <Thumb kind={it.thumb} icon={it.icon} />}
            {it.locked && (
              <span class="lockbadge">
                <Icon name="lock" size={12} />
              </span>
            )}
          </div>
          <div class="card-name">{itemName(cat, tab, it)}</div>
          <div class="card-sub">
            {it.locked ? (
              t('menu.soon')
            ) : it.variants ? (
              <span class="vchip">
                {tFormat(it.variantChip ?? 'menu.variant.count', { n: it.variants.length })}
                <Chevron down={trayOpen} />
              </span>
            ) : it.gse ? (
              `${t('menu.owned')} ${owned}`
            ) : price > 0 ? (
              <>
                <Coin />
                {formatMoney(price)}
              </>
            ) : (
              ''
            )}
          </div>
        </button>
        {it.gse && (
          <button class="btn bw sm buy" data-testid={`buy-${it.gse}`} onClick={() => send({ type: 'buyGse', kind: it.gse ?? '', count: 1 })}>
            {t('menu.buy')} {formatMoney(price)}
          </button>
        )}
      </div>,
    );
    const rowEnd = i % 2 === 1 || i === tab.items.length - 1;
    const openIdx = open ? tab.items.indexOf(open) : -1;
    if (open?.variants && rowEnd && openIdx >= 0 && Math.floor(openIdx / 2) === Math.floor(i / 2)) {
      cells.push(
        <div key="tray" class="vtray" role="radiogroup" data-testid={`tray-${open.id}`} aria-label={itemName(cat, tab, open)}>
          {open.variants.map((v) => {
            const vOn = v.on(s);
            return (
              <button key={v.id} class="vcard" role="radio" aria-checked={vOn} data-testid={`variant-${v.id}`} onClick={() => pick(() => v.pick(useToolStore.getState()))}>
                <Thumb kind={v.thumb} icon={open.icon} />
                <span class="vname clip">{v.name}</span>
                <span class="vfact clip">{v.fact}</span>
                <span class="vprice">
                  <Coin size={10} />
                  {formatMoney(v.price)}
                </span>
              </button>
            );
          })}
        </div>,
      );
    }
  });
  return (
    <div data-testid="build-menu" class="pn buildmenu z-flyout">
      <TitleBar group={cat.group} icon={cat.icon} title={tDynamic(`menu.${cat.id}`)} onClose={() => s.set({ menuOpen: false })} closeLabel={t('sheet.close')} />
      {cat.tabs.length > 1 && (
        <div class="seg bm-tabs" role="tablist">
          {cat.tabs.map((x) => (
            <button key={x.id} role="tab" class="sg" data-testid={`menutab-${x.id}`} aria-pressed={tab.id === x.id} title={tDynamic(`menu.${tabKey(cat, x)}`)} onClick={() => {
              setTray(null);
              pickTab(cat, x);
            }}>
              {tDynamic(`menu.${tabKey(cat, x)}`)}
            </button>
          ))}
        </div>
      )}
      <div class={`bm-cards g-${cat.group}`}>{cells}</div>
      {picks < LEGEND_PICKS && (
        <div class="bm-legend">
          <span>
            <Coin size={10} /> {t('menu.legend.price')}
          </span>
          <span>
            <span class="vchip sm">{t('menu.legend.chip')}</span> {t('menu.legend.variants')}
          </span>
        </div>
      )}
    </div>
  );
}
