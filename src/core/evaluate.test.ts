import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate';
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
      groups: [{ die: 'd20', dice: [7, 15], kept: [1], dropped: [0], subtotal: 15 }],
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
      groups: [{ die: 'd20', dice: [null, null], kept: [], dropped: [], subtotal: null }],
    });
  });

  it('keeps subtotals of unredacted groups after a redacted one', () => {
    const event = ev('1d6+1d4', 'd6', [null]);
    event.dice.push({ type: 'd4', value: 3, group: 1, wave: 0 });
    const summary = evaluate(event);
    expect(summary.total).toBeNull();
    expect(summary.groups.map((g) => g.subtotal)).toEqual([null, 3]);
  });

  it('throws on a group out of range', () => {
    const event = ev('1d6', 'd6', [3]);
    event.dice.push({ type: 'd6', value: 2, group: 1, wave: 0 });
    expect(() => evaluate(event)).toThrow(TypeError);
  });
});
