import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse, PollyrollSyntaxError } from './notation';
import type { DieType, KeepMode, RollTerm } from './types';

/** One generated term: the AST it must parse to and its notation text without the sign. */
interface Piece {
  term: RollTerm;
  text: string;
}

/** A generated notation: terms, an optional leading `+`, whitespace before each character of the
 *  bare notation (index = character index; one extra entry for trailing whitespace), and per-character
 *  upper-casing. */
interface Spec {
  pieces: Piece[];
  leadingPlus: boolean;
  ws: string[];
  upper: boolean[];
}

const MAX_LENGTH = 256;
const DIES: readonly DieType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'dF'];
const MODES: readonly KeepMode[] = ['kh', 'kl', 'dh', 'dl'];

const signArb = fc.constantFrom<1 | -1>(1, -1);

/** Dice term with count in [1, maxCount], every die spelling, optional keep and explode, and the
 *  `k` (kh), `d` (dl), and `x` (!) aliases. */
const dicePiece = (maxCount: number): fc.Arbitrary<Piece> =>
  fc.integer({ min: 1, max: maxCount }).chain((count) =>
    fc
      .record({
        sign: signArb,
        die: fc.constantFrom(...DIES),
        omitCount: fc.boolean(),
        percent: fc.boolean(),
        keep: fc.option(
          fc.record({ mode: fc.constantFrom(...MODES), n: fc.integer({ min: 1, max: count }) }),
          { nil: null },
        ),
        omitN: fc.boolean(),
        shortMode: fc.boolean(),
        explode: fc.boolean(),
        x: fc.boolean(),
        explodeFirst: fc.boolean(),
      })
      .map((r): Piece => {
        const explode = r.explode && r.die !== 'dF';
        const countText = count === 1 && r.omitCount ? '' : String(count);
        const dieText = r.die === 'dF' ? 'f' : r.die === 'd100' && r.percent ? '%' : r.die.slice(1);
        const mode = r.keep?.mode ?? '';
        const modeText = r.shortMode && (mode === 'kh' || mode === 'dl') ? mode.charAt(0) : mode;
        const keepText = r.keep
          ? modeText + (r.keep.n === 1 && r.omitN ? '' : String(r.keep.n))
          : '';
        const bang = explode ? (r.x ? 'x' : '!') : '';
        return {
          term: { kind: 'dice', sign: r.sign, count, die: r.die, keep: r.keep, explode },
          text: `${countText}d${dieText}${r.explodeFirst ? bang + keepText : keepText + bang}`,
        };
      }),
  );

/** `adv` / `dis`: aliases for 2d20kh1 / 2d20kl1. */
const aliasPiece: fc.Arbitrary<Piece> = fc
  .record({ sign: signArb, word: fc.constantFrom('adv', 'dis') })
  .map(({ sign, word }) => ({
    term: {
      kind: 'dice',
      sign,
      count: 2,
      die: 'd20',
      keep: { mode: word === 'adv' ? 'kh' : 'kl', n: 1 },
      explode: false,
    },
    text: word,
  }));

const constantPiece: fc.Arbitrary<Piece> = fc
  .record({ sign: signArb, value: fc.integer({ min: 0, max: 999999 }) })
  .map(({ sign, value }) => ({
    term: { kind: 'constant', sign, value },
    text: String(value),
  }));

/** 1–20 terms, at least one of them dice, and at most 200 dice in total (each dice term holds at
 *  most floor(200 / terms) dice; aliases hold 2 ≤ 10). */
const specArb: fc.Arbitrary<Spec> = fc.integer({ min: 1, max: 20 }).chain((n) => {
  const maxCount = Math.min(100, Math.floor(200 / n));
  const dice = fc.oneof({ arbitrary: dicePiece(maxCount), weight: 4 }, aliasPiece);
  return fc.record({
    pieces: fc
      .tuple(
        dice,
        fc.array(fc.oneof(dice, constantPiece), { minLength: n - 1, maxLength: n - 1 }),
        fc.nat({ max: n - 1 }),
      )
      .map(([first, rest, at]) => [...rest.slice(0, at), first, ...rest.slice(at)]),
    leadingPlus: fc.boolean(),
    ws: fc.array(
      fc.oneof({ arbitrary: fc.constant(''), weight: 4 }, fc.constantFrom(' ', '\t', '\n', '  ')),
      { maxLength: MAX_LENGTH },
    ),
    upper: fc.array(fc.boolean(), { maxLength: MAX_LENGTH }),
  });
});

