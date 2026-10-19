import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RollEvent } from '../src/core/types';
import { shapeOf } from '../src/geometry/labels';
import { getPolyhedron } from '../src/geometry/polyhedra';
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
    __fontLoad: { spec: string; drawnBefore: number; done: boolean };
    __getImageData: CanvasRenderingContext2D['getImageData'];
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

const PLAYBACK = 1.5; // tray.ts plays the 120 Hz track at 1.5× real time

const INVALID: RollEvent = {
  ...EVENT,
  notation: '1d6',
  dice: [{ type: 'd6', value: 7, group: 0, wave: 0 }],
};

const BROKEN: Skin = {
  material: 'plastic',
  color: '#fff',
  labelColor: '#000',
  pattern: { glsl: 'BROKEN' },
};

const SIX: RollEvent = {
  ...EVENT,
  notation: '6d6',
  dice: [1, 2, 3, 4, 5, 6].map((value) => ({ type: 'd6', value, group: 0, wave: 0 })),
  modifier: 0,
};

/**
 * Shares of #tray pixels that are clearly darker than the white page, and clearly red; mean colour
 * of the darker ones.
 */
async function coverage(
  page: Page,
): Promise<{ ink: number; red: number; mean: { r: number; g: number; b: number } }> {
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
    const sum = { r: 0, g: 0, b: 0 };
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 255;
      const g = data[i + 1] ?? 255;
      const b = data[i + 2] ?? 255;
      if (r + g + b < 3 * 235) {
        ink++;
        sum.r += r;
        sum.g += g;
        sum.b += b;
      }
      if (r > 120 && g < 60 && b < 60) red++;
    }
    const n = data.length / 4;
    const k = ink || 1;
    return { ink: ink / n, red: red / n, mean: { r: sum.r / k, g: sum.g / k, b: sum.b / k } };
  }, png.toString('base64'));
}

