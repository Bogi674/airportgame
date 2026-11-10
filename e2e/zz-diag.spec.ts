import { test, type Page } from '@playwright/test';
import { startNewGame } from './helpers';

async function screenOf(page: Page, wx: number, wy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([x, y]) => {
    const out = { x: 0, y: 0 };
    window.__renderer?.camera.worldToScreen(x, y, out);
    return out;
  }, [wx, wy]);
}

const probe = (page: Page, label: string, x: number, y: number) =>
  page.evaluate(([l, px, py]) => {
    const r = document.querySelector('[data-testid="context-bar"]')?.getBoundingClientRect();
    const e = document.elementFromPoint(px as number, py as number);
    const tid = (n: Element | null) => (n ? `${n.tagName}[${n.getAttribute('data-testid') ?? ''}]` : 'none');
    const stack = document.elementsFromPoint(px as number, py as number).slice(0, 4).map(tid);
    return `DIAG ${l} pt=${px},${py} top=${tid(e)} stack=${stack.join('>')} bar=${r ? `${r.x | 0},${r.y | 0},${r.width | 0},${r.height | 0}` : 'none'} problem=${document.querySelector('[data-testid="problem"]')?.textContent ?? 'none'}`;
  }, [label, x, y] as const);

test('diag airfield points', async ({ page }, info) => {
  await startNewGame(page);
  await page.getByTestId('guide').waitFor();
  await page.evaluate(() => {
    const c = window.__renderer?.camera;
    if (c) { c.x = 5000; c.y = 5500; c.zoom = 0.3; c.rotation = 0; }
  });
  await page.getByTestId('tool-runway').click();
  await page.getByTestId('tool-runway').click();
  const a = await screenOf(page, 4800, 6200);
  const b = await screenOf(page, 4800, 4600);
  const log: string[] = [];
  log.push(await probe(page, 'a-before', a.x, a.y));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  log.push(await probe(page, 'a-down', a.x, a.y));
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  log.push(await probe(page, 'mid', (a.x + b.x) / 2, (a.y + b.y) / 2));
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.waitForTimeout(500);
  log.push(await probe(page, 'b', b.x, b.y));
  console.log(`[${info.project.name}]\n` + log.join('\n'));
});

test('diag edit points', async ({ page }, info) => {
  await startNewGame(page);
  await page.evaluate(() => {
    const site = window.__store?.getState().site;
    if (!site) return;
    const ids = new Set<number>();
    for (let y = 4880; y <= 5640; y += 10) for (let x = 2880; x <= 5720; x += 10) ids.add(site.parcelId[Math.floor(y / 10) * 800 + Math.floor(x / 10)]);
    window.__send?.({ type: 'buyParcels', ids: [...ids].filter((id) => site.parcelType[id] !== 6) });
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__send?.({ type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 1500, code: 'C', approach: 'precision', surface: 'asphalt', tier: 1 }));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const c = window.__renderer?.camera;
    if (c) { c.x = 4000; c.y = 5000; c.zoom = 0.5; c.rotation = 0; }
  });
  await page.getByTestId('tool-runway').click();
  await page.getByTestId('opt-runway-mode').selectOption('extend');
  const end = await screenOf(page, 4500, 5000);
  const beyond = await screenOf(page, 4800, 5000);
  const log: string[] = [];
  log.push(await probe(page, 'end-before', end.x, end.y));
  await page.mouse.click(end.x, end.y);
  log.push(await probe(page, 'end-after', end.x, end.y));
  await page.mouse.move(beyond.x, beyond.y, { steps: 4 });
  await page.waitForTimeout(300);
  log.push(await probe(page, 'beyond', beyond.x, beyond.y));
  log.push('DIAG len=' + (await page.evaluate(() => window.__store?.getState().airfield.runways[0]?.lengthM)));
  console.log(`[${info.project.name}]\n` + log.join('\n'));
});
