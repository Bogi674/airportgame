import { useEffect, useRef } from 'preact/hooks';
import type { Renderer } from '@render/renderer';
import { GRID_N, LandClass, SITE_M, type SitePayload } from '@shared/site';
import { t } from './strings';

const SIZE = 200;
const STEP = GRID_N / SIZE;

const CLASS_RGB: Record<number, [number, number, number]> = {
  [LandClass.Water]: [40, 100, 140],
  [LandClass.Beach]: [214, 201, 150],
  [LandClass.Grass]: [112, 150, 84],
  [LandClass.Forest]: [60, 100, 60],
  [LandClass.Wetland]: [92, 128, 96],
  [LandClass.Farmland]: [160, 170, 95],
  [LandClass.Village]: [170, 150, 130],
  [LandClass.Industrial]: [140, 140, 140],
  [LandClass.Road]: [90, 90, 90],
  [LandClass.Rock]: [128, 122, 112],
};

function buildBase(site: SitePayload): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const o = Math.floor((y + 0.5) * STEP) * GRID_N + Math.floor((x + 0.5) * STEP);
      const rgb = CLASS_RGB[site.landClass[o]];
      const k = (y * SIZE + x) * 4;
      img.data[k] = rgb[0];
      img.data[k + 1] = rgb[1];
      img.data[k + 2] = rgb[2];
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function buildOwned(site: SitePayload, owner: Uint8Array | null): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d');
  if (!ctx || !owner) return c;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const o = Math.floor((y + 0.5) * STEP) * GRID_N + Math.floor((x + 0.5) * STEP);
      if (owner[site.parcelId[o]] !== 1) continue;
      const k = (y * SIZE + x) * 4;
      img.data[k] = 255;
      img.data[k + 1] = 210;
      img.data[k + 2] = 74;
      img.data[k + 3] = 140;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

interface Props {
  renderer: Renderer | null;
  site: SitePayload;
  owner: Uint8Array | null;
}

/** 200 by 200 minimap with the camera frame, a compass, align view and zoom to fit. */
export function Minimap({ renderer, site, owner }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const needleRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const ownedRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    baseRef.current = buildBase(site);
  }, [site]);
  useEffect(() => {
    ownedRef.current = buildOwned(site, owner);
  }, [site, owner]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !renderer) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cam = renderer.camera;
    const pt = { x: 0, y: 0 };
    let raf = 0;
    let last = 0;
    const toMini = (v: number): number => (v / SITE_M) * SIZE;

    const draw = (now: number): void => {
      raf = requestAnimationFrame(draw);
      if (now - last < 66) return;
      last = now;
      ctx.clearRect(0, 0, SIZE, SIZE);
      if (baseRef.current) ctx.drawImage(baseRef.current, 0, 0);
      if (ownedRef.current) ctx.drawImage(ownedRef.current, 0, 0);
      ctx.beginPath();
      const corners: [number, number][] = [
        [0, 0],
        [cam.width, 0],
        [cam.width, cam.height],
        [0, cam.height],
      ];
      for (let i = 0; i < 4; i++) {
        cam.screenToWorld(corners[i][0], corners[i][1], pt);
        if (i === 0) ctx.moveTo(toMini(pt.x), toMini(pt.y));
        else ctx.lineTo(toMini(pt.x), toMini(pt.y));
      }
      ctx.closePath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (needleRef.current) needleRef.current.style.transform = `rotate(${(cam.rotation * 180) / Math.PI}deg)`;
    };
    raf = requestAnimationFrame(draw);

    let dragging = false;
    const moveTo = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      cam.x = Math.max(0, Math.min(SITE_M, ((e.clientX - r.left) / r.width) * SITE_M));
      cam.y = Math.max(0, Math.min(SITE_M, ((e.clientY - r.top) / r.height) * SITE_M));
    };
    const down = (e: PointerEvent): void => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      moveTo(e);
    };
    const move = (e: PointerEvent): void => {
      if (dragging) moveTo(e);
    };
    const up = (e: PointerEvent): void => {
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
  }, [renderer, site]);

  const cam = renderer?.camera;
  return (
    <div
      data-testid="minimap"
      class="minimap"
      onPointerDown={(e) => (e.currentTarget as HTMLElement).classList.add('active')}
      onPointerUp={(e) => (e.currentTarget as HTMLElement).classList.remove('active')}
      style={`position:absolute;right:12px;bottom:12px;width:${SIZE}px;padding:6px;background:var(--panel);border:1px solid var(--line);border-radius:10px`}
    >
      <canvas ref={canvasRef} width={SIZE} height={SIZE} aria-label={t('map.minimap')} style={`display:block;width:${SIZE}px;height:${SIZE}px;cursor:crosshair`} />
      <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
        <button data-testid="compass" title={t('map.compass')} aria-label={t('map.compass')} onClick={() => cam?.faceNorth()} style="width:34px;height:34px;padding:0;position:relative">
          <div ref={needleRef} style="position:absolute;inset:0;display:flex;justify-content:center;transition:none">
            <div style="width:0;height:0;margin-top:4px;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:12px solid #ff6b5e" />
          </div>
          <span style="position:absolute;bottom:2px;left:0;right:0;font-size:9px">N</span>
        </button>
        <button data-testid="align" title={t('map.align')} aria-label={t('map.align')} onClick={() => cam?.alignToAxis(site.idealHeadingDeg)} style="height:34px">
          {String(site.idealHeadingDeg).padStart(3, '0')}°
        </button>
        <button data-testid="fit" title={t('map.fit')} aria-label={t('map.fit')} onClick={() => cam?.zoomToFit(SITE_M, SITE_M / 2, SITE_M / 2)} style="height:34px">
          ⤢
        </button>
      </div>
    </div>
  );
}

