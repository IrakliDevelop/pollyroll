import { expect, test } from '@playwright/test';
import type { RollEvent } from '../src/core/types';
import { GOLDEN_HASH } from '../src/physics/golden';
import { planRoll } from '../src/physics/plan';
import type { TrayBounds } from '../src/physics/world';

// Must match the event and bounds in pages/determinism.ts.
const BOUNDS: TrayBounds = { minX: -6, maxX: 6, minZ: -4, maxZ: 4 };
const EVENT: RollEvent = {
  v: 1,
  id: 'determinism-0001',
  notation: '2d20kh1+1d100+3dF',
  dice: [
    { type: 'd20', value: 17, group: 0, wave: 0 },
    { type: 'd20', value: 4, group: 0, wave: 0 },
    { type: 'd100', value: 100, group: 1, wave: 0 },
    { type: 'dF', value: -1, group: 2, wave: 0 },
    { type: 'dF', value: 0, group: 2, wave: 0 },
    { type: 'dF', value: 1, group: 2, wave: 0 },
  ],
  modifier: 0,
  seed: 'c0ffee00c0ffee00c0ffee00c0ffee00',
  createdAt: 0,
};

/** Rounds to 6 decimals; `+ 0` folds -0 into 0. */
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6 + 0;

test('browser physics matches the Node golden hash and roll plan', async ({ page }) => {
  const plan = planRoll(EVENT, BOUNDS);
  const remaps = plan.bodies.map((b) => b.remap.map(round6));

  await page.goto('/determinism.html');
  await page.waitForFunction(() => window.__determinism?.done === true, undefined, {
    timeout: 20_000,
  });
  const state = await page.evaluate(() => window.__determinism);

  expect(state?.golden).toBe(GOLDEN_HASH);
  expect(state?.planHash).toBe(plan.hash);
  expect(state?.remaps).toEqual(remaps);
});
