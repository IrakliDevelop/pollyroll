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
