import { useMemo } from 'preact/hooks';
import { Coin } from './BuildMenu';
import { formatInt, formatMoney } from './format';
import { Icon } from './icons';
import { Button, Panel, Stat, TitleBar } from './kit';
import { askDemolish } from './stores/demolishStore';
import { useGameStore } from './stores/gameStore';
import { AREA_KINDS, useToolStore, type AreaKind } from './stores/toolStore';
import { t, tDynamic, tFormat } from './strings';
import { planArea } from './tools/demolishPlans';

/**
 * Right panel of the area bulldoze (design revision 6 section 5.6, DEM3): the box size, a checklist of types with what the box
 * holds of each, the refund, and the button that asks for confirmation before anything goes.
 */
export function AreaBulldoze() {
  const s = useToolStore();
  const af = useGameStore((g) => g.airfield);
  const grids = useGameStore((g) => g.terminalGrids);
  const box = s.areaBox;
  const plan = useMemo(() => (box ? planArea(af, grids, box, s.areaFilter) : null), [af, grids, box, s.areaFilter]);
  if (s.tool !== 'demolish' || s.bulldozeMode !== 'area' || !box || !plan) return null;
  const all = AREA_KINDS.every((k) => s.areaFilter[k]);
  const setAll = (on: boolean): void => s.set({ areaFilter: Object.fromEntries(AREA_KINDS.map((k) => [k, on])) as Record<AreaKind, boolean> });
  const toggle = (k: AreaKind): void => s.set({ areaFilter: { ...s.areaFilter, [k]: !s.areaFilter[k] } });
  const totalAll = AREA_KINDS.reduce((sum, k) => sum + plan.counts[k], 0);
  const w = Math.round(Math.abs(box.x1 - box.x0));
  const h = Math.round(Math.abs(box.y1 - box.y0));
  const close = (): void => {
    s.set({ areaBox: null });
  };
  const bulldoze = (): void => {
    const lines = AREA_KINDS.filter((k) => s.areaFilter[k] && plan.counts[k] > 0).map((k) => `${tDynamic(`area.kind.${k}`)}: ${formatInt(plan.counts[k])}`);
    askDemolish({
      what: tFormat('area.items', { n: formatInt(plan.total) }),
      lines,
      refund: plan.refund,
      commands: plan.commands,
      after: () => useToolStore.getState().set({ areaBox: null }),
    });
  };
  return (
    <Panel class="z-right area-panel" testid="area-bulldoze" role="region" label={t('area.title')}>
      <TitleBar group="bad" icon="area" tag={t('area.tag')} title={t('area.title')} onClose={close} closeLabel={t('confirm.cancel')} />
      <div class="pn-body" style="display:flex;flex-direction:column;gap:10px">
        <div style="font-size:var(--fs-sm);color:var(--ink-2)">{tFormat('area.box', { w: formatInt(w), h: formatInt(h) })}</div>
        <div class="ck-head">
          <span class="lbl">{t('area.removeThese')}</span>
          <span class="lbl">{t('area.count')}</span>
        </div>
        <label class="ck-row ck-all">
          <input type="checkbox" data-testid="area-all" checked={all} onChange={() => setAll(!all)} />
          <b>{t('area.everything')}</b>
          <b class="num">{formatInt(totalAll)}</b>
        </label>
        <div class="ck-list">
          {AREA_KINDS.map((k) => (
            <label key={k} class={`ck-row${plan.counts[k] === 0 ? ' empty' : ''}`}>
              <input type="checkbox" data-testid={`area-${k}`} checked={s.areaFilter[k]} onChange={() => toggle(k)} />
              <span class="clip">{tDynamic(`area.kind.${k}`)}</span>
              <b class="num">{formatInt(plan.counts[k])}</b>
            </label>
          ))}
        </div>
      </div>
      <div class="area-foot">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <Stat label={t('demolish.refund')} value={plan.refund > 0 ? `+${formatMoney(plan.refund)}` : t('demolish.noRefund')} tone={plan.refund > 0 ? 'good' : undefined} testid="area-refund" />
          <Stat label={t('area.selected')} value={formatInt(plan.total)} />
        </div>
        <div style="display:flex;gap:8px">
          <Button kind="danger" style="flex:1" testid="area-go" disabled={plan.total === 0} onClick={bulldoze}>
            <Icon name="bulldoze" size={15} />
            {tFormat('area.go', { n: formatInt(plan.total) })}
          </Button>
          <Button kind="secondary" testid="area-cancel" onClick={close}>
            {t('confirm.cancel')}
          </Button>
        </div>
        <div style="display:flex;align-items:center;gap:5px;font-size:var(--fs-xs);color:var(--ink-2)">
          <Coin size={10} />
          {t('area.refundNote')}
        </div>
      </div>
    </Panel>
  );
}
