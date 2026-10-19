import { describe, expect, it } from 'vitest';
import type { ShapeType } from '../geometry/polyhedra';
import { penetration, penetrationAt } from './penetration';

const S = Math.sin(Math.PI / 8);
const C = Math.cos(Math.PI / 8);
const PHI = (1 + Math.sqrt(5)) / 2;
// d4 vertices are (±1, ±1, ±1) with an even number of minus signs, scaled to circumradius 0.95.
const D4_HALF = 0.95 / Math.sqrt(3);
// d20 at circumradius 0.85: raw circumradius √(1 + φ²), raw inradius (φ / 3)·√(1 + φ⁴) along
// the face normal (1, 0, φ²)/√(1 + φ⁴) of face (0, 1, φ), (0, −1, φ), (φ, 0, 1).
const D20_IN = (0.85 * (PHI / 3) * Math.sqrt(1 + PHI ** 4)) / Math.sqrt(1 + PHI ** 2);
const D20_N = [1 / Math.sqrt(1 + PHI ** 4), 0, PHI ** 2 / Math.sqrt(1 + PHI ** 4)] as const;
// Turns local +x onto (1, 1, 1)/√3: q ∝ (x̂ × n̂, 1 + x̂·n̂).
const T = 1 / Math.sqrt(3);
const QL = Math.sqrt(2 * T * T + (1 + T) ** 2);
const CORNER = [0, -T / QL, T / QL, (1 + T) / QL];
const along = (d: number): number[] => [d * T, d * T, d * T];

type Case = [string, ShapeType, number[], ShapeType, number[], number];

const cases: Case[] = [
  [
    'two identity d6 0.6 apart on x overlap by 1 − 0.6',
    'd6',
    [0, 0.5, 0, 0, 0, 0, 1],
    'd6',
    [0.6, 0.5, 0, 0, 0, 0, 1],
    0.4,
  ],
  [
    'two identity d6 1.2 apart on x do not overlap',
    'd6',
    [0, 0.5, 0, 0, 0, 0, 1],
    'd6',
    [1.2, 0.5, 0, 0, 0, 0, 1],
    0,
  ],
  [
    'a d6 turned 45° about Y at x = 1.2 pokes its corner 0.5 + √2/2 − 1.2 into the face',
    'd6',
    [0, 0.5, 0, 0, 0, 0, 1],
    'd6',
    [1.2, 0.5, 0, 0, S, 0, C],
    0.5 + Math.SQRT2 / 2 - 1.2,
  ],
  [
    'd6 ridges crossed at right angles 1.3 apart on y overlap by √2 − 1.3 along the edge cross',
    'd6',
    [0, 0, 0, 0, 0, S, C],
    'd6',
    [0, 1.3, 0, S, 0, 0, C],
    Math.SQRT2 - 1.3,
  ],
  [
    'd6 ridges crossed at right angles 1.5 apart on y are separated only by the edge cross',
    'd6',
    [0, 0, 0, 0, 0, S, C],
    'd6',
    [0, 1.5, 0, S, 0, 0, C],
    0,
  ],
  [
    'a d6 turned 45° about Y at (1, 0, 1) is separated by its diagonal face',
    'd6',
    [0, 0, 0, 0, 0, 0, 1],
    'd6',
    [1, 0, 1, 0, S, 0, C],
    0,
  ],
  [
    'a d6 corner meets a face turned to (1, 1, 1) 1.3 out, 0.5 + √3/2 − 1.3 deep',
    'd6',
    [0, 0, 0, 0, 0, 0, 1],
    'd6',
    [...along(1.3), ...CORNER],
    0.5 + Math.sqrt(3) / 2 - 1.3,
  ],
  [
    'a d6 corner 1.4 out from a face turned to (1, 1, 1) is separated by that face',
    'd6',
    [0, 0, 0, 0, 0, 0, 1],
    'd6',
    [...along(1.4), ...CORNER],
    0,
  ],
  [
    'an identity d4 1.0 above a d6 rests its bottom edge 0.5 + 0.95/√3 − 1 into the top face',
    'd6',
    [0, 0, 0, 0, 0, 0, 1],
    'd4',
    [0, 1, 0, 0, 0, 0, 1],
    0.5 + D4_HALF - 1,
  ],
  [
    'an identity d4 1.1 above a d6 does not overlap',
    'd6',
    [0, 0, 0, 0, 0, 0, 1],
    'd4',
    [0, 1.1, 0, 0, 0, 0, 1],
    0,
  ],
  [
    'two identity d20 1.2 apart along a face normal overlap by 2·inradius − 1.2',
    'd20',
    [0, 0, 0, 0, 0, 0, 1],
    'd20',
    [1.2 * D20_N[0], 0, 1.2 * D20_N[2], 0, 0, 0, 1],
    2 * D20_IN - 1.2,
  ],
  [
    'two identity d20 1.4 apart along a face normal do not overlap',
    'd20',
    [0, 0, 0, 0, 0, 0, 1],
    'd20',
    [1.4 * D20_N[0], 0, 1.4 * D20_N[2], 0, 0, 0, 1],
    0,
  ],
  [
    'an identity coin at y = 1.05 on a d6 off the origin sinks 1 − (1.05 − 0.1) into its top',
    'd6',
    [3, 0.5, 0, 0, 0, 0, 1],
    'coin',
    [3, 1.05, 0, 0, 0, 0, 1],
    0.05,
  ],
];

describe('penetration', () => {
  it.each(cases)('%s', (_, a, poseA, b, poseB, depth) => {
    expect(penetration(a, poseA, b, poseB)).toBeCloseTo(depth, 12);
    expect(penetration(b, poseB, a, poseA)).toBeCloseTo(depth, 12);
  });

  it.each(cases)(
    'penetrationAt reads the same poses from frame buffer offsets: %s',
    (_, a, poseA, b, poseB, depth) => {
      const frames = new Float64Array([9, 9, 9, ...poseA, 9, ...poseB]);
      expect(penetrationAt(a, frames, 3, b, frames, 11)).toBeCloseTo(depth, 12);
      expect(penetrationAt(b, frames, 11, a, frames, 3)).toBeCloseTo(depth, 12);
    },
  );

  it('the hand-derived depths are the small contacts they describe', () => {
    expect(0.5 + Math.SQRT2 / 2 - 1.2).toBeCloseTo(0.00711, 5);
    expect(Math.SQRT2 - 1.3).toBeCloseTo(0.11421, 5);
    expect(0.5 + Math.sqrt(3) / 2 - 1.3).toBeCloseTo(0.06603, 5);
    expect(0.5 + D4_HALF - 1).toBeCloseTo(0.04848, 5);
    expect(2 * D20_IN - 1.2).toBeCloseTo(0.15091, 5);
  });

  it('reads missing pose entries as the origin and the identity orientation', () => {
    expect(penetration('d6', [], 'd6', [0.6])).toBeCloseTo(0.4, 12);
  });
});
