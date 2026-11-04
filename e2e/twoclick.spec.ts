import { expect, test } from '@playwright/test';
import { startNewGame, watchErrors } from './helpers';

test('a runway is placed with a start click and an end click, and the map scrolls at the edge', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  const box = await page.getByTestId('map').boundingBox();
  if (!box) throw new Error('no map');
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
  // Start click: no button is held afterwards and the preview follows the pointer.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 - 150, { steps: 3 });
  await expect(page.getByTestId('problem')).toBeVisible();
  // Moving to the right edge scrolls the map while the start is armed.
  const x0 = await page.evaluate(() => window.__renderer?.camera.x ?? 0);
  await page.mouse.move(box.x + box.width - 6, box.y + box.height / 2, { steps: 4 });
  await page.waitForTimeout(700);
  const x1 = await page.evaluate(() => window.__renderer?.camera.x ?? 0);
  expect(x1).toBeGreaterThan(x0 + 50);
  // A right click asks to build or cancel. Escape cancels and keeps the tool.
  await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2, { button: 'right' });
  await expect(page.getByTestId('confirm-popup')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('confirm-popup')).toHaveCount(0);
  await expect(page.getByTestId('problem')).toHaveCount(0);
  // The cancel button does the same.
  await page.mouse.click(box.x + 600, box.y + 400);
  await page.mouse.move(box.x + 700, box.y + 350, { steps: 3 });
  await page.mouse.click(box.x + 700, box.y + 350, { button: 'right' });
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('confirm-popup')).toHaveCount(0);
  expect(errors).toEqual([]);
});
