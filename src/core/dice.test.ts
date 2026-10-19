import { describe, expect, it } from 'vitest';
import { dieRange } from './dice';

describe('dieRange', () => {
  it('gives d2 values 1–2 and dc values 0–1', () => {
    expect(dieRange('d2')).toEqual([1, 2]);
    expect(dieRange('dc')).toEqual([0, 1]);
  });
});
