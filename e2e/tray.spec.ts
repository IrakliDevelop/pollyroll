import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RollEvent } from '../src/core/types';
import type { Skin } from '../src/skins/types';

declare global {
  interface Window {
    __loseContext: WEBGL_lose_context;
    __atlasFonts: string[];
  }
}

const EVENT: RollEvent = {
  v: 1,
  id: 'tray-e2e',
  notation: '2d6+3',
  dice: [
    { type: 'd6', value: 2, group: 0, wave: 0 },
    { type: 'd6', value: 5, group: 0, wave: 0 },
  ],
  modifier: 3,
  seed: '0123456789abcdef0123456789abcdef',
  createdAt: 0,
};

const BROKEN: Skin = {
  material: 'plastic',
  color: '#fff',
  labelColor: '#000',
  pattern: { glsl: 'BROKEN' },
};

/** Shares of #tray pixels that are clearly darker than the white page, and clearly red. */
async function coverage(page: Page): Promise<{ ink: number; red: number }> {
  const png = await page.locator('#tray').screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    if (ctx === null) throw new Error('no 2D context');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let ink = 0;
    let red = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 255;
      const g = data[i + 1] ?? 255;
      const b = data[i + 2] ?? 255;
      if (r + g + b < 3 * 235) ink++;
      if (r > 120 && g < 60 && b < 60) red++;
    }
    const n = data.length / 4;
    return { ink: ink / n, red: red / n };
  }, png.toString('base64'));
}

