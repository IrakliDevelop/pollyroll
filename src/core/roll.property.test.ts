import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate';
import { isRollEvent, redact } from './event';
import { createRoll } from './roll';
import type { DieType, KeepMode, RollEvent } from './types';

interface DiceSpec {
  kind: 'dice';
  sign: 1 | -1;
  count: number;
  die: DieType;
  keep: { mode: KeepMode; n: number } | null;
  explode: boolean;
}
interface ConstantSpec {
  kind: 'constant';
  sign: 1 | -1;
  value: number;
}
type TermSpec = DiceSpec | ConstantSpec;

/** Inclusive value range of each die, from the dice table in the plan. */
const RANGE: Record<DieType, readonly [number, number]> = {
  d4: [1, 4],
  d6: [1, 6],
  d8: [1, 8],
  d10: [1, 10],
  d12: [1, 12],
  d20: [1, 20],
  d100: [1, 100],
  dF: [-1, 1],
};
const DIES = Object.keys(RANGE) as DieType[];
const MODES: readonly KeepMode[] = ['kh', 'kl', 'dh', 'dl'];
const SEED = '0123456789abcdef0123456789abcdef';

const signArb = fc.constantFrom<1 | -1>(1, -1);

const diceArb = (maxCount: number): fc.Arbitrary<TermSpec> =>
  fc.integer({ min: 1, max: maxCount }).chain((count) =>
    fc
      .record({
        sign: signArb,
        die: fc.constantFrom(...DIES),
        keep: fc.option(
          fc.record({ mode: fc.constantFrom(...MODES), n: fc.integer({ min: 1, max: count }) }),
          { nil: null },
        ),
        explode: fc.boolean(),
      })
      .map(({ sign, die, keep, explode }): TermSpec => ({
        kind: 'dice',
        sign,
        count,
        die,
        keep,
        explode: explode && die !== 'dF',
      })),
  );

const constantArb: fc.Arbitrary<TermSpec> = fc
  .record({ sign: signArb, value: fc.integer({ min: 0, max: 999999 }) })
  .map(({ sign, value }): TermSpec => ({ kind: 'constant', sign, value }));

/** 1–20 terms with at least one dice term and at most 200 dice in total. */
const termsArb: fc.Arbitrary<TermSpec[]> = fc.integer({ min: 1, max: 20 }).chain((n) => {
  const dice = diceArb(Math.min(100, Math.floor(200 / n)));
  return fc
    .tuple(
      dice,
      fc.array(fc.oneof(dice, constantArb), { minLength: n - 1, maxLength: n - 1 }),
      fc.nat({ max: n - 1 }),
    )
    .map(([first, rest, at]) => [...rest.slice(0, at), first, ...rest.slice(at)]);
});

/** Values RNG cycling through a generated integer list, each reduced into [0, maxExclusive). */
const rngArb = fc.array(fc.nat(), { minLength: 1, maxLength: 64 });

function notationOf(terms: readonly TermSpec[]): string {
  return terms
    .map((t, i) => {
      const sign = t.sign < 0 ? '-' : i > 0 ? '+' : '';
      if (t.kind === 'constant') return `${sign}${t.value}`;
      const keep = t.keep ? `${t.keep.mode}${t.keep.n}` : '';
      return `${sign}${t.count}d${t.die === 'dF' ? 'F' : t.die.slice(1)}${keep}${t.explode ? '!' : ''}`;
    })
    .join('');
}

function roll(terms: readonly TermSpec[], stream: readonly number[]): RollEvent {
  let i = 0;
  const rng = (max: number): number => (stream[i++ % stream.length] ?? 0) % max;
  return createRoll(notationOf(terms), { rng, seed: SEED });
}

/** Expected total: signed constants plus, per dice term, the signed sum of the dice its keep rule
 *  keeps (dice of a term grouped by index among the dice terms). */
