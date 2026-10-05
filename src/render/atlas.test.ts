import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAtlas } from './atlas';

/** Families the fake 2D context can parse; any other font assignment is ignored, as in browsers. */
const PARSABLE = new Set(['serif', 'Requested', 'TrayFont', 'system-ui']);

/** Stubs `document` with a canvas whose 2D context records ctx.font at every fillText. */
function fakeCanvas(): string[] {
  const drawnWith: string[] = [];
  let font = '10px sans-serif';
  const ctx = {
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    get font(): string {
      return font;
    },
    set font(value: string) {
      const match = /^(?:bold )?\d+(?:\.\d+)?px (.+)$/.exec(value);
      if (match?.[1] !== undefined && PARSABLE.has(match[1])) font = value;
    },
    measureText: () => ({
      actualBoundingBoxAscent: 50,
      actualBoundingBoxDescent: 10,
      actualBoundingBoxLeft: 20,
      actualBoundingBoxRight: 20,
    }),
    fillText: () => drawnWith.push(font),
    fillRect: () => undefined,
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  vi.stubGlobal('document', { createElement: () => canvas });
  return drawnWith;
}

/** Font families (the part after the size) of the recorded fonts. */
const families = (fonts: string[]): Set<string> =>
  new Set(fonts.map((f) => f.replace(/^bold \S+px /, '')));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildAtlas font fallback', () => {
  it('draws with the requested font when the context accepts it', () => {
    const drawnWith = fakeCanvas();
    buildAtlas('Requested', {}, 'TrayFont');
    expect(drawnWith.length).toBeGreaterThan(0);
    expect(families(drawnWith)).toEqual(new Set(['Requested']));
  });

  it('falls back to the tray label font when the requested font does not parse', () => {
    const drawnWith = fakeCanvas();
    buildAtlas('"unclosed', {}, 'TrayFont');
    expect(families(drawnWith)).toEqual(new Set(['TrayFont']));
  });

  it('falls back to system-ui when neither font parses', () => {
    const drawnWith = fakeCanvas();
    buildAtlas('"unclosed', {}, '1px;');
    expect(families(drawnWith)).toEqual(new Set(['system-ui']));
  });

  it('defaults the fallback to system-ui', () => {
    const drawnWith = fakeCanvas();
    buildAtlas('"unclosed');
    expect(families(drawnWith)).toEqual(new Set(['system-ui']));
  });
});
