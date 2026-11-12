import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { overlayMax } from '@render/overlayRamp';
import type { OverlayKind } from '@shared/overlay';
import { Icon } from './icons';
import { useGameStore } from './stores/gameStore';
import { useToolStore } from './stores/toolStore';
import { t, type StringKey } from './strings';

type Shown = Exclude<OverlayKind, 'none'>;

const NAME: Record<Shown, StringKey> = {
  density: 'hud.overlay.density',
  queue: 'hud.overlay.queue',
  walk: 'hud.overlay.walk',
};

const UNIT: Record<Shown, StringKey> = {
  density: 'hud.overlay.unitDensity',
  queue: 'hud.overlay.unitWait',
  walk: 'hud.overlay.unitWalk',
};

/** Ramp steps shown in the legend bar. Matches the 16 step colour ramp of the map. */
const STEPS = 16;
/** Gap between the legend and a bottom centre panel it stacks above, and its default distance from the bottom edge. */
const GAP = 8;
const BASE_BOTTOM = 16;
/** Bottom centre panels the legend stacks above: the build menu and the context bar. */
const STACKED = '[data-testid="build-menu"], [data-testid="context-bar"]';

/**
 * Each step shows its own slice of one gradient built from the theme tokens. A step is one sixteenth of a
 * sixteen times wide gradient, so the slices join into the full ok, warn, bad ramp at any bar width.
 */
function stepStyle(i: number): string {
  const pos = (i / (STEPS - 1)) * 100;
  return `flex:1 1 0;min-width:0;height:8px;background-image:linear-gradient(90deg, var(--ok), var(--warn), var(--bad));background-size:1600% 100%;background-position:${pos}% 0`;
}

/** Legend chip at the bottom centre of the map: the overlay name, the ramp scale and a close button. */
export function OverlayLegend() {
  const overlay = useGameStore((s) => s.overlay);
  const overlayData = useGameStore((s) => s.overlayData);
  const setOverlay = useGameStore((s) => s.setOverlay);
  // Only the fields that show or move the build menu and context bar. A string compares by value, so pointer
  // moves in the tool store do not rerender the legend.
  const stack = useToolStore((s) => `${s.tool}|${s.menuOpen}|${s.category}|${s.hint ? 1 : 0}|${s.problem ? 1 : 0}`);
  const ref = useRef<HTMLDivElement>(null);
  const [bottom, setBottom] = useState(BASE_BOTTOM);
  const max = useMemo(() => (overlay === 'none' ? 0 : overlayMax(overlay, overlayData ?? [])), [overlay, overlayData]);
  const shown = overlay !== 'none';
  // Measures when the legend appears or the stacked panels change, and again when a stacked panel resizes.
  useLayoutEffect(() => {
    const legend = ref.current;
    const root = legend?.parentElement;
    if (!legend || !root) return;
    const measure = (): void => {
      const lr = legend.getBoundingClientRect();
      let top = Infinity;
      root.querySelectorAll<HTMLElement>(STACKED).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.right > lr.left && r.left < lr.right) top = Math.min(top, r.top);
      });
      const rootBottom = root.getBoundingClientRect().bottom;
      setBottom(top === Infinity ? BASE_BOTTOM : Math.max(BASE_BOTTOM, Math.round(rootBottom - top + GAP)));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    root.querySelectorAll<HTMLElement>(STACKED).forEach((el) => observer?.observe(el));
    return () => observer?.disconnect();
  }, [shown, stack]);
  if (overlay === 'none') return null;
  return (
    <div
      ref={ref}
      class="chip"
      role="status"
      data-testid="overlay-legend"
      style={`position:absolute;left:50%;bottom:${bottom}px;transform:translateX(-50%);z-index:5;max-width:min(440px, calc(100vw - 32px));white-space:nowrap`}
    >
      <b style="min-width:0;overflow:hidden;text-overflow:ellipsis">{t(NAME[overlay])}</b>
      <span style="display:inline-flex;gap:1px;width:150px;flex:0 1 150px;min-width:0" aria-hidden="true">
        {Array.from({ length: STEPS }, (_, i) => (
          <i key={i} style={stepStyle(i)} />
        ))}
      </span>
      <span>0</span>
      <span data-testid="overlay-legend-max">{`${max} ${t(UNIT[overlay])}`}</span>
      <button
        aria-label={t('hud.overlay.close')}
        title={t('hud.overlay.close')}
        data-testid="overlay-legend-close"
        onClick={() => setOverlay('none')}
        style="width:22px;height:22px;padding:0;display:inline-flex;align-items:center;justify-content:center"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
