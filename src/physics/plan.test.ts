import { describe, expect, it } from 'vitest';
import type { DieType, RolledDie, RollEvent } from '../core/types';
import { labelText } from '../geometry/labels';
import { getPolyhedron } from '../geometry/polyhedra';
import { getRotationGroup } from '../geometry/symmetry';
import { IDENTITY, quatMul, quatRotate } from '../geometry/vec';
import type { Quat } from '../geometry/vec';
import { MAX_BODIES, planRoll } from './plan';
import type { PlannedBody } from './plan';
import type { TrayBounds } from './world';

const BOUNDS: TrayBounds = { minX: -6, maxX: 6, minZ: -4, maxZ: 4 };

function event(notation: string, dice: RolledDie[], seed: string): RollEvent {
  return { v: 1, id: 't', notation, dice, modifier: 0, seed, createdAt: 0 };
}

function die(type: DieType, value: number | null, wave = 0, group = 0): RolledDie {
  return { type, value, group, wave };
}

function seedFor(typeIndex: number, value: number): string {
  return (typeIndex * 1000 + value + 1000).toString(16).padStart(32, '0');
}

/** Text on the readout pointing most upward at the last frame, rendered as q ⊗ remap. */
function shownText(body: PlannedBody): string {
  const f = body.frames;
  const n = f.length;
  const q: Quat = [f[n - 4] ?? 0, f[n - 3] ?? 0, f[n - 2] ?? 0, f[n - 1] ?? 1];
  const r = quatMul(q, body.remap);
  let best = -1;
  let bestY = -Infinity;
  getPolyhedron(body.shape).readouts.forEach((v, k) => {
    const y = quatRotate(r, v)[1];
    if (y > bestY) {
      bestY = y;
      best = k;
    }
  });
  return labelText(body.labelSet, best);
}

function nearQuat(a: Quat, b: Quat): boolean {
  return a.every((x, i) => Math.abs(x - (b[i] ?? NaN)) < 1e-12);
}

const SINGLE: [DieType, number[], (v: number) => string][] = [
  ['d4', [1, 2, 3, 4], String],
  ['d6', [1, 2, 3, 4, 5, 6], String],
  ['d8', [1, 2, 3, 4, 5, 6, 7, 8], String],
  ['d10', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], (v) => (v === 10 ? '0' : String(v))],
  ['d12', Array.from({ length: 12 }, (_, i) => i + 1), String],
  ['d20', Array.from({ length: 20 }, (_, i) => i + 1), String],
  ['dF', [-1, 0, 1], (v) => (v === -1 ? '−' : v === 0 ? '' : '+')],
];

describe('planRoll remap', () => {
  SINGLE.forEach(([type, values, expected], t) => {
    it(`${type}: every value shows on top after remap`, () => {
      const ups = new Set<number>();
      for (const value of values) {
        const plan = planRoll(event(`1${type}`, [die(type, value)], seedFor(t, value)), BOUNDS);
        expect(plan.bodies).toHaveLength(1);
        const body = plan.bodies[0];
        if (body === undefined) throw new Error('no body');
        expect(body.value).toBe(value);
        expect(body.die).toBe(0);
        expect(body.labelSet).toBe(type);
        expect(body.shape).toBe(type === 'dF' ? 'd6' : type);
        expect(shownText(body)).toBe(expected(value));
        ups.add(body.upReadout);
      }
      expect(ups.size).toBeGreaterThanOrEqual(2);
    });
  });

  it('d100: every value 1–100 shows tens and ones on top', () => {
    expect.hasAssertions();
    const tensUps = new Set<number>();
    const onesUps = new Set<number>();
    const spot: Record<number, [string, string]> = {
      100: ['00', '0'],
      7: ['00', '7'],
      50: ['50', '0'],
      99: ['90', '9'],
    };
    for (let v = 1; v <= 100; v++) {
      const plan = planRoll(event('1d100', [die('d100', v)], seedFor(9, v)), BOUNDS);
      const [tens, ones, extra] = plan.bodies;
      if (tens === undefined || ones === undefined) throw new Error('missing d100 body');
      expect(extra).toBeUndefined();
      expect(tens.labelSet).toBe('d100tens');
      expect(ones.labelSet).toBe('d100ones');
      expect(tens.shape).toBe('d10');
      expect(ones.shape).toBe('d10');
      const t = v === 100 ? 0 : Math.floor(v / 10);
      const o = v % 10;
      expect(tens.value).toBe(t);
      expect(ones.value).toBe(o);
      const text: [string, string] = [shownText(tens), shownText(ones)];
      expect(text).toEqual([t === 0 ? '00' : `${t}0`, String(o)]);
      const want = spot[v];
      if (want !== undefined) expect(text).toEqual(want);
      tensUps.add(tens.upReadout);
      onesUps.add(ones.upReadout);
    }
    expect(tensUps.size).toBeGreaterThanOrEqual(2);
    expect(onesUps.size).toBeGreaterThanOrEqual(2);
  });

  it('remap is an element of the rotation group', () => {
    const group = getRotationGroup('d20');
    for (let v = 1; v <= 20; v++) {
      const plan = planRoll(event('1d20', [die('d20', v)], seedFor(5, v)), BOUNDS);
      const body = plan.bodies[0];
      if (body === undefined) throw new Error('no body');
      expect(group.some((g) => nearQuat(g, body.remap))).toBe(true);
    }
  });
});

