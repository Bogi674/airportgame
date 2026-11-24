import { BAGGAGE, BUSINESS, GROUND, GSE } from '@data/index';
import { BUILDING_KINDS } from '@shared/airfield';
import { FIXTURE_KEYS } from '@shared/business';
import { TRAVELATOR_ASSETS, travelatorCost } from '@shared/travelator';
import type { BagKind } from '@shared/baggageNodes';
import { bagCost } from './tools/baggageTool';
import type { Command } from '@sim/commands';
import { formatMoney } from './format';
import { Icon, type IconName } from './icons';
import { useGameStore, type Sheet } from './stores/gameStore';
import { TENANT_CATEGORY_KEYS } from '@data/schemas/tenants';
import { useToolStore, type TerminalSub, type Tool } from './stores/toolStore';
import { t, tDynamic, type StringKey } from './strings';
import { Thumb } from './thumbs';
import { PropThumb } from './PropThumb';
import { PROP_CATEGORIES, propCost, propsOfCategory } from '@shared/props';

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
}

interface Tab {
  id: string;
  items: Item[];
}

export interface Category {
  id: string;
  icon: IconName;
  hue: number;
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

const fx = (key: string, thumb: string, icon: IconName = 'fixture'): Item => ({
  id: key,
  thumb,
  icon,
  price: fixturePrice(key),
  run: (s) => s.set({ tool: 'terminal', tSub: 'fixture', fixtureId: fixture(key) }),
  active: (s) => s.tool === 'terminal' && s.tSub === 'fixture' && s.fixtureId === fixture(key),
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
  run: (s) => s.set({ tool: 'terminal', tSub }),
  active: (s) => s.tool === 'terminal' && s.tSub === tSub,
});

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

/** The card that removes a placed prop or fixture (T85), on every furnishing tab and the terminal structure and processing tabs. */
const removeProp: Item = {
  id: 'remove',
  thumb: 'erase',
  icon: 'erase',
  run: (s) => s.set({ tool: 'terminal', tSub: 'propRemove', hint: 'hint.terminal.propRemove', problem: null, buy: null }),
  active: (s) => s.tool === 'terminal' && s.tSub === 'propRemove',
};

const sheet = (id: string, target: Sheet, icon: IconName): Item => ({ id, thumb: id, icon, run: () => useGameStore.getState().setSheet(target) });

const gse = (id: string): Item => ({ id, thumb: id, icon: 'handling', gse: id });

const locked = (id: string, icon: IconName): Item => ({ id, thumb: id, icon, locked: true });

export const CATEGORIES: Category[] = [
  {
    id: 'runway',
    icon: 'runway',
    hue: 215,
    testId: 'tool-runway',
    tool: 'runway',
    tabs: [
      {
        id: 'build',
        items: [
          { id: 'new', thumb: 'runway', icon: 'runway', run: (s) => s.set({ tool: 'runway', runwayMode: 'new' }), active: (s) => s.tool === 'runway' && s.runwayMode === 'new' },
          { id: 'extend', thumb: 'runwayExtend', icon: 'runway', run: (s) => s.set({ tool: 'runway', runwayMode: 'extend' }), active: (s) => s.tool === 'runway' && s.runwayMode === 'extend' },
          { id: 'shorten', thumb: 'runwayShorten', icon: 'runway', run: (s) => s.set({ tool: 'runway', runwayMode: 'shorten' }), active: (s) => s.tool === 'runway' && s.runwayMode === 'shorten' },
          { id: 'turnPad', thumb: 'turnPad', icon: 'rapidExit', run: (s) => s.set({ tool: 'turnPad' }), active: (s) => s.tool === 'turnPad' },
        ],
      },
      { id: 'upgrade', items: [{ id: 'upgrade', thumb: 'runway', icon: 'select', run: (s) => s.set({ tool: 'select', hint: 'hint.runwayUpgrade' }) }] },
    ],
  },
  {
    id: 'taxiway',
    icon: 'taxiway',
    hue: 200,
    testId: 'tool-taxiway',
    tool: 'taxiway',
    tabs: [
      {
        id: 'build',
        items: [
          { id: 'new', thumb: 'taxiway', icon: 'taxiway', run: (s) => s.set({ tool: 'taxiway', taxiMode: 'new' }), active: (s) => s.tool === 'taxiway' && s.taxiMode === 'new' },
          { id: 'extend', thumb: 'taxiway', icon: 'taxiway', run: (s) => s.set({ tool: 'taxiway', taxiMode: 'extend' }), active: (s) => s.tool === 'taxiway' && s.taxiMode === 'extend' },
          { id: 'trim', thumb: 'taxiTrim', icon: 'taxiway', run: (s) => s.set({ tool: 'taxiway', taxiMode: 'trim' }), active: (s) => s.tool === 'taxiway' && s.taxiMode === 'trim' },
          { id: 'cut', thumb: 'taxiCut', icon: 'taxiway', run: (s) => s.set({ tool: 'taxiway', taxiMode: 'cut' }), active: (s) => s.tool === 'taxiway' && s.taxiMode === 'cut' },
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
    hue: 190,
    testId: 'tool-apron',
    tool: 'apron',
    tabs: [{ id: 'build', items: [{ id: 'apron', thumb: 'apron', icon: 'apron', run: (s) => s.set({ tool: 'apron' }), active: (s) => s.tool === 'apron' }] }],
  },
  {
    id: 'apronRemove',
    icon: 'demolish',
    hue: 190,
    testId: 'tool-apron-remove',
    tool: 'apronRemove',
    tabs: [{ id: 'build', items: [{ id: 'apronRemove', thumb: 'apron', icon: 'demolish', run: (s) => s.set({ tool: 'apronRemove' }), active: (s) => s.tool === 'apronRemove' }] }],
  },
  {
    id: 'apronExtend',
    icon: 'apron',
    hue: 190,
    testId: 'tool-apron-extend',
    tool: 'apronExtend',
    tabs: [{ id: 'build', items: [{ id: 'apronExtend', thumb: 'apron', icon: 'apron', run: (s) => s.set({ tool: 'apronExtend' }), active: (s) => s.tool === 'apronExtend' }] }],
  },
  {
    id: 'stand',
    icon: 'stands',
    hue: 170,
    testId: 'tool-stands',
    tool: 'stands',
    tabs: [
      {
        id: 'commercial',
        items: [
          { id: 'remote', thumb: 'stand', icon: 'stands', run: (s) => s.set({ tool: 'stands', standType: 'remote' }), active: (s) => s.tool === 'stands' && s.standType === 'remote' },
          { id: 'contact', thumb: 'stand', icon: 'stands', run: (s) => s.set({ tool: 'stands', standType: 'contact' }), active: (s) => s.tool === 'stands' && s.standType === 'contact' },
          { id: 'through', thumb: 'stand', icon: 'stands', run: (s) => s.set({ tool: 'stands', standType: 'through' }), active: (s) => s.tool === 'stands' && s.standType === 'through' },
        ],
      },
      { id: 'ga', items: [{ id: 'gaBlock', thumb: 'gaBlock', icon: 'gaBlock', run: (s) => s.set({ tool: 'gaBlock' }), active: (s) => s.tool === 'gaBlock' }] },
      { id: 'manage', items: [sheet('standManagement', 'stands', 'flights')] },
    ],
  },
  {
    id: 'handling',
    icon: 'handling',
    hue: 30,
    testId: 'tool-handling',
    tool: null,
    tabs: [
      {
        id: 'depot',
        items: [
          { id: 'depot', thumb: 'depot', icon: 'handling', price: GROUND.depot.cost, run: (s) => s.set({ tool: 'depot' }), active: (s) => s.tool === 'depot' },
          { id: 'road', thumb: 'road', icon: 'taxiway', run: (s) => s.set({ tool: 'road' }), active: (s) => s.tool === 'road' },
        ],
      },
      {
        id: 'services',
        items: BUILDING_KINDS.map((kind) => ({
          id: kind,
          thumb: kind === 'fuelFarm' ? 'fuelFarm' : 'depot',
          icon: 'handling' as IconName,
          price: GROUND.buildings[kind].cost,
          run: (s: ToolState) => s.set({ tool: 'building', buildingKind: kind }),
          active: (s: ToolState) => s.tool === 'building' && s.buildingKind === kind,
        })),
      },
      { id: 'baggage', items: [gse('tractor'), gse('cart'), gse('beltloader')] },
      { id: 'fuel', items: [gse('refueller'), gse('dispenser')] },
      { id: 'catering', items: [gse('catering')] },
      { id: 'boarding', items: [gse('stairs'), gse('bus')] },
      { id: 'power', items: [gse('gpu'), gse('tug')] },
    ],
  },
  {
    id: 'flightops',
    icon: 'flightops',
    hue: 255,
    testId: 'tool-flightops',
    tool: null,
    tabs: [
      { id: 'scheduling', items: [sheet('airlines', 'airlines', 'airlines'), sheet('slots', 'slots', 'flightops'), sheet('standManagement', 'stands', 'flights'), sheet('board', 'flights', 'flights')] },
      { id: 'atc', items: [{ id: 'tower', thumb: 'tower', icon: 'tower', run: (s) => s.set({ tool: 'tower' }), active: (s) => s.tool === 'tower' }] },
    ],
  },
  {
    id: 'terminal',
    icon: 'terminal',
    hue: 280,
    testId: 'tool-terminal',
    tool: 'terminal',
    tabs: [
      { id: 'structure', items: [sub('foundation', 'foundation', 'foundation', 'foundation'), sub('floor', 'floor', 'floor', 'floor'), sub('wall', 'wall', 'wall', 'wall'), sub('door', 'door', 'door', 'door'), sub('erase', 'erase', 'erase', 'erase'), removeProp] },
      { id: 'processing', items: [fx('checkIn', 'checkIn'), fx('security', 'security'), fx('kiosk', 'kiosk'), fx('bagDrop', 'bagDrop'), fx('passport', 'passport'), fx('gateDesk', 'gateDesk'), removeProp] },
      { id: 'facilities', items: [fx('belt', 'belt')] },
      { id: 'baggage', items: [bag('machine', 'bagDrop'), bag('bay', 'bagDrop'), bag('carousel', 'belt')] },
      { id: 'shops', items: [...TENANT_CATEGORY_KEYS.map((k, c) => unit(k, c)), { ...sheet('tenants', 'tenants', 'finance'), thumb: 'shop' }] },
      { id: 'circulation', items: [{ ...fx('travelator', 'belt'), price: travelatorCost(1), asset: TRAVELATOR_ASSETS[0] }] },
      {
        id: 'transitions',
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
    hue: 310,
    testId: 'tool-furnish',
    tool: 'terminal',
    tabs: PROP_CATEGORIES.map((cat) => ({ id: cat, items: [...propsOfCategory(cat).map((a) => prop(a.id, a.name)), removeProp] })),
  },
  {
    id: 'infra',
    icon: 'infra',
    hue: 140,
    testId: 'tool-infra',
    tool: null,
    tabs: [{ id: 'landside', items: [locked('parking', 'infra'), locked('road', 'infra'), locked('busStop', 'infra'), locked('rail', 'infra')] }],
  },
  {
    id: 'staff',
    icon: 'staff',
    hue: 340,
    testId: 'tool-staff',
    tool: null,
    tabs: [{ id: 'admin', items: [sheet('staff', 'staff', 'staff'), sheet('finance', 'finance', 'finance'), sheet('airlines', 'airlines', 'airlines'), sheet('site', 'site', 'site')] }],
  },
  {
    id: 'zoning',
    icon: 'zoning',
    hue: 50,
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
];

const fresh = { barOpen: true, selection: null, hint: null, problem: null, buy: null } as const;

/** Opens a category in the left toolbar: its default tool, its first tab, and the flyout beside the rail. */
export function openCategory(c: Category): void {
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

/** Flyout of the open category beside the left rail (T36): tabs for sub menus, and a thumbnail card for each thing that can be built or bought. It steps aside while a side sheet is open. */
export function BuildMenu({ send }: { send(cmd: Command): void }) {
  const s = useToolStore();
  const biz = useGameStore((g) => g.business);
  const sheetOpen = useGameStore((g) => g.sheet !== null);
  const cat = CATEGORIES.find((c) => c.id === s.category);
  if (!cat || !s.menuOpen || sheetOpen) return null;
  const tab = cat.tabs.find((x) => x.id === s.menuTab) ?? cat.tabs[0];
  return (
    <div data-testid="build-menu" class="panel buildmenu" style={`--h:${cat.hue}`}>
      <div class="bm-head">
        <span class="bm-title">
          <Icon name={cat.icon} size={16} /> {tDynamic(`menu.${cat.id}`)}
        </span>
        <div class="tabs" role="tablist" style="margin:0;border:0">
          {cat.tabs.map((x) => (
            <button key={x.id} role="tab" class="tab" data-testid={`menutab-${x.id}`} aria-pressed={tab.id === x.id} onClick={() => s.set({ menuTab: x.id })}>
              {tDynamic(`menu.${cat.id}.${x.id}`)}
            </button>
          ))}
        </div>
        <button class="round" style="width:26px;height:26px;margin-left:auto" aria-label={t('sheet.close')} onClick={() => s.set({ menuOpen: false })}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <div class="bm-cards">
        {tab.items.map((it) => {
          const spec = it.gse ? GSE.find((v) => v.id === it.gse) : undefined;
          const idx = it.gse ? GSE.findIndex((v) => v.id === it.gse) : -1;
          const owned = biz && idx >= 0 ? biz.fleet[idx] : 0;
          const price = it.gse ? BUSINESS.gse[it.gse]?.price ?? 0 : it.price ?? 0;
          const on = it.active ? it.active(s) : false;
          return (
            <div key={it.id} class={`card${on ? ' on' : ''}${it.locked ? ' locked' : ''}`}>
              <button
                class="card-main"
                data-testid={`card-${it.id}`}
                aria-pressed={on}
                disabled={it.locked || (!it.run && !it.gse)}
                onClick={() => it.run && it.run(useToolStore.getState())}
              >
                <div class="thumb">
                  {it.asset ? <PropThumb asset={it.asset} /> : <Thumb kind={it.thumb} icon={it.icon} />}
                  {it.locked && (
                    <span class="lockbadge">
                      <Icon name="lock" size={14} />
                    </span>
                  )}
                </div>
                <div class="card-name">{spec ? spec.name : it.name ?? (it.id === 'remove' && (cat.id === 'furnish' || cat.id === 'terminal') ? t('menu.furnish.remove') : tDynamic(`menu.${cat.id}.${tab.id}.${it.id}` as StringKey))}</div>
                <div class="card-sub">{it.locked ? t('menu.soon') : it.gse ? `${t('menu.owned')} ${owned}` : price > 0 ? formatMoney(price) : ''}</div>
              </button>
              {it.gse && (
                <button class="buy" data-testid={`buy-${it.gse}`} onClick={() => send({ type: 'buyGse', kind: it.gse ?? '', count: 1 })}>
                  {t('menu.buy')} {formatMoney(price)}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
