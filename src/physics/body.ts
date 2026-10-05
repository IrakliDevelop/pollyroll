import { getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { add, cross, dot } from '../geometry/vec';
import type { Vec3 } from '../geometry/vec';

export interface BodyShape {
  shape: ShapeType;
  vertices: Float64Array; // 3 per hull vertex, body frame (centroid origin)
  radius: number; // bounding-sphere radius = circumradius
  invInertia: Float64Array; // 3: inverse principal moments (body frame diagonal), mass 1
}

/**
 * Full 3x3 inertia tensor (row-major) of a uniform solid of mass 1 with the die's hull, about the
 * centroid at the body origin. Tetrahedral decomposition from the origin (Blow and Binstock, "How
 * to find the inertia tensor (or other mass properties) of a 3D solid body represented by a
 * triangle mesh", 2004): each face is fanned into triangles (a, b, c); the tetrahedron (0, a, b, c)
 * has signed volume det/6 with det = a · (b × c), and covariance
 * C = det/120 · (a aᵀ + b bᵀ + c cᵀ + s sᵀ), s = a + b + c. With C summed and divided by the total
 * volume (mass 1), the inertia tensor is I = trace(C)·Id − C.
 */
export function inertiaTensor(shape: ShapeType): Float64Array {
  const { vertices, faces } = getPolyhedron(shape);
  const point = (i: number): Vec3 => {
    const v = vertices[i];
    if (v === undefined) throw new RangeError(`vertex ${i} out of range`);
    return v;
  };
  let cxx = 0;
  let cyy = 0;
  let czz = 0;
  let cxy = 0;
  let cxz = 0;
  let cyz = 0;
  let volume = 0;
  for (const [first, ...rest] of faces) {
    const a = point(first ?? 0);
    for (let k = 0; k + 1 < rest.length; k++) {
      const b = point(rest[k] ?? 0);
      const c = point(rest[k + 1] ?? 0);
      const det = dot(a, cross(b, c));
      volume += det / 6;
      const s = add(add(a, b), c);
      const w = det / 120;
      const pair = (i: 0 | 1 | 2, j: 0 | 1 | 2): number =>
        w * (a[i] * a[j] + b[i] * b[j] + c[i] * c[j] + s[i] * s[j]);
      cxx += pair(0, 0);
      cyy += pair(1, 1);
      czz += pair(2, 2);
      cxy += pair(0, 1);
      cxz += pair(0, 2);
      cyz += pair(1, 2);
    }
  }
  const inv = volume > 1e-12 ? 1 / volume : 0;
  cxx *= inv;
  cyy *= inv;
  czz *= inv;
  cxy *= inv;
  cxz *= inv;
  cyz *= inv;
  const trace = cxx + cyy + czz;
  return new Float64Array([
    trace - cxx,
    -cxy,
    -cxz,
    -cxy,
    trace - cyy,
    -cyz,
    -cxz,
    -cyz,
    trace - czz,
  ]);
}

const cache: Partial<Record<ShapeType, BodyShape>> = {};

/** Cached per shape. Inertia of a uniform solid of mass 1 by tetrahedral decomposition from the
 *  centroid (see `inertiaTensor` for the formula); the off-diagonal terms are ~0 for these shapes
 *  and are dropped. */
export function getBodyShape(shape: ShapeType): BodyShape {
  let body = cache[shape];
  if (body === undefined) {
    const poly = getPolyhedron(shape);
    const vertices = new Float64Array(poly.vertices.length * 3);
    poly.vertices.forEach((v, i) => vertices.set(v, i * 3));
    const [ixx = 0, , , , iyy = 0, , , , izz = 0] = inertiaTensor(shape);
    const inverse = (m: number): number => (m > 1e-12 ? 1 / m : 0);
    const invInertia = new Float64Array([inverse(ixx), inverse(iyy), inverse(izz)]);
    body = { shape, vertices, radius: poly.radius, invInertia };
    cache[shape] = body;
  }
  return body;
}
