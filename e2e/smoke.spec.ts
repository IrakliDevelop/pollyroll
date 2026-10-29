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

  test('reduced motion resolves immediately, then fades the settled dice in', async ({ page }) => {
    await page.goto('/smoke.html?reduced');
    await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 10_000 });
    const { first, ink } = await page.evaluate(async () => {
      const frame = new Promise<'frame'>((r) => requestAnimationFrame(() => r('frame')));
      const done = window.__pollyrollTray.playRoll({
        v: 1,
        id: 'reduced-fade',
        notation: '1d20',
        dice: [{ type: 'd20', value: 7, group: 0, wave: 0 }],
        modifier: 0,
        seed: '0123456789abcdef0123456789abcdef',
        createdAt: 0,
      });
      const first = await Promise.race([done.then(() => 'resolved'), frame]);
      // Same task as the resolve, so the drawing buffer still holds the frame settle() drew.
      const tray = document.getElementById('tray');
      if (!(tray instanceof HTMLCanvasElement)) return { first, ink: -1 };
      const c = document.createElement('canvas');
      c.width = tray.width;
      c.height = tray.height;
      const ctx = c.getContext('2d');
      if (ctx === null) return { first, ink: -1 };
      ctx.fillStyle = '#fff'; // the page background behind the transparent tray
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(tray, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        const sum = (data[i] ?? 255) + (data[i + 1] ?? 255) + (data[i + 2] ?? 255);
        if (sum < 3 * 235) ink++;
      }
      return { first, ink };
    });
    expect(first).toBe('resolved');
    expect(ink).toBe(0);
  });

  test('reduced motion ends its fade on the settled frame', async ({ page }) => {
    await page.goto('/smoke.html?reduced');
    await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 10_000 });
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => window.__pollyroll);
    expect(state.supported).toBe(true);
    expect(state.summary?.total).toBe(TOTAL);
    expect(state.elapsedMs).toBeLessThan(500);
    expect(await inkRatio(page)).toBeGreaterThan(0.01);
    // The static frame is the settled frame of the animated roll.
    await expect(page.locator('#tray')).toHaveScreenshot('smoke.png');
  });

  test('animates coins and settles on their values', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/smoke.html?event=coin');
    await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 20_000 });
    const state = await page.evaluate(() => window.__pollyroll);
    expect(state.supported).toBe(true);
    expect(state.summary?.total).toBe(3);
    expect(errors).toEqual([]);
    // Two coins showing H and T and a d2 showing 2.
    await expect(page.locator('#tray')).toHaveScreenshot('coin.png');
  });

  test('custom labels play a d6 without page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/smoke.html?reduced&labels=custom');
    await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 10_000 });
    const total = await page.evaluate(
      async () =>
        (
          await window.__pollyrollTray.playRoll({
            v: 1,
            id: 'custom-labels',
            notation: '1d6',
            dice: [{ type: 'd6', value: 3, group: 0, wave: 0 }],
            modifier: 0,
            seed: '0123456789abcdef0123456789abcdef',
            createdAt: 0,
          })
        ).total,
    );
    expect(total).toBe(3);
    expect(errors).toEqual([]);
  });
});
