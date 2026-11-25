import { expect, test } from '@playwright/test';
import { startNewGame, watchErrors } from './helpers';

test('build flyouts open beside the rail, clear of the guide and the context bar', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  const rail = await page.getByTestId('tool-rail').boundingBox();
  for (const id of ['runway', 'taxiway', 'apron', 'stands', 'terminal', 'stations', 'furnish', 'commercial', 'flightops', 'infra', 'staff', 'zoning']) {
    await page.getByTestId(`tool-${id}`).click();
    const menu = page.getByTestId('build-menu');
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box && rail && box.x >= rail.x + rail.width).toBe(true);
    await expect(page.getByTestId('guide')).toHaveCount(0);
    const bar = await page.getByTestId('context-bar').boundingBox().catch(() => null);
    if (bar && box) expect(box.y + box.height <= bar.y || bar.x >= box.x + box.width).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('the alert center groups alerts, merges repeats and jumps to a stand', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  await page.evaluate(() => {
    const send = window.__send!;
    send({ type: 'buyParcels', ids: [] });
    send({ type: 'testEvent', id: 'rain' });
  });
  await expect(page.getByTestId('alert-unread')).toBeVisible();
  await page.getByTestId('alert-bell').click();
  await expect(page.getByTestId('alert-center')).toBeVisible();
  await expect(page.getByTestId('alert-group-warning')).toContainText('Heavy rain');
  await expect(page.getByTestId('alert-unread')).toHaveCount(0);

  // A stand alert: the same text twice merges into one row with a count, and Show moves the camera to the stand.
  await page.evaluate(() => {
    const site = window.__store!.getState().site!;
    const ids = new Set<number>();
    for (let y = 4880; y <= 5640; y += 10) for (let x = 2880; x <= 5720; x += 10) ids.add(site.parcelId[Math.floor(y / 10) * 800 + Math.floor(x / 10)]);
    const send = window.__send!;
    send({ type: 'buyParcels', ids: [...ids].filter((id) => site.parcelType[id] !== 6) });
    send({ type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2600, code: 'C', approach: 'precision', surface: 'asphalt', tier: 1 });
    send({ type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 190, code: 'C', connectors: 4, surface: 'asphalt', tier: 1 });
    send({ type: 'buildApron', polygon: [{ x: 3800, y: 5205 }, { x: 4400, y: 5205 }, { x: 4400, y: 5420 }, { x: 3800, y: 5420 }], surface: 'concrete', tier: 1 });
    send({ type: 'buildStands', x: 4350, y: 5330, headingDeg: 180, count: 1, spacingM: 45, standType: 'remote', size: 'medium' });
  });
  await expect.poll(() => page.evaluate(() => window.__store!.getState().airfield.stands.length)).toBe(1);
  await page.evaluate(() => {
    const s = window.__store!.getState() as unknown as { airfield: { stands: { number: string }[] }; logAlert(t: string, s: string, tick: number, stand: string): void };
    const n = s.airfield.stands[0]!.number;
    s.logAlert('Stand without a service road', 'warning', 0, n);
    s.logAlert('Stand without a service road', 'warning', 10, n);
  });
  const row = page.getByTestId('alert-row').filter({ hasText: 'service road' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('2 times');
  await page.evaluate(() => {
    const c = window.__renderer!.camera;
    c.x = 1000;
    c.y = 1000;
  });
  await row.getByTestId('alert-jump').click();
  const cam = await page.evaluate(() => ({ x: window.__renderer!.camera.x, y: window.__renderer!.camera.y }));
  expect(Math.abs(cam.x - 4350)).toBeLessThan(60);
  expect(Math.abs(cam.y - 5330)).toBeLessThan(60);
  expect(errors).toEqual([]);
});

test('the overlay list holds the terminal overlays and the map layers', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  await page.keyboard.press('o');
  for (const id of ['overlay-none', 'overlay-density', 'overlay-queue', 'overlay-staffing', 'overlay-baggage', 'overlay-walk', 'overlay-zones', 'debug-toggle', 'walk-toggle', 'overlay-parcels']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await page.getByTestId('debug-toggle').click();
  await expect(page.getByTestId('debug-toggle')).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});
