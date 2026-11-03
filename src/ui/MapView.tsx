import { useEffect, useRef } from 'preact/hooks';
import { Renderer } from '@render/renderer';
import type { SimClient } from '../worker/client';

const ZOOM_STEP = 1.0015;
const ROTATE_RATE = 0.004;

const CLICK_SLOP_PX = 4;

interface Props {
  client: SimClient;
  onRenderer(renderer: Renderer | null): void;
  onPick(parcelId: number): void;
}

/** The map canvas: owns the renderer, the frame loop and pointer input. */
export function MapView({ client, onRenderer, onPick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Renderer(canvas);
    onRenderer(renderer);
    const cam = renderer.camera;

    let dragging = false;
    let rotating = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;

    const onDown = (e: PointerEvent): void => {
      dragging = e.button === 0 || e.button === 1;
      rotating = e.button === 2;
      lastX = e.offsetX;
      lastY = e.offsetY;
      downX = e.offsetX;
      downY = e.offsetY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      if (dragging) cam.panByScreen(e.offsetX - lastX, e.offsetY - lastY);
      else if (rotating) cam.rotateAt(canvas.clientWidth / 2, canvas.clientHeight / 2, (e.offsetX - lastX) * ROTATE_RATE);
      lastX = e.offsetX;
      lastY = e.offsetY;
    };
    const onUp = (e: PointerEvent): void => {
      const wasClick = dragging && e.button === 0 && Math.hypot(e.offsetX - downX, e.offsetY - downY) < CLICK_SLOP_PX;
      if (wasClick) onPick(renderer.parcelAt(e.offsetX, e.offsetY));
      dragging = false;
      rotating = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      cam.zoomAt(e.offsetX, e.offsetY, Math.pow(ZOOM_STEP, -e.deltaY));
    };
    const onContext = (e: Event): void => e.preventDefault();

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContext);

    // Moving between screens with a different pixel ratio re-sizes the backing store.
    let dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onDpr = (): void => {
      renderer.resize();
      dprQuery.removeEventListener('change', onDpr);
      dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener('change', onDpr);
    };
    dprQuery.addEventListener('change', onDpr);

    let raf = 0;
    const frame = (now: number): void => {
      const f = client.frame(now);
      renderer.render(f.prev, f.curr, f.alpha);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      dprQuery.removeEventListener('change', onDpr);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      renderer.dispose();
      onRenderer(null);
    };
  }, [client, onRenderer, onPick]);

  return <canvas ref={canvasRef} id="map" data-testid="map" style="display:block;width:100%;height:100%;touch-action:none" />;
}
