import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate';
import { redact } from './event';
import { createRoll } from './roll';
import type { DieType, RollEvent } from './types';

/** Event for `notation` with the given dice; bare numbers are wave-0 dice of group 0. */
const ev = (
  notation: string,
  type: DieType,
  values: (number | null)[],
  modifier = 0,
  waves: number[] = [],
): RollEvent => ({
  v: 1,
  id: 'id',
  notation,
  dice: values.map((value, i) => ({ type, value, group: 0, wave: waves[i] ?? 0 })),
  modifier,
  seed: '0123456789abcdef0123456789abcdef',
  createdAt: 0,
});

describe('evaluate', () => {
  it('keeps the highest die and adds the modifier', () => {
    expect(evaluate(ev('2d20kh1+5', 'd20', [7, 15], 5))).toEqual({
      total: 20,
      modifier: 5,
      groups: [
        {
          die: 'd20',
          sign: 1,
          dice: [7, 15],
          kept: [1],
          dropped: [0],
          rerolled: [],
          subtotal: 15,
          success: null,
        },
      ],
    });
  });

  it('drops the lowest with a stable tie order', () => {
    const { groups } = evaluate(ev('4d6dl1', 'd6', [3, 1, 4, 1]));
    expect(groups[0]).toMatchObject({ kept: [0, 2, 3], dropped: [1], subtotal: 8 });
  });

  it('keeps the highest ties by lower index first', () => {
    expect(evaluate(ev('4d6kh2', 'd6', [5, 5, 5, 2])).groups[0]).toMatchObject({
      kept: [0, 1],
      dropped: [2, 3],
      subtotal: 10,
    });
  });

  it('keeps the lowest ties by lower index first', () => {
    expect(evaluate(ev('2d20kl1', 'd20', [9, 9])).groups[0]).toMatchObject({
      kept: [0],
      dropped: [1],
    });
  });

  it('drops the highest ties by lower index first', () => {
    expect(evaluate(ev('4d6dh1', 'd6', [6, 2, 6, 1])).groups[0]).toMatchObject({
      kept: [1, 2, 3],
      dropped: [0],
      subtotal: 9,
    });
  });

  it('applies a negative term sign', () => {
    const summary = evaluate(ev('-1d4+2', 'd4', [3], 2));
    expect(summary.groups[0]?.subtotal).toBe(-3);
    expect(summary.total).toBe(-1);
  });

  it('sums fudge dice', () => {
    expect(evaluate(ev('3dF', 'dF', [-1, 0, 1])).groups[0]?.subtotal).toBe(0);
  });

  it('sums explosion waves into the group', () => {
    const summary = evaluate(ev('1d6!', 'd6', [6, 6, 3], 0, [0, 1, 2]));
    expect(summary.groups[0]).toMatchObject({ kept: [0, 1, 2], dropped: [], subtotal: 15 });
    expect(summary.total).toBe(15);
  });

  it('replaces rerolled dice with their rerolls', () => {
    const summary = evaluate(ev('4d6r1', 'd6', [1, 4, 1, 6, 1, 3, 2], 0, [0, 0, 0, 0, 1, 1, 2]));
    expect(summary.groups[0]).toMatchObject({
      kept: [1, 3, 5, 6],
      dropped: [0, 2, 4],
      subtotal: 15,
    });
    expect(summary.total).toBe(15);
  });

  it('rerolls once and keeps a matching reroll', () => {
    expect(evaluate(ev('2d20ro1', 'd20', [1, 1, 1, 5], 0, [0, 0, 1, 1])).groups[0]).toMatchObject({
      kept: [2, 3],
      dropped: [0, 1],
      subtotal: 6,
    });
  });

  it('keeps among the live dice after rerolls', () => {
    // Live dice 5, 6, 3, 4: kl2 keeps 3 and 4, never the rerolled 1.
    expect(evaluate(ev('4d6r<3kl2', 'd6', [1, 5, 6, 3, 4], 0, [0, 0, 0, 0, 1])).groups[0]).toEqual({
      die: 'd6',
      sign: 1,
      dice: [1, 5, 6, 3, 4],
      kept: [3, 4],
      dropped: [0, 1, 2],
      rerolled: [0],
      subtotal: 7,
      success: null,
    });
  });

  it('lists rerolled dice separately from keep/drop drops', () => {
    expect(
      evaluate(ev('4d6r1kh3', 'd6', [1, 4, 5, 6, 3], 0, [0, 0, 0, 0, 1])).groups[0],
    ).toMatchObject({
      kept: [1, 2, 3],
      dropped: [0, 4],
      rerolled: [0],
      subtotal: 15,
    });
  });

  it('lists every die of a reroll chain', () => {
    expect(evaluate(ev('1d6r1', 'd6', [1, 1, 5], 0, [0, 1, 2])).groups[0]).toMatchObject({
      kept: [2],
      dropped: [0, 1],
      rerolled: [0, 1],
    });
  });

  it('keeps a matching die in the last wave live', () => {
    const waves = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(
      evaluate(
        ev(
          '1d6r',
          'd6',
          waves.map(() => 1),
          0,
          waves,
        ),
      ).groups[0],
    ).toMatchObject({
      kept: [10],
      dropped: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      subtotal: 1,
    });
  });

  it('keeps a firing die live when no reroll follows it', () => {
    expect(evaluate(ev('2d6r', 'd6', [1, 1, 4], 0, [0, 0, 1])).groups[0]).toMatchObject({
      kept: [1, 2],
      dropped: [0],
      subtotal: 5,
    });
  });

  it('counts explosion dice that match a threshold', () => {
    const summary = evaluate(ev('1d6!>=5', 'd6', [5, 6, 2], 0, [0, 1, 2]));
    expect(summary.groups[0]).toMatchObject({ kept: [0, 1, 2], dropped: [], subtotal: 13 });
  });

  it('counts successes and adds the modifier', () => {
    const summary = evaluate(ev('5d10>=7+1', 'd10', [7, 3, 10, 6, 9], 1));
    expect(summary.groups[0]).toMatchObject({ kept: [0, 1, 2, 3, 4], subtotal: 3 });
    expect(summary.total).toBe(4);
  });

  it.each([
    ['6d6>4', [5, 4, 6, 1, 6, 2], 3],
    ['3d20<5', [4, 5, 1], 2],
    ['4d6=6', [6, 6, 1, 5], 2],
    ['2d6<=2', [2, 3], 1],
  ])('counts successes for %s', (notation, values, count) => {
    const type = notation.includes('d20') ? 'd20' : 'd6';
    expect(evaluate(ev(notation, type, values)).groups[0]?.subtotal).toBe(count);
  });

  it('counts successes among kept dice only', () => {
    expect(evaluate(ev('4d6kh3>=5', 'd6', [6, 5, 1, 4])).groups[0]).toMatchObject({
      kept: [0, 1, 3],
      dropped: [2],
      subtotal: 2,
    });
  });

  it('counts successes of rerolled dice after the reroll', () => {
    expect(evaluate(ev('2d6r1>=5', 'd6', [1, 5, 6], 0, [0, 0, 1])).groups[0]?.subtotal).toBe(2);
  });

  it('negates the success count of a negative term', () => {
    const summary = evaluate(ev('-2d6>=5', 'd6', [5, 6]));
    expect(summary.groups[0]?.subtotal).toBe(-2);
    expect(summary.total).toBe(-2);
  });

  it('collects dice per group in event order', () => {
    const event = ev('2d6!+1d4', 'd6', [6, 1, 2], 0, [0, 0, 1]);
    event.dice.splice(2, 0, { type: 'd4', value: 3, group: 1, wave: 0 });
    const summary = evaluate(event);
    expect(summary.groups.map((g) => [g.die, g.dice, g.subtotal])).toEqual([
      ['d6', [6, 1, 2], 9],
      ['d4', [3], 3],
    ]);
    expect(summary.total).toBe(12);
  });

  it('returns null totals for redacted groups', () => {
    expect(evaluate(ev('2d20kh1+5', 'd20', [null, null], 5))).toEqual({
      total: null,
      modifier: 5,
      groups: [
        {
          die: 'd20',
          sign: 1,
          dice: [null, null],
          kept: [],
          dropped: [],
          rerolled: [],
          subtotal: null,
          success: null,
        },
      ],
    });
  });

  it('keeps subtotals of unredacted groups after a redacted one', () => {
    const event = ev('1d6+1d4', 'd6', [null]);
    event.dice.push({ type: 'd4', value: 3, group: 1, wave: 0 });
    const summary = evaluate(event);
    expect(summary.total).toBeNull();
    expect(summary.groups.map((g) => g.subtotal)).toEqual([null, 3]);
  });

  it('reports the term sign of each group', () => {
    const event = ev('1d20-1d4+2', 'd20', [12], 2);
    event.dice.push({ type: 'd4', value: 4, group: 1, wave: 0 });
    expect(evaluate(event).groups.map((g) => g.sign)).toEqual([1, -1]);
  });

  it('reports the success comparison of a counting group', () => {
    expect(evaluate(ev('5d10>=7', 'd10', [8, 3, 9, 7, 1])).groups[0]).toMatchObject({
      success: { op: '>=', n: 7 },
      subtotal: 3,
    });
    expect(evaluate(ev('2d6', 'd6', [2, 5])).groups[0]?.success).toBeNull();
  });

  it('keeps sign and success on a redacted group', () => {
    const event = redact(createRoll('-3d6>=5', { rng: () => 0 }));
    expect(evaluate(event).groups[0]).toMatchObject({
      sign: -1,
      success: { op: '>=', n: 5 },
      subtotal: null,
    });
  });

  it('throws on a group out of range', () => {
    const event = ev('1d6', 'd6', [3]);
    event.dice.push({ type: 'd6', value: 2, group: 1, wave: 0 });
    expect(() => evaluate(event)).toThrow(TypeError);
  });
});
