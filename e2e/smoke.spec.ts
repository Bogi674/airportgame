import { expect, test } from '@playwright/test';

test('boots, ticks, renders chunks and aircraft, and takes input', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/');
  await expect(page.getByTestId('map')).toBeVisible();

  // The sim worker is ticking and reporting.
  await expect.poll(async () => Number(((await page.getByTestId('tick').textContent()) ?? '').replace(/\D/g, ''))).toBeGreaterThan(50);

  // Test traffic travels through commands, the worker and snapshots.
  await page.getByTestId('spawn').click();
  await expect(page.getByText(/Aircraft: 50/)).toBeVisible();

  // Camera input does not throw and the canvas paints non background pixels (baked chunks).
  const canvas = page.getByTestId('map');
  await canvas.hover({ position: { x: 640, y: 360 } });
  await page.mouse.wheel(0, -400);
  await page.mouse.down();
  await page.mouse.move(700, 400);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const painted = await canvas.evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] !== 0x10 || d[i + 1] !== 0x16) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(100);

  // Pausing stops the clock.
  await page.getByTestId('speed-0').click();
  // The HUD reads the sim at a low rate, so let in flight reports settle first.
  await page.waitForTimeout(1500);
  const a = await page.getByTestId('tick').textContent();
  await page.waitForTimeout(700);
  expect(await page.getByTestId('tick').textContent()).toBe(a);

  expect(errors).toEqual([]);
});
