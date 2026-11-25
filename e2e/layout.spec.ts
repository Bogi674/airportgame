import { expect, test, type Page } from '@playwright/test';
import { startNewGame, watchErrors } from './helpers';

/** HUD zones of design revision 6 section 4.1. Popovers are the only layer allowed over them, so they are not listed. */
const ZONES = ['top-bar', 'tool-rail', 'build-menu', 'guide', 'minimap', 'minimap-show', 'task-bar', 'context-bar', 'item-panel', 'parcel'];

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxes(page: Page): Promise<Box[]> {
  const out: Box[] = [];
  for (const id of ZONES) {
    const loc = page.getByTestId(id);
    if ((await loc.count()) === 0 || !(await loc.first().isVisible())) continue;
    const b = await loc.first().boundingBox();
    if (b) out.push({ id, ...b });
  }
  return out;
}

/** No two zones intersect and none leaves the viewport (rule 4.2.6). */
async function expectApart(page: Page, label: string): Promise<void> {
  const vp = page.viewportSize();
  if (!vp) throw new Error('no viewport');
  const list = await boxes(page);
  for (const a of list) {
    expect(a.x >= -0.5 && a.y >= -0.5 && a.x + a.width <= vp.width + 0.5 && a.y + a.height <= vp.height + 0.5, `${label}: ${a.id} inside the viewport`).toBe(true);
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const apart = a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;
      expect(apart, `${label}: ${a.id} and ${b.id} overlap`).toBe(true);
    }
  }
}

for (const [w, h] of [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
] as const) {
  test(`HUD zones never overlap at ${w} by ${h}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: w, height: h });
    await startNewGame(page);
    await expectApart(page, 'start');

    // A flyout with an open variant tray and the context bar of the armed tool.
    await page.getByTestId('tool-stands').click();
    await page.getByTestId('card-contact').click();
    await expect(page.getByTestId('tray-contact')).toBeVisible();
    await expectApart(page, 'flyout with tray');

    // The stations flyout with a level tray.
    await page.getByTestId('tool-stations').click();
    await page.getByTestId('card-security').click();
    await expectApart(page, 'stations tray');

    // Minimap in each state.
    for (const m of ['Semi', 'Hide']) {
      await page.getByTestId('minimap-mode').getByRole('button', { name: m }).click();
      await expectApart(page, `minimap ${m}`);
    }
    await page.getByTestId('minimap-show').click();

    // Each popover opens alone.
    await page.getByTestId('task-select').click();
    for (const id of ['aircraft', 'stands']) {
      await page.getByTestId(id).click();
      await expect(page.getByTestId(`${id}-pop`)).toBeVisible();
      await expectApart(page, `${id} popover`);
    }
    await page.getByTestId('alert-bell').click();
    await expect(page.getByTestId('stands-pop')).toHaveCount(0);
    await expect(page.getByTestId('alert-center')).toBeVisible();
    await page.keyboard.press('Escape');

    // A side sheet hides the flyout and stays clear of the minimap and task bar.
    await page.getByTestId('task-finance').click();
    const sheet = await page.getByTestId('sheet-finance').boundingBox();
    const map = await page.getByTestId('minimap').boundingBox();
    const task = await page.getByTestId('task-bar').boundingBox();
    expect(sheet && map && sheet.x + sheet.width <= map.x).toBe(true);
    expect(sheet && task && sheet.y + sheet.height <= task.y).toBe(true);
    expect(errors).toEqual([]);
  });
}