/** Skips the test when the open page has no WebGL2, as in CI's headless Firefox. */
async function needsWebGL2(page: Page): Promise<void> {
  const ok = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  test.skip(!ok, 'needs WebGL2');
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

  test('labels the canvas with a roll whose context is lost before it settles', async ({
    page,
  }) => {
    await open(page, '');
    const label = await page.evaluate(async (event) => {
      const done = window.__pollyrollTray.playRoll(event);
      await new Promise((r) => setTimeout(r, 100));
      window.__loseContext.loseContext();
      await done;
      return document.getElementById('tray')?.getAttribute('aria-label');
    }, EVENT);
    expect(label).toBe('2d6+3: [2, 5] + 3 = 10');
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

  test('rebuilds the atlas once a font that was not ready finishes loading', async ({ page }) => {
    await page.addInitScript(() => {
      const rec = { spec: '', drawnBefore: -1, done: false };
      window.__fontLoad = rec;
      const fonts = document.fonts;
      const check = fonts.check.bind(fonts);
      let first = true;
      fonts.check = (font, text) => {
        if (!first) return check(font, text);
        first = false;
        return false;
      };
      fonts.load = (font) =>
        new Promise((resolve) => {
          rec.spec = font;
          setTimeout(() => {
            rec.drawnBefore = window.__atlasFonts.length;
            rec.done = true;
            resolve([]);
          }, 200);
        });
    });
    await open(page, '?reduced');
    await page.waitForFunction(() => window.__fontLoad.done);
    const { spec, before, after } = await page.evaluate(() => {
      const fonts = window.__atlasFonts;
      const n = window.__fontLoad.drawnBefore;
      return { spec: window.__fontLoad.spec, before: fonts.slice(0, n), after: fonts.slice(n) };
    });
    expect(spec).toBe('bold 64px sans-serif');
    expect(before.length).toBeGreaterThan(0);
    expect(new Set(before)).toEqual(new Set(['sans-serif']));
    expect(after).toEqual(before);
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

test.describe('tray canvas sizing at devicePixelRatio 2', () => {
  test.use({ deviceScaleFactor: 2 });

  /** Opens the smoke page, then disposes its tray and drops its fixed canvas CSS. */
  async function blank(page: Page): Promise<void> {
    await page.goto('/smoke.html?reduced');
    await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 20_000 });
    await page.evaluate(() => {
      window.__pollyrollTray.dispose();
      document.querySelector('style')?.remove();
    });
  }

  test('pins the CSS size of a canvas sized by its attributes instead of growing it', async ({
    page,
  }) => {
    await blank(page);
    await needsWebGL2(page);
    const size = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 150;
      document.body.append(canvas);
      window.__pollyrollCreate(canvas);
      await new Promise((r) => setTimeout(r, 600));
      return { width: canvas.width, clientWidth: canvas.clientWidth };
    });
    expect(size).toEqual({ width: 600, clientWidth: 300 });
  });

  test('leaves a stylesheet-sized canvas responsive', async ({ page }) => {
    await blank(page);
    await needsWebGL2(page);
    const size = await page.evaluate(async () => {
      const style = document.createElement('style');
      style.textContent = '.fill { width: 100%; }';
      const box = document.createElement('div');
      box.style.width = '400px';
      const canvas = document.createElement('canvas');
      canvas.className = 'fill';
      box.append(canvas);
      document.body.append(style, box);
      window.__pollyrollCreate(canvas);
      await new Promise((r) => setTimeout(r, 300));
      box.style.width = '500px';
      await new Promise((r) => setTimeout(r, 300));
      return { width: canvas.width, inline: canvas.style.width };
    });
    expect(size).toEqual({ width: 1000, inline: '' });
  });
});

test.describe('tray robustness', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'pixel coverage checked in Chromium');

  test('renders a modern CSS color like its hex equivalent', async ({ page }) => {
    await open(page, '?reduced');
    const mean = async (color: string): Promise<{ r: number; g: number; b: number }> => {
      await page.evaluate(
        async ([event, c]) => {
          await window.__pollyrollTray.playRoll({
            ...event,
            skin: { material: 'plastic', color: c, labelColor: '#000' },
          });
        },
        [EVENT, color] as const,
      );
      return (await coverage(page)).mean;
    };
    const hex = await mean('#ff7f50');
    const modern = await mean('color(srgb 1 0.498 0.314)');
    for (const c of ['r', 'g', 'b'] as const) expect(Math.abs(modern[c] - hex[c])).toBeLessThan(8);
  });

  test('renders a hex colour when canvas readback is blocked', async ({ page, context }) => {
    const mean = async (p: Page): Promise<{ r: number; g: number; b: number }> => {
      await p.evaluate(async (event) => {
        await window.__pollyrollTray.playRoll({
          ...event,
          skin: { material: 'plastic', color: '#ff7f50', labelColor: '#000' },
        });
        CanvasRenderingContext2D.prototype.getImageData = window.__getImageData;
      }, EVENT);
      return (await coverage(p)).mean;
    };
    const blocked = await context.newPage();
    await blocked.addInitScript(() => {
      const proto = CanvasRenderingContext2D.prototype;
      window.__getImageData = proto.getImageData;
      proto.getImageData = () => {
        throw new Error('canvas readback blocked');
      };
    });
    const errors = await open(blocked, '?reduced');
    const stubbed = await mean(blocked);
    await page.addInitScript(() => {
      window.__getImageData = CanvasRenderingContext2D.prototype.getImageData;
    });
    await open(page, '?reduced');
    const plain = await mean(page);
    expect(errors).toEqual([]);
    for (const c of ['r', 'g', 'b'] as const)
      expect(Math.abs(stubbed[c] - plain[c])).toBeLessThan(8);
  });

  test('never fades the dice when fadeAfterMs is Infinity', async ({ page }) => {
    await open(page, '?reduced');
    await page.evaluate(async (event) => {
      window.__pollyrollTray.dispose();
      const canvas = document.getElementById('tray');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #tray');
      const tray = window.__pollyrollCreate(canvas, {
        labelFont: 'sans-serif',
        reducedMotion: 'always',
        fadeAfterMs: Infinity,
      });
      await tray.playRoll(event);
      await new Promise((r) => setTimeout(r, 800));
    }, EVENT);
    expect((await coverage(page)).ink).toBeGreaterThan(0.005);
  });

  test('redraws the settled roll when a failing playRoll resized the drawing buffer', async ({
    page,
  }) => {
    await open(page, '?reduced');
    const error = await page.evaluate(async (invalid) => {
      // A DPR change resizes the buffer in playRoll without a ResizeObserver callback.
      Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
      return window.__pollyrollTray.playRoll(invalid).then(
        () => 'resolved',
        (e: unknown) => (e instanceof Error ? e.name : String(e)),
      );
    }, INVALID);
    expect(error).toBe('RangeError');
    expect((await coverage(page)).ink).toBeGreaterThan(0.005);
  });

  test('clears a user canvas on dispose', async ({ page }) => {
    await open(page, '?reduced');
    expect((await coverage(page)).ink).toBeGreaterThan(0.005);
    await page.evaluate(() => window.__pollyrollTray.dispose());
    expect((await coverage(page)).ink).toBe(0);
  });
});

