import { expect, test, type Page } from '@playwright/test';
import { startNewGame, watchErrors } from './helpers';

/**
 * Ramp stub visual tests (docs/BAGGAGE.md section 10, T78): three check in desks whose belts sink into the floor
 * through their out ramps, and a screening machine with its in and out ramps, drawn at detail tiers 1 to 3.
 * Heading 90 maps cell (cx, cy) to world (3880 + 2 cx, 5360 + 2 cy).
 */
const send = (page: Page, cmd: unknown): Promise<void> => page.evaluate((c) => window.__send?.(c), cmd);

async function buildScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    const site = window.__store?.getState().site as unknown as { parcelId: Uint16Array; parcelType: Uint8Array };
    const ids = new Set<number>();
    for (let y = 5300; y <= 5600; y += 10) for (let x = 3800; x <= 4300; x += 10) ids.add(site.parcelId[Math.floor(y / 10) * 800 + Math.floor(x / 10)]);
    window.__send?.({ type: 'buyParcels', ids: [...ids].filter((id) => site.parcelType[id] !== 6) });
  });
  const edit = (building: number, e: object): Promise<void> => send(page, { type: 'terminalBuild', building, ox: 3880, oy: 5360, headingDeg: 90, edit: e });
  await edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 52, y1: 50, variant: 0 });
  await expect.poll(() => page.evaluate(() => window.__store?.getState().business?.terminals.length ?? 0)).toBe(1);
  await edit(1, { op: 'floor', x0: 40, y0: 40, x1: 52, y1: 50, variant: 2 });
  await edit(1, { op: 'zone', x0: 40, y0: 40, x1: 52, y1: 45, variant: 1 });
  await edit(1, { op: 'zone', x0: 40, y0: 45, x1: 52, y1: 50, variant: 4 });
  // Three check in desks in a row; each sends its bags down an out ramp in the row behind it.
  await edit(1, { op: 'fixture', x0: 43, y0: 44, x1: 46, y1: 45, variant: 1 });
  await send(page, { type: 'placeBaggageNode', building: 1, kind: 'machine', cx: 43, cy: 47, rot: 0, widthCells: 0 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const biz = window.__store?.getState().business as unknown as { baggage?: { nodes: { kind: string }[] } } | null;
        return biz?.baggage?.nodes.filter((n) => n.kind === 'machine').length ?? 0;
      }),
    )
    .toBe(1);
}

async function frameAt(page: Page, zoom: number): Promise<void> {
  await page.evaluate((z) => {
    const c = window.__renderer?.camera;
    if (c) {
      c.x = 3972;
      c.y = 5450;
      c.zoom = z;
      c.rotation = 0;
    }
  }, zoom);
  await expect
    .poll(() =>
      page.evaluate((z) => {
        const r = window.__renderer as unknown as { camera: { zoom: number }; chunksReady: boolean } | null;
        return r !== null && r !== undefined && r.chunksReady && r.camera.zoom === z;
      }, zoom),
      // Fine bands bake slowly in software rendered engines (WebKit in the cloud runner), as `npm run shot` allows.
      { timeout: 20_000 },
    )
    .toBe(true);
  // A few frames after the chunks are ready, so the canvas shows the baked kit.
  await page.waitForTimeout(600);
}

test('draws the baggage ramp stubs at detail tiers 1 to 3', async ({ page }) => {
  const errors = watchErrors(page);
  await startNewGame(page);
  await buildScene(page);
  await page.addStyleTag({ content: '[data-testid]:not([data-testid="map"]) { visibility: hidden !important; }' });
  // Tier boundaries of fixturePlan.tierForZoom: 6, 12 and above 24 pixels per meter.
  for (const [tier, zoom] of [
    [1, 8],
    [2, 16],
    [3, 32],
  ] as const) {
    await frameAt(page, zoom);
    await expect(page.getByTestId('map')).toHaveScreenshot(`ramp-tier${tier}.png`, { maxDiffPixelRatio: 0.01 });
  }
  expect(errors).toEqual([]);
});
