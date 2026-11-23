import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers';

test('sandbox from the wizard, save as twice, cards rename, duplicate and load, settings', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect(page.getByTestId('menu-version')).toContainText('Version');

  // Two steps in one panel: the site with its preview, then the airport identity.
  await page.getByTestId('menu-sandbox').click();
  await expect(page.getByTestId('wizard')).toContainText('New sandbox');
  await page.getByTestId('seed').fill('TIDE-4471');
  await expect(page.getByTestId('site-preview')).toBeVisible();
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('airport-name')).toHaveValue('Tide International');
  await page.getByTestId('airport-name').fill('Harbor Field');
  await expect(page.getByTestId('airport-iata')).toHaveValue('HFA');
  await page.getByTestId('brand-c8102e').click();
  await page.getByTestId('menu-start').click();
  await expect(page.getByTestId('top-bar')).toBeVisible();
  await expect(page.getByTestId('airport')).toContainText('Harbor Field');
  await expect(page.getByTestId('cash')).toContainText('Unlimited');
  await expect.poll(() => page.evaluate(() => window.__store?.getState().game.mode)).toBe('sandbox');

  // Save as twice under two names.
  for (const name of ['First plan', 'Second plan']) {
    await page.getByTestId('open-pause').click();
    await page.getByTestId('pause-save-as').click();
    await page.getByTestId('save-as-name').fill(name);
    await page.getByTestId('save-as-confirm').click();
    await expect(page.getByTestId('pause-menu')).toContainText('Game saved');
    await page.getByTestId('pause-resume').click();
  }

  // Settings open from the pause menu and apply at once.
  await page.getByTestId('open-pause').click();
  await page.getByTestId('pause-settings').click();
  await page.getByTestId('opt-theme-light').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await page.getByTestId('opt-theme-dark').click();
  await page.getByTestId('settings-back').click();

  // Load goes to the cards: both saves are there with thumbnails.
  await page.getByTestId('pause-load').click();
  await expect(page.getByTestId('load-screen')).toBeVisible();
  const cards = page.getByTestId('save-card');
  await expect(cards).toHaveCount(2);
  await expect(page.getByTestId('load-screen')).toContainText('First plan');
  await expect(page.getByTestId('load-screen')).toContainText('Second plan');
  await expect(cards.first().locator('img')).toBeVisible();

  // Rename one, duplicate it, then load the copy.
  const second = cards.filter({ hasText: 'Second plan' });
  await second.getByTestId('save-rename').click();
  await page.getByTestId('rename-input').fill('Final plan');
  await page.getByTestId('rename-input').press('Enter');
  await expect(page.getByTestId('load-screen')).toContainText('Final plan');
  await cards.filter({ hasText: 'Final plan' }).first().getByTestId('save-duplicate').click();
  await expect(cards).toHaveCount(3);
  await cards.filter({ hasText: 'Final plan copy' }).getByTestId('save-load').click();
  await expect(page.getByTestId('top-bar')).toBeVisible();
  await expect(page.getByTestId('airport')).toContainText('Harbor Field');
  await expect.poll(() => page.evaluate(() => window.__store?.getState().game.mode)).toBe('sandbox');
  expect(errors).toEqual([]);
});

test('credits and settings from the main menu', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByTestId('menu-credits').click();
  await expect(page.getByTestId('credits')).toBeVisible();
  await page.getByTestId('credits').getByRole('button').click();
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('opt-motion').check();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('airfield.reducedMotion'))).toBe('1');
  await page.getByTestId('settings-back').click();
  await expect(page.getByTestId('menu-new')).toBeVisible();
  expect(errors).toEqual([]);
});