function oracleTotal(terms: readonly TermSpec[], event: RollEvent): number {
  let total = 0;
  let group = 0;
  for (const term of terms) {
    if (term.kind === 'constant') {
      total += term.sign * term.value;
      continue;
    }
    const g = group++;
    const desc = event.dice
      .filter((d) => d.group === g)
      .map((d) => {
        if (d.value === null) throw new Error('unexpected null value');
        return d.value;
      })
      .sort((a, b) => b - a);
    let kept = desc;
    if (term.keep) {
      const { mode, n } = term.keep;
      if (mode === 'kh') kept = desc.slice(0, n);
      else if (mode === 'kl') kept = desc.slice(desc.length - n);
      else if (mode === 'dh') kept = desc.slice(n);
      else kept = desc.slice(0, desc.length - n);
    }
    for (const v of kept) total += term.sign * v;
  }
  return total;
}

const maxed = (n: number): number[] => [n - 1];

describe('roll properties', () => {
  it('every die carries its term type and a value within that die range', () => {
    fc.assert(
      fc.property(termsArb, rngArb, (terms, stream) => {
        const dieTerms = terms.filter((t): t is DiceSpec => t.kind === 'dice');
        for (const d of roll(terms, stream).dice) {
          const term = dieTerms[d.group];
          expect(term?.die).toBe(d.type);
          const [min, max] = RANGE[d.type];
          expect(d.value).toBeGreaterThanOrEqual(min);
          expect(d.value).toBeLessThanOrEqual(max);
        }
      }),
      {
        examples: [
          [[{ kind: 'dice', sign: 1, count: 3, die: 'dF', keep: null, explode: false }], [0, 1, 2]],
          [[{ kind: 'dice', sign: 1, count: 1, die: 'd100', keep: null, explode: true }], [99]],
        ],
      },
    );
  });

  it('evaluate total equals the kept sum per keep rule plus the modifier', () => {
    fc.assert(
      fc.property(termsArb, rngArb, (terms, stream) => {
        const event = roll(terms, stream);
        expect(evaluate(event).total).toBe(oracleTotal(terms, event));
      }),
      {
        examples: [
          // Every die explodes through all ten waves; keep ranks across waves.
          [
            [
              {
                kind: 'dice',
                sign: 1,
                count: 2,
                die: 'd6',
                keep: { mode: 'kl', n: 2 },
                explode: true,
              },
              { kind: 'constant', sign: -1, value: 7 },
            ],
            maxed(6),
          ],
          [
            [
              {
                kind: 'dice',
                sign: -1,
                count: 4,
                die: 'd20',
                keep: { mode: 'dh', n: 1 },
                explode: false,
              },
              {
                kind: 'dice',
                sign: 1,
                count: 4,
                die: 'd8',
                keep: { mode: 'dl', n: 3 },
                explode: false,
              },
            ],
            [3, 17, 9, 0, 5, 2, 7, 1],
          ],
        ],
      },
    );
  });

  it('redact leaves only the initial-wave dice, each with a null value', () => {
    fc.assert(
      fc.property(termsArb, rngArb, (terms, stream) => {
        const event = roll(terms, stream);
        const hidden = redact(event);
        expect(hidden.dice.every((d) => d.value === null && d.wave === 0)).toBe(true);
        expect(hidden.dice).toEqual(
          event.dice.filter((d) => d.wave === 0).map((d) => ({ ...d, value: null })),
        );
      }),
      {
        examples: [
          [[{ kind: 'dice', sign: 1, count: 1, die: 'd4', keep: null, explode: true }], maxed(4)],
        ],
      },
    );
  });

  it('isRollEvent accepts createRoll output and its JSON round trip', () => {
    fc.assert(
      fc.property(termsArb, rngArb, (terms, stream) => {
        const event = roll(terms, stream);
        expect(isRollEvent(event)).toBe(true);
        expect(isRollEvent(JSON.parse(JSON.stringify(event)))).toBe(true);
      }),
      {
        examples: [
          [
            [{ kind: 'dice', sign: -1, count: 100, die: 'd12', keep: null, explode: true }],
            maxed(12),
          ],
        ],
      },
    );
  });
});