test('a failing playRoll leaves the current roll animating and pending', async ({ page }) => {
  await page.goto('/smoke.html');
  await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 20_000 });
  await needsWebGL2(page);
  const result = await page.evaluate(
    async ([six, invalid]) => {
      const tray = window.__pollyrollTray;
      const t0 = performance.now();
      const first = tray
        .playRoll(six)
        .then((s) => ({ total: s.total, ms: performance.now() - t0 }));
      await new Promise((r) => setTimeout(r, 100));
      const error = await tray.playRoll(invalid).then(
        () => 'resolved',
        (e: unknown) => (e instanceof Error ? e.name : String(e)),
      );
      return { error, ...(await first) };
    },
    [SIX, INVALID] as const,
  );
  expect(result.error).toBe('RangeError');
  expect(result.total).toBe(21);
  expect(result.ms).toBeGreaterThan(300);
});

test('plays the track at 1.5× real time, clocked from the first drawn frame', async ({ page }) => {
  await page.goto('/smoke.html');
  await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 20_000 });
  await needsWebGL2(page);
  const d20: RollEvent = {
    ...EVENT,
    notation: '1d20',
    dice: [{ type: 'd20', value: 7, group: 0, wave: 0 }],
    modifier: 0,
  };
  const radii = slots(d20).map((b) => getPolyhedron(shapeOf(b.labelSet)).radius);
  const { totalSteps } = planRoll(d20, trayBounds(4 / 3, fitScale(2, radii, 4 / 3)));
  // At 1.0× the settle would come at least 0.5 s later than at 1.5×.
  expect(totalSteps).toBeGreaterThanOrEqual(180);
  const ms = await page.evaluate(async (event) => {
    const done = window.__pollyrollTray.playRoll(event);
    const first = await new Promise<number>(requestAnimationFrame);
    await done;
    return performance.now() - first;
  }, d20);
  expect(Math.abs(ms / 1000 - (totalSteps * DT) / PLAYBACK)).toBeLessThan(0.15);
});

