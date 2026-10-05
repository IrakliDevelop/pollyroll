import { cross, dot, length, normalize, scale, sub } from './vec';
import type { Vec3 } from './vec';

export type ShapeType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20';

export interface Polyhedron {
  type: ShapeType;
  vertices: readonly Vec3[]; // body frame, centroid at origin, Y up
  faces: readonly (readonly number[])[]; // vertex indexes, counter-clockwise seen from outside
  normals: readonly Vec3[]; // unit outward normal per face
  radius: number; // circumradius (max vertex length)
  readouts: readonly Vec3[]; // unit directions read for "up": face normals; d4: vertex directions
}

export const SHAPES: readonly ShapeType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

const EPS = 1e-9;
const PHI = (1 + Math.sqrt(5)) / 2;
const INV_PHI = 1 / PHI;

/** All sign variants of `base` (zero components are not doubled): x outermost, then y, then z,
 *  '+' before '-'. */
function signs(base: Vec3): Vec3[] {
  let out: number[][] = [[]];
  for (const c of base) {
    const next: number[][] = [];
    for (const prefix of out) {
      next.push([...prefix, c]);
      if (c !== 0) next.push([...prefix, -c]);
    }
    out = next;
  }
  return out.map(([x = 0, y = 0, z = 0]) => [x, y, z]);
}

/** Pentagonal trapezohedron (r = 1, h = 1) with algebraic cos/sin of multiples of 36 degrees. */
function d10Vertices(): Vec3[] {
  const r5 = Math.sqrt(5);
  const c36 = (1 + r5) / 4;
  const s36 = Math.sqrt(10 - 2 * r5) / 4;
  const c72 = (r5 - 1) / 4;
  const s72 = Math.sqrt(10 + 2 * r5) / 4;
  const h = 1;
  const r = 1;
  const z = (h * (1 - c36)) / (1 + c36);
  const upper: [number, number][] = [
    [1, 0],
    [c72, s72],
    [-c36, s36],
    [-c36, -s36],
    [c72, -s72],
  ];
  const lower: [number, number][] = [
    [c36, s36],
    [-c72, s72],
    [-1, 0],
    [-c72, -s72],
    [c36, -s36],
  ];
  return [
    [0, h, 0],
    [0, -h, 0],
    ...upper.map(([c, s]): Vec3 => [r * c, z, r * s]),
    ...lower.map(([c, s]): Vec3 => [r * c, -z, r * s]),
  ];
}

function rawVertices(type: ShapeType): Vec3[] {
  switch (type) {
    case 'd4':
      return [
        [1, 1, 1],
        [1, -1, -1],
        [-1, 1, -1],
        [-1, -1, 1],
      ];
    case 'd6':
      return signs([1, 1, 1]);
    case 'd8':
      return [...signs([1, 0, 0]), ...signs([0, 1, 0]), ...signs([0, 0, 1])];
    case 'd10':
      return d10Vertices();
    case 'd12':
      return [
        ...signs([1, 1, 1]),
        ...signs([0, INV_PHI, PHI]),
        ...signs([INV_PHI, PHI, 0]),
        ...signs([PHI, 0, INV_PHI]),
      ];
    case 'd20':
      return [...signs([0, 1, PHI]), ...signs([1, PHI, 0]), ...signs([PHI, 0, 1])];
  }
}

const TARGET_RADIUS: Record<ShapeType, number> = {
  d4: 0.75,
  d6: Math.sqrt(3) / 2,
  d8: 0.75,
  d10: 0.75,
  d12: 0.72,
  d20: 0.8,
};

function vertexAt(vertices: readonly Vec3[], i: number): Vec3 {
  const v = vertices[i];
  if (v === undefined) throw new RangeError(`vertex ${i} out of range`);
  return v;
}

/** Orders a face's vertex indexes counter-clockwise around outward normal `n` (seen from
 *  outside), starting at the lowest index. Angular sort by half-plane, then cross-product sign,
 *  relative to the ray from the face centroid to the start vertex (no trigonometry). */
function orderFace(vertices: readonly Vec3[], ids: number[], n: Vec3): number[] {
  let c: Vec3 = [0, 0, 0];
  for (const i of ids) {
    const v = vertexAt(vertices, i);
    c = [c[0] + v[0], c[1] + v[1], c[2] + v[2]];
  }
  c = scale(c, 1 / ids.length);
  const [start = 0, ...rest] = ids;
  const r0 = sub(vertexAt(vertices, start), c);
  const half = (d: Vec3): number => {
    const side = dot(n, cross(r0, d));
    return side > 1e-12 || (side >= -1e-12 && dot(r0, d) > 0) ? 0 : 1;
  };
  const keyed = rest.map((i) => {
    const d = sub(vertexAt(vertices, i), c);
    return { i, d, h: half(d) };
  });
  keyed.sort((a, b) => a.h - b.h || -dot(n, cross(a.d, b.d)));
  return [start, ...keyed.map((k) => k.i)];
}

/** Brute-force convex hull face finder: every vertex triple i < j < k (lexicographic) spans a
 *  candidate plane; a plane with every vertex on or behind it is a face, deduplicated by normal. */
function findFaces(vertices: readonly Vec3[]): { faces: number[][]; normals: Vec3[] } {
  let c: Vec3 = [0, 0, 0];
  for (const v of vertices) c = [c[0] + v[0], c[1] + v[1], c[2] + v[2]];
  c = scale(c, 1 / vertices.length);
  const faces: number[][] = [];
  const normals: Vec3[] = [];
  const count = vertices.length;
  for (let i = 0; i < count; i++) {
    const vi = vertexAt(vertices, i);
    for (let j = i + 1; j < count; j++) {
      const vj = vertexAt(vertices, j);
      for (let k = j + 1; k < count; k++) {
        const vk = vertexAt(vertices, k);
        let n = normalize(cross(sub(vj, vi), sub(vk, vi)));
        if (n[0] === 0 && n[1] === 0 && n[2] === 0) continue;
        if (dot(n, sub(c, vi)) > 0) n = scale(n, -1);
        if (!vertices.every((v) => dot(n, sub(v, vi)) <= EPS)) continue;
        const duplicate = normals.some(
          (m) =>
            Math.abs(m[0] - n[0]) < EPS &&
            Math.abs(m[1] - n[1]) < EPS &&
            Math.abs(m[2] - n[2]) < EPS,
        );
        if (duplicate) continue;
        const ids: number[] = [];
        vertices.forEach((v, idx) => {
          if (Math.abs(dot(n, sub(v, vi))) <= EPS) ids.push(idx);
        });
        faces.push(orderFace(vertices, ids, n));
        normals.push(n);
      }
    }
  }
  return { faces, normals };
}

function build(type: ShapeType): Polyhedron {
  const raw = rawVertices(type);
  let rawRadius = 0;
  for (const v of raw) rawRadius = Math.max(rawRadius, length(v));
  const s = TARGET_RADIUS[type] / rawRadius;
  const vertices = raw.map((v) => scale(v, s));
  let radius = 0;
  for (const v of vertices) radius = Math.max(radius, length(v));
  const { faces, normals } = findFaces(vertices);
  const readouts = type === 'd4' ? vertices.map(normalize) : normals;
  return { type, vertices, faces, normals, radius, readouts };
}

const cache: Partial<Record<ShapeType, Polyhedron>> = {};

/** Cached per type; built on first call. */
export function getPolyhedron(type: ShapeType): Polyhedron {
  let p = cache[type];
  if (p === undefined) {
    p = build(type);
    cache[type] = p;
  }
  return p;
}
