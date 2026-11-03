import { clamp } from '@shared/math';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 40;

/**
 * Top down camera. `zoom` is pixels per meter, `rotation` is the view rotation in radians
 * ("align view to runway" sets it). World to screen:
 * screen = viewport / 2 + R(rotation) * (world - center) * zoom.
 */
export class Camera {
  x = 4000;
  y = 4000;
  zoom = 0.1;
  rotation = 0;
  width = 1280;
  height = 720;

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  setZoom(zoom: number): void {
    this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  }

  worldToScreen(wx: number, wy: number, out: { x: number; y: number }): void {
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    const dx = wx - this.x;
    const dy = wy - this.y;
    out.x = this.width / 2 + (dx * c - dy * s) * this.zoom;
    out.y = this.height / 2 + (dx * s + dy * c) * this.zoom;
  }

  screenToWorld(sx: number, sy: number, out: { x: number; y: number }): void {
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    const rx = (sx - this.width / 2) / this.zoom;
    const ry = (sy - this.height / 2) / this.zoom;
    out.x = this.x + rx * c + ry * s;
    out.y = this.y - rx * s + ry * c;
  }

  /** Pans by a screen space drag delta in pixels. */
  panByScreen(dxPx: number, dyPx: number): void {
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    const rx = dxPx / this.zoom;
    const ry = dyPx / this.zoom;
    this.x -= rx * c + ry * s;
    this.y -= -rx * s + ry * c;
  }

  /** Zooms by a factor while keeping the world point under the cursor fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = { x: 0, y: 0 };
    this.screenToWorld(sx, sy, before);
    this.setZoom(this.zoom * factor);
    const after = { x: 0, y: 0 };
    this.screenToWorld(sx, sy, after);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  /** Rotates the view around the cursor point. */
  rotateAt(sx: number, sy: number, delta: number): void {
    const before = { x: 0, y: 0 };
    this.screenToWorld(sx, sy, before);
    this.rotation += delta;
    const after = { x: 0, y: 0 };
    this.screenToWorld(sx, sy, after);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  /** Axis aligned world bounds of everything visible, written into `out` as minX, minY, maxX, maxY. */
  visibleBounds(out: Float64Array): void {
    const c = Math.abs(Math.cos(this.rotation));
    const s = Math.abs(Math.sin(this.rotation));
    const halfW = (this.width / 2) / this.zoom;
    const halfH = (this.height / 2) / this.zoom;
    const ex = halfW * c + halfH * s;
    const ey = halfW * s + halfH * c;
    out[0] = this.x - ex;
    out[1] = this.y - ey;
    out[2] = this.x + ex;
    out[3] = this.y + ey;
  }
}
