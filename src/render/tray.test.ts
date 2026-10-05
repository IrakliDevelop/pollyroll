// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RollEvent } from '../core/types';
import { classic } from '../skins/presets';
import type { Skin } from '../skins/types';
import type * as Atlas from './atlas';
import type { CustomLabels } from './atlas';
import { PollyrollShaderError } from './gl';
import { createDiceTray } from './tray';
import type { DiceTray } from './tray';

const event: RollEvent = {
  v: 1,
  id: 'tray-test',
  notation: '2d6+3',
  dice: [
    { type: 'd6', value: 2, group: 0, wave: 0 },
    { type: 'd6', value: 5, group: 0, wave: 0 },
  ],
  modifier: 3,
  seed: '0123456789abcdef0123456789abcdef',
  createdAt: 0,
};

/** Fonts passed to the glyph atlas builder, in call order. */
const atlasFonts = vi.hoisted((): string[] => []);
vi.mock('./atlas', async (importOriginal) => {
  const actual = await importOriginal<typeof Atlas>();
  return {
    ...actual,
    buildAtlas: (font: string, labels?: CustomLabels): HTMLCanvasElement | null => {
      atlasFonts.push(font);
      return actual.buildAtlas(font, labels);
    },
  };
});

/** Run after each test: removes listeners added on shared globals. */
const cleanups: (() => void)[] = [];

function noWebGl(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
}

