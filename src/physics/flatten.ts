import { getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { quatMul, quatRotate } from '../geometry/vec';
import type { Quat } from '../geometry/vec';

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

/**
 * Settle-to-flat tail for a resting pose (x, y, z, qx, qy, qz, qw): FLATTEN_STEPS frames that turn
 * the die by the shortest-arc rotation A taking its up readout onto +Y (q → A ⊗ q, normalized lerp)
 * while y moves linearly to where the lowest hull vertex touches y = 0. Null when the up readout is
 * already within 0.5° of +Y.
 */
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
  let low = Infinity;
  for (const v of poly.vertices) low = Math.min(low, quatRotate([fx, fy, fz, fw], v)[1]);
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
    out.set([px, s * py - t * low, pz, x / n, y / n, z / n, w / n], (k - 1) * 7);
  }
  return out;
}
