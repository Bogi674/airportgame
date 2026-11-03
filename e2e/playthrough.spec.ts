import { test } from '@playwright/test';
import { playSmallAirport, startNewGame, watchErrors } from './helpers';
import { expect } from '@playwright/test';

test('plays a small airport end to end, with save and load', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await startNewGame(page);
  await playSmallAirport(page);
  expect(errors).toEqual([]);
});
