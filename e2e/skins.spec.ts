import { expect, test } from '@playwright/test';

const PRESETS = [
  'classic',
  'obsidian',
  'brass',
  'oak',
  'sapphire',
  'ruby',
  'emerald',
  'amethyst',
  'topaz',
  'aquamarine',
  'smoke',
];

test.describe('skins', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'screenshot baselines are Chromium only',
  );

  for (const name of PRESETS) {
    test(`renders the ${name} preset`, async ({ page }) => {
      // Reduced motion draws the static settled frame of the fixed smoke event.
      await page.goto(`/smoke.html?reduced&skin=${name}`);
      await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 10_000 });
      expect(await page.evaluate(() => window.__pollyroll.supported)).toBe(true);
      await expect(page.locator('#tray')).toHaveScreenshot(`skin-${name}.png`);
    });
  }

  test('renders a custom MaterialParams gem see-through', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/smoke.html?reduced');
    await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 10_000 });
    const tray = page.locator('#tray');
    const shot = async (transmission: number): Promise<Buffer> => {
      await page.evaluate(
        (t) =>
          window.__pollyrollTray.setSkin({
            material: {
              metalness: 0,
              roughness: 0.06,
              clearcoat: 1,
              transmission: t,
              tint: 0.8,
              sparkle: 0.5,
            },
            color: '#2a8c5a',
            labelColor: '#ffffff',
          }),
        transmission,
      );
      return tray.screenshot();
    };
    const gem = await shot(0.7);
    const opaque = await shot(0);
    await page.evaluate(() => window.__pollyrollTray.clear());
    const blank = await tray.screenshot();
    expect(errors).toEqual([]);
    expect(gem.equals(blank)).toBe(false);
    expect(gem.equals(opaque)).toBe(false);
  });

  test('setSkin throws PollyrollShaderError for invalid custom GLSL', async ({ page }) => {
    await page.goto('/smoke.html?reduced');
    await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 10_000 });
    const result = await page.evaluate(async () => {
      const tray = window.__pollyrollTray;
      const base = { material: 'plastic', color: '#fff', labelColor: '#000' } as const;
      let invalid: { name: string; log: string } | null = null;
      try {
        tray.setSkin({ ...base, pattern: { glsl: 'vec3 pattern(' } });
      } catch (error) {
        const e = error as { name?: unknown; log?: unknown };
        invalid = { name: String(e.name), log: String(e.log) };
      }
      // The tray keeps its skin and still plays rolls after the failed setSkin.
      const after = await tray.playRoll({
        v: 1,
        id: 'after-invalid-skin',
        notation: '1d6',
        dice: [{ type: 'd6', value: 3, group: 0, wave: 0 }],
        modifier: 0,
        seed: '0123456789abcdef0123456789abcdef',
        createdAt: 0,
      });
      let valid: string | null = null;
      try {
        tray.setSkin({
          ...base,
          pattern: {
            glsl: 'vec3 pattern(vec3 p, vec3 n, vec3 a, vec3 b){ return p.y > 0.0 ? a : b; }',
          },
        });
      } catch (error) {
        valid = String(error);
      }
      return { invalid, total: after.total, valid };
    });
    expect(result.invalid?.name).toBe('PollyrollShaderError');
    expect(result.total).toBe(3);
    expect(result.invalid?.log.length).toBeGreaterThan(0);
    expect(result.valid).toBeNull();
  });

  test('playRoll rejects with PollyrollShaderError for an invalid event skin', async ({ page }) => {
    await page.goto('/smoke.html?reduced');
    await page.waitForFunction(() => window.__pollyroll.settled, undefined, { timeout: 10_000 });
    const name = await page.evaluate(async () => {
      try {
        await window.__pollyrollTray.playRoll({
          v: 1,
          id: 'bad-skin',
          notation: '1d6',
          dice: [{ type: 'd6', value: 3, group: 0, wave: 0 }],
          modifier: 0,
          seed: '0123456789abcdef0123456789abcdef',
          createdAt: 0,
          skin: { material: 'plastic', color: '#fff', labelColor: '#000', pattern: { glsl: 'x' } },
        });
        return 'resolved';
      } catch (error) {
        return String((error as { name?: unknown }).name);
      }
    });
    expect(name).toBe('PollyrollShaderError');
  });
});