/** Joins the pieces with their signs, then adds whitespace while the string stays within 256
 *  characters, and upper-cases the flagged characters. */
function build(spec: Spec): string {
  let bare = '';
  spec.pieces.forEach(({ term, text }, i) => {
    const sign = term.sign < 0 ? '-' : i > 0 || spec.leadingPlus ? '+' : '';
    bare += sign + text;
  });
  let budget = MAX_LENGTH - bare.length;
  let out = '';
  for (let i = 0; i <= bare.length; i++) {
    const w = spec.ws[i] ?? '';
    if (w.length <= budget) {
      out += w;
      budget -= w.length;
    }
    const c = bare.charAt(i);
    out += spec.upper[i] ? c.toUpperCase() : c;
  }
  return out;
}

function errorOf(input: string): PollyrollSyntaxError {
  try {
    parse(input);
  } catch (error) {
    if (error instanceof PollyrollSyntaxError) return error;
    throw error;
  }
  throw new Error(`expected parse(${JSON.stringify(input)}) to throw`);
}

function dice(
  sign: 1 | -1,
  count: number,
  die: DieType,
  keep: { mode: KeepMode; n: number } | null,
  explode: boolean,
  text: string,
): Piece {
  return { term: { kind: 'dice', sign, count, die, keep, explode }, text };
}

function constant(sign: 1 | -1, value: number): Piece {
  return { term: { kind: 'constant', sign, value }, text: String(value) };
}

const plain = (pieces: Piece[], leadingPlus = false): Spec => ({
  pieces,
  leadingPlus,
  ws: [],
  upper: [],
});

/** Valid notation prefixes that end where the next term starts. */
const prefixArb = fc.constantFrom('', '  ', '1d6+', '3 + ', '-d20kh1 - ', 'ADV+', '\t+');

