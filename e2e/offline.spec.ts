import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { playSmallAirport, startNewGame, watchErrors } from './helpers';

const file = resolve('dist-offline/airfield-tycoon.html');

// The single file build must run straight from disk with no server and no network.
test('the offline file plays from file:// with workers, saves and no network', async ({ page }) => {
  test.setTimeout(150_000);
  expect(existsSync(file), 'run npm run build:offline first').toBe(true);
  const errors = watchErrors(page);
  const requests: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('file:') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) requests.push(r.url());
  });
  await startNewGame(page, pathToFileURL(file).href);
  await playSmallAirport(page);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
