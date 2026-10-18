import { describe, expect, it } from 'vitest';
import { penetration } from './penetration';

const S = Math.sin(Math.PI / 8);
const C = Math.cos(Math.PI / 8);

describe('penetration', () => {
  it('two identity d6 0.6 apart on x overlap by 1 − 0.6 = 0.4', () => {
    const a = [0, 0.5, 0, 0, 0, 0, 1];
    const b = [0.6, 0.5, 0, 0, 0, 0, 1];
    expect(penetration('d6', a, 'd6', b)).toBeCloseTo(0.4, 12);
  });

  it('two identity d6 1.2 apart on x do not overlap', () => {
    expect(penetration('d6', [0, 0.5, 0, 0, 0, 0, 1], 'd6', [1.2, 0.5, 0, 0, 0, 0, 1])).toBe(0);
  });

  it('a d6 turned 45° about Y at x = 1.2 pokes its corner 0.5 + √2/2 − 1.2 into the face', () => {
    const a = [0, 0.5, 0, 0, 0, 0, 1];
    const b = [1.2, 0.5, 0, 0, S, 0, C];
    const depth = 0.5 + Math.SQRT2 / 2 - 1.2;
    expect(depth).toBeCloseTo(0.00711, 5);
    expect(penetration('d6', a, 'd6', b)).toBeCloseTo(depth, 12);
    expect(penetration('d6', b, 'd6', a)).toBeCloseTo(depth, 12);
  });
});
