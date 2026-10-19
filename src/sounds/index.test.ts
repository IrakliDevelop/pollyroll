import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { coinClinks, diceClacks } from './index';

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

describe('coinClinks', () => {
  it('lists 8 clinks of 25–30 ms starting no earlier than 5 ms before the first sound', () => {
    const { clacks } = coinClinks;
    expect(clacks).toHaveLength(8);
    for (const [start, length] of clacks) {
      expect(Number.isFinite(start)).toBe(true);
      expect(start).toBeGreaterThanOrEqual(-5);
      expect(length).toBeGreaterThanOrEqual(25);
      expect(length).toBeLessThanOrEqual(30);
    }
  });

  it('decodes to an MP3 opening with a frame sync and no ID3 tag', () => {
    const bytes = Buffer.from(coinClinks.audio, 'base64');
    expect(bytes.subarray(0, 3).toString('latin1')).not.toBe('ID3');
    expect(bytes[0]).toBe(0xff);
    expect((bytes[1] ?? 0) & 0xe0).toBe(0xe0);
  });
});
