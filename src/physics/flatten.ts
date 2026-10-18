import { getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { quatMul, quatRotate } from '../geometry/vec';
import type { Quat, Vec3 } from '../geometry/vec';
import { penetrationAt } from './penetration';
import type { TrayBounds } from './world';

export const FLATTEN_STEPS = 36;
const COS_HALF_DEGREE = 0.9999619230641713;

/** Readout index whose world direction R·r has the largest y; ties go to the lowest index. */
export function upReadout(shape: ShapeType, pose: ArrayLike<number>): number {
  const [x, y, z, w] = [pose[3] ?? 0, pose[4] ?? 0, pose[5] ?? 0, pose[6] ?? 1];
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

const GAP = 0.05;
const PASSES = 64;

/** Interval of footprint `f` centred at (cx, cz) projected onto (nx, nz). */
function span(f: Float64Array, cx: number, cz: number, nx: number, nz: number): [number, number] {
  const c = cx * nx + cz * nz;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < f.length; k += 2) {
    const d = c + (f[k] ?? 0) * nx + (f[k + 1] ?? 0) * nz;
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [lo, hi];
}

/** Resting separation by Gauss–Seidel position relaxation: up to PASSES (64) sweeps over pairs
 *  i < j, stopping after a sweep that moves no centre by more than 1e-9. Each pair is tested on the
 *  outward edge normals of both footprints (separating axis theorem); unless some axis already
 *  shows a gap of GAP, both centres (`xz` interleaved) move apart along the axis of least overlap
 *  until GAP separates them, each clamped so its footprint stays inside `bounds`; when the clamp
 *  stops exactly one, the other takes the remaining push (clamped again). */
export function separate(
  xz: Float64Array,
  footprints: readonly Float64Array[],
  bounds: TrayBounds,
): void {
  const clamp = (k: number): void => {
    const f = footprints[k] ?? new Float64Array(0);
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let m = 0; m < f.length; m += 2) {
      x0 = Math.min(x0, f[m] ?? 0);
      x1 = Math.max(x1, f[m] ?? 0);
      z0 = Math.min(z0, f[m + 1] ?? 0);
      z1 = Math.max(z1, f[m + 1] ?? 0);
    }
    const into = (v: number, lo: number, hi: number): number =>
      lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);
    xz[2 * k] = into(xz[2 * k] ?? 0, bounds.minX - x0, bounds.maxX - x1);
    xz[2 * k + 1] = into(xz[2 * k + 1] ?? 0, bounds.minZ - z0, bounds.maxZ - z1);
  };
  let moved = true;
  for (let pass = 0; pass < PASSES && moved; pass++) {
    moved = false;
    for (let i = 0; i < footprints.length; i++) {
      for (let j = i + 1; j < footprints.length; j++) {
        const fi = footprints[i] ?? new Float64Array(0);
        const fj = footprints[j] ?? new Float64Array(0);
        const ix = xz[2 * i] ?? 0;
        const iz = xz[2 * i + 1] ?? 0;
        const jx = xz[2 * j] ?? 0;
        const jz = xz[2 * j + 1] ?? 0;
        let best = Infinity;
        let bx = 0;
        let bz = 0;
        let apart = false;
        for (const f of [fi, fj]) {
          for (let k = 0; k < f.length && !apart; k += 2) {
            const ex = (f[(k + 2) % f.length] ?? 0) - (f[k] ?? 0);
            const ez = (f[(k + 3) % f.length] ?? 0) - (f[k + 1] ?? 0);
            const len = Math.sqrt(ex * ex + ez * ez);
            const nx = ez / len;
            const nz = -ex / len;
            const [iLo, iHi] = span(fi, ix, iz, nx, nz);
            const [jLo, jHi] = span(fj, jx, jz, nx, nz);
            const overlap = Math.min(iHi - jLo, jHi - iLo);
            if (overlap <= -GAP) apart = true;
            else if (overlap < best) {
              best = overlap;
              bx = nx;
              bz = nz;
            }
          }
        }
        if (apart) continue;
        const flip = (jx - ix) * bx + (jz - iz) * bz < 0 ? -1 : 1;
        const push = (flip * (best + GAP)) / 2;
        const pix = ix - bx * push;
        const piz = iz - bz * push;
        const pjx = jx + bx * push;
        const pjz = jz + bz * push;
        xz[2 * i] = pix;
        xz[2 * i + 1] = piz;
        xz[2 * j] = pjx;
        xz[2 * j + 1] = pjz;
        clamp(i);
        clamp(j);
        const iClamped = xz[2 * i] !== pix || xz[2 * i + 1] !== piz;
        const jClamped = xz[2 * j] !== pjx || xz[2 * j + 1] !== pjz;
        if (iClamped !== jClamped) {
          // A wall stopped one die: the free one takes the rest of the push.
          const [iLo, iHi] = span(fi, xz[2 * i] ?? 0, xz[2 * i + 1] ?? 0, bx, bz);
          const [jLo, jHi] = span(fj, xz[2 * j] ?? 0, xz[2 * j + 1] ?? 0, bx, bz);
          const overlap = Math.min(iHi - jLo, jHi - iLo);
          if (overlap > -GAP) {
            const rest = flip * (overlap + GAP);
            const k = iClamped ? j : i;
            const dir = iClamped ? 1 : -1;
            xz[2 * k] = (xz[2 * k] ?? 0) + dir * bx * rest;
            xz[2 * k + 1] = (xz[2 * k + 1] ?? 0) + dir * bz * rest;
            clamp(k);
          }
        }
        const shift = Math.max(
          Math.abs((xz[2 * i] ?? 0) - ix),
          Math.abs((xz[2 * i + 1] ?? 0) - iz),
          Math.abs((xz[2 * j] ?? 0) - jx),
          Math.abs((xz[2 * j + 1] ?? 0) - jz),
        );
        if (shift > 1e-9) moved = true;
      }
    }
  }
}

