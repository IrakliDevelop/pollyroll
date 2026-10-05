import { getPolyhedron } from './polyhedra';
import type { ShapeType } from './polyhedra';
import { cross, dot, length, normalize, quatFromMatrix, quatRotate, scale, sub } from './vec';
import type { Quat, Vec3 } from './vec';

const MATCH = 1e-6;

function near(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || Math.abs(x - y) > MATCH) return false;
  }
  return a.length === b.length;
}

/** Right-handed orthonormal frame from two non-parallel vectors (Gram-Schmidt). */
function frame(a: Vec3, b: Vec3): [Vec3, Vec3, Vec3] {
  const e1 = normalize(a);
  const e2 = normalize(sub(b, scale(e1, dot(b, e1))));
  return [e1, e2, cross(e1, e2)];
}

/**
 * Enumerates proper rotations of the vertex set: a rotation is fixed by where it sends two
 * non-parallel vertices v0, v1, so every vertex pair (vi, vj) with matching lengths and dot
 * product gives a candidate R = B·Aᵀ between the frames A(v0, v1) and B(vi, vj).
 */
function generate(type: ShapeType): Quat[] {
  const vertices = getPolyhedron(type).vertices;
  const [v0] = vertices;
  if (v0 === undefined) return [];
  const v1 = vertices.find((v) => length(cross(v0, v)) > MATCH);
  if (v1 === undefined) return [];
  const len0 = length(v0);
  const len1 = length(v1);
  const d01 = dot(v0, v1);
  const [a1, a2, a3] = frame(v0, v1);
  const group: Quat[] = [];
  vertices.forEach((vi, i) => {
    if (Math.abs(length(vi) - len0) >= 1e-9) return;
    vertices.forEach((vj, j) => {
      if (i === j || Math.abs(length(vj) - len1) >= 1e-9) return;
      if (Math.abs(dot(vi, vj) - d01) >= 1e-9) return;
      const [b1, b2, b3] = frame(vi, vj);
      // Row r of R = B·Aᵀ is Σ_k b_k[r] a_k.
      const row = (r: 0 | 1 | 2): Vec3 => [
        b1[r] * a1[0] + b2[r] * a2[0] + b3[r] * a3[0],
        b1[r] * a1[1] + b2[r] * a2[1] + b3[r] * a3[1],
        b1[r] * a1[2] + b2[r] * a2[2] + b3[r] * a3[2],
      ];
      const r0 = row(0);
      const r1 = row(1);
      const r2 = row(2);
      const apply = (v: Vec3): Vec3 => [dot(r0, v), dot(r1, v), dot(r2, v)];
      if (!vertices.every((v) => vertices.some((w) => near(apply(v), w)))) return;
      const q = quatFromMatrix([...r0, ...r1, ...r2]);
      if (group.some((g) => near(g, q))) return;
      group.push(q);
    });
  });
  return group;
}

const groupCache: Partial<Record<ShapeType, readonly Quat[]>> = {};

/** Proper rotations mapping the shape's vertex set onto itself, computed once and cached. Element 0 is IDENTITY. */
export function getRotationGroup(type: ShapeType): readonly Quat[] {
  let group = groupCache[type];
  if (group === undefined) {
    group = generate(type);
    groupCache[type] = group;
  }
  return group;
}

/** First group element g (group order) with quatRotate(g, readouts[from]) ≈ readouts[to]. */
export function findRemap(type: ShapeType, from: number, to: number): Quat {
  const readouts = getPolyhedron(type).readouts;
  const a = readouts[from];
  const b = readouts[to];
  if (a !== undefined && b !== undefined) {
    const g = getRotationGroup(type).find((q) => near(quatRotate(q, a), b));
    if (g !== undefined) return g;
  }
  throw new Error(`${type}: no rotation maps readout ${from} to ${to}`);
}