describe('planRoll bodies', () => {
  it('redacted event: identity remaps and null values', () => {
    const plan = planRoll(
      event(
        '1d20+1d100+1dF',
        [die('d20', null), die('d100', null, 0, 1), die('dF', null, 0, 2)],
        seedFor(1, 1),
      ),
      BOUNDS,
    );
    expect(plan.bodies.map((b) => b.labelSet)).toEqual(['d20', 'd100tens', 'd100ones', 'dF']);
    for (const body of plan.bodies) {
      expect(body.value).toBeNull();
      expect(body.remap).toEqual(IDENTITY);
    }
  });

  it('caps at MAX_BODIES bodies', () => {
    expect(MAX_BODIES).toBe(30);
    const dice = Array.from({ length: 40 }, () => die('d6', 3));
    const plan = planRoll(event('40d6', dice, seedFor(2, 0)), BOUNDS);
    expect(plan.bodies.map((b) => b.die)).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it('skips a d100 that does not fit and everything after it', () => {
    const dice = [
      ...Array.from({ length: 29 }, () => die('d6', 2)),
      die('d100', 42, 0, 1),
      die('d6', 5, 0, 2),
    ];
    const plan = planRoll(event('29d6+1d100+1d6', dice, seedFor(3, 0)), BOUNDS);
    expect(plan.bodies).toHaveLength(29);
    expect(plan.bodies.every((b) => b.labelSet === 'd6')).toBe(true);
    expect(plan.bodies.map((b) => b.die)).toEqual(Array.from({ length: 29 }, (_, i) => i));
  });

  it('a d100 fills the last two slots as tens then ones with the same die', () => {
    const dice = [...Array.from({ length: 28 }, () => die('d6', 2)), die('d100', 42, 0, 1)];
    const plan = planRoll(event('28d6+1d100', dice, seedFor(4, 0)), BOUNDS);
    expect(plan.bodies).toHaveLength(30);
    const tail = plan.bodies.slice(28).map((b) => [b.die, b.labelSet, b.value]);
    expect(tail).toEqual([
      [28, 'd100tens', 4],
      [28, 'd100ones', 2],
    ]);
  });

  it('explosion waves start in order', () => {
    const plan = planRoll(
      event('1d6!', [die('d6', 6, 0), die('d6', 6, 1), die('d6', 2, 2)], seedFor(6, 0)),
      BOUNDS,
    );
    expect(plan.bodies.map((b) => b.wave)).toEqual([0, 1, 2]);
    const [a, b, c] = plan.bodies.map((x) => x.startStep);
    expect(a).toBeDefined();
    expect(b).toBeGreaterThan(a ?? Infinity);
    expect(c).toBeGreaterThan(b ?? Infinity);
    for (const body of plan.bodies) expect(shownText(body)).toBe(String(body.value));
    expect(plan.totalSteps).toBeGreaterThan(c ?? Infinity);
  });

  it('is deterministic', () => {
    const e = event(
      '2d20+1d100',
      [die('d20', 4), die('d20', 17), die('d100', 63, 0, 1)],
      seedFor(7, 0),
    );
    const a = planRoll(e, BOUNDS);
    const b = planRoll(e, BOUNDS);
    expect(a.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(b.hash).toBe(a.hash);
    expect(b.settled).toBe(a.settled);
    expect(b.totalSteps).toBe(a.totalSteps);
    a.bodies.forEach((body, i) => {
      const other = b.bodies[i];
      expect(other).toBeDefined();
      expect(new Uint8Array(other?.frames.buffer ?? new ArrayBuffer(0))).toEqual(
        new Uint8Array(body.frames.buffer),
      );
    });
  });
});
