import type { OverlayKind } from '@shared/overlay';
import { useGameStore } from './stores/gameStore';
import { t, type StringKey } from './strings';

const ROWS: { kind: OverlayKind; key: StringKey }[] = [
  { kind: 'none', key: 'hud.overlay.off' },
  { kind: 'density', key: 'hud.overlay.density' },
  { kind: 'queue', key: 'hud.overlay.queue' },
  { kind: 'staffing', key: 'hud.overlay.staffing' },
  { kind: 'baggage', key: 'hud.overlay.baggage' },
  { kind: 'walk', key: 'hud.overlay.walk' },
  { kind: 'zones', key: 'hud.overlay.zones' },
];

/**
 * Compact list of every overlay (T36): the terminal overlays, one at a time, then the map layers that switch on and off on
 * their own (traffic reservations, the walking graph of the selected terminal, land parcels). Anchored under the top bar
 * overlay button by its parent.
 */
export function OverlayMenu() {
  const overlay = useGameStore((s) => s.overlay);
  const setOverlay = useGameStore((s) => s.setOverlay);
  const closeOverlayMenu = useGameStore((s) => s.closeOverlayMenu);
  const debugOverlay = useGameStore((s) => s.debugOverlay);
  const walkOverlay = useGameStore((s) => s.walkOverlay);
  const parcelOverlay = useGameStore((s) => s.parcelOverlay);
  const toggleDebugOverlay = useGameStore((s) => s.toggleDebugOverlay);
  const toggleWalkOverlay = useGameStore((s) => s.toggleWalkOverlay);
  const toggleParcelOverlay = useGameStore((s) => s.toggleParcelOverlay);
  const layers = [
    { id: 'debug-toggle', on: debugOverlay, key: 'hud.overlay.traffic' as StringKey, title: t('hud.debug'), toggle: toggleDebugOverlay },
    { id: 'walk-toggle', on: walkOverlay, key: 'hud.overlay.walkGraph' as StringKey, title: t('hud.walkGraph'), toggle: toggleWalkOverlay },
    { id: 'overlay-parcels', on: parcelOverlay, key: 'hud.overlay.parcels' as StringKey, title: t('hud.parcels'), toggle: toggleParcelOverlay },
  ];
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
      <div role="separator" style="height:1px;background:var(--line);margin:4px 0" />
      {layers.map((l) => (
        <button
          key={l.id}
          role="menuitemcheckbox"
          aria-checked={l.on}
          data-testid={l.id}
          title={l.title}
          onClick={l.toggle}
          style="display:flex;gap:8px;align-items:center;width:100%;text-align:left;border:0;border-radius:6px;padding:6px 10px;font-size:12px"
        >
          <span aria-hidden="true" style="width:12px">{l.on ? '✓' : ''}</span>
          {t(l.key)}
        </button>
      ))}
    </div>
  );
}
