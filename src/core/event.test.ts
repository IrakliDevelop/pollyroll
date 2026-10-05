import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate';
import { isRollEvent, redact } from './event';
import { createRoll } from './roll';
import type { RollEvent } from './types';

const S = '0123456789abcdef0123456789abcdef';

const seq = (...values: number[]): ((max: number) => number) => {
  let i = 0;
  return () => {
    const v = values[i++];
    if (v === undefined) throw new Error('seq exhausted');
    return v;
  };
};

type Loose = Record<string, unknown> & { dice: unknown[] };

/** Deep copy of `event` as a loose record, after applying `change`. */
const mutate = (event: RollEvent, change: (e: Loose) => void): unknown => {
  const copy = JSON.parse(JSON.stringify(event)) as Loose;
  change(copy);
  return copy;
};

const d = (value: unknown, wave: number, group = 0, type = 'd6') => ({ type, value, group, wave });

/** '2d20kh1+5' with values 7 and 15. */
const base = (): RollEvent => createRoll('2d20kh1+5', { rng: seq(6, 14), seed: S });
/** '1d6!' with values 6 (wave 0) and 3 (wave 1). */
const exploding = (): RollEvent => createRoll('1d6!', { rng: seq(5, 2), seed: S });

describe('redact', () => {
  it('nulls every value in a copy and leaves the original untouched', () => {
    const event = createRoll('2d6!+1d4+3', { rng: seq(5, 1, 2, 0), seed: S, rollerId: 'p' });
    const snapshot = JSON.parse(JSON.stringify(event)) as unknown;
    const hidden = redact(event);
    expect(hidden).not.toBe(event);
    expect(hidden.dice).not.toBe(event.dice);
    expect(hidden.dice.every((die) => die.value === null)).toBe(true);
    expect(hidden.dice.map((die) => [die.type, die.group, die.wave])).toEqual(
      event.dice.filter((die) => die.wave === 0).map((die) => [die.type, die.group, die.wave]),
    );
    expect({ ...hidden, dice: [] }).toEqual({ ...event, dice: [] });
    expect(event).toEqual(snapshot);
    expect(evaluate(hidden).total).toBeNull();
  });

  it('drops explosion dice so a redacted chain does not reveal how it exploded', () => {
    const chain = createRoll('1d20!', { rng: seq(19, 19, 2), seed: S });
    const single = createRoll('1d20!', { rng: seq(6), seed: S });
    expect(chain.dice.map((die) => die.value)).toEqual([20, 20, 3]);
    expect(single.dice.map((die) => die.value)).toEqual([7]);
    const snapshot = JSON.parse(JSON.stringify(chain)) as unknown;
    const hidden = redact(chain);
    const expected = [{ type: 'd20', value: null, group: 0, wave: 0 }];
    expect(hidden.dice).toEqual(expected);
    expect(redact(single).dice).toEqual(expected);
    expect(isRollEvent(hidden)).toBe(true);
    expect(evaluate(hidden).total).toBeNull();
    expect(chain).toEqual(snapshot);
  });

  it('shares no nested audience or skin objects with the original', () => {
    const event = createRoll('1d6', {
      rng: seq(0),
      seed: S,
      audience: ['a', 'b'],
      skin: { material: 'gem', color: ['red', 'blue'], labelColor: 'white' },
    });
    const snapshot = JSON.parse(JSON.stringify(event)) as unknown;
    const hidden = redact(event);
    expect(hidden.audience).toEqual(event.audience);
    expect(hidden.skin).toEqual(event.skin);
    if (Array.isArray(hidden.audience)) hidden.audience.push('c');
    if (typeof hidden.skin === 'object') {
      hidden.skin.labelColor = 'black';
      if (Array.isArray(hidden.skin.color)) hidden.skin.color[0] = 'green';
    }
    expect(event).toEqual(snapshot);
    const solid = createRoll('1d6', {
      rng: seq(0),
      seed: S,
      skin: { material: 'gem', color: 'red', labelColor: 'white' },
    });
    expect(redact(solid).skin).toEqual(solid.skin);
    expect(redact(solid).skin).not.toBe(solid.skin);
  });
});

