import { describe, expect, it } from 'vitest';
import { SHAPES, getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { getBodyShape, inertiaTensor } from './body';

/** Principal moments for a uniform solid of mass 1, from the closed forms in terms of the edge a
 *  (tetrahedron a²/20, cube a²/6, octahedron a²/10, dodecahedron (39φ + 28)a²/150, icosahedron
 *  φ²a²/10) with a derived from each die's circumradius: d4 R 0.95 → a² = 8R²/3 = 2.406667,
 *  I = 0.120333; d20 R 0.85 → a² = 16R²/(10 + 2√5) = 11.56/14.472136 = 0.798776, I = 0.209122. */
const MOMENTS: Partial<Record<ShapeType, number>> = {
  d4: 0.120333,
  d6: 1 / 6,
  d8: 0.1125,
  d12: 0.160351,
  d20: 0.209122,
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

  it('d6 planes are the six axis normals at offset 0.5', () => {
    const planes = Array.from(getBodyShape('d6').planes);
    const rows = [];
    for (let f = 0; f < planes.length; f += 4) rows.push(planes.slice(f, f + 4).join(','));
    expect(rows.sort()).toEqual(
      ['-1,0,0,0.5', '0,-1,0,0.5', '0,0,-1,0.5', '0,0,1,0.5', '0,1,0,0.5', '1,0,0,0.5'].sort(),
    );
  });

  it('every hull vertex lies inside every face plane and on its own faces', () => {
    for (const shape of SHAPES) {
      const poly = getPolyhedron(shape);
      const { planes } = getBodyShape(shape);
      expect(planes.length, shape).toBe(poly.faces.length * 4);
      poly.faces.forEach((face, f) => {
        const [nx = 0, ny = 0, nz = 0, h = 0] = planes.subarray(f * 4, f * 4 + 4);
        poly.vertices.forEach((v, k) => {
          const s = nx * v[0] + ny * v[1] + nz * v[2] - h;
          expect(s, `${shape} face ${f} vertex ${k}`).toBeLessThanOrEqual(1e-12);
          if (face.includes(k))
            expect(Math.abs(s), `${shape} face ${f} own ${k}`).toBeLessThan(1e-12);
        });
      });
    }
  });

  it('every face edge (p, q) has side normal (q - p) x n pointing away from the face centre', () => {
    for (const shape of SHAPES) {
      const { faces, vertices, planes } = getBodyShape(shape);
      faces.forEach((face, f) => {
        const n = [planes[f * 4] ?? 0, planes[f * 4 + 1] ?? 0, planes[f * 4 + 2] ?? 0];
        const point = (i: number): number[] =>
          [0, 1, 2].map((c) => vertices[(face[i % face.length] ?? 0) * 3 + c] ?? 0);
        const centre = [0, 1, 2].map(
          (c) => face.reduce((sum, _, i) => sum + (point(i)[c] ?? 0), 0) / face.length,
        );
        face.forEach((_, i) => {
          const [px = 0, py = 0, pz = 0] = point(i);
          const [qx = 0, qy = 0, qz = 0] = point(i + 1);
          const [ex, ey, ez] = [qx - px, qy - py, qz - pz];
          const [nx = 0, ny = 0, nz = 0] = n;
          const side = [ey * nz - ez * ny, ez * nx - ex * nz, ex * ny - ey * nx];
          const toCentre = [(centre[0] ?? 0) - px, (centre[1] ?? 0) - py, (centre[2] ?? 0) - pz];
          const dot = side.reduce((sum, v, c) => sum + v * (toCentre[c] ?? 0), 0);
          expect(dot, `${shape} face ${f} edge ${i}`).toBeLessThan(-1e-9);
        });
      });
    }
  });

  it('caches per shape', () => {
    expect(getBodyShape('d8')).toBe(getBodyShape('d8'));
  });
});
