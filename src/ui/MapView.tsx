import { useEffect, useRef } from 'preact/hooks';
import { Renderer } from '@render/renderer';
import type { SimClient } from '../worker/client';
import { useGameStore } from './stores/gameStore';
import { useToolStore } from './stores/toolStore';
import { ToolController } from './tools/controller';
import { toolActions } from './tools/actions';

const ZOOM_STEP = 1.0015;
const ROTATE_RATE = 0.004;
const CLICK_SLOP_PX = 4;

interface Props {
  client: SimClient;
  onRenderer(renderer: Renderer | null): void;
  onPick(parcelId: number): void;
}

/** The map canvas: owns the renderer, the frame loop, pointer input and the build tool controller. */
export function MapView({ client, onRenderer, onPick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Renderer(canvas);
    onRenderer(renderer);
    const cam = renderer.camera;
    const controller = new ToolController({
      send: (cmd) => client.send(cmd),
      setGhost: (g) => renderer.setGhost(g),
      zoom: () => cam.zoom,
      setHighlight: (h, s) => renderer.setHighlight(h, s),
      setGuide: (a, b) => renderer.setGuide(a, b),
      setCursor: (c) => {
        canvas.style.cursor = c;
      },
    });

    const world = { x: 0, y: 0 };
    const toWorld = (e: PointerEvent | MouseEvent): { x: number; y: number } => {
      cam.screenToWorld(e.offsetX, e.offsetY, world);
      return { x: world.x, y: world.y };
    };

    let panning = false;
    let rotating = false;
    let toolDown = false;
    /** The press that completes an armed start click. */
    let endClick = false;
    let pointerX = -1;
    let pointerY = -1;
    let lastMods = { shift: false, alt: false };
    let spaceHeld = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;

    const onDown = (e: PointerEvent): void => {
      const tool = useToolStore.getState().tool;
      lastX = e.offsetX;
      lastY = e.offsetY;
      downX = e.offsetX;
      downY = e.offsetY;
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 0 && tool !== 'select' && !spaceHeld) {
        toolDown = true;
        if (controller.armed) endClick = true;
        else controller.down(toWorld(e), { shift: e.shiftKey, alt: e.altKey });
      } else if (e.button === 0 || e.button === 1) {
        panning = true;
      } else if (e.button === 2) {
        rotating = true;
      }
    };
    const onMove = (e: PointerEvent): void => {
      pointerX = e.offsetX;
      pointerY = e.offsetY;
      lastMods = { shift: e.shiftKey, alt: e.altKey };
      if (panning) cam.panByScreen(e.offsetX - lastX, e.offsetY - lastY);
      else if (rotating) cam.rotateAt(canvas.clientWidth / 2, canvas.clientHeight / 2, (e.offsetX - lastX) * ROTATE_RATE);
      else controller.move(toWorld(e), { shift: e.shiftKey, alt: e.altKey });
      lastX = e.offsetX;
      lastY = e.offsetY;
    };
    const onUp = (e: PointerEvent): void => {
      const click = Math.hypot(e.offsetX - downX, e.offsetY - downY) < CLICK_SLOP_PX;
      if (e.button === 2 && rotating && click) {
        // A right click while laying something out asks to build it or drop it.
        if (controller.gestureActive) useToolStore.getState().set({ confirmAt: { x: e.offsetX, y: e.offsetY } });
        else if (useToolStore.getState().tool !== 'select') controller.cancel();
      }
      if (toolDown && e.button === 0) {
        if (!endClick && click && controller.twoClick) {
          // A click without a drag sets the start point. The next click sets the end point.
          controller.move(toWorld(e), { shift: e.shiftKey, alt: e.altKey });
        } else controller.up(toWorld(e), { shift: e.shiftKey, alt: e.altKey });
      } else if (panning && e.button === 0 && click && useToolStore.getState().tool === 'select') {
        controller.up(toWorld(e), { shift: e.shiftKey, alt: e.altKey });
        // Parcels are only picked in land mode, so building never selects land by accident.
        if (useGameStore.getState().parcelOverlay && useToolStore.getState().selection === null) onPick(renderer.parcelAt(e.offsetX, e.offsetY));
        else onPick(-1);
      }
      toolDown = false;
      endClick = false;
      panning = false;
      rotating = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      cam.zoomAt(e.offsetX, e.offsetY, Math.pow(ZOOM_STEP, -e.deltaY));
    };
    const onDouble = (): void => controller.finish();
    const onContext = (e: Event): void => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') spaceHeld = true;
      if (controller.key(e)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceHeld = false;
    };

    toolActions.confirm = () => controller.confirm();
    toolActions.cancel = () => controller.cancel();
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDouble);
    canvas.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // The selected outline follows the selection and any change to the airfield.
    const unsubSelection = useToolStore.subscribe((s, prev) => {
      if (s.selection !== prev.selection) controller.refreshSelection();
    });
    const unsubAirfield = useGameStore.subscribe((s, prev) => {
      if (s.airfield !== prev.airfield || s.terminalGrids !== prev.terminalGrids) controller.refreshSelection();
    });

    // Switching tools drops any gesture in progress.
    let lastTool = useToolStore.getState().tool;
    const unsubscribe = useToolStore.subscribe((s) => {
      if (s.tool !== lastTool) {
        lastTool = s.tool;
        controller.reset();
      }
    });

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
    let lastFrame = 0;
    const EDGE_PX = 48;
    const EDGE_SPEED = 900;
    const frame = (now: number): void => {
      // Edge scrolling while a gesture is in progress: the nearer the pointer is to the edge, the faster the map moves.
      const dt = lastFrame === 0 ? 0 : Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      if (controller.gestureActive && pointerX >= 0 && dt > 0) {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const ex = pointerX < EDGE_PX ? -(1 - pointerX / EDGE_PX) : pointerX > w - EDGE_PX ? 1 - (w - pointerX) / EDGE_PX : 0;
        const ey = pointerY < EDGE_PX ? -(1 - pointerY / EDGE_PX) : pointerY > h - EDGE_PX ? 1 - (h - pointerY) / EDGE_PX : 0;
        if (ex !== 0 || ey !== 0) {
          cam.panByScreen(-ex * EDGE_SPEED * dt, -ey * EDGE_SPEED * dt);
          cam.screenToWorld(pointerX, pointerY, world);
          controller.move({ x: world.x, y: world.y }, lastMods);
        }
      }
      const f = client.frame(now);
      renderer.render(f.prev, f.curr, f.alpha);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      toolActions.confirm = () => undefined;
      toolActions.cancel = () => undefined;
      unsubSelection();
      unsubAirfield();
      dprQuery.removeEventListener('change', onDpr);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDouble);
      canvas.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      renderer.dispose();
      onRenderer(null);
    };
  }, [client, onRenderer, onPick]);

  return <canvas ref={canvasRef} id="map" data-testid="map" style="display:block;width:100%;height:100%;touch-action:none" />;
}
