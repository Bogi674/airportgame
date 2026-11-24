import { useState } from 'preact/hooks';
import type { Command } from '@sim/commands';
import { itemTarget, type ItemTarget } from './itemActions';
import { useGameStore } from './stores/gameStore';
import { useToolStore } from './stores/toolStore';
import { t } from './strings';

/** Gap in pixels between the clicked point and the popup, so the popup never covers the item it edits. */
const MENU_GAP_PX = 16;
/** Popup width in pixels, kept inside the map on the right edge. */
const MENU_W_PX = 240;
/** Tallest the popup gets (the demolish confirm), kept inside the map on the bottom edge. */
const MENU_H_PX = 150;

/**
 * Relocate, Rotate and Demolish for a picked fixture or prop (T86). Demolish first asks, naming what removal pays back.
 * `prefix` keeps the test ids of the popup and the inspector copies apart.
 */
export function ItemButtons({ target, prefix }: { target: ItemTarget; prefix: string }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  if (confirming === target.key) {
    return (
      <div data-testid={`${prefix}-confirm`} style="margin-top:6px;display:flex;flex-direction:column;gap:6px">
        <div style="font-size:12px;overflow-wrap:anywhere">{target.demolishText}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button
            data-testid={`${prefix}-demolish-yes`}
            onClick={() => {
              setConfirming(null);
              target.demolish();
            }}
          >
            {t('inspector.itemDemolishYes')}
          </button>
          <button data-testid={`${prefix}-demolish-no`} onClick={() => setConfirming(null)}>
            {t('inspector.itemCancel')}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">
      <button data-testid={`${prefix}-move`} onClick={() => target.relocate()}>
        {t('inspector.itemMove')}
      </button>
      <button data-testid={`${prefix}-rotate`} onClick={() => target.rotate()}>
        {t('inspector.itemRotate')}
      </button>
      <button data-testid={`${prefix}-remove`} onClick={() => setConfirming(target.key)}>
        {t('inspector.itemRemove')}
      </button>
    </div>
  );
}

/** Popup beside a fixture or prop picked with the select tool, at the point that was clicked (T86). */
export function ItemMenu({ send }: { send: (c: Command) => void }) {
  const at = useToolStore((s) => s.pickAt);
  const fixturePick = useToolStore((s) => s.fixturePick);
  const propPick = useToolStore((s) => s.propPick);
  const tool = useToolStore((s) => s.tool);
  const grids = useGameStore((s) => s.terminalGrids);
  if (!at || tool !== 'select') return null;
  const target = itemTarget(grids, fixturePick, propPick, send);
  if (!target) return null;
  const left = Math.max(8, Math.min(at.x + MENU_GAP_PX, at.maxX - MENU_W_PX - 8));
  const top = Math.max(8, Math.min(at.y + MENU_GAP_PX, at.maxY - MENU_H_PX - 8));
  return (
    <div data-testid="item-menu" role="menu" class="panel" style={`position:absolute;left:${left}px;top:${top}px;z-index:40;width:${MENU_W_PX}px;padding:8px;box-sizing:border-box`}>
      <div style="font-weight:600;overflow-wrap:anywhere">{target.name}</div>
      <ItemButtons key={target.key} target={target} prefix="menu-item" />
    </div>
  );
}
