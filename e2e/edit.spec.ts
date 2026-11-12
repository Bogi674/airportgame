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

// The context bar grows upward with its content and with the font, so a taller window keeps the test points clear of it.
test.use({ viewport: { width: 1280, height: 900 } });

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

async function totalApronArea(page: Page): Promise<number> {
  return page.evaluate(() => {
    const aprons = (window.__store?.getState().airfield.aprons ?? []) as { polygon: { x: number; y: number }[]; holes?: { x: number; y: number }[][] }[];
    const ring = (r: { x: number; y: number }[]): number => {
      let a = 0;
      for (let i = 0; i < r.length; i++) {
        const q = r[(i + 1) % r.length];
        a += r[i].x * q.y - q.x * r[i].y;
      }
      return Math.abs(a / 2);
    };
    return aprons.reduce((sum, a) => sum + ring(a.polygon) - (a.holes ?? []).reduce((h, r) => h + ring(r), 0), 0);
  });
}

test('extends an apron with the extend tool and cuts a strip out of it with the remove tool', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  const box = await page.getByTestId('map').boundingBox();
  if (!box) throw new Error('no map');
  const send = (cmd: unknown) => page.evaluate((c) => window.__send?.(c), cmd);
  await page.evaluate(() => {
    const site = window.__store?.getState().site;
    if (!site) return;
    const ids = new Set<number>();
    for (let y = 4880; y <= 5640; y += 10) for (let x = 2880; x <= 5720; x += 10) ids.add(site.parcelId[Math.floor(y / 10) * 800 + Math.floor(x / 10)]);
    window.__send?.({ type: 'buyParcels', ids: [...ids].filter((id) => site.parcelType[id] !== 6) });
  });
  await page.waitForTimeout(800);
  await send({ type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2600, code: 'C', approach: 'precision', surface: 'asphalt', tier: 1 });
  await send({ type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 190, code: 'C', connectors: 4, surface: 'asphalt', tier: 1 });
  await send({ type: 'buildApron', polygon: [{ x: 3800, y: 5260 }, { x: 4300, y: 5260 }, { x: 4300, y: 5400 }, { x: 3800, y: 5400 }], surface: 'concrete', tier: 1 });
  await expect.poll(() => page.evaluate(() => window.__store?.getState().airfield.aprons.length ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__store?.getState().airfield.taxiways.length ?? 0)).toBeGreaterThan(0);
  await page.evaluate(() => {
    const c = window.__renderer?.camera;
    if (c) {
      c.x = 3900;
      c.y = 5300;
      c.zoom = 0.5;
      c.rotation = 0;
    }
  });
  const dragRect = async (from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
    const a = await screenOf(page, from.x, from.y);
    const b = await screenOf(page, to.x, to.y);
    await page.mouse.move(box.x + a.x, box.y + a.y);
    await page.mouse.down();
    await page.mouse.move(box.x + b.x, box.y + b.y, { steps: 4 });
    await page.mouse.up();
  };

  // Extend: select the apron, then draw a rectangle that touches its west edge.
  const before = await totalApronArea(page);
  await page.getByTestId('tool-apron-extend').click();
  const inside = await screenOf(page, 4050, 5330);
  await page.mouse.click(box.x + inside.x, box.y + inside.y);
  await page.getByTestId('apron-mode-rect').click();
  await dragRect({ x: 3500, y: 5260 }, { x: 3800, y: 5400 });
  await expect.poll(() => totalApronArea(page)).toBeGreaterThan(before);

  // Remove: cut a strip across the apron with the rectangle mode of the remove tool.
  const extended = await totalApronArea(page);
  await page.getByTestId('tool-apron-remove').click();
  await page.getByTestId('apron-mode-rect').click();
  await dragRect({ x: 3950, y: 5240 }, { x: 4010, y: 5420 });
  await expect.poll(() => totalApronArea(page)).toBeLessThan(extended);
  expect(errors).toEqual([]);
});
