import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHAPES, getPolyhedron } from './polyhedra';
import type { ShapeType } from './polyhedra';
import {
  IDENTITY,
  add,
  cross,
  dot,
  length,
  normalize,
  quatFromMatrix,
  quatMul,
  quatRotate,
  scale,
  sub,
} from './vec';
import type { Quat, Vec3 } from './vec';

function at<T>(list: readonly T[], i: number): T {
  const item = list[i];
  if (item === undefined) throw new Error(`index ${i} out of range`);
  return item;
}

function expectVecClose(actual: readonly number[], expected: readonly number[], tol: number): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs(at(actual, i) - at(expected, i))).toBeLessThanOrEqual(tol);
  }
}

const EXPECTED: Record<
  ShapeType,
  { faces: number; vertices: number; radius: number; sides: number }
> = {
  d4: { faces: 4, vertices: 4, radius: 0.75, sides: 3 },
  d6: { faces: 6, vertices: 8, radius: Math.sqrt(3) / 2, sides: 4 },
  d8: { faces: 8, vertices: 6, radius: 0.75, sides: 3 },
  d10: { faces: 10, vertices: 12, radius: 0.75, sides: 4 },
  d12: { faces: 12, vertices: 20, radius: 0.72, sides: 5 },
  d20: { faces: 20, vertices: 12, radius: 0.8, sides: 3 },
};

describe('vec', () => {
  it('does basic vector arithmetic', () => {
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(sub([1, 2, 3], [4, 5, 6])).toEqual([-3, -3, -3]);
    expect(scale([1, -2, 3], 2)).toEqual([2, -4, 6]);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(length([3, 4, 12])).toBe(13);
    expect(normalize([0, 3, 4])).toEqual([0, 0.6, 0.8]);
  });

  it('normalizes zero-length and tiny vectors to zero', () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
    expect(normalize([1e-13, 0, 0])).toEqual([0, 0, 0]);
  });

  it('multiplies and applies quaternions (Hamilton)', () => {
    const h = Math.sqrt(0.5);
    const z90: Quat = [0, 0, h, h];
    expect(quatMul(IDENTITY, z90)).toEqual(z90);
    expectVecClose(quatRotate(z90, [1, 0, 0]), [0, 1, 0], 1e-15);
    // Two 90 degree turns about Z make a 180 degree turn.
    expectVecClose(quatMul(z90, z90), [0, 0, 1, 0], 1e-15);
    // Apply b (90 about Z) then a (90 about X): x -> y -> z.
    const x90: Quat = [h, 0, 0, h];
    expectVecClose(quatRotate(quatMul(x90, z90), [1, 0, 0]), [0, 0, 1], 1e-15);
  });

  it('converts rotation matrices with canonical sign', () => {
    expect(quatFromMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1])).toEqual([0, 0, 0, 1]);
    const h = Math.sqrt(0.5);
    expectVecClose(quatFromMatrix([0, -1, 0, 1, 0, 0, 0, 0, 1]), [0, 0, h, h], 1e-15);
    expectVecClose(quatFromMatrix([1, 0, 0, 0, -1, 0, 0, 0, -1]), [1, 0, 0, 0], 1e-15);
    expectVecClose(quatFromMatrix([-1, 0, 0, 0, 1, 0, 0, 0, -1]), [0, 1, 0, 0], 1e-15);
    expectVecClose(quatFromMatrix([-1, 0, 0, 0, -1, 0, 0, 0, 1]), [0, 0, 1, 0], 1e-15);
    // 120 degrees about (1,1,1): x -> y -> z -> x.
    expectVecClose(quatFromMatrix([0, 0, 1, 1, 0, 0, 0, 1, 0]), [0.5, 0.5, 0.5, 0.5], 1e-15);
    // Its inverse: the raw Shepperd branch yields w < 0, so the sign flips.
    expectVecClose(quatFromMatrix([0, 1, 0, 0, 0, 1, 1, 0, 0]), [-0.5, -0.5, -0.5, 0.5], 1e-15);
    // 180 degrees about (1,-1,0)/sqrt2: w = 0 and the first non-zero component must be positive.
    expectVecClose(quatFromMatrix([0, -1, 0, -1, 0, 0, 0, 0, -1]), [h, -h, 0, 0], 1e-15);
  });
});