afterEach(() => {
  for (const undo of cleanups.splice(0)) undo();
  atlasFonts.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('createDiceTray without WebGL2', () => {
  it('is unsupported and resolves playRoll immediately with the summary', async () => {
    noWebGl();
    const tray = createDiceTray(document.createElement('canvas'));
    expect(tray.supported).toBe(false);
    const summary = await tray.playRoll(event);
    expect(summary.total).toBe(10);
  });

  it('adds an overlay canvas to an element target and removes it on dispose', () => {
    noWebGl();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const tray = createDiceTray(host);
    const canvas = host.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.style.position).toBe('absolute');
    expect(canvas?.style.pointerEvents).toBe('none');
    tray.dispose();
    tray.dispose();
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('never removes a canvas target and resolves rolls after dispose', async () => {
    noWebGl();
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const tray = createDiceTray(canvas);
    tray.dispose();
    expect(canvas.isConnected).toBe(true);
    expect((await tray.playRoll(event)).total).toBe(10);
  });
});

/**
 * WebGL2 stand-in: every member is a no-op function returning a truthy handle; no 2D context.
 * A shader whose source contains BROKEN fails to compile. Returns the members called, in order,
 * with shader sources recorded as 'shaderSource:<source>'.
 */
function fakeWebGl(): string[] {
  const calls: string[] = [];
  let source = '';
  const gl: unknown = new Proxy(
    {},
    {
      get:
        (_, name) =>
        (...args: unknown[]): unknown => {
          if (name === 'shaderSource') source = String(args[1]);
          calls.push(name === 'shaderSource' ? `shaderSource:${source}` : String(name));
          if (name === 'getShaderParameter') return !source.includes('BROKEN');
          if (name === 'getShaderInfoLog') return 'fake log';
          return {};
        },
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((id: string) =>
    id === 'webgl2' ? gl : null) as typeof HTMLCanvasElement.prototype.getContext);
  return calls;
}

/** Resolves with `p`'s value, or 'pending' when it is still unsettled after 20 ms. */
function within20ms<T>(p: Promise<T>): Promise<T | 'pending'> {
  return Promise.race([
    p,
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 20)),
  ]);
}

describe('createDiceTray context loss', () => {
  it('resolves a pending roll with its summary when the context is lost mid-animation', async () => {
    fakeWebGl();
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const canvas = document.createElement('canvas');
    const tray = createDiceTray(canvas, { reducedMotion: 'never' });
    expect(tray.supported).toBe(true);
    const done = tray.playRoll(event);
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    const result = await within20ms(done);
    expect(result === 'pending' ? 'pending' : result.total).toBe(10);
    tray.dispose();
  });

  it('resolves playRoll immediately while lost and draws the dice on restore', async () => {
    const calls = fakeWebGl();
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const canvas = document.createElement('canvas');
    const tray = createDiceTray(canvas, { reducedMotion: 'never' });
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    calls.length = 0;
    const result = await within20ms(tray.playRoll(event));
    expect(result === 'pending' ? 'pending' : result.total).toBe(10);
    expect(calls).not.toContain('drawArraysInstanced');
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(calls).toContain('drawArraysInstanced');
    tray.dispose();
  });

  it('does not draw a roll cleared while the context was lost', async () => {
    const calls = fakeWebGl();
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const canvas = document.createElement('canvas');
    const tray = createDiceTray(canvas, { reducedMotion: 'never' });
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    await within20ms(tray.playRoll(event));
    tray.clear();
    calls.length = 0;
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(calls).toContain('clear');
    expect(calls).not.toContain('drawArraysInstanced');
    tray.dispose();
  });

  const broken = {
    material: 'plastic',
    color: '#fff',
    labelColor: '#000',
    pattern: { glsl: 'BROKEN' },
  } as const;

  /** Reduced-motion tray without shadows whose context is lost; window errors are collected. */
  function lostTray(): { canvas: HTMLCanvasElement; tray: DiceTray; errors: unknown[] } {
    const canvas = document.createElement('canvas');
    const tray = createDiceTray(canvas, { reducedMotion: 'always', shadows: false });
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent): void => {
      errors.push(e.error);
    };
    window.addEventListener('error', onError);
    cleanups.push(() => window.removeEventListener('error', onError));
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    return { canvas, tray, errors };
  }

  it('drops an invalid skin set while lost and keeps drawing with the previous skin', async () => {
    const calls = fakeWebGl();
    const { canvas, tray, errors } = lostTray();
    expect((await tray.playRoll(event)).total).toBe(10);
    expect(() => tray.setSkin(broken)).not.toThrow();
    calls.length = 0;
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(errors).toEqual([]);
    expect(calls).toContain('drawArraysInstanced');
    expect(() => tray.setSkin(broken)).toThrow(PollyrollShaderError);
    tray.dispose();
  });

  it('rejects a skin that cannot be resolved in setSkin while lost, not on restore', async () => {
    const calls = fakeWebGl();
    const { canvas, tray, errors } = lostTray();
    await tray.playRoll(event);
    const bogus = { ...classic, material: 'bogus' } as unknown as Skin;
    expect(() => tray.setSkin(bogus)).toThrow();
    calls.length = 0;
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(errors).toEqual([]);
    expect(calls).toContain('drawArraysInstanced');
    tray.dispose();
  });

  it('applies a valid skin set while lost on restore', async () => {
    const calls = fakeWebGl();
    const { canvas, tray } = lostTray();
    await tray.playRoll(event);
    tray.setSkin({
      ...broken,
      pattern: { glsl: 'vec3 pattern(vec3 p, vec3 n, vec3 a, vec3 b) { return b; } // MARK' },
    });
    expect(calls.some((c) => c.includes('MARK'))).toBe(false);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(calls.some((c) => c.includes('MARK'))).toBe(true);
    tray.dispose();
  });

  it('falls back to the tray skin when an event skin played while lost fails on restore', async () => {
    const calls = fakeWebGl();
    const { canvas, tray, errors } = lostTray();
    expect((await tray.playRoll({ ...event, skin: broken })).total).toBe(10);
    calls.length = 0;
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(errors).toEqual([]);
    expect(calls).toContain('drawArraysInstanced');
    tray.dispose();
  });
});

describe('createDiceTray label font', () => {
  it('builds the atlas from skin.font, then labelFont, and rebuilds it when the font changes', async () => {
    const calls = fakeWebGl();
    const tray = createDiceTray(document.createElement('canvas'), {
      reducedMotion: 'always',
      labelFont: 'TrayFont',
    });
    expect(atlasFonts).toEqual(['TrayFont']);
    await tray.playRoll(event);
    expect(atlasFonts).toEqual(['TrayFont']);
    expect(calls.filter((c) => c === 'createTexture')).toHaveLength(1);

    calls.length = 0;
    tray.setSkin({ ...classic, font: 'SkinFont' });
    expect(atlasFonts).toEqual(['TrayFont', 'SkinFont']);
    expect(calls).toContain('deleteTexture');
    expect(calls).toContain('createTexture');

    calls.length = 0;
    tray.setSkin({ ...classic, labelColor: '#123', font: 'SkinFont' });
    expect(atlasFonts).toEqual(['TrayFont', 'SkinFont']);
    expect(calls).not.toContain('deleteTexture');

    await tray.playRoll({ ...event, skin: { ...classic, font: 'EventFont' } });
    expect(atlasFonts).toEqual(['TrayFont', 'SkinFont', 'EventFont']);
    await tray.playRoll({ ...event, skin: 'classic' });
    expect(atlasFonts).toEqual(['TrayFont', 'SkinFont', 'EventFont', 'TrayFont']);
    tray.dispose();
  });

  it('defaults the atlas font to system-ui', () => {
    fakeWebGl();
    createDiceTray(document.createElement('canvas')).dispose();
    expect(atlasFonts).toEqual(['system-ui']);
  });
});
