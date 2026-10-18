import type { Compare, DiceTerm, DieType } from './types';

export const DIE_TYPES: readonly DieType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'dF'];

/** Inclusive [min, max] value range: dN → [1, N]; dF → [-1, 1]. */
export function dieRange(type: DieType): readonly [number, number] {
  return type === 'dF' ? [-1, 1] : [1, Number(type.slice(1))];
}

export const MAX_WAVE = 10;

/** True when `v` satisfies `c`: the operator holds `<`, `=`, or `>` for `v` below, at, or above `n`. */
export function matches(c: Compare, v: number): boolean {
  return c.op.includes(v < c.n ? '<' : v > c.n ? '>' : '=');
}

/** True when a die of `term` showing `v` in `wave` explodes or is rerolled into the next wave. */
export function fires(term: DiceTerm, v: number, wave: number): boolean {
  const { explode, reroll } = term;
  if (explode) return matches(explode, v);
  return !!reroll && (!reroll.once || wave === 0) && matches(reroll.on, v);
}
