/**
 * Small immutable vector and quaternion helpers for geometry setup. Deterministic: only
 * `+ - * /`, `Math.sqrt`, comparisons, and `Math.abs`, so results are bit-identical across
 * JavaScript engines.
 */

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number]; // [x, y, z, w], Hamilton convention

export const IDENTITY: Quat = [0, 0, 0, 1];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

/** Unit vector; returns [0, 0, 0] when length <= 1e-12. */
export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len <= 1e-12) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

/** Hamilton product a ⊗ b (apply b, then a). */
export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotates v by unit quaternion q (q v q*), using v + 2w(u × v) + 2u × (u × v). */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}

/** Rotation matrix (row-major 3x3, 9 numbers) to unit quaternion, Shepperd's method, sqrt only;
 *  canonical sign: w > 0, or when |w| < 1e-12 the first non-zero of x, y, z is positive. */
export function quatFromMatrix(m: readonly number[]): Quat {
  const [m00 = 0, m01 = 0, m02 = 0, m10 = 0, m11 = 0, m12 = 0, m20 = 0, m21 = 0, m22 = 0] = m;
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = s / 4;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = s / 4;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = s / 4;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = s / 4;
  }
  const len = Math.sqrt(x * x + y * y + z * z + w * w);
  x /= len;
  y /= len;
  z /= len;
  w /= len;
  let flip: boolean;
  if (Math.abs(w) >= 1e-12) flip = w < 0;
  else if (Math.abs(x) >= 1e-12) flip = x < 0;
  else if (Math.abs(y) >= 1e-12) flip = y < 0;
  else flip = z < 0;
  return flip ? [-x, -y, -z, -w] : [x, y, z, w];
}
