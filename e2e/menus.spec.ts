import { expect, test } from '@playwright/test';
import { startNewGame, watchErrors } from './helpers';

test('category menus, fleet purchase, stand management and land mode', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  // Ground handling opens on the depot and road tools, then lists vehicles to buy. Vehicles live in a depot (T60),
  // so buying one before any depot is built is refused with a notice and costs nothing.
  await page.getByTestId('tool-handling').click();
  await expect(page.getByTestId('build-menu')).toBeVisible();
  await page.getByTestId('card-depot').click();
  await expect(page.getByTestId('card-depot')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('card-road').click();
  await expect(page.getByTestId('card-road')).toHaveAttribute('aria-pressed', 'true');
  const cash = await page.evaluate(() => window.__store?.getState().cash ?? 0);
  await page.getByTestId('menutab-baggage').click();
  await page.getByTestId('buy-tractor').click();
  await expect(page.getByTestId('toasts')).toContainText('Build one first');
  expect(await page.evaluate(() => window.__store?.getState().cash ?? 0)).toBe(cash);
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
