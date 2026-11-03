import { expect, type Page } from '@playwright/test';

export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** Opens the game, starts a new game with the default seed and waits for the site. */
export async function startNewGame(page: Page, url = '/', preset?: 'flatCoastal' | 'riverValley'): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.getByTestId('menu-new').click();
  if (preset) await page.getByTestId(`preset-${preset}`).click();
  await page.getByTestId('menu-start').click();
  await expect(page.getByTestId('top-bar')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__store?.getState().site?.parcelCount ?? 0)).toBeGreaterThan(0);
  await page.waitForTimeout(500);
}

/** Builds a small airport through game commands, earns money, then saves, exits and continues. */
export async function playSmallAirport(page: Page): Promise<void> {
  // Buy the land under the layout, through the same command the buy button sends.
  const bought = await page.evaluate(() => {
    const site = window.__store?.getState().site as unknown as { parcelId: Uint16Array; parcelType: Uint8Array };
    const ids = new Set<number>();
    for (let y = 4880; y <= 5640; y += 10) for (let x = 2880; x <= 5720; x += 10) ids.add(site.parcelId[Math.floor(y / 10) * 800 + Math.floor(x / 10)]);
    const list = [...ids].filter((id) => site.parcelType[id] !== 6);
    window.__send?.({ type: 'buyParcels', ids: list });
    return list.length;
  });
  expect(bought).toBeGreaterThan(3);
  await expect.poll(() => page.evaluate(() => window.__store?.getState().cash ?? 0)).toBeLessThan(30_000_000);

  const send = (cmd: unknown) => page.evaluate((c) => window.__send?.(c), cmd);
  await send({ type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2600, code: 'C', approach: 'precision', surface: 'asphalt', tier: 1 });
  await send({ type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 190, code: 'C', connectors: 4, surface: 'asphalt', tier: 1 });
  await send({ type: 'buildApron', polygon: [{ x: 3800, y: 5260 }, { x: 4300, y: 5260 }, { x: 4300, y: 5400 }, { x: 3800, y: 5400 }], surface: 'concrete', tier: 1 });
  await send({ type: 'buildStands', x: 4250, y: 5330, headingDeg: 180, count: 6, spacingM: 45, standType: 'remotePushback', code: 'C' });
  await send({ type: 'buildTerminal', cx: 4050, cy: 5480, w: 120, d: 40, headingDeg: 90 });
  await expect.poll(() => page.evaluate(() => window.__store?.getState().business?.terminals.length ?? 0)).toBe(1);
  await send({ type: 'addModule', terminalId: 1, kind: 'checkIn', count: 8 });
  await send({ type: 'addModule', terminalId: 1, kind: 'security', count: 3 });
  await send({ type: 'addModule', terminalId: 1, kind: 'belt', count: 2 });
  await send({ type: 'signAirline', airlineId: 0, rotations: 2 });
  await send({ type: 'signAirline', airlineId: 1, rotations: 2 });
  await expect.poll(() => page.evaluate(() => window.__store?.getState().airfield.runways.length ?? 0)).toBe(1);
  await expect(page.getByTestId('guide')).toContainText('✓');

  // Run fast until the first landing fees arrive.
  await page.getByTestId('speed-8').click();
  const landing = (): Promise<number> => page.evaluate(() => window.__store?.getState().business?.today[2] ?? 0);
  await expect.poll(landing, { timeout: 90_000, intervals: [1000] }).toBeGreaterThan(0);

  // The finance sheet and the flights board show it.
  await page.getByTestId('open-finance').click();
  await expect(page.getByTestId('sheet-finance')).toContainText('Landing fees');
  await page.getByTestId('sheet-close').click();
  await page.getByTestId('open-flights').click();
  await expect(page.getByTestId('sheet-flights')).toBeVisible();
  await page.getByTestId('sheet-close').click();

  // Save through the pause menu, leave, and continue from the save.
  await page.getByTestId('open-pause').click();
  await page.getByTestId('pause-save').click();
  await expect(page.getByTestId('pause-menu')).toContainText('Game saved');
  const cashBefore = await page.evaluate(() => window.__store?.getState().cash ?? 0);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pause-export').click()]);
  expect(download.suggestedFilename()).toMatch(/\.airfield$/);
  await page.getByTestId('pause-exit').click();
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.getByTestId('menu-continue').click();
  await expect(page.getByTestId('top-bar')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__store?.getState().airfield.runways.length ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__store?.getState().business?.terminals.length ?? 0)).toBe(1);
  const cashAfter = await page.evaluate(() => window.__store?.getState().cash ?? 0);
  expect(Math.abs(cashAfter - cashBefore)).toBeLessThan(200_000);

}
