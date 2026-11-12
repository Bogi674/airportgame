import type { OverlayKind } from '@shared/overlay';
import { useGameStore } from './stores/gameStore';
import { t, type StringKey } from './strings';

const ROWS: { kind: OverlayKind; key: StringKey }[] = [
  { kind: 'none', key: 'hud.overlay.off' },
  { kind: 'density', key: 'hud.overlay.density' },
  { kind: 'queue', key: 'hud.overlay.queue' },
  { kind: 'walk', key: 'hud.overlay.walk' },
];

/** Compact list of the terminal overlays, one at a time. Anchored under the top bar overlay button by its parent. */
export function OverlayMenu() {
  const overlay = useGameStore((s) => s.overlay);
  const setOverlay = useGameStore((s) => s.setOverlay);
  const closeOverlayMenu = useGameStore((s) => s.closeOverlayMenu);
  return (
    <div
      role="menu"
      aria-label={t('hud.overlay.title')}
      class="panel"
      style="position:absolute;right:0;top:44px;padding:6px;display:flex;flex-direction:column;gap:2px;min-width:200px;z-index:30"
    >
      {ROWS.map((r) => (
        <button
          key={r.kind}
          role="menuitemradio"
          aria-checked={overlay === r.kind}
          data-testid={`overlay-${r.kind}`}
          onClick={() => {
            setOverlay(r.kind);
            closeOverlayMenu();
          }}
          style="display:block;width:100%;text-align:left;border:0;border-radius:6px;padding:6px 10px;font-size:12px"
        >
          {t(r.key)}
        </button>
      ))}
    </div>
  );
}
