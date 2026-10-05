import { describe, expect, it } from 'vitest';
import { PollyrollSyntaxError } from './notation';
import { createRoll } from './roll';

const S = '0123456789abcdef0123456789abcdef';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** RNG returning the listed numbers in order; throws when exhausted. */
const seq = (...values: number[]): ((max: number) => number) => {
  let i = 0;
  return () => {
    const v = values[i++];
    if (v === undefined) throw new Error('seq exhausted');
    return v;
  };
};

const brief = (dice: { type: string; value: number | null; group: number; wave: number }[]) =>
  dice.map((d) => [d.type, d.value, d.group, d.wave]);

describe('createRoll', () => {
  it('builds a v1 event from injected values', () => {
    const before = Date.now();
    const event = createRoll('2d20kh1+5', { rng: seq(6, 14), seed: S });
    const after = Date.now();
    expect(event.dice).toEqual([
      { type: 'd20', value: 7, group: 0, wave: 0 },
      { type: 'd20', value: 15, group: 0, wave: 0 },
    ]);
    expect(event.v).toBe(1);
    expect(event.notation).toBe('2d20kh1+5');
    expect(event.modifier).toBe(5);
    expect(event.seed).toBe(S);
    expect(event.id).toMatch(UUID_V4);
    expect(event.createdAt).toBeGreaterThanOrEqual(before);
    expect(event.createdAt).toBeLessThanOrEqual(after);
    expect('skin' in event).toBe(false);
    expect('rollerId' in event).toBe(false);
    expect('audience' in event).toBe(false);
  });

  it('passes the die size to the rng', () => {
    const maxes: number[] = [];
    createRoll('1d4+1d8+1d10+1d12+1d20+1d100+1dF+1d6', {
      rng: (max) => {
        maxes.push(max);
        return 0;
      },
    });
    expect(maxes).toEqual([4, 8, 10, 12, 20, 100, 3, 6]);
  });

  it('explodes into later waves', () => {
    const event = createRoll('1d6!', { rng: seq(5, 5, 2), seed: S });
    expect(brief(event.dice)).toEqual([
      ['d6', 6, 0, 0],
      ['d6', 6, 0, 1],
      ['d6', 3, 0, 2],
    ]);
  });

  it('caps explosions at wave 10', () => {
    const event = createRoll('1d6!', { rng: () => 5 });
    expect(event.dice).toHaveLength(11);
    expect(event.dice.every((d) => d.value === 6)).toBe(true);
    expect(event.dice.map((d) => d.wave)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('orders dice wave-major across groups', () => {
    const event = createRoll('2d6!+1d4!', { rng: seq(5, 0, 3, 1, 2) });
    expect(brief(event.dice)).toEqual([
      ['d6', 6, 0, 0],
      ['d6', 1, 0, 0],
      ['d4', 4, 1, 0],
      ['d6', 2, 0, 1],
      ['d4', 3, 1, 1],
    ]);
  });

  it('does not explode terms without !', () => {
    const event = createRoll('1d6', { rng: seq(5) });
    expect(brief(event.dice)).toEqual([['d6', 6, 0, 0]]);
  });

  it('assigns groups by dice term, skipping constants', () => {
    const event = createRoll('3+1d4-2+1d6', { rng: seq(0, 0) });
    expect(event.dice.map((d) => d.group)).toEqual([0, 1]);
    expect(event.modifier).toBe(1);
  });

  it('maps dF and d% values', () => {
    expect(createRoll('1dF', { rng: seq(0) }).dice[0]?.value).toBe(-1);
    expect(createRoll('1dF', { rng: seq(2) }).dice[0]?.value).toBe(1);
    expect(createRoll('1d%', { rng: seq(99) }).dice[0]).toEqual({
      type: 'd100',
      value: 100,
      group: 0,
      wave: 0,
    });
  });

  it('rejects invalid rng outputs', () => {
    expect(() => createRoll('1d6', { rng: () => -1 })).toThrow(RangeError);
    expect(() => createRoll('1d6', { rng: () => 6 })).toThrow(RangeError);
    expect(() => createRoll('1d6', { rng: () => 1.5 })).toThrow(RangeError);
    expect(() => createRoll('1d6', { rng: () => Number.NaN })).toThrow(RangeError);
  });

  it('rejects an invalid seed', () => {
    expect(() => createRoll('1d6', { seed: 'XYZ' })).toThrow(TypeError);
  });

  it('generates a default seed and values', () => {
    const event = createRoll('10d20');
    expect(event.seed).toMatch(/^[0-9a-f]{32}$/);
    for (const d of event.dice) {
      expect(Number.isInteger(d.value)).toBe(true);
      expect(d.value).toBeGreaterThanOrEqual(1);
      expect(d.value).toBeLessThanOrEqual(20);
    }
    expect(createRoll('1d6').id).not.toBe(event.id);
  });

  it('copies skin, rollerId, and audience when given', () => {
    const skin = { material: 'metal' as const, color: '#fff', labelColor: '#000' };
    const event = createRoll('1d6', { skin, rollerId: 'p1', audience: ['a', 'b'] });
    expect(event.skin).toEqual(skin);
    expect(event.rollerId).toBe('p1');
    expect(event.audience).toEqual(['a', 'b']);
    expect(createRoll('1d6', { skin: 'classic', audience: 'dm' })).toMatchObject({
      skin: 'classic',
      audience: 'dm',
    });
  });

  it('propagates syntax errors', () => {
    expect(() => createRoll('1d7')).toThrow(PollyrollSyntaxError);
  });
});
