import { describe, expect, it } from 'vitest';
import {
  labelIndex,
  labelText,
  labelUnderline,
  readoutForValue,
  readoutNumbers,
  shapeOf,
} from './labels';
import type { LabelSet } from './labels';
import { getPolyhedron } from './polyhedra';
import type { ShapeType } from './polyhedra';
import type { Vec3 } from './vec';

const MINUS = '−';

function at<T>(list: readonly T[], i: number): T {
  const item = list[i];
  if (item === undefined) throw new Error(`index ${i} out of range`);
  return item;
}

function close(a: Vec3, b: Vec3): boolean {
  return (
    Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9
  );
}

function oppositeIndex(shape: ShapeType, i: number): number {
  const readouts = getPolyhedron(shape).readouts;
  const r = at(readouts, i);
  const j = readouts.findIndex((o) => close(o, [-r[0], -r[1], -r[2]]));
  if (j < 0) throw new Error(`no opposite readout for ${shape} ${i}`);
  return j;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to; v++) out.push(v);
  return out;
}

/** Every value a set can show, with the text the face must carry (from PLAN.md § 2). */
const VALUES: Record<LabelSet, [number, string][]> = {
  d4: range(1, 4).map((v) => [v, String(v)]),
  d6: range(1, 6).map((v) => [v, String(v)]),
  d8: range(1, 8).map((v) => [v, String(v)]),
  d10: range(1, 10).map((v) => [v, v === 10 ? '0' : String(v)]),
  d12: range(1, 12).map((v) => [v, String(v)]),
  d20: range(1, 20).map((v) => [v, String(v)]),
  d100tens: [
    [0, '00'],
    [1, '10'],
    [2, '20'],
    [3, '30'],
    [4, '40'],
    [5, '50'],
    [6, '60'],
    [7, '70'],
    [8, '80'],
    [9, '90'],
  ],
  d100ones: range(0, 9).map((v) => [v, String(v)]),
  dF: [
    [-1, MINUS],
    [0, ''],
    [1, '+'],
  ],
};

const SETS = Object.keys(VALUES) as LabelSet[];

