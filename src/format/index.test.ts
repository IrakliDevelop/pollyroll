import { describe, expect, it } from 'vitest';
import { evaluate } from '../core/evaluate';
import type { DieType, RollEvent } from '../core/types';
import { formatRoll } from './index';

type Die = [type: DieType, value: number | null, group?: number, wave?: number];

const ev = (notation: string, modifier: number, dice: Die[]): RollEvent => ({
  v: 1,
  id: 'id',
  notation,
  dice: dice.map(([type, value, group = 0, wave = 0]) => ({ type, value, group, wave })),
  modifier,
  seed: '0123456789abcdef0123456789abcdef',
  createdAt: 0,
});

describe('formatRoll', () => {
  it.each([
    [
      'marks dropped dice in parentheses',
      ev('2d20kh1+5', 5, [
        ['d20', 7],
        ['d20', 15],
      ]),
      '2d20kh1+5: [(7), 15] + 5 = 20',
    ],
    [
      'joins a subtracted group with a minus',
      ev('1d20-1d4+2', 2, [
        ['d20', 12],
        ['d4', 4, 1],
      ]),
      '1d20-1d4+2: [12] - [4] + 2 = 10',
    ],
    ['prefixes a subtracted first group', ev('-1d4+10', 10, [['d4', 3]]), '-1d4+10: -[3] + 10 = 7'],
    [
      'appends the success comparison and count',
      ev('5d10>=7+1', 1, [
        ['d10', 8],
        ['d10', 3],
        ['d10', 9],
        ['d10', 7],
        ['d10', 1],
      ]),
      '5d10>=7+1: [8, 3, 9, 7, 1]>=7: 3 + 1 = 4',
    ],
    [
      'lists a rerolled die as dropped and its replacement',
      ev('4d6r1', 0, [
        ['d6', 1],
        ['d6', 4],
        ['d6', 5],
        ['d6', 6],
        ['d6', 3, 0, 1],
      ]),
      '4d6r1: [(1), 4, 5, 6, 3] = 18',
    ],
    [
      'writes fudge values as signed numbers',
      ev('4dF', 0, [
        ['dF', -1],
        ['dF', 0],
        ['dF', 1],
        ['dF', 1],
      ]),
      '4dF: [-1, 0, 1, 1] = 1',
    ],
    [
      'writes redacted values and total as ?',
      ev('2d6-1', -1, [
        ['d6', null],
        ['d6', null],
      ]),
      '2d6-1: [?, ?] - 1 = ?',
    ],
    [
      'writes a redacted success count as ?',
      ev('2d6>=5', 0, [
        ['d6', null],
        ['d6', null],
      ]),
      '2d6>=5: [?, ?]>=5: ? = ?',
    ],
  ])('%s', (_, event, text) => {
    expect(formatRoll(event, evaluate(event))).toBe(text);
  });
});
