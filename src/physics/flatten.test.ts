import { describe, expect, it } from 'vitest';
import { getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { quatMul, quatRotate } from '../geometry/vec';
import type { Quat } from '../geometry/vec';
import { FLATTEN_STEPS, flattenTail } from './flatten';
import { simulate } from './sim';
import type { SimResult } from './sim';
import type { TrayBounds } from './world';

const CYCLE: ShapeType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
const COS_HALF_DEGREE = Math.cos((0.5 * Math.PI) / 180);

function frameAt(frames: ArrayLike<number>, k: number): number[] {
  return Array.from({ length: 7 }, (_, i) => frames[k * 7 + i] ?? NaN);
}

function quatOf(f: readonly number[]): Quat {
  return [f[3] ?? 0, f[4] ?? 0, f[5] ?? 0, f[6] ?? 1];
}

function restOf(shape: ShapeType, f: readonly number[]): { upY: number; lowY: number } {
  const q = quatOf(f);
  const poly = getPolyhedron(shape);
  const upY = Math.max(...poly.readouts.map((r) => quatRotate(q, r)[1]));
  const lowY = (f[1] ?? NaN) + Math.min(...poly.vertices.map((v) => quatRotate(q, v)[1]));
  return { upY, lowY };
}

function expectAboveFloor(shape: ShapeType, frames: Float64Array): void {
  for (let k = 0; k < frames.length / 7; k++)
    expect(restOf(shape, frameAt(frames, k)).lowY, `frame ${k}`).toBeGreaterThan(-1e-6);
}

function expectFlatEnd(result: SimResult, label: string): void {
  for (const t of result.tracks) {
    const last = frameAt(t.frames, t.frames.length / 7 - 1);
    const { upY, lowY } = restOf(t.shape, last);
    expect(upY, `${label} ${t.shape}`).toBeGreaterThanOrEqual(COS_HALF_DEGREE);
    expect(Math.abs(lowY), `${label} ${t.shape}`).toBeLessThan(0.01);
    const ys = getPolyhedron(t.shape).readouts.map((r) => quatRotate(quatOf(last), r)[1]);
    expect(ys.indexOf(Math.max(...ys)), `${label} ${t.shape}`).toBe(t.upReadout);
  }
}

describe('flattenTail', () => {
  it('turns a d6 tilted 20° about Z flat and lowers it onto the floor', () => {
    // Tilted 20°: the lowest vertex sits at −0.5·(cos20° + sin20°) ≈ −0.6408, so the die rests
    // with its centre at 0.6408. Flat, the top normal is +Y and the centre is at 0.5 (edge 1).
    const half = (10 * Math.PI) / 180;
    const pose = new Float64Array([1.5, 0.6408, -2, 0, 0, Math.sin(half), Math.cos(half)]);
    const tail = flattenTail('d6', pose);
    expect(tail).not.toBeNull();
    if (tail === null) return;
    expect(tail.length).toBe(FLATTEN_STEPS * 7);
    const last = frameAt(tail, FLATTEN_STEPS - 1);
    const top = quatRotate(quatOf(last), [0, 1, 0]);
    expect(Math.abs(top[0])).toBeLessThan(1e-6);
    expect(Math.abs(top[1] - 1)).toBeLessThan(1e-6);
    expect(Math.abs(top[2])).toBeLessThan(1e-6);
    expect(Math.abs((last[1] ?? NaN) - 0.5)).toBeLessThan(1e-3);
    expect([last[0], last[2]]).toEqual([1.5, -2]);
    // Halfway the tilt about Z halves to 10°, so the die rests at 0.5·(cos10° + sin10°) ≈ 0.5792,
    // above the linear 0.5704.
    const mid = frameAt(tail, FLATTEN_STEPS / 2 - 1);
    expect(Math.abs((mid[1] ?? NaN) - 0.5792)).toBeLessThan(1e-3);
    expect(quatRotate(quatOf(mid), [0, 1, 0])[1]).toBeCloseTo(Math.cos(half), 3);
    expectAboveFloor('d6', tail);
  });

  it('keeps a d8 tilted 50° above the floor through the tail', () => {
    // Face normal n = (1,1,1)/√3 turned to +Y, then tilted 50° away from vertex (1,0,0), so +Y
    // leans toward that vertex in the body frame and n stays the top face.
    const n = 1 / Math.sqrt(3);
    const aw = 1 + n;
    const an = Math.sqrt(n * n + n * n + aw * aw);
    const q0: Quat = [-n / an, 0, n / an, aw / an];
    const v = quatRotate(q0, [1, 0, 0]);
    const dn = Math.hypot(v[0], v[2]);
    const half = (-25 * Math.PI) / 180;
    const q1: Quat = [
      (Math.sin(half) * v[2]) / dn,
      0,
      (-Math.sin(half) * v[0]) / dn,
      Math.cos(half),
    ];
    const q = quatMul(q1, q0);
    const rest = restOf('d8', [0, 0, 0, ...q]);
    expect(rest.upY).toBeCloseTo(Math.cos((50 * Math.PI) / 180), 9);
    const tail = flattenTail('d8', new Float64Array([0, -rest.lowY, 0, ...q]));
    expect(tail).not.toBeNull();
    if (tail !== null) expectAboveFloor('d8', tail);
  });

  it('leaves a die within 0.5° of flat alone', () => {
    const quarter = (0.2 * Math.PI) / 180;
    const pose = new Float64Array([0, 0.5, 0, Math.sin(quarter), 0, 0, Math.cos(quarter)]);
    expect(flattenTail('d6', pose)).toBeNull();
  });
});

describe('simulate ends flat', () => {
  it('every die of 100 mixed 1–10 dice rolls ends flat on the floor', () => {
    const bounds: TrayBounds = { minX: -5.75, maxX: 5.75, minZ: -4.5, maxZ: 4.5 };
    let tailed = 0;
    let held = 0;
    for (let i = 0; i < 100; i++) {
      const shapes = Array.from({ length: 1 + (i % 10) }, (_, k) => CYCLE[(i + k) % 6] ?? 'd6');
      const input = {
        seed: i.toString(16).padStart(32, '0'),
        shapes,
        waves: shapes.map(() => 0),
        bounds,
      };
      const result = simulate(input);
      expectFlatEnd(result, `seed ${i}`);
      const again = simulate(input);
      expect(again.totalSteps).toBe(result.totalSteps);
      again.tracks.forEach((t, k) => {
        expect(
          Buffer.from(t.frames.buffer).equals(
            Buffer.from(result.tracks[k]?.frames.buffer ?? new ArrayBuffer(0)),
          ),
        ).toBe(true);
      });
      const cocked = result.tracks.map((t) => {
        const n = t.frames.length / 7;
        return (
          n > FLATTEN_STEPS &&
          restOf(t.shape, frameAt(t.frames, n - 1 - FLATTEN_STEPS)).upY < COS_HALF_DEGREE
        );
      });
      if (!cocked.includes(true)) continue;
      tailed++;
      result.tracks.forEach((t, k) => {
        if (cocked[k] === true) return;
        // Already flat: holds its final frame through the tail.
        const n = t.frames.length / 7;
        const final = frameAt(t.frames, n - 1);
        for (let s = n - 1 - FLATTEN_STEPS; s < n - 1; s++)
          expect(frameAt(t.frames, s)).toEqual(final);
        held++;
      });
    }
    expect(tailed).toBeGreaterThan(0);
    expect(held).toBeGreaterThan(0);
  }, 120_000);

  it.each(CYCLE)(
    '200 single %s rolls end flat',
    (shape) => {
      const bounds: TrayBounds = { minX: -6.5, maxX: 6.5, minZ: -4.5, maxZ: 4.5 };
      for (let i = 0; i < 200; i++) {
        const seed = (0x1000 + i).toString(16).padStart(32, '0');
        expectFlatEnd(simulate({ seed, shapes: [shape], waves: [0], bounds }), `seed ${i}`);
      }
    },
    120_000,
  );
});
