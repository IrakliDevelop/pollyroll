import { describe, expect, it } from 'vitest';
import { diceClacks } from './index';

describe('diceClacks', () => {
  it('lists 7 ordered clacks starting at -0.8 ms and ending by 430 ms', () => {
    const { clacks } = diceClacks;
    expect(clacks).toHaveLength(7);
    expect(clacks[0]?.[0]).toBe(-0.8);
    for (const [i, [start, length]] of clacks.entries()) {
      expect(length).toBeGreaterThan(0);
      if (i > 0) expect(start).toBeGreaterThan(clacks[i - 1]?.[0] ?? Infinity);
    }
    const [start, length] = clacks[6] ?? [Infinity, 0];
    expect(start + length).toBeLessThanOrEqual(430);
  });

  it('decodes to a 1,188-byte clip opening with an MPEG frame sync', () => {
    const bytes = Buffer.from(diceClacks.audio, 'base64');
    expect(bytes).toHaveLength(1188);
    expect(bytes[0]).toBe(0xff);
    expect((bytes[1] ?? 0) & 0xe0).toBe(0xe0);
  });
});
