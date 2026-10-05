import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSeedRng, cryptoInt, generateSeed, isSeed } from './rng';

const take = (n: number, next: () => number): number[] => Array.from({ length: n }, next);

describe('createSeedRng', () => {
  it('matches the sfc32 reference vector for a mixed seed', () => {
    const rng = createSeedRng('0123456789abcdef0123456789abcdef');
    expect(take(4, () => rng.u32())).toEqual([108627314, 2484290148, 4276039932, 923844663]);
  });

  it('matches the sfc32 reference vector for the zero seed', () => {
    const rng = createSeedRng('00000000000000000000000000000000');
    expect(take(4, () => rng.u32())).toEqual([1363572419, 145230303, 808754475, 4216505632]);
  });

  it('produces identical sequences for the same seed and floats in [0, 1)', () => {
    const seed = 'deadbeefcafebabe0011223344556677';
    const a = createSeedRng(seed);
    const b = createSeedRng(seed);
    expect(take(1000, () => a.u32())).toEqual(take(1000, () => b.u32()));
    const floats = take(1000, () => a.float());
    for (const f of floats) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('throws TypeError for invalid seeds', () => {
    expect(() => createSeedRng('xyz')).toThrow(TypeError);
    expect(() => createSeedRng('0123456789ABCDEF0123456789ABCDEF')).toThrow(TypeError);
  });

  it('int throws RangeError outside [1, 2^32]', () => {
    const rng = createSeedRng('00000000000000000000000000000000');
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(rng.int(1)).toBe(0);
  });
});

describe('isSeed', () => {
  it('accepts exactly 32 lowercase hex characters', () => {
    expect(isSeed('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isSeed('0123456789ABCDEF0123456789ABCDEF')).toBe(false);
    expect(isSeed('0123456789abcdef0123456789abcde')).toBe(false);
    expect(isSeed('0123456789abcdef0123456789abcdef0')).toBe(false);
    expect(isSeed('g123456789abcdef0123456789abcdef')).toBe(false);
    expect(isSeed(42)).toBe(false);
    expect(isSeed(null)).toBe(false);
  });
});

describe('generateSeed', () => {
  it('returns 32 lowercase hex characters and differs between calls', () => {
    const a = generateSeed();
    const b = generateSeed();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('cryptoInt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects draws at or above the limit', () => {
    const draws = [0xffffffff, 7];
    const spy = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint32Array) array[0] = draws.shift() ?? 0;
        return array;
      });
    expect(cryptoInt(3)).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('throws RangeError outside [1, 2^32] and returns 0 for 1', () => {
    expect(() => cryptoInt(0)).toThrow(RangeError);
    expect(() => cryptoInt(1.5)).toThrow(RangeError);
    expect(() => cryptoInt(2 ** 32 + 1)).toThrow(RangeError);
    expect(cryptoInt(1)).toBe(0);
  });

  it('accepts the 2^32 upper bound', () => {
    const v = cryptoInt(2 ** 32);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(2 ** 32);
  });
});

const critical: readonly [max: number, chi2: number][] = [
  [4, 16.266],
  [6, 20.515],
  [8, 24.322],
  [10, 27.877],
  [12, 31.264],
  [20, 43.82],
  [100, 148.23],
  [3, 13.816],
];

const chiSquare = (max: number, next: (max: number) => number): number => {
  const perBucket = 2000;
  const counts = new Array<number>(max).fill(0);
  for (let i = 0; i < max * perBucket; i++) {
    const v = next(max);
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts.reduce((sum, c) => sum + ((c - perBucket) * (c - perBucket)) / perBucket, 0);
};

describe('chi-square uniformity (p = 0.001)', () => {
  const seedRng = createSeedRng('9e3779b97f4a7c15f39cc0605cedc834');
  for (const [max, limit] of critical) {
    it(`cryptoInt(${max}) is uniform`, () => {
      expect(chiSquare(max, cryptoInt)).toBeLessThan(limit);
    });
    it(`SeedRng.int(${max}) is uniform`, () => {
      expect(chiSquare(max, (m) => seedRng.int(m))).toBeLessThan(limit);
    });
  }
});