describe('labels', () => {
  it('maps label sets to shapes', () => {
    expect(SETS.map(shapeOf)).toEqual(['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd10', 'd10', 'd6']);
  });

  it('numbers d4 vertices 1-4 in vertex order', () => {
    expect(readoutNumbers('d4')).toEqual([1, 2, 3, 4]);
  });

  it('numbers d6 faces by their explicit normals', () => {
    const expected: [Vec3, number][] = [
      [[0, 1, 0], 1],
      [[0, 0, 1], 2],
      [[1, 0, 0], 3],
      [[-1, 0, 0], 4],
      [[0, 0, -1], 5],
      [[0, -1, 0], 6],
    ];
    const readouts = getPolyhedron('d6').readouts;
    const numbers = readoutNumbers('d6');
    for (const [normal, n] of expected) {
      const i = readouts.findIndex((r) => close(r, normal));
      expect(i).toBeGreaterThanOrEqual(0);
      expect(numbers[i]).toBe(n);
    }
  });

  const OPPOSITE_SUM: [ShapeType, number, number[]][] = [
    ['d6', 7, range(1, 6)],
    ['d8', 9, range(1, 8)],
    ['d10', 9, range(0, 9)],
    ['d12', 13, range(1, 12)],
    ['d20', 21, range(1, 20)],
  ];
  for (const [shape, sum, all] of OPPOSITE_SUM) {
    it(`gives ${shape} opposite faces summing to ${sum}, each number once`, () => {
      const numbers = readoutNumbers(shape);
      expect([...numbers].sort((a, b) => a - b)).toEqual(all);
      numbers.forEach((n, i) => {
        expect(n + at(numbers, oppositeIndex(shape, i))).toBe(sum);
      });
    });
  }

  it('gives the lowest numbers to the earliest faces (walk order)', () => {
    for (const shape of ['d8', 'd12', 'd20'] as const) {
      expect(readoutNumbers(shape)[0]).toBe(1);
    }
    expect(readoutNumbers('d10')[0]).toBe(0);
  });

  for (const set of SETS) {
    it(`round-trips every ${set} value through readoutForValue and labelText`, () => {
      const seen = new Set<number>();
      for (const [value, text] of VALUES[set]) {
        const r = readoutForValue(set, value);
        expect(labelText(set, r)).toBe(text);
        seen.add(r);
      }
      expect(seen.size).toBe(VALUES[set].length);
    });
  }

  /** Natural label index of each value: d4..d20 value − 1; d10/d100 digit; dF −1/0/+1 → 0/1/2. */
  const NATURAL: Record<LabelSet, (value: number) => number> = {
    d4: (v) => v - 1,
    d6: (v) => v - 1,
    d8: (v) => v - 1,
    d10: (v) => v % 10,
    d12: (v) => v - 1,
    d20: (v) => v - 1,
    d100tens: (v) => v,
    d100ones: (v) => v,
    dF: (v) => v + 1,
  };
  for (const set of SETS) {
    it(`gives every ${set} readout its natural label index`, () => {
      for (const [value] of VALUES[set]) {
        expect(labelIndex(set, readoutForValue(set, value)), `${set} ${value}`).toBe(
          NATURAL[set](value),
        );
      }
      const indexes = readoutNumbers(shapeOf(set)).map((_, i) => labelIndex(set, i));
      const count = set === 'dF' ? 3 : indexes.length;
      expect([...new Set(indexes)].sort((a, b) => a - b)).toEqual(range(0, count - 1));
    });
  }

  it('labels dF faces minus, minus, blank, blank, plus, plus with opposite signs', () => {
    const texts = readoutNumbers('d6').map((_, i) => labelText('dF', i));
    expect([...texts].sort()).toEqual(['', '', '+', '+', MINUS, MINUS].sort());
    texts.forEach((t, i) => {
      const o = at(texts, oppositeIndex('d6', i));
      if (t === MINUS) expect(o).toBe('+');
      if (t === '+') expect(o).toBe(MINUS);
      if (t === '') expect(o).toBe('');
    });
  });

  it('underlines 6 and 9 on d10, d12, d20, and d100 ones only', () => {
    const underlined = (set: LabelSet, value: number): boolean =>
      labelUnderline(set, readoutForValue(set, value));
    for (const set of ['d10', 'd12', 'd20', 'd100ones'] as const) {
      expect(underlined(set, 6)).toBe(true);
      expect(underlined(set, 9)).toBe(true);
      expect(underlined(set, 1)).toBe(false);
    }
    expect(underlined('d10', 10)).toBe(false);
    expect(underlined('d12', 12)).toBe(false);
    expect(underlined('d20', 16)).toBe(false);
    expect(underlined('d20', 19)).toBe(false);
    expect(underlined('d4', 4)).toBe(false);
    expect(underlined('d6', 6)).toBe(false);
    expect(underlined('d8', 6)).toBe(false);
    expect(underlined('d100tens', 6)).toBe(false);
    expect(underlined('d100tens', 9)).toBe(false);
    expect(underlined('dF', 1)).toBe(false);
    for (const set of SETS) {
      const count = readoutNumbers(shapeOf(set)).filter((_, i) => labelUnderline(set, i)).length;
      expect(count, set).toBe(['d10', 'd12', 'd20', 'd100ones'].includes(set) ? 2 : 0);
    }
  });

  it('throws RangeError for values a set cannot show', () => {
    const bad: [LabelSet, number][] = [
      ['d4', 0],
      ['d4', 5],
      ['d4', 1.5],
      ['d6', 7],
      ['d8', 9],
      ['d10', 0],
      ['d10', 11],
      ['d10', 20],
      ['d10', 2.5],
      ['d12', 13],
      ['d20', 0],
      ['d20', Number.NaN],
      ['d100tens', -1],
      ['d100tens', 10],
      ['d100ones', 10],
      ['dF', 2],
      ['dF', -2],
      ['dF', 0.5],
    ];
    for (const [set, value] of bad) {
      expect(() => readoutForValue(set, value), `${set} ${value}`).toThrow(RangeError);
    }
  });

  it('throws RangeError for readout indexes out of range', () => {
    expect(() => labelText('d6', 6)).toThrow(RangeError);
    expect(() => labelText('d20', -1)).toThrow(RangeError);
    expect(() => labelUnderline('d4', 4)).toThrow(RangeError);
    expect(() => labelIndex('dF', 6)).toThrow(RangeError);
  });
});
