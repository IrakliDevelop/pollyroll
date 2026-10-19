import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { diceClacks } from './index';

describe('diceClacks', () => {
  it('lists 7 ordered clacks starting at -2.9 ms and ending by 430 ms', () => {
    const { clacks } = diceClacks;
    expect(clacks).toHaveLength(7);
    expect(clacks[0]?.[0]).toBe(-2.9);
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

  it('keeps the 0.5.0 data byte for byte', () => {
    const hash = createHash('sha256').update(JSON.stringify(diceClacks)).digest('hex');
    expect(hash).toBe('8fb77eb47ea985a7c8cab16863f41f99752aebed9b16ff5d956368ba6dc4ef25');
  });
});