describe('isRollEvent', () => {
  it('accepts createRoll output, a JSON round trip, and a redacted copy', () => {
    const event = createRoll('2d6!+1d4-1d8kh1+3', {
      seed: S,
      skin: 'classic',
      rollerId: 'p1',
      audience: ['a'],
    });
    expect(isRollEvent(event)).toBe(true);
    expect(isRollEvent(JSON.parse(JSON.stringify(event)))).toBe(true);
    expect(isRollEvent(redact(event))).toBe(true);
    expect(isRollEvent(base())).toBe(true);
    expect(isRollEvent(exploding())).toBe(true);
    expect(isRollEvent(redact(exploding()))).toBe(true);
  });

  it('accepts a full 1d6! chain of 11 dice', () => {
    const event = createRoll('1d6!', { rng: () => 5 });
    expect(event.dice).toHaveLength(11);
    expect(isRollEvent(event)).toBe(true);
  });

  it('accepts valid optional fields', () => {
    const ok = (change: (e: Record<string, unknown>) => void): boolean =>
      isRollEvent(mutate(base(), change));
    expect(ok((e) => (e.skin = 'x'.repeat(64)))).toBe(true);
    expect(
      ok(
        (e) =>
          (e.skin = {
            material: { metalness: 0, roughness: 1, clearcoat: 0.5 },
            color: ['#fff', '#000'],
            labelColor: '#000',
            labelStyle: 'embossed',
            pattern: 'marble',
            font: 'serif',
          }),
      ),
    ).toBe(true);
    expect(ok((e) => (e.skin = { material: 'gem', color: 'red', labelColor: 'white' }))).toBe(true);
    expect(ok((e) => (e.audience = 'all'))).toBe(true);
    expect(ok((e) => (e.audience = 'dm'))).toBe(true);
    expect(ok((e) => (e.audience = Array.from({ length: 100 }, () => 'x')))).toBe(true);
    expect(ok((e) => (e.rollerId = 'x'.repeat(128)))).toBe(true);
    expect(ok((e) => (e.id = 'x'.repeat(128)))).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isRollEvent(null)).toBe(false);
    expect(isRollEvent([])).toBe(false);
    expect(isRollEvent('x')).toBe(false);
    expect(isRollEvent(undefined)).toBe(false);
  });

  it('never throws on hostile input', () => {
    const hostile = Object.defineProperty({ v: 1, id: 'a' }, 'notation', {
      get() {
        throw new Error('boom');
      },
    });
    expect(isRollEvent(hostile)).toBe(false);
  });

  const top: [string, (e: Loose) => void][] = [
    ['v 2', (e) => (e.v = 2)],
    ['id empty', (e) => (e.id = '')],
    ['id 129 chars', (e) => (e.id = 'x'.repeat(129))],
    ['notation bad', (e) => (e.notation = 'bad')],
    ['notation 1d7', (e) => (e.notation = '1d7')],
    ['notation not a string', (e) => (e.notation = 5)],
    ['seed uppercase', (e) => (e.seed = S.toUpperCase())],
    ['modifier 4 for +5', (e) => (e.modifier = 4)],
    ['modifier 5.5', (e) => (e.modifier = 5.5)],
    ['modifier string', (e) => (e.modifier = '5')],
    ['createdAt NaN', (e) => (e.createdAt = Number.NaN)],
    ['createdAt -1', (e) => (e.createdAt = -1)],
    ['createdAt Infinity', (e) => (e.createdAt = Number.POSITIVE_INFINITY)],
    ['dice empty', (e) => (e.dice = [])],
    ['dice not an array', (e) => Object.assign(e, { dice: {} })],
    ['dice too long', (e) => (e.dice = Array.from({ length: 2201 }, () => d(7, 0, 0, 'd20')))],
    ['die null', (e) => (e.dice[0] = null as never)],
    ['die type d7', (e) => (e.dice[0] = d(7, 0, 0, 'd7') as never)],
    ['die type mismatch with group', (e) => (e.dice[0] = d(5, 0, 0, 'd6'))],
    ['group -1', (e) => (e.dice[0] = d(7, 0, -1, 'd20'))],
    ['group 1 for one term', (e) => (e.dice[0] = d(7, 0, 1, 'd20'))],
    ['group 0.5', (e) => (e.dice[0] = d(7, 0, 0.5, 'd20'))],
    ['wave 11', (e) => (e.dice[1] = d(7, 11, 0, 'd20'))],
    ['value 0 for d20', (e) => (e.dice[0] = d(0, 0, 0, 'd20'))],
    ['value 21 for d20', (e) => (e.dice[0] = d(21, 0, 0, 'd20'))],
    ['value 1.5', (e) => (e.dice[0] = d(1.5, 0, 0, 'd20'))],
    ['value string', (e) => (e.dice[0] = d('7' as never, 0, 0, 'd20'))],
    ['extra wave-0 die', (e) => e.dice.push(d(3, 0, 0, 'd20'))],
    ['missing wave-0 die', (e) => e.dice.pop()],
    ['skin 65 chars', (e) => (e.skin = 'x'.repeat(65))],
    ['skin empty string', (e) => (e.skin = '')],
    ['skin null', (e) => (e.skin = null as never)],
    [
      'skin with glsl pattern',
      (e) => (e.skin = { material: 'gem', color: 'red', labelColor: 'w', pattern: { glsl: 'x' } }),
    ],
    [
      'skin with metalness 2',
      (e) => (e.skin = { material: { metalness: 2, roughness: 0 }, color: 'r', labelColor: 'w' }),
    ],
    [
      'skin with clearcoat NaN',
      (e) =>
        (e.skin = {
          material: { metalness: 0, roughness: 0, clearcoat: Number.NaN },
          color: 'r',
          labelColor: 'w',
        }),
    ],
    [
      'skin with unknown material',
      (e) => (e.skin = { material: 'cheese' as never, color: 'r', labelColor: 'w' }),
    ],
    [
      'skin color array of 3',
      (e) => (e.skin = { material: 'gem', color: ['a', 'b', 'c'] as never, labelColor: 'w' }),
    ],
    [
      'skin color 65 chars',
      (e) => (e.skin = { material: 'gem', color: 'x'.repeat(65), labelColor: 'w' }),
    ],
    ['skin without labelColor', (e) => (e.skin = { material: 'gem', color: 'r' } as never)],
    [
      'skin labelStyle neon',
      (e) =>
        (e.skin = { material: 'gem', color: 'r', labelColor: 'w', labelStyle: 'neon' as never }),
    ],
    [
      'skin font empty',
      (e) => (e.skin = { material: 'gem', color: 'r', labelColor: 'w', font: '' }),
    ],
    [
      'skin font 129 chars',
      (e) => (e.skin = { material: 'gem', color: 'r', labelColor: 'w', font: 'x'.repeat(129) }),
    ],
    ['rollerId empty', (e) => (e.rollerId = '')],
    ['rollerId number', (e) => (e.rollerId = 1 as never)],
    ['audience everyone', (e) => (e.audience = 'everyone' as never)],
    ['audience [1]', (e) => (e.audience = [1] as never)],
    ['audience [""]', (e) => (e.audience = [''])],
    ['audience of 101', (e) => (e.audience = Array.from({ length: 101 }, () => 'x'))],
    ['audience sparse array', (e) => (e.audience = new Array<string>(3))],
    [
      'skin color sparse array',
      (e) => (e.skin = { material: 'gem', color: new Array(2) as never, labelColor: 'w' }),
    ],
    ['dice with a hole', (e) => delete e.dice[1]],
  ];
  it.each(top)('rejects %s', (_name, change) => {
    expect(isRollEvent(mutate(base(), change))).toBe(false);
  });

  it('rejects value 0 for d6 and value 2 for dF', () => {
    expect(isRollEvent(mutate(exploding(), (e) => (e.dice[1] = d(0, 1))))).toBe(false);
    const fudge = createRoll('1dF', { rng: seq(0), seed: S });
    expect(isRollEvent(fudge)).toBe(true);
    expect(isRollEvent(mutate(fudge, (e) => (e.dice[0] = d(2, 0, 0, 'dF'))))).toBe(false);
  });

  it('checks explosion structure', () => {
    const ex = exploding();
    const bad = (dice: ReturnType<typeof d>[]): boolean =>
      isRollEvent(mutate(ex, (e) => (e.dice = dice)));
    expect(bad([d(6, 0), d(3, 1)])).toBe(true);
    // extra wave-0 die
    expect(bad([d(2, 0), d(6, 0), d(3, 1)])).toBe(false);
    // missing explosion die
    expect(bad([d(6, 0)])).toBe(false);
    // extra explosion die
    expect(bad([d(6, 0), d(3, 1), d(4, 1)])).toBe(false);
    // explosion without a max in the previous wave
    expect(bad([d(5, 0), d(3, 1)])).toBe(false);
    // waves decreasing in array order
    expect(bad([d(3, 1), d(6, 0)])).toBe(false);
    // wave 10 dice never spawn more
    const chain = Array.from({ length: 11 }, (_, w) => d(6, w));
    expect(bad(chain)).toBe(true);
    expect(bad([...chain, d(6, 11)])).toBe(false);
  });

  it('rejects explosion dice on a non-exploding term', () => {
    const plain = createRoll('1d6', { rng: seq(5), seed: S });
    expect(isRollEvent(plain)).toBe(true);
    expect(isRollEvent(mutate(plain, (e) => e.dice.push(d(3, 1))))).toBe(false);
  });

  it('allows redacted explosions to shrink but not grow per wave', () => {
    const ex = exploding();
    const check = (dice: ReturnType<typeof d>[]): boolean =>
      isRollEvent(mutate(ex, (e) => (e.dice = dice)));
    expect(check([d(null, 0), d(null, 1)])).toBe(true);
    expect(check([d(null, 0)])).toBe(true);
    expect(check([d(null, 0), d(null, 1), d(null, 1)])).toBe(false);
    expect(check([d(null, 0), d(null, 2)])).toBe(false);
    expect(check([d(null, 1)])).toBe(false);
    expect(check([d(6, 0), d(null, 1), d(null, 1)])).toBe(false);
  });
});
