import { describe, expect, it } from 'vitest';
import { Camera, MAX_ZOOM, MIN_ZOOM } from '@render/camera';

const pt = { x: 0, y: 0 };

describe('Camera', () => {
  it('clamps zoom to 0.05 .. 40 px/m', () => {
    const c = new Camera();
    c.setZoom(0.001);
    expect(c.zoom).toBe(MIN_ZOOM);
    c.setZoom(1000);
    expect(c.zoom).toBe(MAX_ZOOM);
  });

  it('round trips world and screen at any rotation', () => {
    const c = new Camera();
    c.x = 1234;
    c.y = 567;
    c.zoom = 2.5;
    c.rotation = 0.9;
    c.worldToScreen(1300, 600, pt);
    const sx = pt.x;
    const sy = pt.y;
    c.screenToWorld(sx, sy, pt);
    expect(pt.x).toBeCloseTo(1300, 6);
    expect(pt.y).toBeCloseTo(600, 6);
  });

  it('centers the camera position in the viewport', () => {
    const c = new Camera();
    c.setViewport(1000, 600);
    c.worldToScreen(c.x, c.y, pt);
    expect(pt.x).toBeCloseTo(500);
    expect(pt.y).toBeCloseTo(300);
  });

  it('zoomAt keeps the point under the cursor fixed', () => {
    const c = new Camera();
    c.rotation = 0.4;
    c.zoom = 1;
    c.screenToWorld(200, 150, pt);
    const wx = pt.x;
    const wy = pt.y;
    c.zoomAt(200, 150, 3);
    expect(c.zoom).toBeCloseTo(3);
    c.screenToWorld(200, 150, pt);
    expect(pt.x).toBeCloseTo(wx, 6);
    expect(pt.y).toBeCloseTo(wy, 6);
  });

  it('rotateAt keeps the point under the cursor fixed', () => {
    const c = new Camera();
    c.screenToWorld(300, 100, pt);
    const wx = pt.x;
    const wy = pt.y;
    c.rotateAt(300, 100, 1.1);
    c.screenToWorld(300, 100, pt);
    expect(pt.x).toBeCloseTo(wx, 6);
    expect(pt.y).toBeCloseTo(wy, 6);
  });

  it('panByScreen moves the world with the cursor', () => {
    const c = new Camera();
    c.rotation = 0.7;
    c.zoom = 2;
    c.screenToWorld(400, 300, pt);
    const wx = pt.x;
    const wy = pt.y;
    c.panByScreen(50, -30);
    c.screenToWorld(450, 270, pt);
    expect(pt.x).toBeCloseTo(wx, 6);
    expect(pt.y).toBeCloseTo(wy, 6);
  });

  it('visibleBounds covers the viewport corners', () => {
    const c = new Camera();
    c.setViewport(800, 600);
    c.zoom = 0.5;
    c.rotation = 0.6;
    const b = new Float64Array(4);
    c.visibleBounds(b);
    for (const [sx, sy] of [[0, 0], [800, 0], [0, 600], [800, 600]]) {
      c.screenToWorld(sx, sy, pt);
      expect(pt.x).toBeGreaterThanOrEqual(b[0] - 1e-6);
      expect(pt.x).toBeLessThanOrEqual(b[2] + 1e-6);
      expect(pt.y).toBeGreaterThanOrEqual(b[1] - 1e-6);
      expect(pt.y).toBeLessThanOrEqual(b[3] + 1e-6);
    }
  });
});
