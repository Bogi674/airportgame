import { expect, test } from '@playwright/test';
import { startNewGame, watchErrors } from './helpers';

test('category menus, fleet purchase, stand management and land mode', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  // Ground handling lists vehicles to buy.
  await page.getByTestId('tool-handling').click();
  await expect(page.getByTestId('build-menu')).toBeVisible();
  const cash = await page.evaluate(() => window.__store?.getState().cash ?? 0);
  await page.getByTestId('buy-tractor').click();
  await expect.poll(() => page.evaluate(() => window.__store?.getState().cash ?? 0)).toBeLessThan(cash);
  // Every category opens its menu with tabs.
  for (const id of ['runway', 'taxiway', 'apron', 'stands', 'terminal', 'flightops', 'infra', 'staff', 'zoning']) {
    await page.getByTestId(`tool-${id}`).click();
    await expect(page.getByTestId('build-menu')).toBeVisible();
  }
  // Stand management opens from the stand category.
  await page.getByTestId('tool-stands').click();
  await page.getByTestId('menutab-manage').click();
  await page.getByTestId('card-standManagement').click();
  await expect(page.getByTestId('sheet-stands')).toBeVisible();
  await expect(page.getByTestId('auto-stands')).toBeChecked();
  await page.getByTestId('sheet-close').click();
  // Land mode is separate from building.
  await page.getByTestId('parcel-toggle').click();
  await expect(page.getByTestId('land-banner')).toBeVisible();
  await expect(page.getByTestId('tool-rail')).toHaveCount(0);
  await page.getByTestId('land-exit').click();
  await expect(page.getByTestId('tool-rail')).toBeVisible();
  expect(errors).toEqual([]);
});
