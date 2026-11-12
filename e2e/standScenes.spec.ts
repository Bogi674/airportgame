import { expect, test, type Page } from '@playwright/test';
import { startNewGame, watchErrors } from './helpers';

interface SceneStand {
  size: 'small' | 'medium' | 'large';
  x: number;
  spacingM: number;
  typeIdx: number;
}

// Dock types by index in the aircraft list: kingair_360 (largest small type), a320neo, b787_9.
const SCENES: SceneStand[] = [
  { size: 'small', x: 3600, spacingM: 30, typeIdx: 9 },
  { size: 'medium', x: 3900, spacingM: 45, typeIdx: 1 },
  { size: 'large', x: 4350, spacingM: 80, typeIdx: 3 },
];
const STAND_Y = 5340;
const ZOOM = 5;
/** TURNAROUND in src/sim/ops/traffic.ts, copied because the sim module cannot load under the test runner. */
const TURNAROUND = 4;

/** Commands reach the sim worker in order, so a send needs no wait of its own. */
const send = (page: Page, cmd: unknown): Promise<void> => page.evaluate((c) => window.__send?.(c), cmd);

/** What the page records from the render loop: the latest frame count, aircraft states and vehicle dock flags. */
interface FrameProbe {
  frames: number;
  aircraftStates: number[];
  vehicles: number;
  /** Every vehicle in the latest snapshot reports vehicleDocked. */
  allDocked: boolean;
}

/** Wraps the renderer's draw call to record the snapshot it draws, since the store carries no vehicle state. */
async function installFrameProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Views = { header: Int32Array; aircraftState: Uint8Array; vehicleDocked: Uint8Array };
    const r = window.__renderer as unknown as { render: (prev: Views | null, curr: Views | null, alpha: number) => void };
    const probe = { frames: 0, aircraftStates: [] as number[], vehicles: 0, allDocked: false };
    const draw = r.render.bind(r);
    r.render = (prev, curr, alpha) => {
      draw(prev, curr, alpha);
      probe.frames++;
      if (!curr) return;
      probe.aircraftStates = Array.from(curr.aircraftState.subarray(0, curr.header[2]));
      probe.vehicles = curr.header[3];
      probe.allDocked = curr.vehicleDocked.subarray(0, probe.vehicles).every((d) => d === 1);
    };
    (window as unknown as { __probe: typeof probe }).__probe = probe;
  });
}

const readProbe = (page: Page): Promise<FrameProbe> =>
  page.evaluate(() => ({ ...(window as unknown as { __probe: FrameProbe }).__probe }));

/** Buys the land and builds a code E runway, parallel taxiway, apron and one stand per size. */
async function buildScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    const site = window.__store?.getState().site as unknown as { parcelId: Uint16Array; parcelType: Uint8Array };
    const ids = new Set<number>();
    for (let y = 4880; y <= 6000; y += 10) for (let x = 2880; x <= 6400; x += 10) ids.add(site.parcelId[Math.floor(y / 10) * 800 + Math.floor(x / 10)]);
    window.__send?.({ type: 'buyParcels', ids: [...ids].filter((id) => site.parcelType[id] !== 6) });
  });
  await expect.poll(() => page.evaluate(() => window.__store?.getState().cash ?? 0)).toBeLessThan(120_000_000);
  await send(page, { type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 3300, code: 'E', approach: 'precision', surface: 'asphalt', tier: 2 });
  await send(page, { type: 'buildParallelTaxiway', runwayId: 1, side: 'right', offsetM: 200, code: 'E', connectors: 4, surface: 'asphalt', tier: 2 });
  await send(page, { type: 'buildApron', polygon: [{ x: 3400, y: 5205 }, { x: 4900, y: 5205 }, { x: 4900, y: 5460 }, { x: 3400, y: 5460 }], surface: 'concrete', tier: 2 });
  for (const s of SCENES) {
    await send(page, { type: 'buildStands', x: s.x, y: STAND_Y, headingDeg: 180, count: 1, spacingM: s.spacingM, standType: 'remote', size: s.size });
  }
  await send(page, { type: 'buildTower', x: 3300, y: 4700, level: 2 });
  const counts = () => page.evaluate(() => {
    const a = window.__store?.getState().airfield;
    return { runways: a?.runways.length ?? 0, taxiways: a?.taxiways.length ?? 0, aprons: a?.aprons.length ?? 0, stands: a?.stands.length ?? 0 };
  });
  await expect.poll(async () => (await counts()).runways).toBe(1);
  await expect.poll(async () => (await counts()).taxiways).toBeGreaterThan(0);
  await expect.poll(async () => (await counts()).aprons).toBe(1);
  await expect.poll(async () => (await counts()).stands).toBe(SCENES.length);
}

for (const scene of SCENES) {
  test(`${scene.size} stand with a docked aircraft and its ground equipment`, async ({ page }) => {
    const errors = watchErrors(page);
    await startNewGame(page);
    await buildScene(page);
    const standId = await page.evaluate((x) => {
      const stands = window.__store?.getState().airfield.stands as unknown as { id: number; x: number }[];
      return stands.reduce((best, s) => (Math.abs(s.x - x) < Math.abs(best.x - x) ? s : best)).id;
    }, scene.x);
    await installFrameProbe(page);
    await send(page, { type: 'testDockAt', standId, typeIdx: scene.typeIdx, turnTicks: 10_000_000 });
    await page.addStyleTag({ content: '[data-testid]:not([data-testid="map"]) { visibility: hidden !important; }' });
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="speed-8"]')?.click());
    // Docked: the aircraft is in its turnaround and every vehicle reports its dock pose in the snapshot.
    await expect
      .poll(
        async () => {
          const p = await readProbe(page);
          return p.aircraftStates.includes(TURNAROUND) && p.vehicles > 0 && p.allDocked;
        },
        { timeout: 90_000, intervals: [250] },
      )
      .toBe(true);
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="speed-0"]')?.click());
    await page.evaluate(({ x, y, zoom }) => {
      const c = window.__renderer?.camera;
      if (c) {
        c.x = x;
        c.y = y;
        c.zoom = zoom;
        c.rotation = 0;
      }
    }, { x: scene.x, y: STAND_Y, zoom: ZOOM });
    await expect
      .poll(() =>
        page.evaluate(({ x, y, zoom }) => {
          const r = window.__renderer as unknown as { camera: { x: number; y: number; zoom: number }; chunksReady: boolean } | null;
          return r !== null && r !== undefined && r.chunksReady && r.camera.x === x && r.camera.y === y && r.camera.zoom === zoom;
        }, { x: scene.x, y: STAND_Y, zoom: ZOOM }),
      )
      .toBe(true);
    const framesAfterCamera = (await readProbe(page)).frames;
    // Two more frames after the camera moved and the chunks are ready, so the canvas shows the final pose.
    await expect.poll(async () => (await readProbe(page)).frames).toBeGreaterThanOrEqual(framesAfterCamera + 2);
    await expect(page.getByTestId('map')).toHaveScreenshot(`stand-${scene.size}.png`, { maxDiffPixelRatio: 0.01 });
    expect(errors).toEqual([]);
  });
}
