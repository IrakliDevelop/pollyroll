import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RollEvent } from '../core/types';
import { labelText } from '../geometry/labels';
import { getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { quatMul, quatRotate } from '../geometry/vec';
import type { Quat } from '../geometry/vec';
import { planRoll } from './plan';
import type { PlannedBody } from './plan';
import { simulate } from './sim';
import type { SimInput } from './sim';
import type { TrayBounds } from './world';

const BOUNDS: TrayBounds = { minX: -6, maxX: 6, minZ: -4, maxZ: 4 };
const SHAPES: readonly ShapeType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
// Each property simulates whole rolls (up to 720 steps per wave), so runs are kept modest.
const NUM_RUNS = 20;

const seedArb = fc.string({
  unit: fc.constantFrom(...'0123456789abcdef'),
  minLength: 32,
  maxLength: 32,
});

/** 1–10 bodies of any shape, each thrown in wave 0, 1, or 2. */
const bodiesArb = fc.array(
  fc.record({ shape: fc.constantFrom(...SHAPES), wave: fc.integer({ min: 0, max: 2 }) }),
  { minLength: 1, maxLength: 10 },
);

const input = (seed: string, bodies: { shape: ShapeType; wave: number }[]): SimInput => ({
  seed,
  shapes: bodies.map((b) => b.shape),
  waves: bodies.map((b) => b.wave),
  bounds: BOUNDS,
});

type Shown = 'd6' | 'd10' | 'd20';
const valueArb = fc.oneof(
  ...(['d6', 'd10', 'd20'] as const).map((type) =>
    fc.integer({ min: 1, max: Number(type.slice(1)) }).map((value) => ({ type, value })),
  ),
);

/** Text a d6/d10/d20 shows for a value: d10 shows 10 as "0". */
const expectedText = (type: Shown, value: number): string =>
  type === 'd10' && value === 10 ? '0' : String(value);

/** Label on the readout pointing most upward at the last frame, rendered as q ⊗ remap. */
function topText(body: PlannedBody): string {
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

/** Index of the first differing byte of two frame arrays (the shorter length when one is a prefix
 *  or missing), or -1 when they are byte-identical. */
function firstByteDiff(a: Float32Array, b: Float32Array | undefined): number {
  const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const y = b ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(0);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return i;
  return x.length === y.length ? -1 : n;
}

describe('physics properties', () => {
  it('simulate produces only finite frame values for any seed', () => {
    fc.assert(
      fc.property(seedArb, bodiesArb, (seed, bodies) => {
        const result = simulate(input(seed, bodies));
        expect(result.tracks).toHaveLength(bodies.length);
        for (const track of result.tracks) {
          expect(track.frames.length).toBeGreaterThan(0);
          expect(track.frames.every((x) => Number.isFinite(x))).toBe(true);
        }
      }),
      {
        numRuns: NUM_RUNS,
        examples: [
          ['00000000000000000000000000000000', [{ shape: 'd4', wave: 0 }]],
          [
            'ffffffffffffffffffffffffffffffff',
            Array.from({ length: 10 }, () => ({ shape: 'd20' as const, wave: 0 })),
          ],
        ],
      },
    );
  });

  it('the same seed twice gives byte-identical tracks', () => {
    fc.assert(
      fc.property(seedArb, bodiesArb, (seed, bodies) => {
        const a = simulate(input(seed, bodies));
        const b = simulate(input(seed, bodies));
        expect(b.totalSteps).toBe(a.totalSteps);
        expect(b.settled).toBe(a.settled);
        a.tracks.forEach((track, i) => {
          const other = b.tracks[i];
          expect(other?.startStep).toBe(track.startStep);
          expect(other?.upReadout).toBe(track.upReadout);
          expect(firstByteDiff(track.frames, other?.frames)).toBe(-1);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('planRoll shows the chosen d6, d10, or d20 value on top after remap', () => {
    fc.assert(
      fc.property(seedArb, fc.array(valueArb, { minLength: 1, maxLength: 3 }), (seed, dice) => {
        const event: RollEvent = {
          v: 1,
          id: 'property',
          notation: dice.map((d) => `1${d.type}`).join('+'),
          dice: dice.map((d, group) => ({ type: d.type, value: d.value, group, wave: 0 })),
          modifier: 0,
          seed,
          createdAt: 0,
        };
        const plan = planRoll(event, BOUNDS);
        expect(plan.bodies).toHaveLength(dice.length);
        plan.bodies.forEach((body, i) => {
          const d = dice[i];
          if (d === undefined) throw new Error(`missing die ${i}`);
          expect(topText(body)).toBe(expectedText(d.type, d.value));
        });
      }),
      {
        numRuns: NUM_RUNS,
        examples: [
          [
            '0123456789abcdef0123456789abcdef',
            [
              { type: 'd10', value: 10 },
              { type: 'd20', value: 20 },
              { type: 'd6', value: 1 },
            ],
          ],
        ],
      },
    );
  });
});
