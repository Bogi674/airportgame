import { describe, expect, it } from 'vitest';
import { ensurePacks, kitAsset } from '../src/render/sprites/fixtureKit';

describe('fixture kit loader', () => {
  it('serves an asset only after its category pack is loaded', async () => {
    expect(kitAsset('checkIn.l1')).toBeUndefined();
    await ensurePacks(['processing']);
    const asset = kitAsset('checkIn.l1');
    expect(asset?.size).toEqual([2, 2]);
    expect(asset?.ops.length).toBeGreaterThan(0);
  });

  it('keeps categories that are not loaded out of the kit', async () => {
    await ensurePacks(['processing']);
    expect(kitAsset('securityExit.staffed')).toBeUndefined();
  });

  it('does not reload a pack that is already loaded', async () => {
    await ensurePacks(['processing']);
    const first = kitAsset('checkIn.l1');
    await ensurePacks(['processing']);
    expect(kitAsset('checkIn.l1')).toBe(first);
  });
});
