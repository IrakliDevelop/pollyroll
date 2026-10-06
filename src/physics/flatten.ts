import { getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { quatMul, quatRotate } from '../geometry/vec';
import type { Quat, Vec3 } from '../geometry/vec';

export const FLATTEN_STEPS = 24;
const COS_HALF_DEGREE = 0.9999619230641713;

/** Readout index whose world direction R·r has the largest y; ties go to the lowest index. */
export function upReadout(shape: ShapeType, pose: Float64Array): number {
  const [, , , x = 0, y = 0, z = 0, w = 1] = pose;
  // Second row of the rotation matrix of q.
  const r0 = 2 * (x * y + z * w);
  const r1 = 1 - 2 * (x * x + z * z);
  const r2 = 2 * (y * z - x * w);
  let best = 0;
  let bestY = -Infinity;
  getPolyhedron(shape).readouts.forEach((r, k) => {
    const ry = r0 * r[0] + r1 * r[1] + r2 * r[2];
    if (ry > bestY) {
      bestY = ry;
      best = k;
    }
  });
  return best;
}

/** Settle-to-flat tail: nlerp by the shortest arc taking the up readout to +Y; null if within 0.5°. */
export function flattenTail(shape: ShapeType, pose: Float64Array): Float64Array | null {
  const [px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0, qw = 1] = pose;
  const q: Quat = [qx, qy, qz, qw];
  const poly = getPolyhedron(shape);
  const r = poly.readouts[upReadout(shape, pose)] ?? [0, 1, 0];
  const [ux, uy, uz] = quatRotate(q, r);
  if (uy >= COS_HALF_DEGREE) return null;
  // Shortest arc u → +Y: (u × Y, 1 + u·Y) normalized; uy > 0 for the top readout, so w > 1.
  const aw = 1 + uy;
  const an = Math.sqrt(uz * uz + ux * ux + aw * aw);
  const [fx, fy, fz, fw] = quatMul([-uz / an, 0, ux / an, aw / an], q);
  const low = lowestY(poly.vertices, fx, fy, fz, fw);
  const sign = qx * fx + qy * fy + qz * fz + qw * fw < 0 ? -1 : 1;
  const out = new Float64Array(FLATTEN_STEPS * 7);
  for (let k = 1; k <= FLATTEN_STEPS; k++) {
    const t = k / FLATTEN_STEPS;
    const s = 1 - t;
    const x = s * qx + t * sign * fx;
    const y = s * qy + t * sign * fy;
    const z = s * qz + t * sign * fz;
    const w = s * qw + t * sign * fw;
    const n = Math.sqrt(x * x + y * y + z * z + w * w);
    const i = (k - 1) * 7;
    out[i] = px;
    // Resting height is concave in the tilt, so a linear y alone would sink mid-tail.
    out[i + 1] = Math.max(s * py - t * low, -lowestY(poly.vertices, x / n, y / n, z / n, w / n));
    out[i + 2] = pz;
    out[i + 3] = x / n;
    out[i + 4] = y / n;
    out[i + 5] = z / n;
    out[i + 6] = w / n;
  }
  return out;
}

/** Lowest world y of the vertices under unit quaternion (x, y, z, w), via its matrix's second row. */
function lowestY(vertices: readonly Vec3[], x: number, y: number, z: number, w: number): number {
  const r0 = 2 * (x * y + z * w);
  const r1 = 1 - 2 * (x * x + z * z);
  const r2 = 2 * (y * z - x * w);
  let low = Infinity;
  for (const v of vertices) low = Math.min(low, r0 * v[0] + r1 * v[1] + r2 * v[2]);
  return low;
}
