import { describe, expect, it } from 'vitest';
import { parse, PollyrollSyntaxError } from './notation';
import type { DieType, RollTerm } from './types';

function dice(
  sign: 1 | -1,
  count: number,
  die: DieType,
  keep: { mode: 'kh' | 'kl' | 'dh' | 'dl'; n: number } | null = null,
  explode = false,
): RollTerm {
  return { kind: 'dice', sign, count, die, keep, explode };
}

function constant(sign: 1 | -1, value: number): RollTerm {
  return { kind: 'constant', sign, value };
}

function errorOf(input: unknown): PollyrollSyntaxError {
  try {
    parse(input as string);
  } catch (error) {
    if (error instanceof PollyrollSyntaxError) return error;
    throw error;
  }
  throw new Error(`expected parse(${JSON.stringify(input)}) to throw`);
}

describe('parse', () => {
  it('parses dice with keep and a constant', () => {
    expect(parse('2d20kh1+5')).toEqual({
      terms: [dice(1, 2, 'd20', { mode: 'kh', n: 1 }), constant(1, 5)],
    });
  });

  it('parses every die size', () => {
    const sizes: [string, DieType][] = [
      ['d4', 'd4'],
      ['d6', 'd6'],
      ['d8', 'd8'],
      ['d10', 'd10'],
      ['d12', 'd12'],
      ['d20', 'd20'],
      ['d100', 'd100'],
    ];
    for (const [text, die] of sizes) {
      expect(parse(`3${text}`)).toEqual({ terms: [dice(1, 3, die)] });
    }
  });

  it('treats d% as d100 with an implicit count of 1', () => {
    expect(parse('d%')).toEqual({ terms: [dice(1, 1, 'd100')] });
  });

  it('parses fudge dice case-insensitively', () => {
    expect(parse('dF')).toEqual({ terms: [dice(1, 1, 'dF')] });
    expect(parse('df')).toEqual({ terms: [dice(1, 1, 'dF')] });
    expect(parse('4dF')).toEqual({ terms: [dice(1, 4, 'dF')] });
  });

  it('is case-insensitive', () => {
    expect(parse('D6')).toEqual({ terms: [dice(1, 1, 'd6')] });
    expect(parse('4D6KH3')).toEqual({ terms: [dice(1, 4, 'd6', { mode: 'kh', n: 3 })] });
  });

  it('ignores whitespace everywhere', () => {
    expect(parse(' 4 d 6 ! k h 3 ')).toEqual({
      terms: [dice(1, 4, 'd6', { mode: 'kh', n: 3 }, true)],
    });
    expect(parse('2 d 2 0')).toEqual(parse('2d20'));
    expect(parse('\t1d6\n+\r2')).toEqual({ terms: [dice(1, 1, 'd6'), constant(1, 2)] });
  });

  it('reads signs between terms and a leading sign', () => {
    expect(parse('-1d4+2-3')).toEqual({
      terms: [dice(-1, 1, 'd4'), constant(1, 2), constant(-1, 3)],
    });
    expect(parse('+3+1d6')).toEqual({ terms: [constant(1, 3), dice(1, 1, 'd6')] });
  });

  it('expands adv and dis', () => {
    expect(parse('adv+1d4')).toEqual({
      terms: [dice(1, 2, 'd20', { mode: 'kh', n: 1 }), dice(1, 1, 'd4')],
    });
    expect(parse('DIS')).toEqual({ terms: [dice(1, 2, 'd20', { mode: 'kl', n: 1 })] });
    expect(parse('1d4-adv')).toEqual({
      terms: [dice(1, 1, 'd4'), dice(-1, 2, 'd20', { mode: 'kh', n: 1 })],
    });
  });

  it('parses every keep mode and defaults n to 1', () => {
    expect(parse('4d6dl')).toEqual({ terms: [dice(1, 4, 'd6', { mode: 'dl', n: 1 })] });
    expect(parse('4d6dh2')).toEqual({ terms: [dice(1, 4, 'd6', { mode: 'dh', n: 2 })] });
    expect(parse('4d6kl')).toEqual({ terms: [dice(1, 4, 'd6', { mode: 'kl', n: 1 })] });
    expect(parse('4d6kh4')).toEqual({ terms: [dice(1, 4, 'd6', { mode: 'kh', n: 4 })] });
    expect(parse('4dFkh2')).toEqual({ terms: [dice(1, 4, 'dF', { mode: 'kh', n: 2 })] });
  });

  it('accepts suffixes in any order', () => {
    const expected = { terms: [dice(1, 4, 'd6', { mode: 'kl', n: 2 }, true)] };
    expect(parse('4d6kl2!')).toEqual(expected);
    expect(parse('4d6!kl2')).toEqual(expected);
  });

  it.each([
    ['4d6k3', '4d6kh3'],
    ['2d20k', '2d20kh1'],
    ['4D6K3', '4d6kh3'],
    ['4d6d1', '4d6dl1'],
    ['4d6d', '4d6dl1'],
    ['4 d 6 d 2', '4d6dl2'],
    ['3d6x', '3d6!'],
    ['3D6X', '3d6!'],
    ['4d6kx', '4d6kh1!'],
    ['4d6xd', '4d6!dl1'],
    ['4d6dx', '4d6dl1!'],
  ])('reads alias %s as %s', (alias, canonical) => {
    expect(parse(alias)).toEqual(parse(canonical));
  });

  it('parses aliases to literal ASTs', () => {
    expect(parse('4d6k3+2d20k')).toEqual({
      terms: [dice(1, 4, 'd6', { mode: 'kh', n: 3 }), dice(1, 2, 'd20', { mode: 'kh', n: 1 })],
    });
    expect(parse('4d6d1-4d6d')).toEqual({
      terms: [dice(1, 4, 'd6', { mode: 'dl', n: 1 }), dice(-1, 4, 'd6', { mode: 'dl', n: 1 })],
    });
    expect(parse('3d6x')).toEqual({ terms: [dice(1, 3, 'd6', null, true)] });
  });

  it('accepts values at the limits', () => {
    expect(parse('100d6+100d6').terms).toHaveLength(2);
    expect(parse(`1d4${'+1'.repeat(19)}`).terms).toHaveLength(20);
    expect(parse('1d6+999999').terms[1]).toEqual(constant(1, 999999));
    expect(parse('1d6+0').terms[1]).toEqual(constant(1, 0));
    expect(parse('1d6'.padEnd(256, ' ')).terms).toHaveLength(1);
  });
});