/** Opens the smoke page, waits for its roll to settle, and collects page errors. */
async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/smoke.html${query}`);
  await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 20_000 });
  await page.evaluate(() => {
    const canvas = document.getElementById('tray');
    const ext =
      canvas instanceof HTMLCanvasElement
        ? canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')
        : undefined;
    if (ext === undefined || ext === null) throw new Error('WEBGL_lose_context unavailable');
    window.__loseContext = ext;
  });
  return errors;
}

/** Loses or restores the #tray context and waits until the matching event has been handled. */
function setLost(page: Page, lost: boolean): Promise<void> {
  return page.evaluate(async (lose) => {
    const canvas = document.getElementById('tray');
    if (canvas === null) throw new Error('missing #tray');
    const fired = new Promise((resolve) => {
      canvas.addEventListener(lose ? 'webglcontextlost' : 'webglcontextrestored', resolve, {
        once: true,
      });
    });
    if (lose) window.__loseContext.loseContext();
    else window.__loseContext.restoreContext();
    await fired;
  }, lost);
}

test.describe('tray context loss', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'uses WEBGL_lose_context in Chromium');

  test('resolves an animating roll with its summary when the context is lost', async ({ page }) => {
    await open(page, '');
    const result = await page.evaluate(async (event) => {
      const within = <T>(p: Promise<T>, ms: number): Promise<T | 'pending'> =>
        Promise.race([p, new Promise<'pending'>((r) => setTimeout(() => r('pending'), ms))]);
      const done = window.__pollyrollTray.playRoll(event).then((s) => s.total);
      const before = await within(done, 100);
      window.__loseContext.loseContext();
      return { before, after: await within(done, 300) };
    }, EVENT);
    expect(result).toEqual({ before: 'pending', after: 10 });
  });

  test('resolves playRoll at once while lost and draws the dice on restore', async ({ page }) => {
    await open(page, '');
    await setLost(page, true);
    const total = await page.evaluate(async (event) => {
      const timeout = new Promise<'pending'>((r) => setTimeout(() => r('pending'), 100));
      return Promise.race([window.__pollyrollTray.playRoll(event).then((s) => s.total), timeout]);
    }, EVENT);
    expect(total).toBe(10);
    await setLost(page, false);
    expect((await coverage(page)).ink).toBeGreaterThan(0.005);
  });

  test('does not draw a roll cleared while the context was lost', async ({ page }) => {
    await open(page, '');
    await setLost(page, true);
    await page.evaluate(async (event) => {
      await window.__pollyrollTray.playRoll(event);
      window.__pollyrollTray.clear();
    }, EVENT);
    await setLost(page, false);
    expect((await coverage(page)).ink).toBe(0);
  });

  test('drops an invalid skin set while lost and keeps drawing with the previous skin', async ({
    page,
  }) => {
    const errors = await open(page, '?reduced');
    await setLost(page, true);
    expect(
      await page.evaluate(
        async (event) => (await window.__pollyrollTray.playRoll(event)).total,
        EVENT,
      ),
    ).toBe(10);
    await page.evaluate((skin) => window.__pollyrollTray.setSkin(skin), BROKEN);
    await setLost(page, false);
    expect(errors).toEqual([]);
    expect((await coverage(page)).ink).toBeGreaterThan(0.005);
    const name = await page.evaluate((skin) => {
      try {
        window.__pollyrollTray.setSkin(skin);
        return 'accepted';
      } catch (error) {
        return String((error as { name?: unknown }).name);
      }
    }, BROKEN);
    expect(name).toBe('PollyrollShaderError');
  });

  test('rejects a skin that cannot be resolved in setSkin while lost, not on restore', async ({
    page,
  }) => {
    const errors = await open(page, '?reduced');
    await setLost(page, true);
    const name = await page.evaluate(() => {
      const bogus: unknown = { material: 'bogus', color: '#fff', labelColor: '#000' };
      try {
        window.__pollyrollTray.setSkin(bogus as Skin);
        return 'accepted';
      } catch (error) {
        return String((error as { name?: unknown }).name);
      }
    });
    expect(name).toBe('TypeError');
    await setLost(page, false);
    expect(errors).toEqual([]);
    expect((await coverage(page)).ink).toBeGreaterThan(0.005);
  });

  test('applies a valid skin set while lost on restore', async ({ page }) => {
    await open(page, '?reduced');
    expect((await coverage(page)).red).toBe(0);
    await setLost(page, true);
    await page.evaluate(() =>
      window.__pollyrollTray.setSkin({ material: 'plastic', color: '#ff0000', labelColor: '#000' }),
    );
    await setLost(page, false);
    expect((await coverage(page)).red).toBeGreaterThan(0.005);
  });

  test('falls back to the tray skin when an event skin played while lost fails on restore', async ({
    page,
  }) => {
    const errors = await open(page, '?reduced');
    await setLost(page, true);
    const total = await page.evaluate(
      async ([event, skin]) => (await window.__pollyrollTray.playRoll({ ...event, skin })).total,
      [EVENT, BROKEN] as const,
    );
    expect(total).toBe(10);
    await setLost(page, false);
    expect(errors).toEqual([]);
    expect((await coverage(page)).ink).toBeGreaterThan(0.005);
  });
});

test.describe('tray label font', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'atlas fonts checked in Chromium');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const fonts: string[] = [];
      window.__atlasFonts = fonts;
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (
        this: CanvasRenderingContext2D,
        ...args: Parameters<CanvasRenderingContext2D['fillText']>
      ): void {
        fonts.push(this.font.replace(/^bold \S+px /, ''));
        fillText.apply(this, args);
      };
    });
  });

  /** Font families drawn into glyph atlases since the last call. */
  const drawn = (page: Page): Promise<string[]> =>
    page.evaluate(() => [...new Set(window.__atlasFonts.splice(0))]);

  test('builds the atlas from skin.font, then labelFont, and rebuilds it when the font changes', async ({
    page,
  }) => {
    await open(page, '?reduced');
    expect(await drawn(page)).toEqual(['sans-serif']);
    const classic: Skin = {
      material: 'plastic',
      color: '#f4f1ea',
      labelColor: '#1a1a1a',
      labelStyle: 'printed',
    };
    await page.evaluate((s) => window.__pollyrollTray.setSkin({ ...s, font: 'SkinFont' }), classic);
    expect(await drawn(page)).toEqual(['SkinFont']);
    await page.evaluate(
      (s) => window.__pollyrollTray.setSkin({ ...s, labelColor: '#123', font: 'SkinFont' }),
      classic,
    );
    expect(await drawn(page)).toEqual([]);
    await page.evaluate(
      async ([event, s]) => {
        await window.__pollyrollTray.playRoll({ ...event, skin: { ...s, font: 'EventFont' } });
      },
      [EVENT, classic] as const,
    );
    expect(await drawn(page)).toEqual(['EventFont']);
    await page.evaluate(async (event) => {
      await window.__pollyrollTray.playRoll({ ...event, skin: 'classic' });
    }, EVENT);
    expect(await drawn(page)).toEqual(['sans-serif']);
  });

  test('defaults the atlas font to system-ui', async ({ page }) => {
    await open(page, '?reduced');
    await drawn(page);
    await page.evaluate(() => window.__pollyrollCreate(document.createElement('canvas')).dispose());
    expect(await drawn(page)).toEqual(['system-ui']);
  });
});

test.describe('tray die scale', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'pixel coverage checked in Chromium');

  test('keeps a rolling die at its scale and draws the next roll larger', async ({ page }) => {
    await open(page, '');
    const one: RollEvent = {
      ...EVENT,
      notation: '1d20',
      dice: [{ type: 'd20', value: 7, group: 0, wave: 0 }],
      modifier: 0,
    };
    const total = await page.evaluate(async (event) => {
      const done = window.__pollyrollTray.playRoll(event);
      await new Promise((r) => setTimeout(r, 100));
      window.__pollyrollTray.setDieScale(2);
      return (await done).total;
    }, one);
    expect(total).toBe(7);
    const small = (await coverage(page)).ink;
    await page.evaluate(async (event) => {
      await window.__pollyrollTray.playRoll(event);
    }, one);
    const large = (await coverage(page)).ink;
    expect(small).toBeGreaterThan(0.001);
    expect(large / small).toBeGreaterThan(2.5);
  });
});
