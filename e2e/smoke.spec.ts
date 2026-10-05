import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const TOTAL = 94; // 3 + 5 + 7 + 6 + 11 + 19 + 42 + 1

/** Share of canvas pixels that differ clearly from the white page background. */
async function inkRatio(page: Page): Promise<number> {
  const png = await page.locator('#tray').screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    if (ctx === null) return 0;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 255;
      const g = data[i + 1] ?? 255;
      const b = data[i + 2] ?? 255;
      if (r + g + b < 3 * 235) ink++;
    }
    return ink / (data.length / 4);
  }, png.toString('base64'));
}

test.describe('render smoke', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'screenshot baseline is Chromium only',
  );

  test('animates a roll and settles on the event values', async ({ page }) => {
    await page.goto('/smoke.html');
    await page.waitForFunction(() => window.__pollyroll.ready, undefined, { timeout: 10_000 });
    await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 20_000 });
    const state = await page.evaluate(() => window.__pollyroll);
    expect(state.supported).toBe(true);
    expect(state.summary?.total).toBe(TOTAL);
    expect(await inkRatio(page)).toBeGreaterThan(0.01);
    await expect(page.locator('#tray')).toHaveScreenshot('smoke.png');
  });

  test('reduced motion resolves immediately with static settled dice', async ({ page }) => {
    await page.goto('/smoke.html?reduced');
    await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 10_000 });
    const state = await page.evaluate(() => window.__pollyroll);
    expect(state.supported).toBe(true);
    expect(state.summary?.total).toBe(TOTAL);
    expect(state.elapsedMs).toBeLessThan(500);
    expect(await inkRatio(page)).toBeGreaterThan(0.01);
    // The static frame is the settled frame of the animated roll.
    await expect(page.locator('#tray')).toHaveScreenshot('smoke.png');
  });
});
