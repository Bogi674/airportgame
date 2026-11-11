import { expect, test, type Page } from '@playwright/test';
import { startNewGame, watchErrors } from './helpers';

/** Buys the land, then lays a 20 by 12 cell terminal on public and secure zones. Heading 90 maps cell (cx, cy) to world (3880 + 2 cx, 5360 + 2 cy). */
async function layTerminal(page: Page): Promise<void> {
  await page.evaluate(() => {
    const site = window.__store?.getState().site as unknown as { parcelId: Uint16Array; parcelType: Uint8Array };
    const ids = new Set<number>();
    for (let y = 5300; y <= 5600; y += 10) for (let x = 3800; x <= 4300; x += 10) ids.add(site.parcelId[Math.floor(y / 10) * 800 + Math.floor(x / 10)]);
    window.__send?.({ type: 'buyParcels', ids: [...ids].filter((id) => site.parcelType[id] !== 6) });
  });
  const send = (cmd: unknown) => page.evaluate((c) => window.__send?.(c), cmd);
  const edit = (building: number, e: object) => send({ type: 'terminalBuild', building, ox: 3880, oy: 5360, headingDeg: 90, edit: e });
  await edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 60, y1: 52, variant: 0 });
  await expect.poll(() => page.evaluate(() => window.__store?.getState().business?.terminals.length ?? 0)).toBe(1);
  await edit(1, { op: 'floor', x0: 40, y0: 40, x1: 60, y1: 52, variant: 2 });
  await edit(1, { op: 'zone', x0: 40, y0: 40, x1: 60, y1: 52, variant: 1 });
  await edit(1, { op: 'zone', x0: 50, y0: 40, x1: 60, y1: 52, variant: 3 });
}

async function focusCamera(page: Page): Promise<void> {
  await page.evaluate(() => {
    const c = window.__renderer?.camera;
    if (c) {
      c.x = 3980;
      c.y = 5452;
      c.zoom = 6;
      c.rotation = 0;
    }
  });
  await page.waitForTimeout(1200);
}

test('draws the kiosk, bag drops, passport booth and gate desk at true scale', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  await layTerminal(page);
  const send = (cmd: unknown) => page.evaluate((c) => window.__send?.(c), cmd);
  const edit = (e: object) => send({ type: 'terminalBuild', building: 1, ox: 3880, oy: 5360, headingDeg: 90, edit: e });
  // Public side: a kiosk, a bag drop across two cells, and a bag drop turned to run along the rows.
  await edit({ op: 'fixture', x0: 42, y0: 42, x1: 43, y1: 43, variant: 13, rot: 0 });
  await edit({ op: 'fixture', x0: 44, y0: 42, x1: 45, y1: 43, variant: 14, rot: 0 });
  await edit({ op: 'fixture', x0: 42, y0: 46, x1: 43, y1: 47, variant: 14, rot: 1 });
  // Secure side: a passport booth and a gate desk across two cells.
  await edit({ op: 'fixture', x0: 52, y0: 42, x1: 53, y1: 43, variant: 15, rot: 0 });
  await edit({ op: 'fixture', x0: 54, y0: 46, x1: 55, y1: 47, variant: 16, rot: 0 });

  const counts = () => page.evaluate(() => (window.__store?.getState().business?.terminals[0] as unknown as { counts: Record<string, number> } | undefined)?.counts);
  await expect.poll(async () => (await counts())?.kiosk ?? 0).toBe(1);
  await expect.poll(async () => (await counts())?.passport ?? 0).toBe(1);
  await expect.poll(async () => (await counts())?.gateDesk ?? 0).toBe(1);
  // Each two cell fixture counts once, so two bag drops are two.
  await expect.poll(async () => (await counts())?.bagDrop ?? 0).toBe(2);

  await focusCamera(page);
  await page.screenshot({ path: 'test-results/terminal-fixtures.png' });
  expect(errors).toEqual([]);
});

test('R turns the bag drop about to be placed, and the placed tail follows', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  await layTerminal(page);
  await focusCamera(page);
  const box = await page.getByTestId('map').boundingBox();
  if (!box) throw new Error('no map');
  // Cell (44, 46) centre in world, then its screen position.
  const target = await page.evaluate(() => {
    const out = { x: 0, y: 0 };
    window.__renderer?.camera.worldToScreen(3969, 5453, out);
    return out;
  });

  await page.getByTestId('tool-terminal').click();
  await page.getByTestId('menutab-processing').click();
  await page.getByTestId('card-bagDrop').click();
  await page.mouse.move(box.x + target.x, box.y + target.y);
  await page.keyboard.press('r');
  // Two clicks on the same cell: the first sets the start point, the second places the fixture.
  await page.mouse.click(box.x + target.x, box.y + target.y);
  await page.mouse.click(box.x + target.x, box.y + target.y);

  // The grid holds the anchor with rotation code 2 (rot 1) and its tail one row down with code 6.
  const placed = () =>
    page.evaluate(() => {
      const g = (window.__store?.getState() as unknown as { terminalGrids: { w: number; fixture: Uint8Array; fixtureRot: Uint8Array }[] } | undefined)?.terminalGrids[0];
      if (!g) return false;
      const i = g.fixture.findIndex((f, k) => f === 14 && g.fixtureRot[k] === 2);
      return i >= 0 && g.fixture[i + g.w] === 14 && g.fixtureRot[i + g.w] === 6 && g.fixtureRot[i + 1] === 0;
    });
  await expect.poll(placed).toBe(true);
  expect(errors).toEqual([]);
});