/** Orientation of `pose` (frame layout) pre-multiplied by the shortest arc taking its up readout
 *  to +Y. */
export function flatOrientation(shape: ShapeType, pose: ArrayLike<number>): Quat {
  const q: Quat = [pose[3] ?? 0, pose[4] ?? 0, pose[5] ?? 0, pose[6] ?? 1];
  const r = getPolyhedron(shape).readouts[upReadout(shape, pose)] ?? [0, 1, 0];
  const [ux, uy, uz] = quatRotate(q, r);
  // Shortest arc u → +Y: (u × Y, 1 + u·Y) normalized; uy > 0 for the top readout, so w > 1.
  const aw = 1 + uy;
  const an = Math.sqrt(uz * uz + ux * ux + aw * aw);
  return quatMul([-uz / an, 0, ux / an, aw / an], q);
}

/** Horizontal convex hull of the hull vertices rotated by q, relative to the centre, as
 *  interleaved x, z in counter-clockwise order (Andrew's monotone chain, collinear points dropped). */
export function footprint(shape: ShapeType, q: Quat): Float64Array {
  const points = getPolyhedron(shape).vertices.map((v) => {
    const [x, , z] = quatRotate(q, v);
    return [x, z] as const;
  });
  points.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
  type P = readonly [number, number];
  const turn = (o: P, a: P, b: P): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const chain = (list: readonly P[]): P[] => {
    const out: P[] = [];
    for (const p of list) {
      while (
        out.length >= 2 &&
        turn(out[out.length - 2] ?? p, out[out.length - 1] ?? p, p) <= 1e-12
      )
        out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  const hull = [...chain(points), ...chain([...points].reverse())];
  return new Float64Array(hull.flat());
}

/** Two-phase settle tail: slide and flatten above the starting bottom, then drop. Phase 1
 *  (FLATTEN_STEPS / 2 steps) nlerps by the shortest arc taking the up readout to +Y while x and z
 *  move linearly to (x, z), keeping the lowest vertex at the starting bottom height (clamped to
 *  the floor); phase 2 lowers the flat die linearly onto the floor. With `lift`, phase 1 is
 *  lift–slide: the die first rises unturned to bottom `lift` over RISE_STEPS, then turns and slides
 *  at that height. null if within 0.5° and not moved. */
export function flattenTail(
  shape: ShapeType,
  pose: Float64Array,
  x: number,
  z: number,
  lift?: number,
): Float64Array | null {
  const [px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0, qw = 1] = pose;
  const poly = getPolyhedron(shape);
  const r = poly.readouts[upReadout(shape, pose)] ?? [0, 1, 0];
  if (quatRotate([qx, qy, qz, qw], r)[1] >= COS_HALF_DEGREE && x === px && z === pz) return null;
  const [fx, fy, fz, fw] = flatOrientation(shape, pose);
  const low = lowestY(poly.vertices, fx, fy, fz, fw);
  const bottom = Math.max(0, py + lowestY(poly.vertices, qx, qy, qz, qw));
  const clear = lift === undefined ? bottom : Math.max(bottom, lift);
  const sign = qx * fx + qy * fy + qz * fz + qw * fw < 0 ? -1 : 1;
  const half = FLATTEN_STEPS / 2;
  const rise = lift === undefined ? 0 : RISE_STEPS;
  const out = new Float64Array(FLATTEN_STEPS * 7);
  for (let k = 1; k <= FLATTEN_STEPS; k++) {
    const t = Math.min(Math.max((k - rise) / (half - rise), 0), 1);
    const s = 1 - t;
    const up = k >= rise ? 1 : k / rise;
    const cx = s * qx + t * sign * fx;
    const cy = s * qy + t * sign * fy;
    const cz = s * qz + t * sign * fz;
    const cw = s * qw + t * sign * fw;
    const n = Math.sqrt(cx * cx + cy * cy + cz * cz + cw * cw);
    const i = (k - 1) * 7;
    out[i] = s * px + t * x;
    out[i + 1] =
      k <= half
        ? bottom + (clear - bottom) * up - lowestY(poly.vertices, cx / n, cy / n, cz / n, cw / n)
        : (1 - (k - half) / half) * clear - low;
    out[i + 2] = s * pz + t * z;
    out[i + 3] = cx / n;
    out[i + 4] = cy / n;
    out[i + 5] = cz / n;
    out[i + 6] = cw / n;
  }
  return out;
}

const RISE_STEPS = 6;
const TAIL_DEPTH = 0.005;
const CLEARANCE = 0.02;
const MAX_RISE = 1.5;
const LIFT_PASSES = 4;

/** Collision-aware settle tails: up to LIFT_PASSES sweeps over the tailed dice in index order, each
 *  checking the die against every other die (its current tail, or its held pose) at every tail frame
 *  where their bounding spheres meet, by `penetrationAt`. Of a pair past TAIL_DEPTH only the die with
 *  the higher starting bottom b0 lifts (ties: the one moving farther in xz, then the lower index):
 *  its tail is rebuilt as lift–slide–drop with bottom max(b0, top) + CLEARANCE, at most
 *  b0 + MAX_RISE, where top is the highest top the dice it hit reach in their plain tails over the
 *  frames they penetrate (clearances only grow). Stops after a sweep that rebuilds nothing; pairs
 *  still penetrating are left. `tails` holds the plain tails on entry and is updated in place. */
export function liftTails(
  shapes: readonly ShapeType[],
  poses: readonly Float64Array[],
  xz: Float64Array,
  tails: (Float64Array | null)[],
): void {
  const plain = tails.slice();
  const bottoms = poses.map((pose, k) => {
    const [, py = 0, , qx = 0, qy = 0, qz = 0, qw = 1] = pose;
    const vertices = getPolyhedron(shapes[k] ?? 'd6').vertices;
    return Math.max(0, py + lowestY(vertices, qx, qy, qz, qw));
  });
  const moves = poses.map((pose, k) => {
    const dx = (xz[2 * k] ?? 0) - (pose[0] ?? 0);
    const dz = (xz[2 * k + 1] ?? 0) - (pose[2] ?? 0);
    return dx * dx + dz * dz;
  });
  const lifts = (i: number, j: number): boolean => {
    const bi = bottoms[i] ?? 0;
    const bj = bottoms[j] ?? 0;
    if (bi !== bj) return bi > bj;
    const mi = moves[i] ?? 0;
    const mj = moves[j] ?? 0;
    return mi !== mj ? mi > mj : i < j;
  };
  const clearance = new Float64Array(shapes.length).fill(-Infinity);
  const framesOf = (t: (Float64Array | null)[], k: number): Float64Array =>
    t[k] ?? poses[k] ?? new Float64Array(7);
  const offset = (t: (Float64Array | null)[], k: number, f: number): number =>
    t[k] === null ? 0 : f * 7;
  for (let pass = 0; pass < LIFT_PASSES; pass++) {
    let rebuilt = false;
    shapes.forEach((si, i) => {
      const pose = poses[i];
      if (tails[i] === null || pose === undefined) return;
      let top = -Infinity;
      shapes.forEach((sj, j) => {
        if (j === i || !lifts(i, j)) return;
        const reach = getPolyhedron(si).radius + getPolyhedron(sj).radius;
        const vertices = getPolyhedron(sj).vertices;
        const a = framesOf(tails, i);
        const b = framesOf(tails, j);
        const p = framesOf(plain, j);
        for (let f = 0; f < FLATTEN_STEPS; f++) {
          const oa = offset(tails, i, f);
          const ob = offset(tails, j, f);
          const dx = (a[oa] ?? 0) - (b[ob] ?? 0);
          const dy = (a[oa + 1] ?? 0) - (b[ob + 1] ?? 0);
          const dz = (a[oa + 2] ?? 0) - (b[ob + 2] ?? 0);
          if (dx * dx + dy * dy + dz * dz >= reach * reach) continue;
          if (!(penetrationAt(si, a, oa, sj, b, ob) > TAIL_DEPTH)) continue;
          const o = offset(plain, j, f);
          const high = highestY(
            vertices,
            p[o + 3] ?? 0,
            p[o + 4] ?? 0,
            p[o + 5] ?? 0,
            p[o + 6] ?? 1,
          );
          top = Math.max(top, (p[o + 1] ?? 0) + high);
        }
      });
      if (top === -Infinity) return;
      const b0 = bottoms[i] ?? 0;
      const lift = Math.min(Math.max(b0, top) + CLEARANCE, b0 + MAX_RISE);
      if (!(lift > (clearance[i] ?? -Infinity))) return;
      clearance[i] = lift;
      tails[i] = flattenTail(si, pose, xz[2 * i] ?? 0, xz[2 * i + 1] ?? 0, lift);
      rebuilt = true;
    });
    if (!rebuilt) return;
  }
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

/** Highest world y of the vertices under unit quaternion (x, y, z, w), via its matrix's second row. */
function highestY(vertices: readonly Vec3[], x: number, y: number, z: number, w: number): number {
  const r0 = 2 * (x * y + z * w);
  const r1 = 1 - 2 * (x * x + z * z);
  const r2 = 2 * (y * z - x * w);
  let high = -Infinity;
  for (const v of vertices) high = Math.max(high, r0 * v[0] + r1 * v[1] + r2 * v[2]);
  return high;
}
