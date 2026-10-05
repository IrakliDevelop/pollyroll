import { describe, expect, it } from 'vitest';
import { SHAPES, getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { getBodyShape, inertiaTensor } from './body';

/** Principal moments for a uniform solid of mass 1, from the closed forms in terms of the edge a
 *  (tetrahedron a²/20, cube a²/6, octahedron a²/10, dodecahedron (39φ + 28)a²/150, icosahedron
 *  φ²a²/10) with a derived from each die's circumradius. */
const MOMENTS: Partial<Record<ShapeType, number>> = {
  d4: 0.075,
  d6: 1 / 6,
  d8: 0.1125,
  d12: 0.160351,
  d20: 0.185243,
};

describe('getBodyShape', () => {
  for (const shape of SHAPES) {
    const expected = MOMENTS[shape];
    if (expected === undefined) continue;
    it(`${shape} has isotropic principal moment ${expected}`, () => {
      const body = getBodyShape(shape);
      for (let k = 0; k < 3; k++) {
        const inv = body.invInertia[k] ?? 0;
        expect(Math.abs(1 / inv - expected), `${shape} axis ${k}`).toBeLessThan(1e-5);
      }
    });
  }

  it('d10 has I_xx = I_zz != I_yy', () => {
    const [ix = 0, iy = 0, iz = 0] = getBodyShape('d10').invInertia;
    expect(Math.abs(ix - iz)).toBeLessThan(1e-9);
    expect(Math.abs(ix - iy)).toBeGreaterThan(1e-3);
  });

  it('drops off-diagonal terms that are below 1e-9 for every shape', () => {
    for (const shape of SHAPES) {
      const t = inertiaTensor(shape);
      for (const [r, c] of [
        [0, 1],
        [0, 2],
        [1, 2],
      ] as const) {
        expect(Math.abs(t[r * 3 + c] ?? 1), `${shape} ${r}${c}`).toBeLessThan(1e-9);
        expect(Math.abs(t[c * 3 + r] ?? 1), `${shape} ${c}${r}`).toBeLessThan(1e-9);
      }
    }
  });

  it('copies hull vertices and circumradius from the geometry', () => {
    for (const shape of SHAPES) {
      const poly = getPolyhedron(shape);
      const body = getBodyShape(shape);
      expect(body.shape).toBe(shape);
      expect(body.radius).toBe(poly.radius);
      expect(body.vertices.length).toBe(poly.vertices.length * 3);
      poly.vertices.forEach((v, i) => {
        expect(body.vertices[i * 3]).toBe(v[0]);
        expect(body.vertices[i * 3 + 1]).toBe(v[1]);
        expect(body.vertices[i * 3 + 2]).toBe(v[2]);
      });
    }
  });

  it('caches per shape', () => {
    expect(getBodyShape('d8')).toBe(getBodyShape('d8'));
  });
});
