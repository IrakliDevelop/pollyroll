import { describe, expect, it } from 'vitest';
import { SHAPES, getPolyhedron } from './polyhedra';
import type { ShapeType } from './polyhedra';
import { findRemap, getRotationGroup } from './symmetry';
import { quatMul, quatRotate } from './vec';
import type { Quat, Vec3 } from './vec';

function close(a: readonly number[], b: readonly number[], tol: number): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || Math.abs(x - y) > tol) return false;
  }
  return a.length === b.length;
}

function sameRotation(a: Quat, b: Quat, tol: number): boolean {
  return close(a, b, tol) || close(a, [-b[0], -b[1], -b[2], -b[3]], tol);
}

function inGroup(group: readonly Quat[], q: Quat): boolean {
  return group.some((g) => sameRotation(g, q, 1e-9));
}

const ORDERS: Record<ShapeType, number> = { d4: 12, d6: 24, d8: 24, d10: 10, d12: 60, d20: 60 };

describe('rotation groups', () => {
  it('has the expected order per shape (T 12, O 24, D5 10, I 60)', () => {
    for (const type of SHAPES) expect(getRotationGroup(type).length, type).toBe(ORDERS[type]);
  });

  it('caches each group', () => {
    for (const type of SHAPES) expect(getRotationGroup(type)).toBe(getRotationGroup(type));
  });

  for (const type of SHAPES) {
    describe(type, () => {
      const group = getRotationGroup(type);
      const vertices = getPolyhedron(type).vertices;
      const readouts = getPolyhedron(type).readouts;

      it('starts with the identity', () => {
        expect(close(group[0] ?? [], [0, 0, 0, 1], 1e-12)).toBe(true);
      });

      it('holds distinct unit rotations that map the vertex set onto itself', () => {
        group.forEach((g, i) => {
          expect(Math.abs(Math.hypot(...g) - 1)).toBeLessThanOrEqual(1e-12);
          for (let j = 0; j < i; j++) expect(sameRotation(g, group[j] ?? g, 1e-6)).toBe(false);
          for (const v of vertices) {
            const m = quatRotate(g, v);
            expect(vertices.some((w) => close(m, w, 1e-9))).toBe(true);
          }
        });
      });

      it('is closed under composition (up to sign)', () => {
        for (const a of group)
          for (const b of group) expect(inGroup(group, quatMul(a, b))).toBe(true);
      });

      it('is transitive on readouts via findRemap', () => {
        for (let from = 0; from < readouts.length; from++) {
          for (let to = 0; to < readouts.length; to++) {
            const g = findRemap(type, from, to);
            const r = readouts[from] ?? [0, 0, 0];
            const t = readouts[to] ?? [1, 1, 1];
            expect(close(quatRotate(g, r), t, 1e-9), `${from}->${to}`).toBe(true);
          }
        }
      });

      it('returns the first matching element (identity for from === to)', () => {
        for (let i = 0; i < readouts.length; i++) expect(findRemap(type, i, i)).toBe(group[0]);
      });
    });
  }

  it('contains the hand-computed generators', () => {
    const h = Math.sqrt(0.5);
    const yQuarter: Quat = [0, h, 0, h];
    expect(inGroup(getRotationGroup('d6'), yQuarter)).toBe(true);
    expect(inGroup(getRotationGroup('d8'), yQuarter)).toBe(true);
    expect(inGroup(getRotationGroup('d4'), yQuarter)).toBe(false);
    expect(inGroup(getRotationGroup('d10'), yQuarter)).toBe(false);
    // 72 degrees about Y: (0, sin 36, 0, cos 36).
    const c36 = (1 + Math.sqrt(5)) / 4;
    const s36 = Math.sqrt(10 - 2 * Math.sqrt(5)) / 4;
    expect(inGroup(getRotationGroup('d10'), [0, s36, 0, c36])).toBe(true);
    // 120 degrees about (1,1,1): x -> y -> z.
    const third: Quat = [0.5, 0.5, 0.5, 0.5];
    for (const type of ['d4', 'd6', 'd8', 'd12', 'd20'] as const) {
      expect(inGroup(getRotationGroup(type), third), type).toBe(true);
    }
  });

  it('throws when no element maps the readouts', () => {
    expect(() => findRemap('d6', 0, 6)).toThrow(Error);
    expect(() => findRemap('d4', -1, 0)).toThrow(Error);
  });

  it('remaps a d6 value face onto a settled up-face', () => {
    const readouts = getPolyhedron('d6').readouts;
    const up: Vec3 = [0, 1, 0];
    const settled = readouts.findIndex((r) => close(r, up, 1e-9));
    const valueFace = readouts.findIndex((r) => close(r, [1, 0, 0], 1e-9));
    const g = findRemap('d6', valueFace, settled);
    expect(close(quatRotate(g, [1, 0, 0]), up, 1e-9)).toBe(true);
  });
});
