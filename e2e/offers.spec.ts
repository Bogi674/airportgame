import { expect, test, type Page } from '@playwright/test';
import { startNewGame, watchErrors } from './helpers';

/** Builds the airport the offers need: parcels, a runway, an apron of stands, a terminal with its control room, a tower and two signed airlines. */
async function buildOffersAirport(page: Page): Promise<void> {
  const send = (cmd: unknown) => page.evaluate((c) => window.__send?.(c), cmd);
  await page.evaluate(() => {
    const site = window.__store?.getState().site as unknown as { parcelId: Uint16Array; parcelType: Uint8Array };
    const ids = new Set<number>();
    for (let y = 4880; y <= 5640; y += 10) for (let x = 2880; x <= 5720; x += 10) ids.add(site.parcelId[Math.floor(y / 10) * 800 + Math.floor(x / 10)]);
    window.__send?.({ type: 'buyParcels', ids: [...ids].filter((id) => site.parcelType[id] !== 6) });
  });
  await expect.poll(() => page.evaluate(() => window.__store?.getState().cash ?? 0)).toBeLessThan(120_000_000);
  await send({ type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2600, code: 'C', approach: 'precision', surface: 'asphalt', tier: 1 });
  await send({ type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 190, code: 'C', connectors: 4, surface: 'asphalt', tier: 1 });
  await send({ type: 'buildApron', polygon: [{ x: 3800, y: 5260 }, { x: 4300, y: 5260 }, { x: 4300, y: 5400 }, { x: 3800, y: 5400 }], surface: 'concrete', tier: 1 });
  // Extra large stands take every offered type, so a drop onto the first stand is accepted whichever airline's flight is picked.
  await send({ type: 'buildStands', x: 4250, y: 5330, headingDeg: 180, count: 4, spacingM: 95, standType: 'remote', size: 'xl' });
  const edit = (building: number, e: object) => send({ type: 'terminalBuild', building, ox: 3880, oy: 5360, headingDeg: 90, edit: e });
  await edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 100, y1: 52, variant: 0 });
  await expect.poll(() => page.evaluate(() => window.__store?.getState().business?.terminals.length ?? 0)).toBe(1);
  await edit(1, { op: 'floor', x0: 40, y0: 40, x1: 100, y1: 52, variant: 2 });
  await edit(1, { op: 'wall', x0: 40, y0: 40, x1: 100, y1: 40, variant: 1 });
  await edit(1, { op: 'wall', x0: 70, y0: 40, x1: 72, y1: 40, variant: 3 });
  await edit(1, { op: 'fixture', x0: 42, y0: 42, x1: 50, y1: 43, variant: 1 });
  await edit(1, { op: 'zone', x0: 72, y0: 40, x1: 100, y1: 52, variant: 3 });
  await edit(1, { op: 'wall', x0: 72, y0: 40, x1: 72, y1: 42, variant: 1 });
  await edit(1, { op: 'wall', x0: 72, y0: 45, x1: 72, y1: 52, variant: 1 });
  await edit(1, { op: 'fixture', x0: 72, y0: 42, x1: 73, y1: 45, variant: 2 });
  await edit(1, { op: 'fixture', x0: 76, y0: 46, x1: 82, y1: 47, variant: 4 });
  await edit(1, { op: 'zone', x0: 88, y0: 48, x1: 90, y1: 50, variant: 4 });
  await edit(1, { op: 'fixture', x0: 88, y0: 48, x1: 90, y1: 50, variant: 12 });
  await send({ type: 'buildTower', x: 3300, y: 5600, level: 1 });
  await send({ type: 'signAirline', airlineId: 0, rotations: 2 });
  await send({ type: 'signAirline', airlineId: 1, rotations: 2 });
}

/** Flight indexes that are scheduled and hold no stand, earliest first. */
function unassignedFlights(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const board = (window.__store?.getState().business?.board ?? []) as { flight: number; standId: number; status: string }[];
    return board.filter((r) => r.flight >= 0 && r.standId < 0 && r.status === 'scheduled').map((r) => r.flight);
  });
}

function standOf(page: Page, flight: number): Promise<number> {
  return page.evaluate((f) => {
    const board = (window.__store?.getState().business?.board ?? []) as { flight: number; standId: number }[];
    return board.find((r) => r.flight === f)?.standId ?? -2;
  }, flight);
}

/** Drags a block with the mouse onto a stand row, and checks the row shows the expected drop mark while the pointer is over it. */
async function dragOnto(page: Page, flight: number, rowTestId: string, mark: 'drop-ok' | 'drop-bad'): Promise<void> {
  const row = page.getByTestId(rowTestId);
  await row.scrollIntoViewIfNeeded();
  const block = page.getByTestId(`offer-${flight}`);
  await block.scrollIntoViewIfNeeded();
  const from = await block.boundingBox();
  const to = await row.boundingBox();
  if (!from || !to) throw new Error('block or row is not on screen');
  const sx = from.x + from.width / 2;
  const sy = from.y + from.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy + 8, { steps: 2 });
  await page.mouse.move(sx, to.y + to.height / 2, { steps: 12 });
  await expect(page.getByTestId(mark)).toBeVisible();
  await page.mouse.up();
}

test('stand timeline: a flight dragged onto a stand row takes it, a refused drop stays with a notice', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  await buildOffersAirport(page);
  await expect.poll(async () => (await unassignedFlights(page)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  const [first, second] = await unassignedFlights(page);

  await page.getByTestId('tool-stands').click();
  await page.getByTestId('menutab-manage').click();
  await page.getByTestId('card-standManagement').click();
  await expect(page.getByTestId('sheet-stands')).toBeVisible();
  await page.getByTestId('auto-stands').uncheck();
  await expect(page.getByTestId('lane-unassigned').getByTestId(`offer-${first}`)).toBeVisible();

  const stand = await page.evaluate(() => {
    const stands = (window.__store?.getState().airfield.stands ?? []) as { id: number }[];
    return stands[0]?.id ?? -1;
  });
  expect(stand).toBeGreaterThanOrEqual(0);
  await dragOnto(page, first, `stand-row-${stand}`, 'drop-ok');
  await expect(page.getByTestId(`stand-row-${stand}`).getByTestId(`offer-${first}`)).toBeVisible();
  await expect.poll(() => standOf(page, first)).toBe(stand);

  await page.getByTestId(`stand-open-${stand}`).uncheck();
  await expect(page.getByTestId(`stand-row-${stand}`).locator('.tl-grid.closed')).toBeVisible();
  await dragOnto(page, second, `stand-row-${stand}`, 'drop-bad');
  await expect(page.getByTestId('lane-unassigned').getByTestId(`offer-${second}`)).toBeVisible();
  await expect(page.getByTestId('notice')).toContainText('closed');
  expect(errors).toEqual([]);
});
