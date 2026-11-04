import { expect, test, type Page } from '@playwright/test';
import { startNewGame, watchErrors } from './helpers';

async function screenOf(page: Page, wx: number, wy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([x, y]) => {
      const out = { x: 0, y: 0 };
      window.__renderer?.camera.worldToScreen(x, y, out);
      return out;
    },
    [wx, wy],
  );
}

test('extends a runway with the runway tool and changes its class from the inspector', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  const box = await page.getByTestId('map').boundingBox();
  if (!box) throw new Error('no map');
  await page.evaluate(() => {
    const site = window.__store?.getState().site;
    if (!site) return;
    const ids = new Set<number>();
    for (let y = 4880; y <= 5640; y += 10) for (let x = 2880; x <= 5720; x += 10) ids.add(site.parcelId[Math.floor(y / 10) * 800 + Math.floor(x / 10)]);
    window.__send?.({ type: 'buyParcels', ids: [...ids].filter((id) => site.parcelType[id] !== 6) });
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__send?.({ type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 1500, code: 'C', approach: 'precision', surface: 'asphalt', tier: 1 }));
  await expect.poll(() => page.evaluate(() => window.__store?.getState().airfield.runways.length ?? 0)).toBe(1);
  await page.evaluate(() => {
    const c = window.__renderer?.camera;
    if (c) {
      c.x = 4000;
      c.y = 5000;
      c.zoom = 0.5;
      c.rotation = 0;
    }
  });
  await page.getByTestId('tool-runway').click();
  await page.getByTestId('opt-runway-mode').selectOption('extend');
  const end = await screenOf(page, 4500, 5000);
  const beyond = await screenOf(page, 4800, 5000);
  await page.mouse.click(box.x + end.x, box.y + end.y);
  await page.mouse.move(box.x + beyond.x, box.y + beyond.y, { steps: 4 });
  await page.mouse.click(box.x + beyond.x, box.y + beyond.y);
  await expect.poll(() => page.evaluate(() => window.__store?.getState().airfield.runways[0]?.lengthM ?? 0)).toBeGreaterThan(1700);
  expect(await page.evaluate(() => window.__store?.getState().airfield.runways.length)).toBe(1);

  // Select it and upgrade the class.
  await page.keyboard.press('Escape');
  const mid = await screenOf(page, 3800, 5000);
  await page.mouse.click(box.x + mid.x, box.y + mid.y);
  await expect(page.getByTestId('runway-upgrade')).toBeVisible();
  await page.getByTestId('rw-class').selectOption('D');
  await page.getByTestId('rw-apply').click();
  await expect.poll(() => page.evaluate(() => window.__store?.getState().airfield.runways[0]?.code)).toBe('D');
  expect(errors).toEqual([]);
});
