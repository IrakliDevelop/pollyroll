import { describe, expect, it } from 'vitest';
import { getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { quatMul, quatRotate } from '../geometry/vec';
import type { Quat } from '../geometry/vec';
import {
  FLATTEN_STEPS,
  flatOrientation,
  flattenTail,
  footprint,
  liftTails,
  separate,
} from './flatten';
import { penetration } from './penetration';
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
    const tail = flattenTail('d6', pose, 1.5, -2);
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
    // Halfway through the 18-step flatten phase the tilt about Z halves to 10°, so the die rests at
    // 0.5·(cos10° + sin10°) ≈ 0.5792, above the linear 0.5704.
    const mid = frameAt(tail, FLATTEN_STEPS / 4 - 1);
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
    const tail = flattenTail('d8', new Float64Array([0, -rest.lowY, 0, ...q]), 0, 0);
    expect(tail).not.toBeNull();
    if (tail !== null) expectAboveFloor('d8', tail);
  });

  it('slides a d6 stacked on another off it before dropping it to the floor', () => {
    const bottom = new Float64Array([0, 0.5, 0, 0, 0, 0, 1]);
    const top = new Float64Array([0, 1.5, 0, 0, 0, 0, 1]);
    const square = footprint('d6', [0, 0, 0, 1]);
    const xz = new Float64Array([0, 0, 0, 0]);
    separate(xz, [square, square], { minX: -4, maxX: 4, minZ: -4, maxZ: 4 });
    const lower = flattenTail('d6', bottom, xz[0] ?? NaN, xz[1] ?? NaN);
    const upper = flattenTail('d6', top, xz[2] ?? NaN, xz[3] ?? NaN);
    expect(lower).not.toBeNull();
    expect(upper).not.toBeNull();
    if (lower === null || upper === null) return;
    for (let k = 0; k < FLATTEN_STEPS; k++) {
      const depth = penetration('d6', frameAt(lower, k), 'd6', frameAt(upper, k));
      expect(depth, `frame ${k}`).toBeLessThanOrEqual(0.005);
    }
    const last = frameAt(upper, FLATTEN_STEPS - 1);
    expect(last[1]).toBeCloseTo(0.5, 9);
    expect(penetration('d6', frameAt(lower, FLATTEN_STEPS - 1), 'd6', last)).toBe(0);
  });

  it('leaves a die within 0.5° of flat alone', () => {
    const quarter = (0.2 * Math.PI) / 180;
    const pose = new Float64Array([0, 0.5, 0, Math.sin(quarter), 0, 0, Math.cos(quarter)]);
    expect(flattenTail('d6', pose, 0, 0)).toBeNull();
  });
});

describe('separate', () => {
  // Flat identity d6 footprints are squares ±0.5; pairs end GAP 0.05 apart, so centres 1.05.
  const square = footprint('d6', [0, 0, 0, 1]);
  const bounds: TrayBounds = { minX: -3, maxX: 3, minZ: -2, maxZ: 2 };

  it('moves two overlapping flat d6 apart and tails them to the new centres', () => {
    const a = new Float64Array([0, 0.5, 0, 0, 0, 0, 1]);
    const b = new Float64Array([0.6, 0.5, 0, 0, 0, 0, 1]);
    const xz = new Float64Array([0, 0, 0.6, 0]);
    separate(xz, [square, square], bounds);
    // Overlap on x is 1 − 0.6 = 0.4; each moves (0.4 + 0.05) / 2 = 0.225.
    expect(xz[0]).toBeCloseTo(-0.225, 12);
    expect(xz[2]).toBeCloseTo(0.825, 12);
    expect([xz[1], xz[3]]).toEqual([0, 0]);
    for (const [pose, k] of [
      [a, 0],
      [b, 2],
    ] as const) {
      const tail = flattenTail('d6', pose, xz[k] ?? NaN, xz[k + 1] ?? NaN);
      expect(tail).not.toBeNull();
      if (tail === null) return;
      const last = frameAt(tail, FLATTEN_STEPS - 1);
      expect(last[0]).toBeCloseTo(xz[k] ?? NaN, 6);
      expect(last[1]).toBeCloseTo(0.5, 6);
      expect(last[2]).toBe(0);
    }
  });

  it('pushes coincident centres 1.05 apart along one axis', () => {
    const xz = new Float64Array([1, 0, 1, 0]);
    separate(xz, [square, square], bounds);
    const dx = Math.abs((xz[2] ?? NaN) - (xz[0] ?? NaN));
    const dz = Math.abs((xz[3] ?? NaN) - (xz[1] ?? NaN));
    expect(Math.min(dx, dz)).toBe(0);
    expect(Math.max(dx, dz)).toBeCloseTo(1.05, 9);
  });

  it('keeps moved footprints inside the walls', () => {
    // Against the +x wall the right die stops at 3 − 0.5; each pass halves the remaining overlap.
    const xz = new Float64Array([2, 0, 2.2, 0]);
    separate(xz, [square, square], bounds);
    expect(xz[2]).toBe(2.5);
    expect((xz[2] ?? NaN) - (xz[0] ?? NaN)).toBeGreaterThanOrEqual(1.05 - 0.01);
  });

  it('leaves dice already 1.1 apart alone', () => {
    const xz = new Float64Array([0, 0, 1.1, 0]);
    separate(xz, [square, square], bounds);
    expect(Array.from(xz)).toEqual([0, 0, 1.1, 0]);
  });
});

