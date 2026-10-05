const TWO_32 = 2 ** 32;
const SEED_PATTERN = /^[0-9a-f]{32}$/;
const word = new Uint32Array(1);

/** Unbiased integer in [0, max) from a uint32 source, rejecting draws at or above the limit. */
function rejectionInt(max: number, draw: () => number): number {
  if (!Number.isInteger(max) || max < 1 || max > TWO_32) {
    throw new RangeError(`maxExclusive must be an integer in [1, 2^32], got ${max}`);
  }
  const limit = TWO_32 - (TWO_32 % max);
  let u = draw();
  while (u >= limit) u = draw();
  return u % max;
}

/** One uint32 from crypto.getRandomValues. */
function cryptoU32(): number {
  let u = 0;
  for (const w of globalThis.crypto.getRandomValues(word)) u = w;
  return u;
}

/** Unbiased integer in [0, maxExclusive) from crypto.getRandomValues with rejection sampling. */
export function cryptoInt(maxExclusive: number): number {
  return rejectionInt(maxExclusive, cryptoU32);
}

/** 128-bit seed as 32 lowercase hex characters, from crypto.getRandomValues. */
export function generateSeed(): string {
  const words = globalThis.crypto.getRandomValues(new Uint32Array(4));
  let seed = '';
  for (const w of words) seed += w.toString(16).padStart(8, '0');
  return seed;
}

/** True when `value` is a string of exactly 32 lowercase hex characters. */
export function isSeed(value: unknown): value is string {
  return typeof value === 'string' && SEED_PATTERN.test(value);
}

export interface SeedRng {
  /** Next raw sfc32 output, an unsigned 32-bit integer. */
  u32(): number;
  /** Uniform float in [0, 1): u32() / 2^32. */
  float(): number;
  /** Unbiased integer in [0, maxExclusive) using the same rejection rule as cryptoInt. */
  int(maxExclusive: number): number;
}

/** sfc32 stream seeded from a 128-bit hex seed; throws TypeError when !isSeed(seed). */
export function createSeedRng(seed: string): SeedRng {
  if (!isSeed(seed)) throw new TypeError('seed must be 32 lowercase hex characters');
  const part = (i: number): number => parseInt(seed.slice(i * 8, i * 8 + 8), 16) | 0;
  let a = part(0);
  let b = part(1);
  let c = part(2);
  let d = part(3);
  const u32 = (): number => {
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) u32();
  return {
    u32,
    float: () => u32() / TWO_32,
    int: (maxExclusive) => rejectionInt(maxExclusive, u32),
  };
}