describe('notation properties', () => {
  it('a notation built from a term list parses back to exactly those terms', () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        const notation = build(spec);
        expect(notation.length).toBeLessThanOrEqual(MAX_LENGTH);
        expect(parse(notation)).toEqual({ terms: spec.pieces.map((p) => p.term) });
      }),
      {
        examples: [
          // Exactly 200 dice, both d100 spellings, keep count equal to the dice count.
          [
            plain([
              dice(1, 100, 'd100', { mode: 'kh', n: 100 }, true, '100d100kh100!'),
              dice(-1, 100, 'd100', { mode: 'dl', n: 1 }, false, '100d%dl'),
            ]),
          ],
          // Exactly 20 terms, upper case, leading minus alias, largest constant.
          [
            {
              pieces: [
                dice(-1, 2, 'd20', { mode: 'kl', n: 1 }, false, 'dis'),
                ...Array.from({ length: 19 }, () => constant(1, 999999)),
              ],
              leadingPlus: false,
              ws: [' ', '\t'],
              upper: Array.from({ length: 200 }, () => true),
            },
          ],
          // Every alias, bare and with n.
          [
            plain([
              dice(1, 4, 'd6', { mode: 'kh', n: 3 }, true, '4d6k3x'),
              dice(1, 2, 'd20', { mode: 'kh', n: 1 }, false, '2d20k'),
              dice(1, 4, 'd6', { mode: 'dl', n: 1 }, true, '4d6xd'),
              dice(1, 4, 'd8', { mode: 'dl', n: 2 }, false, '4d8d2'),
            ]),
          ],
          // Whitespace inside numbers, implicit count, explode before keep, fudge dice, zero.
          [
            {
              pieces: [
                dice(1, 10, 'd10', null, false, '10d10'),
                dice(1, 1, 'd4', { mode: 'dh', n: 1 }, true, 'd4!dh1'),
                dice(-1, 3, 'dF', { mode: 'kh', n: 2 }, false, '3dfkh2'),
                constant(-1, 0),
              ],
              leadingPlus: true,
              ws: [' ', '', ' ', '\n', '', ' ', '  ', '', '', '', '', '', '', '', '', '', '', '\t'],
              upper: [false, false, false, true, false, false, false, false, false, true, true],
            },
          ],
        ],
      },
    );
  });

  it('a dice count from 101 to 1000 is rejected at the count', () => {
    fc.assert(
      fc.property(
        prefixArb,
        fc.integer({ min: 101, max: 1000 }),
        fc.constantFrom('4', '6', '8', '10', '12', '20', '100', '%', 'F'),
        fc.constantFrom('', 'kh1', '!', '+5', '-1d4'),
        (prefix, count, die, suffix) => {
          const error = errorOf(`${prefix}${count}d${die}${suffix}`);
          expect(error.index).toBe(prefix.length);
        },
      ),
      {
        examples: [
          ['', 101, '6', ''],
          ['1d6+', 1000, '%', ''],
        ],
      },
    );
  });

  it('a constant above 999999 is rejected at the constant', () => {
    fc.assert(
      fc.property(
        prefixArb,
        fc.integer({ min: 1_000_000, max: Number.MAX_SAFE_INTEGER }),
        fc.constantFrom('', '+1d6', '-2', ' '),
        (prefix, value, suffix) => {
          const error = errorOf(`${prefix}${value}${suffix}`);
          expect(error.index).toBe(prefix.length);
        },
      ),
      {
        examples: [
          ['', 1_000_000, ''],
          ['1d6+', 1_000_000, ''],
        ],
      },
    );
  });

  it('a 21st term is rejected at its first character', () => {
    const shortTerm = fc.oneof(
      fc.integer({ min: 0, max: 99 }).map(String),
      fc
        .tuple(fc.integer({ min: 1, max: 5 }), fc.constantFrom('4', '6', '8'))
        .map(([count, die]) => `${count}d${die}`),
    );
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom('+', '-', ' + ', '- '), shortTerm), {
          minLength: 21,
          maxLength: 40,
        }),
        (terms) => {
          let notation = '';
          let at = -1;
          terms.forEach(([sign, text], i) => {
            if (i > 0) notation += sign;
            if (i === 20) at = notation.length;
            notation += text;
          });
          expect(notation.length).toBeLessThanOrEqual(MAX_LENGTH);
          expect(errorOf(notation).index).toBe(at);
        },
      ),
      { examples: [[Array.from({ length: 21 }, (): [string, string] => ['+', 'd6'])]] },
    );
  });

  it('the term that brings the total above 200 dice is rejected at its first character', () => {
    // Three counts of at least 67 always exceed 200 together.
    const countsArb = fc
      .tuple(
        fc.array(fc.integer({ min: 1, max: 100 }), { maxLength: 17 }),
        fc.array(fc.integer({ min: 67, max: 100 }), { minLength: 3, maxLength: 3 }),
      )
      .chain(([small, big]) => {
        const all = [...small, ...big];
        return fc.shuffledSubarray(all, { minLength: all.length, maxLength: all.length });
      });
    fc.assert(
      fc.property(
        countsArb,
        fc.array(fc.constantFrom('4', '20', '%', 'F'), { minLength: 20, maxLength: 20 }),
        (counts, dies) => {
          let notation = '';
          let at = -1;
          let total = 0;
          counts.forEach((count, i) => {
            if (i > 0) notation += '+';
            total += count;
            if (at < 0 && total > 200) at = notation.length;
            notation += `${count}d${dies[i] ?? '6'}`;
          });
          expect(at).toBeGreaterThanOrEqual(0);
          expect(errorOf(notation).index).toBe(at);
        },
      ),
      {
        examples: [
          [[100, 100, 1], Array.from({ length: 20 }, () => '6')],
          [[67, 67, 67], Array.from({ length: 20 }, () => '%')],
        ],
      },
    );
  });
});