test.describe('dropped dice', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'pixel comparison checked in Chromium',
  );

  test('fades the dropped die after settle and leaves kept dice unchanged', async ({ page }) => {
    const shot = async (query: string): Promise<string> => {
      await open(page, `?reduced&event=${query}`);
      return (await page.locator('#tray').screenshot()).toString('base64');
    };
    const all = await shot('all');
    const adv = await shot('adv');
    const dis = await shot('dis');
    const diff = await page.evaluate(
      async (shots) => {
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
        const [pa, pb, pc] = await Promise.all(shots.map(pixels));
        if (pa === undefined || pb === undefined || pc === undefined) throw new Error('no pixels');
        const n = pa.length / 4;
        const masks = [pb, pc].map((p) => {
          const mask = new Uint8Array(n);
          let lighter = 0;
          for (let i = 0; i < n; i++) {
            const sa = (pa[4 * i] ?? 0) + (pa[4 * i + 1] ?? 0) + (pa[4 * i + 2] ?? 0);
            const sb = (p[4 * i] ?? 0) + (p[4 * i + 1] ?? 0) + (p[4 * i + 2] ?? 0);
            if (Math.abs(sb - sa) <= 30) continue;
            mask[i] = 1;
            if (sb > sa) lighter++;
          }
          const changed = mask.reduce((sum, m) => sum + m, 0);
          return { mask, changed, lighter: changed === 0 ? 0 : lighter / changed };
        });
        const [adv, dis] = masks;
        if (adv === undefined || dis === undefined) throw new Error('no masks');
        let both = 0;
        for (let i = 0; i < n; i++) both += (adv.mask[i] ?? 0) & (dis.mask[i] ?? 0);
        return {
          changed: [adv.changed / n, dis.changed / n],
          lighter: [adv.lighter, dis.lighter],
          overlap: both / Math.max(1, Math.min(adv.changed, dis.changed)),
        };
      },
      [all, adv, dis],
    );
    for (const changed of diff.changed) expect(changed).toBeGreaterThan(0.003);
    for (const lighter of diff.lighter) expect(lighter).toBeGreaterThan(0.95);
    // adv and dis fade different dice, so their changed pixels barely meet.
    expect(diff.overlap).toBeLessThan(0.2);
  });

  test('fades a rerolled die once its replacement is thrown, before settle', async ({ page }) => {
    // Same dice, waves and seed, so both rolls move identically; only `r` drops the 1.
    const reroll: RollEvent = {
      ...EVENT,
      notation: '1d6r1',
      dice: [
        { type: 'd6', value: 1, group: 0, wave: 0 },
        { type: 'd6', value: 5, group: 0, wave: 1 },
      ],
      modifier: 0,
    };
    const explode: RollEvent = { ...reroll, notation: '1d6x' };
    const radii = slots(reroll).map((b) => getPolyhedron(shapeOf(b.labelSet)).radius);
    const plan = planRoll(reroll, trayBounds(4 / 3, fitScale(2, radii, 4 / 3)));
    const start = plan.bodies[1]?.startStep ?? NaN;
    // Fake rAF fires on a 16 ms grid, so a multiple of 16 lands both shots on the same step; the
    // clock starts at the first frame, 16 ms after playRoll.
    const atMs = 16 * Math.round((((start + plan.totalSteps) / 2) * DT * 1000) / PLAYBACK / 16);
    const atStep = ((atMs - 16) * PLAYBACK) / 1000 / DT;
    expect(atStep).toBeGreaterThan(start);
    expect(atStep).toBeLessThan(plan.totalSteps);
    await page.clock.install({ time: 0 });
    await page.goto('/smoke.html');
    await page.waitForFunction(() => window.__pollyroll.ready);
    await needsWebGL2(page);
    await page.clock.pauseAt(20_000);
    const shot = async (event: RollEvent): Promise<string> => {
      await page.evaluate((e) => void window.__pollyrollTray.playRoll(e), event);
      await page.clock.runFor(atMs);
      return (await page.locator('#tray').screenshot()).toString('base64');
    };
    const bright = await shot(explode);
    const faded = await shot(reroll);
    const diff = await page.evaluate(
      async (shots) => {
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
        const [pa, pb] = await Promise.all(shots.map(pixels));
        if (pa === undefined || pb === undefined) throw new Error('no pixels');
        const n = pa.length / 4;
        let changed = 0;
        let lighter = 0;
        for (let i = 0; i < n; i++) {
          const sa = (pa[4 * i] ?? 0) + (pa[4 * i + 1] ?? 0) + (pa[4 * i + 2] ?? 0);
          const sb = (pb[4 * i] ?? 0) + (pb[4 * i + 1] ?? 0) + (pb[4 * i + 2] ?? 0);
          if (Math.abs(sb - sa) <= 30) continue;
          changed++;
          if (sb > sa) lighter++;
        }
        return { changed: changed / n, lighter: changed === 0 ? 0 : lighter / changed };
      },
      [bright, faded],
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
    await needsWebGL2(page);
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
      // rAF callbacks run in order, so the tray has drawn its first frame before this one.
      await new Promise(requestAnimationFrame);
      const replaced = a.starts.length;
      void tray.playRoll(event);
      const stoppedOnReplace = a.stops;
      tray.clear();
      void tray.playRoll(event);
      const done = tray.playRoll(event);
      const beforeFirstFrame = a.starts.length - replaced;
      await done;
      const current = a.starts.length - replaced;
      const stoppedAtSettle = a.stops - stoppedOnReplace;
      tray.dispose();
      return {
        replaced,
        stoppedOnReplace,
        beforeFirstFrame,
        current,
        stoppedAtSettle,
        starts: a.starts,
        stops: a.stops,
        closes: a.closes,
      };
    }, EVENT);
    // The smoke canvas is 800 × 600 CSS pixels at the default dieScale 2.
    const radii = slots(EVENT).map((b) => getPolyhedron(shapeOf(b.labelSet)).radius);
    const bounds = trayBounds(4 / 3, fitScale(2, radii, 4 / 3));
    const end = (planRoll(EVENT, bounds).totalSteps * DT) / PLAYBACK + 0.1;
    expect(replay.replaced).toBeGreaterThan(0);
    expect(replay.stoppedOnReplace).toBe(replay.replaced);
    // Rolls replaced or cleared before their first frame schedule nothing.
    expect(replay.beforeFirstFrame).toBe(0);
    expect(replay.current).toBeGreaterThan(0);
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
    await needsWebGL2(page);
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

test.describe('tray accessibility', () => {
  test('labels the canvas with the settled result and never with a replaced roll', async ({
    page,
  }) => {
    await page.goto('/smoke.html');
    await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 20_000 });
    await needsWebGL2(page);
    const labels = await page.evaluate(
      async ([six, event]) => {
        const canvas = document.getElementById('tray');
        if (canvas === null) throw new Error('missing #tray');
        const tray = window.__pollyrollTray;
        await tray.playRoll(event);
        const seen: (string | null)[] = [];
        const record = (ms: MutationRecord[]): void => {
          for (const m of ms) seen.push(m.oldValue);
        };
        const observer = new MutationObserver(record);
        observer.observe(canvas, { attributeFilter: ['aria-label'], attributeOldValue: true });
        await Promise.all([tray.playRoll(six), tray.playRoll(event)]);
        record(observer.takeRecords());
        observer.disconnect();
        const final = canvas.getAttribute('aria-label');
        return { seen: [...seen, final], final };
      },
      [SIX, EVENT] as const,
    );
    expect(labels.final).toBe('2d6+3: [2, 5] + 3 = 10');
    expect(labels.seen).not.toContain('6d6: [1, 2, 3, 4, 5, 6] = 21');
    expect(labels.seen[0]).toBe('2d6+3: [2, 5] + 3 = 10');
  });

  test('resets the label while a new roll animates', async ({ page }) => {
    await page.goto('/smoke.html');
    await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 20_000 });
    await needsWebGL2(page);
    const labels = await page.evaluate(
      async ([a, b, invalid]) => {
        window.__pollyrollTray.dispose();
        const host = document.createElement('div');
        host.style.cssText = 'width:800px;height:600px';
        document.body.append(host);
        const tray = window.__pollyrollCreate(host, { announce: true, reducedMotion: 'never' });
        const canvas = host.querySelector('canvas');
        const live = host.querySelector('[role="status"]');
        if (canvas === null || live === null) throw new Error('missing canvas or live region');
        const read = (): [string | null, string | null] => [
          canvas.getAttribute('aria-label'),
          live.textContent,
        ];
        await tray.playRoll(a);
        await tray.playRoll(invalid).catch(() => undefined);
        const afterInvalid = read();
        const next = tray.playRoll(b);
        const animating = read();
        await next;
        return { afterInvalid, animating, settled: read() };
      },
      [EVENT, SIX, INVALID] as const,
    );
    expect(labels.afterInvalid).toEqual(['2d6+3: [2, 5] + 3 = 10', '2d6+3: [2, 5] + 3 = 10']);
    expect(labels.animating).toEqual(['Dice tray', '']);
    expect(labels.settled).toEqual([
      '6d6: [1, 2, 3, 4, 5, 6] = 21',
      '6d6: [1, 2, 3, 4, 5, 6] = 21',
    ]);
  });
});
