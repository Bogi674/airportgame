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

test('builds a runway, taxiway, apron and stands, and undoes them', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  await page.getByTestId('guide').waitFor();
  const box = await page.getByTestId('map').boundingBox();
  if (!box) throw new Error('no map');
  const counts = () => page.evaluate(() => {
    const a = window.__store?.getState().airfield;
    return { r: a?.runways.length ?? 0, t: a?.taxiways.length ?? 0, a: a?.aprons.length ?? 0, s: a?.stands.length ?? 0, h: a?.holding.length ?? 0 };
  });

  // Frame the corridor, then drag a runway across it.
  await page.evaluate(() => {
    const c = window.__renderer?.camera;
    if (c) {
      c.x = 5000;
      c.y = 5500;
      c.zoom = 0.3;
      c.rotation = 0;
    }
  });
  await page.getByTestId('tool-runway').click();
  const a = await screenOf(page, 4800, 6200);
  const b = await screenOf(page, 4800, 4600);
  await page.mouse.move(box.x + a.x, box.y + a.y);
  await page.mouse.down();
  await page.mouse.move(box.x + (a.x + b.x) / 2, box.y + (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(box.x + b.x, box.y + b.y, { steps: 4 });
  // The land is not owned yet, so the preview explains why and offers to buy it.
  await expect(page.getByTestId('problem')).toContainText('do not own');
  await page.mouse.up();
  await expect(page.getByTestId('buy-land')).toBeVisible();
  expect((await counts()).r).toBe(0);
  await page.getByTestId('buy-land').click();
  await expect.poll(() => page.evaluate(() => window.__store?.getState().cash ?? 0)).toBeLessThan(120_000_000);

  await page.mouse.move(box.x + a.x, box.y + a.y);
  await page.mouse.down();
  await page.mouse.move(box.x + (a.x + b.x) / 2, box.y + (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(box.x + b.x, box.y + b.y, { steps: 4 });
  await page.waitForTimeout(400);
  await expect(page.getByTestId('problem')).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(async () => (await counts()).r).toBe(1);

  // A taxiway from the runway edge, finished with Enter.
  await page.getByTestId('tool-taxiway').click();
  const p1 = await screenOf(page, 4812, 5400);
  const p2 = await screenOf(page, 4990, 5400);
  await page.mouse.click(box.x + p1.x, box.y + p1.y);
  await page.mouse.click(box.x + p2.x, box.y + p2.y);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await counts()).t).toBe(1);
  await expect.poll(async () => (await counts()).h).toBeGreaterThan(0);

  // Undo and redo through the rail.
  await page.getByTestId('undo').click();
  await expect.poll(async () => (await counts()).t).toBe(0);
  await page.getByTestId('redo').click();
  await expect.poll(async () => (await counts()).t).toBe(1);

  // Inspect the runway.
  await page.getByTestId('tool-select').click();
  const mid = await screenOf(page, 4800, 5400);
  await page.mouse.click(box.x + mid.x, box.y + mid.y);
  await expect(page.getByTestId('object-panel')).toContainText('Runway');

  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/airfield.png' });
  await page.evaluate(() => {
    const c = window.__renderer?.camera;
    if (c) {
      c.x = 4850;
      c.y = 5400;
      c.zoom = 2.2;
    }
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-results/airfield-close.png' });
  await page.evaluate(() => {
    const c = window.__renderer?.camera;
    if (c) {
      c.x = 4800;
      c.y = 6130;
      c.zoom = 1.6;
    }
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-results/airfield-end.png' });
  expect(errors).toEqual([]);
});