describe('simulate ends without overlap', () => {
  const wide: TrayBounds = { minX: -6.5, maxX: 6.5, minZ: -3.5, maxZ: 3.5 };
  const cases: [string, ShapeType[], TrayBounds][] = [
    [
      'A',
      [
        ...Array<ShapeType>(6).fill('d20'),
        ...Array<ShapeType>(6).fill('d12'),
        ...Array<ShapeType>(6).fill('d8'),
      ],
      wide,
    ],
    ['B', Array<ShapeType>(30).fill('d6'), { minX: -8.25, maxX: 8.25, minZ: -4.75, maxZ: 4.75 }],
    [
      'C',
      Array.from({ length: 24 }, (_, k) => CYCLE[k % 6] ?? 'd6'),
      // trayBounds(608 / 360, s) at the 0.3.0 area-only fit for 24 dice.
      { minX: -7.5, maxX: 7.5, minZ: -4.25, maxZ: 4.25 },
    ],
  ];

  it('lifts a d6 cocked on the edge of a flat d6 over it by at most 1.5', () => {
    // B is turned −30° about z with its bottom face on A's top edge (0.5, 1) at face point
    // (−0.2, −0.5): centre (0.5, 1) − R(−0.2, −0.5) = (0.5 + 0.4232, 1 + 0.3333); its lowest vertex
    // R(0.5, −0.5) = (0.183, −0.683) sits at y 0.650, beside A. Flattened in place it would sink
    // into A, and separate() pushes A too, so both have tails.
    const a = new Float64Array([0, 0.5, 0, 0, 0, 0, 1]);
    const half = (-15 * Math.PI) / 180;
    const b = new Float64Array([0.9232, 1.3333, 0, 0, 0, Math.sin(half), Math.cos(half)]);
    const xz = new Float64Array([0, 0, 0.9232, 0]);
    const bounds: TrayBounds = { minX: -4, maxX: 4, minZ: -4, maxZ: 4 };
    separate(
      xz,
      [footprint('d6', [0, 0, 0, 1]), footprint('d6', flatOrientation('d6', b))],
      bounds,
    );
    const tails = [
      flattenTail('d6', a, xz[0] ?? NaN, xz[1] ?? NaN),
      flattenTail('d6', b, xz[2] ?? NaN, xz[3] ?? NaN),
    ];
    const plain = tails[1];
    expect(plain).not.toBeNull();
    if (plain === null || plain === undefined) return;
    const sunk = Math.max(
      ...Array.from({ length: FLATTEN_STEPS }, (_, k) =>
        penetration('d6', frameAt(tails[0] ?? a, k), 'd6', frameAt(plain, k)),
      ),
    );
    expect(sunk).toBeGreaterThan(0.005);
    liftTails(['d6', 'd6'], [a, b], xz, tails);
    const [ta, tb] = tails;
    expect(ta).not.toBeNull();
    expect(tb).not.toBeNull();
    if (!ta || !tb) return;
    for (let k = 0; k < FLATTEN_STEPS; k++) {
      const depth = penetration('d6', frameAt(ta, k), 'd6', frameAt(tb, k));
      expect(depth, `frame ${k}`).toBeLessThanOrEqual(0.005);
      expect((ta[k * 7 + 1] ?? NaN) - 0.5, `A frame ${k}`).toBeLessThanOrEqual(1.5);
      expect((tb[k * 7 + 1] ?? NaN) - 1.3333, `B frame ${k}`).toBeLessThanOrEqual(1.5);
    }
  });

  it('no two dice interpenetrate at the final frame of crowded rolls', () => {
    for (const [name, shapes, bounds] of cases) {
      for (let i = 0; i < 30; i++) {
        const seed = i.toString(16).padStart(32, '0');
        const result = simulate({ seed, shapes, waves: shapes.map(() => 0), bounds });
        const last = result.tracks.map((t) => frameAt(t.frames, t.frames.length / 7 - 1));
        result.tracks.forEach((a, j) => {
          for (let k = j + 1; k < result.tracks.length; k++) {
            const b = result.tracks[k];
            if (b === undefined) continue;
            const depth = penetration(a.shape, last[j] ?? [], b.shape, last[k] ?? []);
            expect(depth, `case ${name} seed ${i} dice ${j},${k}`).toBeLessThanOrEqual(0.005);
          }
        });
      }
    }
  }, 300_000);
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
      const tail = result.tailSteps;
      if (tail === 0) continue;
      tailed++;
      result.tracks.forEach((t) => {
        const n = t.frames.length / 7;
        const final = frameAt(t.frames, n - 1);
        const before = frameAt(t.frames, n - 1 - tail);
        if (restOf(t.shape, before).upY < COS_HALF_DEGREE) return;
        if (before[0] !== final[0] || before[2] !== final[2]) return;
        // Already flat and not pushed apart: holds its final frame through the tail.
        for (let s = n - 1 - tail; s < n - 1; s++) expect(frameAt(t.frames, s)).toEqual(final);
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
