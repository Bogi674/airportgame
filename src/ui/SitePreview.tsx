import { useEffect, useRef } from 'preact/hooks';
import { SEASONS, WIND_BINS, type SitePayload } from '@shared/site';
import { buildBase } from './Minimap';
import { t } from './strings';

const SIZE = 200;

/** Reads a theme token, so the drawing follows dark and light themes. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Mini map of a previewed site for the new game panel (T35): land classes, the wind rose of the whole year in the
 * centre and the ideal runway heading as a line through it.
 */
export function SitePreview({ site }: { site: SitePayload | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (!site) return;
    ctx.drawImage(buildBase(site), 0, 0, SIZE, SIZE);
    const freq = new Float64Array(WIND_BINS);
    let max = 0;
    for (let b = 0; b < WIND_BINS; b++) {
      for (let s = 0; s < SEASONS; s++) freq[b] += site.windFreq[s * WIND_BINS + b] ?? 0;
      max = Math.max(max, freq[b]);
    }
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const r = SIZE * 0.32;
    ctx.fillStyle = token('--panel');
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = token('--accent');
    const half = Math.PI / WIND_BINS;
    for (let b = 0; b < WIND_BINS; b++) {
      if (max <= 0) break;
      const a = (b * 2 * Math.PI) / WIND_BINS - Math.PI / 2;
      const len = (r * freq[b]) / max;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, len, a - half * 0.8, a + half * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    const h = ((site.idealHeadingDeg - 90) * Math.PI) / 180;
    ctx.strokeStyle = token('--text');
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(h) * (r + 4), cy - Math.sin(h) * (r + 4));
    ctx.lineTo(cx + Math.cos(h) * (r + 4), cy + Math.sin(h) * (r + 4));
    ctx.stroke();
  }, [site]);
  return <canvas ref={ref} data-testid="site-preview" width={SIZE} height={SIZE} role="img" aria-label={t('menu.windRose')} style="width:200px;height:200px;border:1px solid var(--line);border-radius:10px;background:var(--bg);flex:none" />;
}
