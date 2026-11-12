import { describe, expect, it } from 'vitest';
import { readoutBelowTip, readoutPosition } from '@render/renderer';

const out = { x: 0, y: 0 };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Places a readout under a 28 px tall snap tip with a 6 px gap and returns both rectangles. */
function tipAndReadout(tipX: number, tipY: number, tipW: number, boxW: number, vw: number, vh: number): { tip: Rect; box: Rect } {
  const tip = { x: tipX, y: tipY, w: tipW, h: 28 };
  const p = readoutBelowTip(tip.x, tip.y, tip.w, tip.h, 6, boxW, 20, vw, vh, out);
  return { tip, box: { x: p.x, y: p.y, w: boxW, h: 20 } };
}

describe('readoutPosition', () => {
  it('sits 16 px right and below the cursor when it fits', () => {
    const p = readoutPosition(100, 200, 120, 20, 1280, 720, out);
    expect(p).toEqual({ x: 116, y: 216 });
  });

  it('flips to the left of the cursor when it would cross the right edge', () => {
    const p = readoutPosition(1200, 200, 120, 20, 1280, 720, out);
    expect(p).toEqual({ x: 1200 - 16 - 120, y: 216 });
    expect(p.x + 120).toBe(1200 - 16);
  });

  it('flips above the cursor when it would cross the bottom edge', () => {
    const p = readoutPosition(100, 710, 120, 20, 1280, 720, out);
    expect(p).toEqual({ x: 116, y: 710 - 16 - 20 });
    expect(p.y + 20).toBe(710 - 16);
  });

  it('flips on both axes when it would cross the right and bottom edges', () => {
    const p = readoutPosition(1200, 710, 120, 20, 1280, 720, out);
    expect(p).toEqual({ x: 1200 - 16 - 120, y: 710 - 16 - 20 });
  });

  it('writes into the given output object and returns it', () => {
    const p = readoutPosition(10, 10, 50, 20, 1280, 720, out);
    expect(p).toBe(out);
  });
});

describe('readoutBelowTip', () => {
  it('sits under the tip with the same left edge and a 6 px gap', () => {
    const { tip, box } = tipAndReadout(200, 200, 100, 120, 1280, 720);
    expect(box.x).toBe(tip.x);
    expect(box.y).toBe(tip.y + tip.h + 6);
    expect(intersects(tip, box)).toBe(false);
  });

  it('keeps the readout inside the right edge without touching the tip', () => {
    const { tip, box } = tipAndReadout(1100, 200, 150, 200, 1280, 720);
    expect(box.x).toBe(tip.x + tip.w - box.w);
    expect(box.x + box.w).toBeLessThanOrEqual(1280);
    expect(box.x + box.w).toBe(tip.x + tip.w);
    expect(intersects(tip, box)).toBe(false);
  });

  it('flips above the tip when it would cross the bottom edge', () => {
    const { tip, box } = tipAndReadout(200, 700, 100, 120, 1280, 720);
    expect(box.y + box.h).toBeLessThanOrEqual(720);
    expect(box.y + box.h).toBe(tip.y - 6);
    expect(intersects(tip, box)).toBe(false);
  });
});
