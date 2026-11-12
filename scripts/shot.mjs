#!/usr/bin/env node
// Takes in game screenshots from a JSON scenario, for the visual check of every task.
// Needs the dev server: run `npm run dev` in another terminal first (http://localhost:5173).
// Usage: npm run shot -- <scenario.json> [outDir]     (default outDir: shots/)
// Set PW_CHROMIUM_PATH to use an installed Chromium instead of the Playwright download.
//
// Scenario fields (all optional except one of commands or actions):
// {
//   "preset": "flatCoastal",                 new game preset: flatCoastal or riverValley
//   "buy": [[x0, y0, x1, y1]],               buy every parcel touching these world rectangles (meters)
//   "commands": [{ "type": "buildRunway", ... }],   sim commands, sent in order (see src/sim/commands.ts)
//   "camera": { "x": 4000, "y": 5000, "zoom": 1.5, "rotation": 0 },   zoom is pixels per meter
//   "hideUi": false,                          hide every panel so only the map shows
//   "viewport": { "w": 1600, "h": 1000 },
//   "actions": [                             pointer and keyboard input, world coordinates in meters
//     { "tool": "tool-taxiway" },            click the element with this data-testid
//     { "click": [x, y] }, { "move": [x, y] }, { "down": [x, y] }, { "up": [x, y] },
//     { "key": "Enter" }, { "wait": 500 },
//     { "camera": { "x": 1, "y": 2, "zoom": 3 } },
//     { "shot": "name", "clip": { "w": 700, "h": 500 } },  clip is centered on the viewport
//     { "expect": { "path": "airfield.stands.0.size", "equals": "small" } }   fails the run when the store value differs
//   ],
//   "report": ["airfield.runways.length", "cash"]   values from the game store printed at the end
// }
// When "actions" has no shot, one full screenshot named after the scenario is taken at the end.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [scenarioPath, outDir = 'shots'] = process.argv.slice(2);
if (!scenarioPath) {
  console.error('usage: npm run shot -- <scenario.json> [outDir]');
  process.exit(2);
}
const sc = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const name = basename(scenarioPath).replace(/\.json$/, '');
mkdirSync(outDir, { recursive: true });
const url = process.env.SHOT_URL ?? 'http://localhost:5173/';

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
const vw = sc.viewport?.w ?? 1600;
const vh = sc.viewport?.h ?? 1000;
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

try {
  await page.goto(url);
} catch {
  console.error(`Cannot open ${url}. Start the dev server with npm run dev first.`);
  await browser.close();
  process.exit(2);
}
await page.getByTestId('menu-new').click();
if (sc.preset) await page.getByTestId(`preset-${sc.preset}`).click();
await page.getByTestId('menu-start').click();
await page.getByTestId('top-bar').waitFor();
await page.waitForFunction(() => (window.__store?.getState().site?.parcelCount ?? 0) > 0);

for (const r of sc.buy ?? []) {
  await page.evaluate((rect) => {
    const site = window.__store.getState().site;
    const ids = new Set();
    const [x0, y0, x1, y1] = rect;
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 10) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 10) ids.add(site.parcelId[Math.floor(y / 10) * 800 + Math.floor(x / 10)]);
    }
    window.__send({ type: 'buyParcels', ids: [...ids].filter((id) => site.parcelType[id] !== 6) });
  }, r);
  await page.waitForTimeout(300);
}
for (const c of sc.commands ?? []) {
  await page.evaluate((cmd) => window.__send(cmd), c);
  await page.waitForTimeout(150);
}
await page.waitForTimeout(800);

const setCamera = (cam) =>
  page.evaluate((c) => {
    const k = window.__renderer.camera;
    if (c.x !== undefined) k.x = c.x;
    if (c.y !== undefined) k.y = c.y;
    if (c.zoom !== undefined) k.zoom = c.zoom;
    k.rotation = c.rotation ?? 0;
  }, cam);
if (sc.camera) await setCamera(sc.camera);
if (sc.hideUi) await page.addStyleTag({ content: '[data-testid]:not([data-testid="map"]) { visibility: hidden !important; }' });
// Terrain chunks bake in a worker: wait until every chunk in view is ready (at most 20 s).
const settle = async () => {
  await page.waitForTimeout(200);
  await page.waitForFunction(() => window.__renderer?.chunksReady === true, null, { timeout: 20000 }).catch(() => console.log('warning: chunks still baking'));
  await page.waitForTimeout(300);
};
await settle();

const box = await page.getByTestId('map').boundingBox();
const toScreen = async ([x, y]) => {
  const s = await page.evaluate(([wx, wy]) => {
    const o = { x: 0, y: 0 };
    window.__renderer.camera.worldToScreen(wx, wy, o);
    return o;
  }, [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
};

const readStore = (key) => page.evaluate((k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), window.__store.getState()), key);

let shots = 0;
const shoot = async (file, clip) => {
  const path = join(outDir, `${file}.png`);
  const opts = { path };
  if (clip) opts.clip = { x: Math.max(0, vw / 2 - clip.w / 2), y: Math.max(0, vh / 2 - clip.h / 2), width: clip.w, height: clip.h };
  await page.screenshot(opts);
  console.log(`saved ${path}`);
  shots++;
};

for (const a of sc.actions ?? []) {
  // A DOM click works while hideUi has hidden the panels.
  if (a.tool) await page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.click(), a.tool);
  else if (a.click) {
    const p = await toScreen(a.click);
    await page.mouse.click(p.x, p.y);
  } else if (a.move) {
    const p = await toScreen(a.move);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  } else if (a.down) {
    const p = await toScreen(a.down);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
  } else if (a.up) {
    const p = await toScreen(a.up);
    await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.mouse.up();
  } else if (a.key) await page.keyboard.press(a.key);
  else if (a.wait) await page.waitForTimeout(a.wait);
  else if (a.camera) {
    await setCamera(a.camera);
    await settle();
  }
  else if (a.shot) await shoot(`${name}-${a.shot}`, a.clip);
  else if (a.expect) {
    const actual = await readStore(a.expect.path);
    if (JSON.stringify(actual) !== JSON.stringify(a.expect.equals)) {
      console.error(`expect failed: ${a.expect.path} is ${JSON.stringify(actual)}, expected ${JSON.stringify(a.expect.equals)}`);
      await browser.close();
      process.exit(1);
    }
    console.log(`expect ok: ${a.expect.path} = ${JSON.stringify(actual)}`);
  }
  await page.waitForTimeout(120);
}
if (shots === 0) {
  await page.waitForTimeout(400);
  await shoot(name, null);
}

const report = {};
for (const key of sc.report ?? []) {
  report[key] = await readStore(key);
}
if (Object.keys(report).length > 0) console.log('report', JSON.stringify(report));
console.log(errors.length > 0 ? `page errors: ${JSON.stringify(errors)}` : 'page errors: none');
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
