import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate';
import { isRollEvent, redact } from './event';
import { createRoll } from './roll';
import type { Compare, CompareOp, DieType, KeepMode, RollEvent } from './types';

interface DiceSpec {
  kind: 'dice';
  sign: 1 | -1;
  count: number;
  die: DieType;
  keep: { mode: KeepMode; n: number } | null;
  explode: Compare | null;
  reroll: { on: Compare; once: boolean } | null;
  success: Compare | null;
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
const OPS: readonly CompareOp[] = ['=', '<', '<=', '>', '>='];
const SEED = '0123456789abcdef0123456789abcdef';

const signArb = fc.constantFrom<1 | -1>(1, -1);

const diceArb = (maxCount: number): fc.Arbitrary<TermSpec> =>
  fc.tuple(fc.integer({ min: 1, max: maxCount }), fc.constantFrom(...DIES)).chain(([count, die]) =>
    fc
      .record({
        sign: signArb,
        keep: fc.option(
          fc.record({ mode: fc.constantFrom(...MODES), n: fc.integer({ min: 1, max: count }) }),
          { nil: null },
        ),
        // Thresholds in [2, max - 1] never match every face.
        fire: fc.record({
          kind: fc.constantFrom('none', 'explode', 'reroll', 'rerollOnce'),
          op: fc.constantFrom(...OPS),
          n: fc.integer({ min: 2, max: Math.max(2, RANGE[die][1] - 1) }),
        }),
        success: fc.option(
          fc.record({
            op: fc.constantFrom(...OPS),
            n: fc.integer({ min: 0, max: RANGE[die][1] + 1 }),
          }),
          { nil: null },
        ),
      })
      .map(({ sign, keep, fire, success }): TermSpec => {
        const on = { op: fire.op, n: fire.n };
        const kind = die === 'dF' ? 'none' : fire.kind;
        return {
          kind: 'dice',
          sign,
          count,
          die,
          keep,
          explode: kind === 'explode' ? on : null,
          reroll:
            kind === 'none' || kind === 'explode' ? null : { on, once: kind === 'rerollOnce' },
          success,
        };
      }),
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

const cmp = (c: Compare): string => `${c.op}${c.n}`;

/** Independent comparison oracle. */
function satisfies(c: Compare, v: number): boolean {
  if (c.op === '=') return v === c.n;
  if (c.op === '<') return v < c.n;
  if (c.op === '<=') return v <= c.n;
  if (c.op === '>') return v > c.n;
  return v >= c.n;
}

function notationOf(terms: readonly TermSpec[]): string {
  return terms
    .map((t, i) => {
      const sign = t.sign < 0 ? '-' : i > 0 ? '+' : '';
      if (t.kind === 'constant') return `${sign}${t.value}`;
      const keep = t.keep ? `${t.keep.mode}${t.keep.n}` : '';
      const fire = t.explode
        ? `!${cmp(t.explode)}`
        : t.reroll
          ? `r${t.reroll.once ? 'o' : ''}${cmp(t.reroll.on)}`
          : '';
      const success = t.success ? cmp(t.success) : '';
      return `${sign}${t.count}d${t.die === 'dF' ? 'F' : t.die.slice(1)}${keep}${fire}${success}`;
    })
    .join('');
}

function roll(terms: readonly TermSpec[], stream: readonly number[]): RollEvent {
  let i = 0;
  const rng = (max: number): number => (stream[i++ % stream.length] ?? 0) % max;
  return createRoll(notationOf(terms), { rng, seed: SEED });
}

/** Expected total: signed constants plus, per dice term, the signed sum (or, with a success
 *  comparison, the signed count of matches) of the dice its keep rule keeps among the dice that were
 *  not rerolled (dice of a term grouped by index among the dice terms). A matching die is rerolled
 *  unless it is in the last wave: wave 10, or wave 1 for reroll-once. */
function oracleTotal(terms: readonly TermSpec[], event: RollEvent): number {
  let total = 0;
  let group = 0;
  for (const term of terms) {
    if (term.kind === 'constant') {
      total += term.sign * term.value;
      continue;
    }
    const g = group++;
    const { reroll } = term;
    const last = reroll?.once ? 1 : 10;
    const desc = event.dice
      .filter((d) => d.group === g)
      .filter((d) => !reroll || d.wave === last || !satisfies(reroll.on, d.value ?? 0))
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
    for (const v of kept) {
      if (!term.success) total += term.sign * v;
      else if (satisfies(term.success, v)) total += term.sign;
    }
  }
  return total;
}

const maxed = (n: number): number[] => [n - 1];
const eq = (n: number): Compare => ({ op: '=', n });
const REROLL_ONES: TermSpec = {
  kind: 'dice',
  sign: 1,
  count: 3,
  die: 'd8',
  keep: { mode: 'kl', n: 2 },
  explode: null,
  reroll: { on: eq(1), once: false },
  success: { op: '<=', n: 1 },
};

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
          [
            [
              {
                kind: 'dice',
                sign: 1,
                count: 3,
                die: 'dF',
                keep: null,
                explode: null,
                reroll: null,
                success: null,
              },
            ],
            [0, 1, 2],
          ],
          [
            [
              {
                kind: 'dice',
                sign: 1,
                count: 1,
                die: 'd100',
                keep: null,
                explode: eq(100),
                reroll: null,
                success: null,
              },
            ],
            [99],
          ],
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
                explode: eq(6),
                reroll: null,
                success: null,
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
                explode: null,
                reroll: null,
                success: null,
              },
              {
                kind: 'dice',
                sign: 1,
                count: 4,
                die: 'd8',
                keep: { mode: 'dl', n: 3 },
                explode: null,
                reroll: null,
                success: null,
              },
            ],
            [3, 17, 9, 0, 5, 2, 7, 1],
          ],
          // Every die rerolls through all ten waves; the last wave stays live.
          [[REROLL_ONES], [0]],
          // Reroll once, then count successes among the kept dice.
          [
            [
              {
                kind: 'dice',
                sign: -1,
                count: 4,
                die: 'd6',
                keep: { mode: 'kh', n: 3 },
                explode: null,
                reroll: { on: { op: '<', n: 3 }, once: true },
                success: { op: '>=', n: 2 },
              },
            ],
            [0, 4, 1, 5, 0, 1, 3],
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
          [
            [
              {
                kind: 'dice',
                sign: 1,
                count: 1,
                die: 'd4',
                keep: null,
                explode: eq(4),
                reroll: null,
                success: null,
              },
            ],
            maxed(4),
          ],
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
            [
              {
                kind: 'dice',
                sign: -1,
                count: 100,
                die: 'd12',
                keep: null,
                explode: eq(12),
                reroll: null,
                success: null,
              },
            ],
            maxed(12),
          ],
          [[REROLL_ONES], [0]],
        ],
      },
    );
  });
});
