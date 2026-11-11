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

test('lays a terminal with foundation, flooring, walls and fixtures using the mouse', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  await page.evaluate(() => {
    const site = window.__store?.getState().site as unknown as { parcelId: Uint16Array; parcelType: Uint8Array };
    const ids = new Set<number>();
    for (let y = 5300; y <= 5600; y += 10) for (let x = 3800; x <= 4300; x += 10) ids.add(site.parcelId[Math.floor(y / 10) * 800 + Math.floor(x / 10)]);
    window.__send?.({ type: 'buyParcels', ids: [...ids].filter((id) => site.parcelType[id] !== 6) });
    const c = window.__renderer?.camera;
    if (c) {
      c.x = 4040;
      c.y = 5460;
      c.zoom = 4;
      c.rotation = 0;
    }
  });
  await page.waitForTimeout(800);
  const box = await page.getByTestId('map').boundingBox();
  if (!box) throw new Error('no map');
  const drag = async (a: [number, number], b: [number, number]): Promise<void> => {
    const p = await screenOf(page, a[0], a[1]);
    const q = await screenOf(page, b[0], b[1]);
    await page.mouse.move(box.x + p.x, box.y + p.y);
    await page.mouse.down();
    await page.mouse.move(box.x + (p.x + q.x) / 2, box.y + (p.y + q.y) / 2, { steps: 3 });
    await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
    await page.mouse.up();
  };
  const summary = () => page.evaluate(() => window.__store?.getState().business?.terminals[0] as unknown as { cells: number; counts: Record<string, number> } | undefined);

  await page.getByTestId('tool-terminal').click();
  await page.getByTestId('tsub-foundation').click();
  await drag([4000, 5440], [4080, 5470]);
  await expect.poll(async () => (await summary())?.cells ?? 0).toBeGreaterThan(300);
  const cells = (await summary())?.cells ?? 0;

  // Flooring and a wall do not change the cell count but cost money.
  const cash0 = await page.evaluate(() => window.__store?.getState().cash ?? 0);
  await page.getByTestId('tsub-floor').click();
  await drag([4000, 5440], [4080, 5470]);
  await expect.poll(() => page.evaluate(() => window.__store?.getState().cash ?? 0)).toBeLessThan(cash0);
  await page.getByTestId('tsub-wall').click();
  await drag([4000, 5440], [4080, 5440]);

  // Check in desks along a row.
  await page.getByTestId('tsub-fixture').click();
  await page.getByTestId('opt-fixture').selectOption('1');
  await drag([4004, 5446], [4020, 5446]);
  await expect.poll(async () => (await summary())?.counts.checkIn ?? 0).toBeGreaterThan(3);
  expect((await summary())?.cells).toBe(cells);

  // Erasing a cell removes the desk there.
  const desks = (await summary())?.counts.checkIn ?? 0;
  await page.getByTestId('tsub-erase').click();
  await drag([4004, 5446], [4006, 5446]);
  await expect.poll(async () => (await summary())?.counts.checkIn ?? 0).toBeLessThan(desks);

  // A foundation on the apron side of the layout is refused with an explanation.
  await page.getByTestId('tsub-foundation').click();
  await page.mouse.move(box.x + 700, box.y + 200);
  expect(errors).toEqual([]);
});

test('the walk overlay toggle shows the walking graph of the selected terminal', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  await page.evaluate(() => {
    const site = window.__store?.getState().site as unknown as { parcelId: Uint16Array; parcelType: Uint8Array };
    const ids = new Set<number>();
    for (let y = 5300; y <= 5600; y += 10) for (let x = 3800; x <= 4300; x += 10) ids.add(site.parcelId[Math.floor(y / 10) * 800 + Math.floor(x / 10)]);
    window.__send?.({ type: 'buyParcels', ids: [...ids].filter((id) => site.parcelType[id] !== 6) });
    const c = window.__renderer?.camera;
    if (c) {
      c.x = 4040;
      c.y = 5460;
      c.zoom = 4;
      c.rotation = 0;
    }
  });
  await page.waitForTimeout(800);
  const box = await page.getByTestId('map').boundingBox();
  if (!box) throw new Error('no map');
  const at = async (wx: number, wy: number): Promise<{ x: number; y: number }> => {
    const s = await page.evaluate(
      ([x, y]) => {
        const out = { x: 0, y: 0 };
        window.__renderer?.camera.worldToScreen(x, y, out);
        return out;
      },
      [wx, wy],
    );
    return { x: box.x + s.x, y: box.y + s.y };
  };

  await page.getByTestId('tool-terminal').click();
  await page.getByTestId('tsub-foundation').click();
  const a = await at(4000, 5440);
  const b = await at(4080, 5470);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__store?.getState().business?.terminals.length ?? 0)).toBeGreaterThan(0);

  await page.getByTestId('tool-select').click();
  const inside = await at(4040, 5455);
  await page.mouse.click(inside.x, inside.y);
  await expect(page.getByTestId('terminal-panel')).toBeVisible();

  const toggle = page.getByTestId('walk-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});
