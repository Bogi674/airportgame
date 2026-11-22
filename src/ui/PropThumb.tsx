import { useEffect, useRef } from 'preact/hooks';
import { propSpec } from '@shared/props';
import { ensurePacks, type KitCategory } from '../render/sprites/fixtureKit';
import { bakeFixture } from '../render/sprites/fixtureSprite';

/** Card thumbnail size in CSS pixels, the 96 by 60 frame of the other build menu thumbnails. */
const W = 96;
const H = 60;
/** Free border around the sprite in CSS pixels. */
const INSET = 4;
const BG = '#d3dadd';

/** The kit sprite of a prop asset at full detail, fitted into the card thumbnail without changing its proportions. */
export function PropThumb({ asset }: { asset: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const spec = propSpec(asset);
    const canvas = ref.current;
    if (!spec || !canvas) return;
    let live = true;
    void ensurePacks([spec.category as KitCategory]).then(() => {
      if (!live) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Pixels per meter that fit the sprite with its shadow pad into the frame. The sprite keeps its true proportions.
      const [w, d] = spec.size;
      const ppm = Math.min((W - 2 * INSET) / (w + 1.4), (H - 2 * INSET) / (d + 1.4)) * dpr;
      const sprite = bakeFixture(asset, 3, 0, Math.round(ppm * 100) / 100, null);
      if (!sprite) return;
      const sw = sprite.canvas.width;
      const sh = sprite.canvas.height;
      ctx.drawImage(sprite.canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2);
    });
    return () => {
      live = false;
    };
  }, [asset]);
  return <canvas ref={ref} style={`width:${W}px;height:${H}px;max-width:100%;display:block`} aria-hidden="true" />;
}
