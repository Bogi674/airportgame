import { expect, test } from '@playwright/test';
import { startNewGame, watchErrors } from './helpers';

test('boots to the menu, starts a game, ticks, pauses and renders the map', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  await expect(page.getByTestId('map')).toBeVisible();

  // The sim worker is ticking and the clock moves.
  await expect.poll(() => page.evaluate(() => window.__store?.getState().tick ?? 0)).toBeGreaterThan(100);
  await expect(page.getByTestId('clock')).toContainText('06:');

  // Terrain bakes and paints non background pixels.
  await expect.poll(() => page.evaluate(() => window.__renderer?.chunkCount ?? 0)).toBeGreaterThan(0);
  await page.waitForTimeout(1200);
  const painted = await page.getByTestId('map').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    if (d) for (let i = 0; i < d.length; i += 4 * 97) if (d[i] !== 0x10 || d[i + 1] !== 0x16) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(100);

  // Camera input.
  const canvas = page.getByTestId('map');
  await canvas.hover({ position: { x: 640, y: 360 } });
  await page.mouse.wheel(0, -400);
  await page.mouse.down();
  await page.mouse.move(700, 400);
  await page.mouse.up();

  // Pausing stops the clock.
  await page.getByTestId('speed-0').click();
  await page.waitForTimeout(1500);
  const a = await page.evaluate(() => window.__store?.getState().tick);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__store?.getState().tick)).toBe(a);

  expect(errors).toEqual([]);
});
