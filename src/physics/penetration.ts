import { getPolyhedron } from '../geometry/polyhedra';
import type { Polyhedron, ShapeType } from '../geometry/polyhedra';
import { cross, dot, quatRotate, sub } from '../geometry/vec';
import type { Quat, Vec3 } from '../geometry/vec';

function quatOf(pose: ArrayLike<number>): Quat {
  return [pose[3] ?? 0, pose[4] ?? 0, pose[5] ?? 0, pose[6] ?? 1];
}

function placed(poly: Polyhedron, pose: ArrayLike<number>): Vec3[] {
  const q = quatOf(pose);
  return poly.vertices.map((v) => {
    const r = quatRotate(q, v);
    return [r[0] + (pose[0] ?? 0), r[1] + (pose[1] ?? 0), r[2] + (pose[2] ?? 0)];
  });
}

function edges(poly: Polyhedron, world: readonly Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  const seen: string[] = [];
  for (const face of poly.faces) {
    face.forEach((a, k) => {
      const b = face[(k + 1) % face.length] ?? a;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.includes(key)) return;
      seen.push(key);
      out.push(sub(world[b] ?? [0, 0, 0], world[a] ?? [0, 0, 0]));
    });
  }
  return out;
}

function project(points: readonly Vec3[], axis: Vec3): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    const d = dot(p, axis);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [lo, hi];
}

/** Exact penetration depth of two convex hulls by the separating axis theorem (face normals and
 *  edge cross products); 0 when they do not overlap. */
export function penetration(
  a: ShapeType,
  poseA: ArrayLike<number>,
  b: ShapeType,
  poseB: ArrayLike<number>,
): number {
  const pa = getPolyhedron(a);
  const pb = getPolyhedron(b);
  const va = placed(pa, poseA);
  const vb = placed(pb, poseB);
  const axes = [
    ...pa.normals.map((n) => quatRotate(quatOf(poseA), n)),
    ...pb.normals.map((n) => quatRotate(quatOf(poseB), n)),
  ];
  const eb = edges(pb, vb);
  for (const u of edges(pa, va)) for (const v of eb) axes.push(cross(u, v));
  let best = Infinity;
  for (const axis of axes) {
    const lenSq = dot(axis, axis);
    if (lenSq < 1e-12) continue;
    const [aMin, aMax] = project(va, axis);
    const [bMin, bMax] = project(vb, axis);
    const overlap = Math.min(aMax - bMin, bMax - aMin) / Math.sqrt(lenSq);
    if (overlap <= 0) return 0;
    best = Math.min(best, overlap);
  }
  return best;
}
