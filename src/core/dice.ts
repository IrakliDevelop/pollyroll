import type { DieType } from './types';

export const DIE_TYPES: readonly DieType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'dF'];

/** Inclusive [min, max] value range: dN → [1, N]; dF → [-1, 1]. */
export function dieRange(type: DieType): readonly [number, number] {
  return type === 'dF' ? [-1, 1] : [1, Number(type.slice(1))];
}

export const MAX_WAVE = 10;
