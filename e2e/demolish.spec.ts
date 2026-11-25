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

/** A runway with a parallel taxiway, an apron and one remote stand east of the start area. */
async function airport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const site = window.__store!.getState().site!;
    const ids = new Set<number>();
    for (let y = 4880; y <= 5640; y += 10) for (let x = 2880; x <= 5720; x += 10) ids.add(site.parcelId[Math.floor(y / 10) * 800 + Math.floor(x / 10)]);
    const send = window.__send!;
    send({ type: 'buyParcels', ids: [...ids].filter((id) => site.parcelType[id] !== 6) });
    send({ type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2600, code: 'C', approach: 'precision', surface: 'asphalt', tier: 1 });
    send({ type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 190, code: 'C', connectors: 4, surface: 'asphalt', tier: 1 });
    send({ type: 'buildApron', polygon: [{ x: 3800, y: 5205 }, { x: 4400, y: 5205 }, { x: 4400, y: 5420 }, { x: 3800, y: 5420 }], surface: 'concrete', tier: 1 });
    send({ type: 'buildStands', x: 4100, y: 5330, headingDeg: 180, count: 1, spacingM: 45, standType: 'remote', size: 'medium' });
    const c = window.__renderer!.camera;
    c.x = 4100;
    c.y = 5200;
    c.zoom = 0.8;
  });
  await expect.poll(() => page.evaluate(() => window.__store!.getState().airfield.stands.length)).toBe(1);
}

async function drag(page: Page, a: [number, number], b: [number, number]): Promise<void> {
  const box = await page.getByTestId('map').boundingBox();
  if (!box) throw new Error('no map');
  const p = await screenOf(page, a[0], a[1]);
  const q = await screenOf(page, b[0], b[1]);
  await page.mouse.move(box.x + p.x, box.y + p.y);
  await page.mouse.down();
  await page.mouse.move(box.x + (p.x + q.x) / 2, box.y + (p.y + q.y) / 2, { steps: 4 });
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 4 });
  await page.mouse.up();
}

test('line demolish cuts the stroked taxiway after a confirm and alerts the stand that lost its access', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  await airport(page);
  const taxiLength = (): Promise<number> =>
    page.evaluate(() => window.__store!.getState().airfield.taxiways.reduce((sum, t) => sum + t.points.slice(1).reduce((l, p, i) => l + Math.hypot(p.x - t.points[i].x, p.y - t.points[i].y), 0), 0));
  const before = await taxiLength();
  const cash = await page.evaluate(() => window.__store!.getState().cash);

  await page.getByTestId('tool-taxiway').click();
  await page.getByTestId('card-demolish').click();

  // Cancel sends nothing.
  await drag(page, [3900, 5190], [4300, 5190]);
  await expect(page.getByTestId('demolish-confirm')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('demolish-confirm')).toHaveCount(0);
  expect(await taxiLength()).toBeCloseTo(before, 0);

  // Confirm cuts the stretch, pays the refund shown and raises the lost access alert.
  await drag(page, [3900, 5190], [4300, 5190]);
  const refund = Number((await page.getByTestId('demolish-refund').textContent())?.replace(/[^0-9]/g, ''));
  expect(refund).toBeGreaterThan(0);
  await page.getByTestId('demolish-yes').click();
  await expect.poll(taxiLength).toBeLessThan(before - 300);
  await expect.poll(() => page.evaluate(() => window.__store!.getState().cash)).toBe(cash + refund);
  await expect.poll(() => page.evaluate(() => window.__store!.getState().alertLog.map((a) => a.text).join('|'))).toContain('stopped working');
  expect(errors).toEqual([]);
});

test('a runway stroke in the middle is refused, area bulldoze sweeps a box after a confirm', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  await airport(page);

  await page.getByTestId('tool-runway').click();
  await page.getByTestId('card-demolish').click();
  await drag(page, [4000, 5000], [4300, 5000]);
  await expect(page.getByTestId('demolish-confirm')).toHaveCount(0);
  await expect(page.getByTestId('problem')).toContainText('trimmed from an end');

  await page.getByTestId('tool-demolish').click();
  await page.getByTestId('card-area').click();
  await drag(page, [4000, 5260], [4200, 5410]);
  await expect(page.getByTestId('area-bulldoze')).toBeVisible();
  await expect(page.getByTestId('area-go')).toContainText('1');
  await page.getByTestId('area-go').click();
  await expect(page.getByTestId('demolish-confirm')).toBeVisible();
  await page.getByTestId('demolish-yes').click();
  await expect.poll(() => page.evaluate(() => window.__store!.getState().airfield.stands.length)).toBe(0);
  await expect(page.getByTestId('area-bulldoze')).toHaveCount(0);
  expect(errors).toEqual([]);
});
