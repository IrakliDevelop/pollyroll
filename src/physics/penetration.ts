import { getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { getBodyShape } from './body';

const MAX_VERTICES = 32;
const MAX_FACES = 20;
const MAX_EDGES = 48;

// Scratch buffers: world vertices, world face normals, world edge vectors of each hull.
const vertsA = new Float64Array(MAX_VERTICES * 3);
const vertsB = new Float64Array(MAX_VERTICES * 3);
const normalsA = new Float64Array(MAX_FACES * 3);
const normalsB = new Float64Array(MAX_FACES * 3);
const edgesA = new Float64Array(MAX_EDGES * 3);
const edgesB = new Float64Array(MAX_EDGES * 3);

const edgeCache: Partial<Record<ShapeType, Int32Array>> = {};

/** Unique hull edges of `shape` as vertex index pairs, cached. */
function edgeIndexes(shape: ShapeType): Int32Array {
  let cached = edgeCache[shape];
  if (cached === undefined) {
    const pairs: number[] = [];
    const seen: string[] = [];
    for (const face of getPolyhedron(shape).faces) {
      face.forEach((a, k) => {
        const b = face[(k + 1) % face.length] ?? a;
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (seen.includes(key)) return;
        seen.push(key);
        pairs.push(a, b);
      });
    }
    cached = new Int32Array(pairs);
    edgeCache[shape] = cached;
  }
  return cached;
}

/** Writes the world vertices, face normals, and edge vectors of `shape` at the pose stored at
 *  `frames[offset..offset + 7]` (px, py, pz, qx, qy, qz, qw). */
function place(
  shape: ShapeType,
  frames: ArrayLike<number>,
  offset: number,
  verts: Float64Array,
  normals: Float64Array,
  edges: Float64Array,
): void {
  const px = frames[offset] ?? 0;
  const py = frames[offset + 1] ?? 0;
  const pz = frames[offset + 2] ?? 0;
  const x = frames[offset + 3] ?? 0;
  const y = frames[offset + 4] ?? 0;
  const z = frames[offset + 5] ?? 0;
  const w = frames[offset + 6] ?? 1;
  const r00 = 1 - 2 * (y * y + z * z);
  const r01 = 2 * (x * y - z * w);
  const r02 = 2 * (x * z + y * w);
  const r10 = 2 * (x * y + z * w);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - x * w);
  const r20 = 2 * (x * z - y * w);
  const r21 = 2 * (y * z + x * w);
  const r22 = 1 - 2 * (x * x + y * y);
  const body = getBodyShape(shape);
  const local = body.vertices;
  for (let k = 0; k < local.length; k += 3) {
    const vx = local[k] ?? 0;
    const vy = local[k + 1] ?? 0;
    const vz = local[k + 2] ?? 0;
    verts[k] = r00 * vx + r01 * vy + r02 * vz + px;
    verts[k + 1] = r10 * vx + r11 * vy + r12 * vz + py;
    verts[k + 2] = r20 * vx + r21 * vy + r22 * vz + pz;
  }
  const planes = body.planes;
  for (let f = 0; f < planes.length / 4; f++) {
    const nx = planes[f * 4] ?? 0;
    const ny = planes[f * 4 + 1] ?? 0;
    const nz = planes[f * 4 + 2] ?? 0;
    normals[f * 3] = r00 * nx + r01 * ny + r02 * nz;
    normals[f * 3 + 1] = r10 * nx + r11 * ny + r12 * nz;
    normals[f * 3 + 2] = r20 * nx + r21 * ny + r22 * nz;
  }
  const pairs = edgeIndexes(shape);
  for (let e = 0; e < pairs.length / 2; e++) {
    const a = (pairs[e * 2] ?? 0) * 3;
    const b = (pairs[e * 2 + 1] ?? 0) * 3;
    for (let c = 0; c < 3; c++) edges[e * 3 + c] = (verts[b + c] ?? 0) - (verts[a + c] ?? 0);
  }
}

/** Overlap of the two placed hulls projected on axis (x, y, z), in units of the axis length;
 *  Infinity for a degenerate axis. */
function overlapOn(x: number, y: number, z: number, countA: number, countB: number): number {
  const lenSq = x * x + y * y + z * z;
  if (lenSq < 1e-12) return Infinity;
  let aMin = Infinity;
  let aMax = -Infinity;
  for (let k = 0; k < countA * 3; k += 3) {
    const d = (vertsA[k] ?? 0) * x + (vertsA[k + 1] ?? 0) * y + (vertsA[k + 2] ?? 0) * z;
    aMin = Math.min(aMin, d);
    aMax = Math.max(aMax, d);
  }
  let bMin = Infinity;
  let bMax = -Infinity;
  for (let k = 0; k < countB * 3; k += 3) {
    const d = (vertsB[k] ?? 0) * x + (vertsB[k + 1] ?? 0) * y + (vertsB[k + 2] ?? 0) * z;
    bMin = Math.min(bMin, d);
    bMax = Math.max(bMax, d);
  }
  return Math.min(aMax - bMin, bMax - aMin) / Math.sqrt(lenSq);
}

/** Least overlap over `faces` placed face normals; 0 as soon as one separates the hulls. */
function faceOverlap(normals: Float64Array, faces: number, countA: number, countB: number): number {
  let best = Infinity;
  for (let f = 0; f < faces * 3; f += 3) {
    const o = overlapOn(normals[f] ?? 0, normals[f + 1] ?? 0, normals[f + 2] ?? 0, countA, countB);
    if (o <= 0) return 0;
    best = Math.min(best, o);
  }
  return best;
}

/** `penetration` for poses stored at offsets of frame buffers, using scratch buffers (no
 *  allocation once each shape's edge list is cached). */
export function penetrationAt(
  a: ShapeType,
  framesA: ArrayLike<number>,
  offsetA: number,
  b: ShapeType,
  framesB: ArrayLike<number>,
  offsetB: number,
): number {
  place(a, framesA, offsetA, vertsA, normalsA, edgesA);
  place(b, framesB, offsetB, vertsB, normalsB, edgesB);
  const bodyA = getBodyShape(a);
  const bodyB = getBodyShape(b);
  const countA = bodyA.vertices.length / 3;
  const countB = bodyB.vertices.length / 3;
  const faceA = faceOverlap(normalsA, bodyA.planes.length / 4, countA, countB);
  if (faceA <= 0) return 0;
  const faceB = faceOverlap(normalsB, bodyB.planes.length / 4, countA, countB);
  if (faceB <= 0) return 0;
  let best = Math.min(faceA, faceB);
  const edgeCountA = edgeIndexes(a).length / 2;
  const edgeCountB = edgeIndexes(b).length / 2;
  for (let i = 0; i < edgeCountA * 3; i += 3) {
    const ux = edgesA[i] ?? 0;
    const uy = edgesA[i + 1] ?? 0;
    const uz = edgesA[i + 2] ?? 0;
    for (let j = 0; j < edgeCountB * 3; j += 3) {
      const vx = edgesB[j] ?? 0;
      const vy = edgesB[j + 1] ?? 0;
      const vz = edgesB[j + 2] ?? 0;
      const o = overlapOn(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx, countA, countB);
      if (o <= 0) return 0;
      best = Math.min(best, o);
    }
  }
  return best;
}

/** Exact penetration depth of two convex hulls by the separating axis theorem (face normals and
 *  edge cross products); 0 when they do not overlap. */
export function penetration(
  a: ShapeType,
  poseA: ArrayLike<number>,
  b: ShapeType,
  poseB: ArrayLike<number>,
): number {
  return penetrationAt(a, poseA, 0, b, poseB, 0);
}
