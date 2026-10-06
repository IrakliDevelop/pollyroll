import { describe, expect, it } from 'vitest';
import { BEVEL, MESH_STRIDE, getDieMesh } from './mesh';
import type { DieMesh } from './mesh';
import { SHAPES, getPolyhedron } from './polyhedra';
import { add, cross, dot, length, scale, sub } from './vec';
import type { Vec3 } from './vec';

interface MeshVertex {
  p: Vec3;
  n: Vec3;
  uv: readonly [number, number];
  cell: number;
}

function vertex(mesh: DieMesh, i: number): MeshVertex {
  const at = (k: number): number => {
    const v = mesh.data[i * MESH_STRIDE + k];
    if (v === undefined) throw new RangeError(`float ${k} of vertex ${i} missing`);
    return v;
  };
  return { p: [at(0), at(1), at(2)], n: [at(3), at(4), at(5)], uv: [at(6), at(7)], cell: at(8) };
}

function triangles(mesh: DieMesh): [MeshVertex, MeshVertex, MeshVertex][] {
  const out: [MeshVertex, MeshVertex, MeshVertex][] = [];
  for (let i = 0; i + 2 < mesh.vertexCount; i += 3) {
    out.push([vertex(mesh, i), vertex(mesh, i + 1), vertex(mesh, i + 2)]);
  }
  return out;
}

function vertices(mesh: DieMesh): MeshVertex[] {
  return Array.from({ length: mesh.vertexCount }, (_, i) => vertex(mesh, i));
}

function uvArea(t: readonly [MeshVertex, MeshVertex, MeshVertex]): number {
  const [a, b, c] = t;
  return (b.uv[0] - a.uv[0]) * (c.uv[1] - a.uv[1]) - (c.uv[0] - a.uv[0]) * (b.uv[1] - a.uv[1]);
}

/** Label square of a labelled triangle: side length (|∂p/∂u|) and the position of uv (0.5, 0.5). */
function labelSquare(t: readonly [MeshVertex, MeshVertex, MeshVertex]): {
  side: number;
  center: Vec3;
} {
  const [a, b, c] = t;
  const e1 = sub(b.p, a.p);
  const e2 = sub(c.p, a.p);
  const du1 = b.uv[0] - a.uv[0];
  const dv1 = b.uv[1] - a.uv[1];
  const du2 = c.uv[0] - a.uv[0];
  const dv2 = c.uv[1] - a.uv[1];
  const det = du1 * dv2 - du2 * dv1;
  const pu = scale(sub(scale(e1, dv2), scale(e2, dv1)), 1 / det);
  const pv = scale(sub(scale(e2, du1), scale(e1, du2)), 1 / det);
  const center = add(a.p, add(scale(pu, 0.5 - a.uv[0]), scale(pv, 0.5 - a.uv[1])));
  return { side: length(pu), center };
}

/** Distance from p to the line through a and b. */
function lineDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const e = sub(b, a);
  return length(cross(sub(p, a), e)) / length(e);
}

/** Index of the hull face whose normal matches `n` (labels sit on face planes). */
function faceOf(shape: (typeof SHAPES)[number], n: Vec3): number {
  return getPolyhedron(shape).normals.findIndex((m) => dot(m, n) > 1 - 1e-5);
}

