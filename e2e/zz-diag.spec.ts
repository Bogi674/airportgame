import { test } from '@playwright/test';
import { startNewGame } from './helpers';

test('diag context bar', async ({ page }) => {
  await startNewGame(page);
  const box = await page.getByTestId('map').boundingBox();
  await page.getByTestId('tool-runway').click();
  await page.waitForTimeout(500);
  const out = await page.evaluate(() => {
    const r = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().toJSON() ?? null;
    const at = (x: number, y: number) => {
      const e = document.elementFromPoint(x, y);
      return e ? `${e.tagName}[${e.getAttribute('data-testid') ?? ''}]` : 'none';
    };
    const m = document.querySelector('[data-testid="map"]')?.getBoundingClientRect();
    const cx = m ? m.x + m.width / 2 : 0;
    const cy = m ? m.y + m.height / 2 : 0;
    return {
      bar: r('context-bar'),
      map: m?.toJSON(),
      center: at(cx, cy),
      c2: at(cx + 100, cy - 150),
      font: getComputedStyle(document.body).fontFamily,
      dpr: devicePixelRatio,
      inner: [innerWidth, innerHeight],
    };
  });
  console.log('DIAG ' + JSON.stringify({ box, ...out }));
});
