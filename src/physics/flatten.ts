import { getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { quatMul, quatRotate } from '../geometry/vec';
import type { Quat, Vec3 } from '../geometry/vec';
import type { TrayBounds } from './world';

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

const SPACING = 0.8;
const PASSES = 8;

/** Resting separation by Gauss–Seidel position relaxation: PASSES sweeps over pairs i < j push the
 *  horizontal centres (`xz` interleaved) to SPACING·(Ri + Rj) apart, clamping each moved centre
 *  into `bounds` inset by SPACING·R. Coincident centres separate along +x. */
export function separate(xz: Float64Array, radii: readonly number[], bounds: TrayBounds): void {
  const clamp = (k: number): void => {
    const m = SPACING * (radii[k] ?? 0);
    xz[2 * k] = Math.min(Math.max(xz[2 * k] ?? 0, bounds.minX + m), bounds.maxX - m);
    xz[2 * k + 1] = Math.min(Math.max(xz[2 * k + 1] ?? 0, bounds.minZ + m), bounds.maxZ - m);
  };
  for (let pass = 0; pass < PASSES; pass++) {
    for (let i = 0; i < radii.length; i++) {
      for (let j = i + 1; j < radii.length; j++) {
        const dx = (xz[2 * j] ?? 0) - (xz[2 * i] ?? 0);
        const dz = (xz[2 * j + 1] ?? 0) - (xz[2 * i + 1] ?? 0);
        const want = SPACING * ((radii[i] ?? 0) + (radii[j] ?? 0));
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d >= want) continue;
        const nx = d < 1e-9 ? 1 : dx / d;
        const nz = d < 1e-9 ? 0 : dz / d;
        const push = (want - d) / 2;
        xz[2 * i] = (xz[2 * i] ?? 0) - nx * push;
        xz[2 * i + 1] = (xz[2 * i + 1] ?? 0) - nz * push;
        xz[2 * j] = (xz[2 * j] ?? 0) + nx * push;
        xz[2 * j + 1] = (xz[2 * j + 1] ?? 0) + nz * push;
        clamp(i);
        clamp(j);
      }
    }
  }
}

/** Settle-to-flat tail: nlerp by the shortest arc taking the up readout to +Y while x and z move
 *  linearly to (x, z); null if within 0.5° and not moved. */
export function flattenTail(
  shape: ShapeType,
  pose: Float64Array,
  x: number,
  z: number,
): Float64Array | null {
  const [px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0, qw = 1] = pose;
  const q: Quat = [qx, qy, qz, qw];
  const poly = getPolyhedron(shape);
  const r = poly.readouts[upReadout(shape, pose)] ?? [0, 1, 0];
  const [ux, uy, uz] = quatRotate(q, r);
  if (uy >= COS_HALF_DEGREE && x === px && z === pz) return null;
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
    const cx = s * qx + t * sign * fx;
    const cy = s * qy + t * sign * fy;
    const cz = s * qz + t * sign * fz;
    const cw = s * qw + t * sign * fw;
    const n = Math.sqrt(cx * cx + cy * cy + cz * cz + cw * cw);
    const i = (k - 1) * 7;
    out[i] = s * px + t * x;
    // Resting height is concave in the tilt, so a linear y alone would sink mid-tail.
    out[i + 1] = Math.max(
      s * py - t * low,
      -lowestY(poly.vertices, cx / n, cy / n, cz / n, cw / n),
    );
    out[i + 2] = s * pz + t * z;
    out[i + 3] = cx / n;
    out[i + 4] = cy / n;
    out[i + 5] = cz / n;
    out[i + 6] = cw / n;
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