describe('getDieMesh', () => {
  it('uses the documented stride and bevel', () => {
    expect(MESH_STRIDE).toBe(9);
    expect(BEVEL).toBe(0.08);
  });

  it.each(SHAPES)('%s: whole triangles with unit normals inside the hull radius', (shape) => {
    const mesh = getDieMesh(shape);
    const poly = getPolyhedron(shape);
    expect(mesh.shape).toBe(shape);
    expect(mesh.vertexCount).toBeGreaterThan(0);
    expect(mesh.vertexCount % 3).toBe(0);
    expect(mesh.data.length).toBe(mesh.vertexCount * MESH_STRIDE);
    for (const v of vertices(mesh)) {
      expect(Math.abs(length(v.n) - 1)).toBeLessThan(1e-6);
      expect(length(v.p)).toBeLessThanOrEqual(poly.radius + 1e-6);
    }
  });

  it.each(SHAPES)('%s: every triangle is counter-clockwise from outside', (shape) => {
    for (const [a, b, c] of triangles(getDieMesh(shape))) {
      const g = cross(sub(b.p, a.p), sub(c.p, a.p));
      const ns: Vec3 = [
        a.n[0] + b.n[0] + c.n[0],
        a.n[1] + b.n[1] + c.n[1],
        a.n[2] + b.n[2] + c.n[2],
      ];
      expect(dot(g, ns)).toBeGreaterThan(0);
    }
  });

  it.each(SHAPES)('%s: label cells cover exactly the readout indexes', (shape) => {
    const cells = new Set(vertices(getDieMesh(shape)).map((v) => v.cell));
    const labelled = [...cells].filter((c) => c >= 0).sort((a, b) => a - b);
    expect(labelled).toEqual(getPolyhedron(shape).readouts.map((_, i) => i));
    for (const c of cells) expect(c === -1 || c >= 0).toBe(true);
  });

  it.each(SHAPES)(
    '%s: unlabelled vertices carry (−1, −1); label triangles are not mirrored',
    (shape) => {
      const tris = triangles(getDieMesh(shape));
      let labelled = 0;
      for (const t of tris) {
        const cells = t.map((v) => v.cell);
        expect(new Set(cells).size).toBe(1);
        if (t[0].cell < 0) {
          for (const v of t) expect(v.uv).toEqual([-1, -1]);
          continue;
        }
        labelled++;
        expect(uvArea(t)).toBeGreaterThan(0);
      }
      expect(labelled).toBeGreaterThan(0);
    },
  );

  it('d6: the label square center (0.5, 0.5) is the face centroid', () => {
    const poly = getPolyhedron('d6');
    const tris = triangles(getDieMesh('d6')).filter((t) => t[0].cell >= 0);
    for (const [a, b, c] of tris) {
      // Affine map (lu, lv) → position through this triangle, evaluated at (0.5, 0.5).
      const det = uvArea([a, b, c]);
      const du = 0.5 - a.uv[0];
      const dv = 0.5 - a.uv[1];
      const s = (du * (c.uv[1] - a.uv[1]) - dv * (c.uv[0] - a.uv[0])) / det;
      const r = ((b.uv[0] - a.uv[0]) * dv - (b.uv[1] - a.uv[1]) * du) / det;
      const p = add(a.p, add(scale(sub(b.p, a.p), s), scale(sub(c.p, a.p), r)));
      const face = poly.faces[a.cell] ?? [];
      let centroid: Vec3 = [0, 0, 0];
      for (const i of face) centroid = add(centroid, poly.vertices[i] ?? [0, 0, 0]);
      centroid = scale(centroid, 1 / face.length);
      expect(length(sub(p, centroid))).toBeLessThan(1e-5);
    }
  });

  it('d4: 12 label quads, each face shows exactly its own three vertices', () => {
    const poly = getPolyhedron('d4');
    const tris = triangles(getDieMesh('d4')).filter((t) => t[0].cell >= 0);
    expect(tris.length).toBe(24);
    const quads = new Set<string>();
    const shown = poly.faces.map(() => new Set<number>());
    for (const t of tris) {
      const g = cross(sub(t[1].p, t[0].p), sub(t[2].p, t[0].p));
      const f = faceOf('d4', [g[0] / length(g), g[1] / length(g), g[2] / length(g)]);
      expect(f).toBeGreaterThanOrEqual(0);
      shown[f]?.add(t[0].cell);
      quads.add(`${f}:${t[0].cell}`);
    }
    expect(quads.size).toBe(12);
    poly.faces.forEach((face, f) => {
      expect([...(shown[f] ?? [])].sort()).toEqual([...face].sort());
    });
  });

  it.each(SHAPES.filter((s) => s !== 'd4'))(
    '%s: label square side is 1.45 × the inset face inradius; its glyph circle fits the face',
    (shape) => {
      const byCell = new Map<number, [MeshVertex, MeshVertex, MeshVertex][]>();
      for (const t of triangles(getDieMesh(shape))) {
        if (t[0].cell < 0) continue;
        byCell.set(t[0].cell, [...(byCell.get(t[0].cell) ?? []), t]);
      }
      expect(byCell.size).toBe(getPolyhedron(shape).readouts.length);
      for (const tris of byCell.values()) {
        const first = tris[0];
        if (first === undefined) throw new Error('empty label');
        const { side, center } = labelSquare(first);
        // Fan triangles (centroid, v, next): the outer edges bound the inset face.
        const rIn = Math.min(...tris.map((t) => lineDistance(center, t[1].p, t[2].p)));
        expect(side / rIn).toBeCloseTo(1.45, 5);
        expect(0.5 * side * 0.8).toBeLessThanOrEqual(rIn);
        for (const t of tris) expect(labelSquare(t).side).toBeCloseTo(side, 5);
      }
    },
  );

  it('d4: corner labels are 1.1 × r_in, 0.36 of the way to the corner, glyph box inside the kite', () => {
    const tris = triangles(getDieMesh('d4')).filter((t) => t[0].cell >= 0);
    const corners = new Map<number, Vec3[]>();
    for (const t of tris) {
      const g = cross(sub(t[1].p, t[0].p), sub(t[2].p, t[0].p));
      const f = faceOf('d4', scale(g, 1 / length(g)));
      const list = corners.get(f) ?? [];
      if (!list.some((p) => length(sub(p, t[0].p)) < 1e-9)) list.push(t[0].p);
      corners.set(f, list);
    }
    for (const t of tris) {
      const g = cross(sub(t[1].p, t[0].p), sub(t[2].p, t[0].p));
      const pts = corners.get(faceOf('d4', scale(g, 1 / length(g)))) ?? [];
      expect(pts.length).toBe(3);
      const [p0, p1, p2] = pts;
      if (p0 === undefined || p1 === undefined || p2 === undefined) throw new Error('face corners');
      const c = scale(add(p0, add(p1, p2)), 1 / 3);
      const rIn = Math.min(
        lineDistance(c, p0, p1),
        lineDistance(c, p1, p2),
        lineDistance(c, p2, p0),
      );
      const v = t[0].p;
      const { side, center } = labelSquare(t);
      expect(side / rIn).toBeCloseTo(1.1, 5);
      expect(length(sub(center, add(c, scale(sub(v, c), 0.36))))).toBeLessThan(1e-6);
      // Atlas glyph block: at most 0.8 of the cell high and 0.875 wide (128 px cell, 8 px pad).
      const n = scale(g, 1 / length(g));
      const up = scale(sub(v, c), 1 / length(sub(v, c)));
      const right = cross(up, n);
      const mids = pts.filter((p) => length(sub(p, v)) > 1e-9).map((p) => scale(add(v, p), 0.5));
      expect(mids.length).toBe(2);
      const [m0, m1] = mids;
      if (m0 === undefined || m1 === undefined) throw new Error('kite midpoints');
      const kite = [v, m0, c, m1];
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const q = add(center, add(scale(right, sx * 0.4375 * side), scale(up, sy * 0.4 * side)));
          // Inside the convex kite: q lies on the same side of every edge.
          const sides = kite.map((a, k) => {
            const b = kite[(k + 1) % 4] ?? a;
            return dot(cross(sub(b, a), sub(q, a)), n);
          });
          expect(sides.every((d) => d > 0) || sides.every((d) => d < 0)).toBe(true);
        }
      }
    }
  });

  it.each(SHAPES)('%s: corners are cut (no vertex within 0.02 of a hull vertex)', (shape) => {
    const hull = getPolyhedron(shape).vertices;
    for (const v of vertices(getDieMesh(shape))) {
      for (const h of hull) expect(length(sub(v.p, h))).toBeGreaterThanOrEqual(0.02);
    }
  });

  it('caches per shape', () => {
    expect(getDieMesh('d20')).toBe(getDieMesh('d20'));
    expect(getDieMesh('d6')).not.toBe(getDieMesh('d8'));
  });
});