describe('polyhedra', () => {
  it('lists the shapes in order', () => {
    expect(SHAPES).toEqual(['d4', 'd6', 'd8', 'd10', 'd12', 'd20']);
  });

  it('caches each polyhedron', () => {
    for (const type of SHAPES) {
      expect(getPolyhedron(type)).toBe(getPolyhedron(type));
      expect(getPolyhedron(type).type).toBe(type);
    }
  });

  for (const type of SHAPES) {
    describe(type, () => {
      const p = getPolyhedron(type);
      const exp = EXPECTED[type];

      it('has the expected face, vertex, and side counts', () => {
        expect(p.faces.length).toBe(exp.faces);
        expect(p.vertices.length).toBe(exp.vertices);
        expect(p.normals.length).toBe(exp.faces);
        for (const face of p.faces) expect(face.length).toBe(exp.sides);
      });

      it('satisfies Euler V - E + F = 2', () => {
        const edges = new Set<string>();
        for (const face of p.faces) {
          for (let i = 0; i < face.length; i++) {
            const a = at(face, i);
            const b = at(face, (i + 1) % face.length);
            edges.add(a < b ? `${a}-${b}` : `${b}-${a}`);
          }
        }
        expect(p.vertices.length - edges.size + p.faces.length).toBe(2);
      });

      it('has the target circumradius and centroid at the origin', () => {
        expect(Math.abs(p.radius - exp.radius)).toBeLessThanOrEqual(1e-12);
        let max = 0;
        let c: Vec3 = [0, 0, 0];
        for (const v of p.vertices) {
          max = Math.max(max, length(v));
          c = add(c, v);
        }
        expect(p.radius).toBe(max);
        expectVecClose(scale(c, 1 / p.vertices.length), [0, 0, 0], 1e-12);
      });

      it('has planar, convex, counter-clockwise, outward faces with unit normals', () => {
        p.faces.forEach((face, f) => {
          const n = at(p.normals, f);
          expect(Math.abs(length(n) - 1)).toBeLessThanOrEqual(1e-12);
          const v0 = at(p.vertices, at(face, 0));
          const v1 = at(p.vertices, at(face, 1));
          const v2 = at(p.vertices, at(face, 2));
          for (const i of face) {
            expect(Math.abs(dot(n, sub(at(p.vertices, i), v0)))).toBeLessThanOrEqual(1e-9);
          }
          for (const v of p.vertices) expect(dot(n, sub(v, v0))).toBeLessThanOrEqual(1e-9);
          expect(dot(n, cross(sub(v1, v0), sub(v2, v0)))).toBeGreaterThan(0);
          for (let i = 0; i < face.length; i++) {
            const a = at(p.vertices, at(face, i));
            const b = at(p.vertices, at(face, (i + 1) % face.length));
            const c = at(p.vertices, at(face, (i + 2) % face.length));
            expect(dot(n, cross(sub(b, a), sub(c, b)))).toBeGreaterThan(0);
          }
          expect(dot(n, v0)).toBeGreaterThan(0);
          expect(at(face, 0)).toBe(Math.min(...face));
        });
      });

      it('reads up from unit readouts', () => {
        if (type === 'd4') {
          expect(p.readouts.length).toBe(4);
          p.readouts.forEach((r, i) => {
            expectVecClose(r, scale(at(p.vertices, i), 1 / 0.75), 1e-12);
          });
        } else {
          expect(p.readouts).toEqual(p.normals);
        }
        for (const r of p.readouts) expect(Math.abs(length(r) - 1)).toBeLessThanOrEqual(1e-12);
      });
    });
  }

  it('builds a d6 with edge length exactly 1', () => {
    const p = getPolyhedron('d6');
    for (const face of p.faces) {
      for (let i = 0; i < face.length; i++) {
        const a = at(p.vertices, at(face, i));
        const b = at(p.vertices, at(face, (i + 1) % face.length));
        expect(length(sub(a, b))).toBe(1);
      }
    }
    for (const v of p.vertices) for (const c of v) expect(Math.abs(c)).toBe(0.5);
  });

  it('builds a d4 from the listed raw vertices in order', () => {
    const s = 0.75 / Math.sqrt(3);
    const raw: Vec3[] = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ];
    raw.forEach((v, i) => expectVecClose(at(getPolyhedron('d4').vertices, i), scale(v, s), 1e-15));
  });

  it('builds a d8 with vertices in the listed order', () => {
    const raw: Vec3[] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    raw.forEach((v, i) => expectVecClose(at(getPolyhedron('d8').vertices, i), scale(v, 0.75), 0));
  });

  it('builds a d10 with apexes on the Y axis and kite faces', () => {
    const p = getPolyhedron('d10');
    const top = at(p.vertices, 0);
    const bottom = at(p.vertices, 1);
    expect(top[0]).toBe(0);
    expect(top[2]).toBe(0);
    expect(top[1]).toBeGreaterThan(0);
    expectVecClose(bottom, [0, -top[1], 0], 0);
    for (const face of p.faces) {
      // Each kite holds exactly one apex.
      expect(face.filter((i) => i < 2).length).toBe(1);
    }
  });
});

describe('determinism guard', () => {
  it('uses no transcendental or random Math functions in src/geometry', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.bench.ts'),
    );
    expect(files).toEqual(
      expect.arrayContaining(['vec.ts', 'polyhedra.ts', 'labels.ts', 'symmetry.ts']),
    );
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, f).not.toMatch(/Math\.(sin|cos|tan|atan2?|asin|acos|exp|pow|log|random)\b/);
    }
  });
});
