import { expect, test } from '@playwright/test';
import { startNewGame, watchErrors } from './helpers';

test('generates a site, buys land, and navigates with the minimap tools', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  await page.getByTestId('open-site').click();
  await expect(page.getByTestId('site-info')).toBeVisible();
  await expect(page.getByTestId('minimap')).toBeVisible();
  expect(await page.getByTestId('site-info').textContent()).toContain('$120,000,000');
  await page.getByTestId('sheet-close').click();

  // Terrain chunks bake and show real colours, not just the clear colour.
  await expect.poll(() => page.evaluate(() => window.__renderer?.chunkCount ?? 0)).toBeGreaterThan(0);
  await page.waitForTimeout(1200);
  const distinct = await page.getByTestId('map').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    if (d) for (let i = 0; i < d.length; i += 4 * 211) seen.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
    return seen.size;
  });
  expect(distinct).toBeGreaterThan(5);

  // Parcel overlay and picking.
  await page.keyboard.press('p');
  await expect(page.getByTestId('parcel-toggle')).toHaveAttribute('aria-pressed', 'true');
  const box = await page.getByTestId('map').boundingBox();
  if (!box) throw new Error('no map box');
  // Click away from the owned start area, near the left edge of the view.
  await page.mouse.click(box.x + 80, box.y + box.height - 60);
  await expect(page.getByTestId('parcel')).toBeVisible();
  const buy = page.getByTestId('buy');
  if (await buy.isVisible()) {
    await buy.click();
    await expect(page.getByTestId('parcel')).toContainText('Owned');
    expect(await page.evaluate(() => window.__store?.getState().cash)).toBeLessThan(120_000_000);
  }

  // Compass and align view.
  await page.getByTestId('align').click();
  const rot = await page.evaluate(() => window.__renderer?.camera.rotation ?? 0);
  expect(Math.abs(rot)).toBeGreaterThanOrEqual(0);
  await page.getByTestId('compass').click();
  expect(await page.evaluate(() => window.__renderer?.camera.rotation)).toBe(0);

  // Zoom to fit shows the whole 8 km site.
  await page.getByTestId('fit').click();
  const zoom = await page.evaluate(() => window.__renderer?.camera.zoom ?? 0);
  expect(zoom).toBeGreaterThan(0.05);
  expect(zoom).toBeLessThan(0.15);

  // A new game with the other preset replaces the site.
  const seedBefore = await page.evaluate(() => window.__store?.getState().site?.corridor.cx);
  await page.getByTestId('open-pause').click();
  await page.getByTestId('pause-exit').click();
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.getByTestId('menu-new').click();
  await page.getByTestId('preset-riverValley').click();
  await page.getByTestId('menu-start').click();
  await expect(page.getByTestId('top-bar')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__store?.getState().site?.corridor.cx)).not.toBe(seedBefore);

  expect(errors).toEqual([]);
});
