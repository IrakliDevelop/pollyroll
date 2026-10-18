import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RollEvent } from '../src/core/types';
import { planRoll, slots } from '../src/physics/plan';
import { DT } from '../src/physics/world';
import { fitScale, trayBounds } from '../src/render/camera';
import type { Skin } from '../src/skins/types';

interface AudioRecord {
  constructed: number;
  starts: number[];
  stops: number;
  gains: { value: number }[];
  closes: number;
}

declare global {
  interface Window {
    __loseContext: WEBGL_lose_context;
    __atlasFonts: string[];
    __audio: AudioRecord;
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
      window.__pollyrollTray.setDieScale(1);
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

test.describe('dropped dice', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'pixel comparison checked in Chromium',
  );

  test('fades the dropped die after settle and leaves kept dice unchanged', async ({ page }) => {
    await open(page, '?reduced&event=all');
    const all = (await page.locator('#tray').screenshot()).toString('base64');
    await open(page, '?reduced&event=adv');
    const adv = (await page.locator('#tray').screenshot()).toString('base64');
    const diff = await page.evaluate(
      async ([a, b]) => {
        const pixels = async (b64: string): Promise<Uint8ClampedArray> => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d');
          if (ctx === null) throw new Error('no 2D context');
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, c.width, c.height).data;
        };
        const pa = await pixels(a);
        const pb = await pixels(b);
        let changed = 0;
        let lighter = 0;
        for (let i = 0; i < pa.length; i += 4) {
          const sa = (pa[i] ?? 0) + (pa[i + 1] ?? 0) + (pa[i + 2] ?? 0);
          const sb = (pb[i] ?? 0) + (pb[i + 1] ?? 0) + (pb[i + 2] ?? 0);
          if (Math.abs(sb - sa) <= 30) continue;
          changed++;
          if (sb > sa) lighter++;
        }
        return {
          changed: changed / (pa.length / 4),
          lighter: changed === 0 ? 0 : lighter / changed,
        };
      },
      [all, adv] as const,
    );
    expect(diff.changed).toBeGreaterThan(0.003);
    expect(diff.lighter).toBeGreaterThan(0.95);
  });
});

test.describe('sound', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const rec: AudioRecord = { constructed: 0, starts: [], stops: 0, gains: [], closes: 0 };
      window.__audio = rec;
      const node = <T extends object>(props: T): T & { connect: <N>(n: N) => N } => ({
        ...props,
        connect: (n) => n,
      });
      class StubAudioContext {
        currentTime = 0;
        sampleRate = 48000;
        state = 'suspended';
        destination = {};
        constructor() {
          rec.constructed++;
        }
        createBuffer(_channels: number, length: number) {
          return { getChannelData: () => new Float32Array(length) };
        }
        createBufferSource() {
          return node({
            buffer: null,
            start: (when: number) => rec.starts.push(when),
            stop: () => rec.stops++,
          });
        }
        createBiquadFilter() {
          return node({ type: '', frequency: { value: 0 }, Q: { value: 0 } });
        }
        createGain() {
          const gain = { value: 0 };
          rec.gains.push(gain);
          return node({ gain });
        }
        resume() {
          this.state = 'running';
          return Promise.resolve();
        }
        close() {
          rec.closes++;
          return Promise.resolve();
        }
      }
      Object.defineProperty(window, 'AudioContext', { value: StubAudioContext });
    });
  });

  const settled = async (page: Page, query: string): Promise<void> => {
    await page.goto(`/smoke.html${query}`);
    await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 20_000 });
  };

  test('schedules impact clacks within the roll, stops them on replace and settle, and closes on dispose', async ({
    page,
  }) => {
    await settled(page, '?sound');
    const first = await page.evaluate(() => ({
      constructed: window.__audio.constructed,
      starts: window.__audio.starts.length,
      stops: window.__audio.stops,
      gains: window.__audio.gains.map((g) => g.value),
    }));
    expect(first.constructed).toBe(1);
    expect(first.starts).toBeGreaterThanOrEqual(3);
    expect(first.starts).toBeLessThanOrEqual(48);
    // A suspended context must not play a settled roll's clacks on a later resume.
    expect(first.stops).toBe(first.starts);
    for (const g of first.gains) {
      expect(g).toBeGreaterThan(0);
      expect(g).toBeLessThanOrEqual(1);
    }

    const replay = await page.evaluate(async (event) => {
      const tray = window.__pollyrollTray;
      const a = window.__audio;
      a.starts = [];
      a.stops = 0;
      void tray.playRoll(event);
      const replaced = a.starts.length;
      const done = tray.playRoll(event);
      const stoppedOnReplace = a.stops;
      const current = a.starts.length - replaced;
      await done;
      const stoppedAtSettle = a.stops - stoppedOnReplace;
      tray.dispose();
      return {
        replaced,
        stoppedOnReplace,
        current,
        stoppedAtSettle,
        starts: a.starts,
        stops: a.stops,
        closes: a.closes,
      };
    }, EVENT);
    // The smoke canvas is 800 × 600 CSS pixels at the default dieScale 2.
    const bounds = trayBounds(4 / 3, fitScale(2, slots(EVENT).length, 4 / 3));
    const end = planRoll(EVENT, bounds).totalSteps * DT + 0.1;
    expect(replay.current).toBeGreaterThan(0);
    expect(replay.stoppedOnReplace).toBe(replay.replaced);
    expect(replay.stoppedAtSettle).toBe(replay.current);
    for (const when of replay.starts) {
      expect(when).toBeGreaterThanOrEqual(0);
      expect(when).toBeLessThanOrEqual(end);
    }
    // Settle already stopped every source, so dispose only closes the context.
    expect(replay.stops).toBe(replay.replaced + replay.current);
    expect(replay.closes).toBe(1);
  });

  test('setSound clamps to 1, mutes at 0, and rejects non-finite volumes', async ({ page }) => {
    await settled(page, '?sound');
    const result = await page.evaluate(async (event) => {
      const tray = window.__pollyrollTray;
      const a = window.__audio;
      const gains = async (): Promise<number[]> => {
        a.gains = [];
        await tray.playRoll(event);
        return a.gains.map((g) => g.value);
      };
      const atOne = await gains();
      tray.setSound(5);
      const atFive = await gains();
      tray.setSound(0);
      const muted = await gains();
      let error = '';
      try {
        tray.setSound(Number.NaN);
      } catch (e) {
        error = e instanceof RangeError ? 'RangeError' : String(e);
      }
      return { atOne, atFive, muted, error };
    }, EVENT);
    expect(result.atOne.length).toBeGreaterThan(0);
    expect(result.atFive).toEqual(result.atOne);
    expect(result.muted).toEqual([]);
    expect(result.error).toBe('RangeError');
  });

  test('creates no AudioContext by default', async ({ page }) => {
    await settled(page, '');
    expect(await page.evaluate(() => window.__audio.constructed)).toBe(0);
  });
});
