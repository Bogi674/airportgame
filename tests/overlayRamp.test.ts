import { describe, expect, it } from 'vitest';
import type { OverlayData } from '@shared/overlay';
import { OVERLAY_MAX } from '@shared/overlay';
import { buildRamp, overlayMax, rampIndex, RAMP_STEPS, withAlpha } from '../src/render/overlayRamp';

const OK = '#7fe0a0';
const WARN = '#ffd38a';
const BAD = '#ff9a92';

function overlay(p: Partial<OverlayData>): OverlayData {
  return {
    building: 0,
    w: 0,
    h: 0,
    density: new Uint16Array(0),
    nodeCell: new Int32Array(0),
    nodeQueue: new Uint16Array(0),
    nodeWaitS: new Uint16Array(0),
    gateCell: new Int32Array(0),
    gateDistM: new Uint16Array(0),
    ...p,
  };
}

describe('buildRamp', () => {
  it('has sixteen steps', () => {
    expect(buildRamp(OK, WARN, BAD, 0.6)).toHaveLength(16);
    expect(RAMP_STEPS).toBe(16);
  });

  it('starts at the ok colour and ends at the bad colour', () => {
    const ramp = buildRamp(OK, WARN, BAD, 1);
    expect(ramp[0]).toBe('rgba(127, 224, 160, 1)');
    expect(ramp[ramp.length - 1]).toBe('rgba(255, 154, 146, 1)');
  });

  it('rejects a colour that is not six digit hex', () => {
    expect(() => buildRamp('green', WARN, BAD, 1)).toThrow();
  });
});

describe('withAlpha', () => {
  it('turns a hex colour into an rgba string', () => {
    expect(withAlpha('#ff9a92', 0.5)).toBe('rgba(255, 154, 146, 0.5)');
  });
});

describe('rampIndex', () => {
  it('is 0 at zero', () => {
    expect(rampIndex(0, 100)).toBe(0);
  });

  it('is 8 at the middle', () => {
    expect(rampIndex(50, 100)).toBe(8);
  });

  it('is 15 at the maximum', () => {
    expect(rampIndex(100, 100)).toBe(15);
  });

  it('clamps above the maximum to 15', () => {
    expect(rampIndex(500, 100)).toBe(15);
  });

  it('is 0 when the maximum is 0', () => {
    expect(rampIndex(5, 0)).toBe(0);
  });
});

describe('overlayMax', () => {
  it('is the highest density for density', () => {
    const a = overlay({ density: Uint16Array.from([0, 3, 7]) });
    const b = overlay({ density: Uint16Array.from([12, 2]) });
    expect(overlayMax('density', [a, b])).toBe(12);
  });

  it('is the longest service wait for queue', () => {
    const a = overlay({ nodeWaitS: Uint16Array.from([30, 90]) });
    expect(overlayMax('queue', [a])).toBe(90);
  });

  it('is the longest reachable gate distance for walk, leaving out unreachable gates', () => {
    const a = overlay({ gateDistM: Uint16Array.from([40, OVERLAY_MAX, 220]) });
    expect(overlayMax('walk', [a])).toBe(220);
  });

  it('never returns a value above the unreachable marker as a distance', () => {
    const a = overlay({ gateDistM: Uint16Array.from([OVERLAY_MAX, OVERLAY_MAX]) });
    expect(overlayMax('walk', [a])).toBe(1);
  });

  it('is 1 for empty data', () => {
    expect(overlayMax('density', [])).toBe(1);
    expect(overlayMax('queue', [])).toBe(1);
    expect(overlayMax('walk', [])).toBe(1);
  });

  it('is 1 for none', () => {
    expect(overlayMax('none', [overlay({ density: Uint16Array.from([9]) })])).toBe(1);
  });
});