describe('parse errors', () => {
  const cases: [string, unknown, number][] = [
    ['non-string input', 42, 0],
    ['empty input', '', 0],
    ['whitespace-only input', ' \t ', 0],
    ['input longer than 256 characters', '1d6'.padEnd(257, ' '), 256],
    ['unexpected character', '1d6 y', 4],
    ['unexpected character at start', 'x', 0],
    ['unexpected character after a constant', '2x', 1],
    ['double sign', '--1d6', 1],
    ['sign only', '+', 1],
    ['missing die size', '1d', 2],
    ['bad die size character', '1dx', 2],
    ['bad die size character after implicit count', 'dix', 1],
    ['drop alias n above count', '1d6d6', 4],
    ['drop alias n of 0', '4d6d0', 4],
    ['keep alias then second keep', '4d6k3kh1', 5],
    ['keep alias n above count', '2d6k3', 4],
    ['x then second explode', '3d6x!', 4],
    ['x with a number', '3d6x2', 4],
    ['x with a comparison', '3d6x>5', 4],
    ['x on dF', '1dFx', 3],
    ['suffix on adv', 'adv!', 3],
    ['die size d7', '1d7', 2],
    ['die size d1', '1d1', 2],
    ['die size d1000', '1d1000', 2],
    ['die size with whitespace', '1 d 7', 4],
    ['dice count 0', '0d6', 0],
    ['dice count above 100', '101d6', 0],
    ['explode on dF', '1dF!', 3],
    ['second explode', '1d6!!', 4],
    ['second keep', '4d6kh1kl1', 6],
    ['keep n above count', '2d6kh3', 5],
    ['keep n of 0', '2d6kh0', 5],
    ['keep n above implicit count', 'd6dl2', 4],
    ['constant above 999999', '1d6+1000000', 4],
    ['constant above 999999 with whitespace', ' 1d6 + 1000000', 7],
    ['more than 20 terms', `1d4${'+1'.repeat(20)}`, 42],
    ['more than 200 dice', '100d6+100d6+1d6', 12],
    ['more than 200 dice via adv', '100d6+99d6+adv', 11],
    ['no dice term', '5', 0],
    ['no dice term with several constants', '3+4', 0],
    ['trailing operator', '1d6+', 4],
    ['trailing operator with whitespace', '1d6+ ', 5],
    ['count prefix on adv', '2adv', 1],
    ['count prefix on dis', '2dis', 1],
  ];

  for (const [name, input, index] of cases) {
    it(`${name}: ${JSON.stringify(input)} -> index ${index}`, () => {
      const error = errorOf(input);
      expect(error.index).toBe(index);
      expect(error.message.length).toBeGreaterThan(0);
    });
  }

  it('throws a PollyrollSyntaxError that is an Error', () => {
    const error = errorOf('1d7');
    expect(error).toBeInstanceOf(PollyrollSyntaxError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PollyrollSyntaxError');
    expect(error.index).toBe(2);
  });
});
