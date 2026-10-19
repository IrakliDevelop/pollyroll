import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAtlas, LABEL_SETS } from './atlas';
import { ATLAS_ROWS } from './shaders';

/** Families the fake 2D context can parse; any other font assignment is ignored, as in browsers. */
const PARSABLE = new Set(['serif', 'Requested', 'TrayFont', 'system-ui']);

interface Drawn {
  font: string;
  text: string;
  x: number;
  y: number;
}

/** Stubs `document` with a canvas whose 2D context records ctx.font and the text at every fillText. */
function fakeCanvas(): Drawn[] {
  const drawnWith: Drawn[] = [];
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
    fillText: (text: string, x: number, y: number) => drawnWith.push({ font, text, x, y }),
    fillRect: () => undefined,
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  vi.stubGlobal('document', { createElement: () => canvas });
  return drawnWith;
}

/** Font families (the part after the size) of the recorded fonts. */
const families = (drawn: Drawn[]): Set<string> =>
  new Set(drawn.map((d) => d.font.replace(/^bold \S+px /, '')));

/** Text drawn in atlas cell (column, row) of 128 px cells. */
const cellText = (drawn: Drawn[], column: number, row: number): string | undefined =>
  drawn.find((d) => Math.floor(d.x / 128) === column && Math.floor(d.y / 128) === row)?.text;

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

describe('buildAtlas coin rows', () => {
  it('appends d2 and dc after the existing rows', () => {
    expect(LABEL_SETS).toEqual([
      'd4',
      'd6',
      'd8',
      'd10',
      'd12',
      'd20',
      'd100tens',
      'd100ones',
      'dF',
      'd2',
      'dc',
    ]);
    expect(ATLAS_ROWS).toBe(11);
  });

  it('draws d2 as 1, 2 and dc as T, H in natural order', () => {
    const drawn = fakeCanvas();
    buildAtlas('Requested');
    expect([cellText(drawn, 0, 9), cellText(drawn, 1, 9)]).toEqual(['1', '2']);
    expect([cellText(drawn, 0, 10), cellText(drawn, 1, 10)]).toEqual(['T', 'H']);
  });

  it('draws custom dc labels in natural order', () => {
    const drawn = fakeCanvas();
    buildAtlas('Requested', { dc: ['Tails', 'Heads'] });
    expect([cellText(drawn, 0, 10), cellText(drawn, 1, 10)]).toEqual(['Tails', 'Heads']);
  });
});
