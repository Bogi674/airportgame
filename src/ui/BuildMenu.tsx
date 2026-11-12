import { BUSINESS, GSE } from '@data/index';
import { FIXTURE_KEYS } from '@shared/business';
import type { Command } from '@sim/commands';
import { formatMoney } from './format';
import { Icon, type IconName } from './icons';
import { useGameStore, type Sheet } from './stores/gameStore';
import { useToolStore, type TerminalSub, type Tool } from './stores/toolStore';
import { t, tDynamic, type StringKey } from './strings';
import { Thumb } from './thumbs';

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
  const s = (BUSINESS.shops as Record<string, { cost: number }>)[key];
  return (m ?? s)?.cost ?? 0;
};

const fx = (key: string, thumb: string, icon: IconName = 'fixture'): Item => ({
  id: key,
  thumb,
  icon,
  price: fixturePrice(key),
  run: (s) => s.set({ tool: 'terminal', tSub: 'fixture', fixtureId: fixture(key) }),
  active: (s) => s.tool === 'terminal' && s.tSub === 'fixture' && s.fixtureId === fixture(key),
});

const sub = (id: string, tSub: TerminalSub, thumb: string, icon: IconName): Item => ({
  id,
  thumb,
  icon,
  run: (s) => s.set({ tool: 'terminal', tSub }),
  active: (s) => s.tool === 'terminal' && s.tSub === tSub,
});

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
      { id: 'structure', items: [sub('foundation', 'foundation', 'foundation', 'foundation'), sub('floor', 'floor', 'floor', 'floor'), sub('wall', 'wall', 'wall', 'wall'), sub('door', 'door', 'door', 'door'), sub('erase', 'erase', 'erase', 'erase')] },
      { id: 'processing', items: [fx('checkIn', 'checkIn'), fx('security', 'security'), fx('kiosk', 'kiosk'), fx('bagDrop', 'bagDrop'), fx('passport', 'passport'), fx('gateDesk', 'gateDesk')] },
      { id: 'facilities', items: [fx('belt', 'belt'), fx('seating', 'seating'), fx('toilet', 'toilet')] },
      { id: 'shops', items: [fx('convenience', 'shop'), fx('quickFood', 'shop'), fx('cafe', 'shop'), fx('dutyFree', 'shop'), fx('booksGifts', 'shop'), fx('pharmacy', 'shop')] },
    ],
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
    tabs: [{ id: 'admin', items: [sheet('finance', 'finance', 'finance'), sheet('airlines', 'airlines', 'airlines'), sheet('site', 'site', 'site')] }],
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
        items: [1, 2, 3, 4].map((z) => ({
          id: ['public', 'commercial', 'secure', 'staff'][z - 1],
          thumb: ['zonePublic', 'zoneCommercial', 'zoneSecure', 'zoneStaff'][z - 1],
          icon: 'zoning' as IconName,
          run: (s: ToolState) => s.set({ tool: 'terminal', tSub: 'zone', zoneType: z as 1 | 2 | 3 | 4 }),
          active: (s: ToolState) => s.tool === 'terminal' && s.tSub === 'zone' && s.zoneType === z,
        })),
      },
    ],
  },
];

const fresh = { barOpen: true, selection: null, hint: null, problem: null, buy: null } as const;

/** Opens a category in the left toolbar: its default tool, its first tab, and the bottom menu. */
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

/** Bottom menu of the open category: tabs for sub menus, and a thumbnail card for each thing that can be built or bought. */
export function BuildMenu({ send }: { send(cmd: Command): void }) {
  const s = useToolStore();
  const biz = useGameStore((g) => g.business);
  const cat = CATEGORIES.find((c) => c.id === s.category);
  if (!cat || !s.menuOpen) return null;
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
                  <Thumb kind={it.thumb} icon={it.icon} />
                  {it.locked && (
                    <span class="lockbadge">
                      <Icon name="lock" size={14} />
                    </span>
                  )}
                </div>
                <div class="card-name">{spec ? spec.name : tDynamic(`menu.${cat.id}.${tab.id}.${it.id}` as StringKey) }</div>
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
