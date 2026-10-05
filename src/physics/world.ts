import type { ShapeType } from '../geometry/polyhedra';
import type { Quat, Vec3 } from '../geometry/vec';
import { getBodyShape } from './body';
import type { BodyShape } from './body';

export interface TrayBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} // wall planes, die units

export interface WorldConfig {
  gravity: number;
  restitution: number;
  friction: number;
  linearDamping: number; // per second, applied as v *= 1 / (1 + c·DT)
  angularDamping: number; // per second, applied as ω *= 1 / (1 + c·DT)
  iterations: number;
}

export const DT = 1 / 120;

export const DEFAULT_CONFIG: WorldConfig = {
  gravity: -30,
  restitution: 0.35,
  friction: 0.6,
  // Tuned on the settle-acceptance throws (10 mixed dice, seeds 0-49 and 50-249): the best settle
  // rate in the allowed ranges with a median of about 250 steps.
  linearDamping: 0.6,
  angularDamping: 2,
  iterations: 10,
};

export interface World {
  readonly count: number;
  /** Adds a body; returns its index. Max 30 bodies and 20 hull vertices (RangeError beyond). */
  add(
    shape: ShapeType,
    position: Vec3,
    orientation: Quat,
    velocity: Vec3,
    angularVelocity: Vec3,
  ): number;
  step(): void;
  /** Writes px,py,pz,qx,qy,qz,qw of body i into out at offset. */
  read(i: number, out: Float32Array | Float64Array, offset: number): void;
  linearSpeedSq(i: number): number;
  angularSpeedSq(i: number): number;
}

const MAX_BODIES = 30;
const MAX_VERTICES = 20;
const PLANES = 5;
const MAX_CONTACTS = MAX_BODIES * PLANES * MAX_VERTICES + (MAX_BODIES * (MAX_BODIES - 1)) / 2;
const BAUMGARTE = 0.2;
const SLOP = 0.005;
const RESTITUTION_THRESHOLD = 1;
const EPSILON = 1e-12;

// Contact record layout (Float64, STRIDE numbers per contact).
const C_N = 0; // normal (from A to B), 3
const C_T1 = 3; // first tangent, 3
const C_T2 = 6; // second tangent, 3
const C_TARGET = 9; // normal velocity target
const C_LAMBDA = 10; // accumulated impulses: normal, tangent 1, tangent 2
const C_MASS = 13; // effective masses: normal, tangent 1, tangent 2
const C_ROWS = 16; // per row (normal, t1, t2): rA×d, IA⁻¹(rA×d), rB×d, IB⁻¹(rB×d)
const ROW = 12;
const STRIDE = C_ROWS + 3 * ROW;
// Warm-start slots: one per (body, plane, vertex), then one per body pair (i, j).
const PLANE_SLOTS = MAX_BODIES * PLANES * MAX_VERTICES;
const SLOTS = PLANE_SLOTS + MAX_BODIES * MAX_BODIES;

/** Element i of a preallocated buffer (indexes are in range by construction). */
function at(a: Float64Array, i: number): number {
  const v = a[i];
  return v === undefined ? 0 : v;
}

/** Element i of a preallocated index buffer (indexes are in range by construction). */
function atInt(a: Int32Array, i: number): number {
  const v = a[i];
  return v === undefined ? 0 : v;
}

/** Throws RangeError when a hull has more vertices than the contact buffers hold. */
export function checkHull(vertices: Float64Array): void {
  if (vertices.length > MAX_VERTICES * 3) {
    throw new RangeError(`at most ${MAX_VERTICES} hull vertices per body`);
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (!(value >= min)) return min; // also maps NaN to min
  return value > max ? max : value;
}

/**
 * Fixed-step rigid-body world for convex dice of mass 1 in a box tray (floor y = 0 and four walls).
 * Each step is semi-implicit Euler (velocities first, then positions) with contacts solved by
 * warm-started sequential impulses (Catto, "Iterative Dynamics with Temporal Coherence", GDC 2005).
 * All state lives in preallocated Float64Arrays; `step()` allocates nothing.
 */
export function createWorld(bounds: TrayBounds, config?: Partial<WorldConfig>): World {
  const cfg: WorldConfig = { ...DEFAULT_CONFIG, ...config };
  const { gravity, iterations } = cfg;
  const restitution = clampNumber(cfg.restitution, 0, 1);
  const friction = clampNumber(cfg.friction, 0, Infinity);
  const linearFactor = 1 / (1 + clampNumber(cfg.linearDamping, 0, Infinity) * DT);
  const angularFactor = 1 / (1 + clampNumber(cfg.angularDamping, 0, Infinity) * DT);
  const biasRate = BAUMGARTE / DT;

  // Planes in contact order: floor, x >= minX, x <= maxX, z >= minZ, z <= maxZ.
  const planeNormal = new Float64Array([0, 1, 0, 1, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, -1]);
  const planeOffset = new Float64Array([0, bounds.minX, -bounds.maxX, bounds.minZ, -bounds.maxZ]);

  const shapes: BodyShape[] = [];
  const bodyInvInertia = new Float64Array(MAX_BODIES * 3); // body-frame principal inverse moments
  const bodyRadius = new Float64Array(MAX_BODIES);
  const pos = new Float64Array(MAX_BODIES * 3);
  const vel = new Float64Array(MAX_BODIES * 3);
  const quat = new Float64Array(MAX_BODIES * 4);
  const omega = new Float64Array(MAX_BODIES * 3);
  const rot = new Float64Array(MAX_BODIES * 9); // row-major rotation matrix
  const invI = new Float64Array(MAX_BODIES * 9); // world inverse inertia R·diag·Rᵀ
  const worldVerts = new Float64Array(MAX_VERTICES * 3);

  const contacts = new Float64Array(MAX_CONTACTS * STRIDE);
  const contactA = new Int32Array(MAX_CONTACTS); // -1 for a static plane
  const contactB = new Int32Array(MAX_CONTACTS);
  const contactSlot = new Int32Array(MAX_CONTACTS);
  const slotLambda = new Float64Array(SLOTS * 3); // accumulated impulses of each slot's last contact
  const slotStep = new Int32Array(SLOTS); // stepNumber + 1 of the step that wrote slotLambda
  let stepNumber = 1;
  let contactCount = 0;
  let count = 0;

  function checkIndex(i: number): void {
    if (!(i >= 0 && i < count)) throw new RangeError(`body ${i} out of range`);
  }

  /** Rotation matrix from the unit quaternion and world inverse inertia I⁻¹ = R·diag(d)·Rᵀ. */
  function updateInertia(i: number): void {
    const x = at(quat, i * 4);
    const y = at(quat, i * 4 + 1);
    const z = at(quat, i * 4 + 2);
    const w = at(quat, i * 4 + 3);
    const r = i * 9;
    rot[r] = 1 - 2 * (y * y + z * z);
    rot[r + 1] = 2 * (x * y - z * w);
    rot[r + 2] = 2 * (x * z + y * w);
    rot[r + 3] = 2 * (x * y + z * w);
    rot[r + 4] = 1 - 2 * (x * x + z * z);
    rot[r + 5] = 2 * (y * z - x * w);
    rot[r + 6] = 2 * (x * z - y * w);
    rot[r + 7] = 2 * (y * z + x * w);
    rot[r + 8] = 1 - 2 * (x * x + y * y);
    const d0 = at(bodyInvInertia, i * 3);
    const d1 = at(bodyInvInertia, i * 3 + 1);
    const d2 = at(bodyInvInertia, i * 3 + 2);
    for (let row = 0; row < 3; row++) {
      const a0 = at(rot, r + row * 3);
      const a1 = at(rot, r + row * 3 + 1);
      const a2 = at(rot, r + row * 3 + 2);
      for (let col = 0; col < 3; col++) {
        invI[r + row * 3 + col] =
          a0 * d0 * at(rot, r + col * 3) +
          a1 * d1 * at(rot, r + col * 3 + 1) +
          a2 * d2 * at(rot, r + col * 3 + 2);
      }
    }
  }

  /** Writes r × d and I⁻¹(r × d) for body `body` (skipped for a static plane, body < 0) at `offset`;
   *  returns the angular term (r × d)·I⁻¹(r × d) of the effective mass. */
  function angularRow(
    body: number,
    rx: number,
    ry: number,
    rz: number,
    dx: number,
    dy: number,
    dz: number,
    offset: number,
  ): number {
    if (body < 0) {
      for (let k = 0; k < 6; k++) contacts[offset + k] = 0;
      return 0;
    }
    const cx = ry * dz - rz * dy;
    const cy = rz * dx - rx * dz;
    const cz = rx * dy - ry * dx;
    const m = body * 9;
    const ix = at(invI, m) * cx + at(invI, m + 1) * cy + at(invI, m + 2) * cz;
    const iy = at(invI, m + 3) * cx + at(invI, m + 4) * cy + at(invI, m + 5) * cz;
    const iz = at(invI, m + 6) * cx + at(invI, m + 7) * cy + at(invI, m + 8) * cz;
    contacts[offset] = cx;
    contacts[offset + 1] = cy;
    contacts[offset + 2] = cz;
    contacts[offset + 3] = ix;
    contacts[offset + 4] = iy;
    contacts[offset + 5] = iz;
    return cx * ix + cy * iy + cz * iz;
  }

  /** Velocity of B relative to A along row `row` of contact `c`: d·vB + ωB·(rB×d) − d·vA − ωA·(rA×d). */
  function rowVelocity(c: number, row: number): number {
    const base = c * STRIDE;
    const dir = base + row * 3;
    const r = base + C_ROWS + row * ROW;
    const dx = at(contacts, dir);
    const dy = at(contacts, dir + 1);
    const dz = at(contacts, dir + 2);
    const b = atInt(contactB, c) * 3;
    let v =
      dx * at(vel, b) +
      dy * at(vel, b + 1) +
      dz * at(vel, b + 2) +
      at(omega, b) * at(contacts, r + 6) +
      at(omega, b + 1) * at(contacts, r + 7) +
      at(omega, b + 2) * at(contacts, r + 8);
    const ai = atInt(contactA, c);
    if (ai >= 0) {
      const a = ai * 3;
      v -=
        dx * at(vel, a) +
        dy * at(vel, a + 1) +
        dz * at(vel, a + 2) +
        at(omega, a) * at(contacts, r) +
        at(omega, a + 1) * at(contacts, r + 1) +
        at(omega, a + 2) * at(contacts, r + 2);
    }
    return v;
  }

  /**
   * Records a contact of body B against A (-1 = static plane), normal n from A to B. Tangents use
   * Catto's deterministic basis ("Computing a Basis", 2009); |nx| ≥ 0.57735 ≈ 1/√3 keeps the divisor
   * ≥ √(1/3). Impulses warm-start from `slot` when it had a contact in the previous step.
   */
  function addContact(
    a: number,
    b: number,
    nx: number,
    ny: number,
    nz: number,
    rax: number,
    ray: number,
    raz: number,
    rbx: number,
    rby: number,
    rbz: number,
    depth: number,
    slot: number,
  ): void {
    const c = contactCount++;
    contactA[c] = a;
    contactB[c] = b;
    contactSlot[c] = slot;
    const warm = atInt(slotStep, slot) === stepNumber;
    const base = c * STRIDE;
    let t1x: number;
    let t1y: number;
    let t1z: number;
    if (Math.abs(nx) >= 0.57735) {
      const len = Math.sqrt(nx * nx + ny * ny);
      t1x = ny / len;
      t1y = -nx / len;
      t1z = 0;
    } else {
      const len = Math.sqrt(ny * ny + nz * nz);
      t1x = 0;
      t1y = nz / len;
      t1z = -ny / len;
    }
    const t2x = ny * t1z - nz * t1y;
    const t2y = nz * t1x - nx * t1z;
    const t2z = nx * t1y - ny * t1x;
    contacts[base + C_N] = nx;
    contacts[base + C_N + 1] = ny;
    contacts[base + C_N + 2] = nz;
    contacts[base + C_T1] = t1x;
    contacts[base + C_T1 + 1] = t1y;
    contacts[base + C_T1 + 2] = t1z;
    contacts[base + C_T2] = t2x;
    contacts[base + C_T2 + 1] = t2y;
    contacts[base + C_T2 + 2] = t2z;
    const linear = a >= 0 ? 2 : 1;
    for (let row = 0; row < 3; row++) {
      const dx = at(contacts, base + row * 3);
      const dy = at(contacts, base + row * 3 + 1);
      const dz = at(contacts, base + row * 3 + 2);
      const rowAt = base + C_ROWS + row * ROW;
      const k =
        linear +
        angularRow(a, rax, ray, raz, dx, dy, dz, rowAt) +
        angularRow(b, rbx, rby, rbz, dx, dy, dz, rowAt + 6);
      contacts[base + C_MASS + row] = k > EPSILON ? 1 / k : 0;
      contacts[base + C_LAMBDA + row] = warm ? at(slotLambda, slot * 3 + row) : 0;
    }
    const approach = rowVelocity(c, 0);
    const bias = depth > SLOP ? biasRate * (depth - SLOP) : 0;
    const bounce = approach < -RESTITUTION_THRESHOLD ? -restitution * approach : 0;
    contacts[base + C_TARGET] = bias > bounce ? bias : bounce;
  }

  /** Convex vertex–plane contacts (exact for a hull against a half-space), then bounding-sphere
   *  pairs i < j. Order: body, plane, vertex; then pairs in (i, j) order. */
  function collide(): void {
    contactCount = 0;
    for (let i = 0; i < count; i++) {
      const shape = shapes[i];
      if (shape === undefined) continue;
      const verts = shape.vertices;
      const nv = verts.length / 3;
      const m = i * 9;
      const px = at(pos, i * 3);
      const py = at(pos, i * 3 + 1);
      const pz = at(pos, i * 3 + 2);
      for (let k = 0; k < nv; k++) {
        const vx = at(verts, k * 3);
        const vy = at(verts, k * 3 + 1);
        const vz = at(verts, k * 3 + 2);
        worldVerts[k * 3] = at(rot, m) * vx + at(rot, m + 1) * vy + at(rot, m + 2) * vz;
        worldVerts[k * 3 + 1] = at(rot, m + 3) * vx + at(rot, m + 4) * vy + at(rot, m + 5) * vz;
        worldVerts[k * 3 + 2] = at(rot, m + 6) * vx + at(rot, m + 7) * vy + at(rot, m + 8) * vz;
      }
      for (let p = 0; p < PLANES; p++) {
        const nx = at(planeNormal, p * 3);
        const ny = at(planeNormal, p * 3 + 1);
        const nz = at(planeNormal, p * 3 + 2);
        const offset = at(planeOffset, p);
        for (let k = 0; k < nv; k++) {
          const rx = at(worldVerts, k * 3);
          const ry = at(worldVerts, k * 3 + 1);
          const rz = at(worldVerts, k * 3 + 2);
          const separation = nx * (px + rx) + ny * (py + ry) + nz * (pz + rz) - offset;
          if (separation < 0) {
            const slot = (i * PLANES + p) * MAX_VERTICES + k;
            addContact(-1, i, nx, ny, nz, 0, 0, 0, rx, ry, rz, -separation, slot);
          }
        }
      }
    }
    for (let i = 0; i < count; i++) {
      const ri = at(bodyRadius, i);
      for (let j = i + 1; j < count; j++) {
        const rj = at(bodyRadius, j);
        const dx = at(pos, j * 3) - at(pos, i * 3);
        const dy = at(pos, j * 3 + 1) - at(pos, i * 3 + 1);
        const dz = at(pos, j * 3 + 2) - at(pos, i * 3 + 2);
        const distSq = dx * dx + dy * dy + dz * dz;
        const reach = ri + rj;
        if (distSq >= reach * reach) continue;
        const dist = Math.sqrt(distSq);
        let nx = 0;
        let ny = 1;
        let nz = 0;
        if (dist >= 1e-9) {
          nx = dx / dist;
          ny = dy / dist;
          nz = dz / dist;
        }
        addContact(
          i,
          j,
          nx,
          ny,
          nz,
          nx * ri,
          ny * ri,
          nz * ri,
          -nx * rj,
          -ny * rj,
          -nz * rj,
          reach - dist,
          PLANE_SLOTS + i * MAX_BODIES + j,
        );
      }
    }
  }

  /**
   * Sequential impulses with warm starting (Catto 2005): normal impulse clamped >= 0, box friction
   * clamped to ±friction·λn; accumulated impulses are saved per slot for the next step.
   */
  function solve(): void {
    for (let c = 0; c < contactCount; c++) {
      const base = c * STRIDE;
      const b = atInt(contactB, c) * 3;
      const ai = atInt(contactA, c);
      for (let row = 0; row < 3; row++) {
        const lambda = at(contacts, base + C_LAMBDA + row);
        if (lambda === 0) continue;
        const dir = base + row * 3;
        const r = base + C_ROWS + row * ROW;
        for (let k = 0; k < 3; k++) {
          vel[b + k] = at(vel, b + k) + at(contacts, dir + k) * lambda;
          omega[b + k] = at(omega, b + k) + at(contacts, r + 9 + k) * lambda;
        }
        if (ai >= 0) {
          const a = ai * 3;
          for (let k = 0; k < 3; k++) {
            vel[a + k] = at(vel, a + k) - at(contacts, dir + k) * lambda;
            omega[a + k] = at(omega, a + k) - at(contacts, r + 3 + k) * lambda;
          }
        }
      }
    }
    for (let it = 0; it < iterations; it++) {
      for (let c = 0; c < contactCount; c++) {
        const base = c * STRIDE;
        const b = atInt(contactB, c) * 3;
        const ai = atInt(contactA, c);
        const a = ai < 0 ? 0 : ai * 3;
        let vbx = at(vel, b);
        let vby = at(vel, b + 1);
        let vbz = at(vel, b + 2);
        let wbx = at(omega, b);
        let wby = at(omega, b + 1);
        let wbz = at(omega, b + 2);
        let vax = 0;
        let vay = 0;
        let vaz = 0;
        let wax = 0;
        let way = 0;
        let waz = 0;
        if (ai >= 0) {
          vax = at(vel, a);
          vay = at(vel, a + 1);
          vaz = at(vel, a + 2);
          wax = at(omega, a);
          way = at(omega, a + 1);
          waz = at(omega, a + 2);
        }
        let limit = 0;
        for (let row = 0; row < 3; row++) {
          const dir = base + row * 3;
          const r = base + C_ROWS + row * ROW;
          const dx = at(contacts, dir);
          const dy = at(contacts, dir + 1);
          const dz = at(contacts, dir + 2);
          let v =
            dx * vbx +
            dy * vby +
            dz * vbz +
            wbx * at(contacts, r + 6) +
            wby * at(contacts, r + 7) +
            wbz * at(contacts, r + 8);
          if (ai >= 0) {
            v -=
              dx * vax +
              dy * vay +
              dz * vaz +
              wax * at(contacts, r) +
              way * at(contacts, r + 1) +
              waz * at(contacts, r + 2);
          }
          const old = at(contacts, base + C_LAMBDA + row);
          const mass = at(contacts, base + C_MASS + row);
          let next: number;
          if (row === 0) {
            next = old + mass * (at(contacts, base + C_TARGET) - v);
            if (next < 0) next = 0;
            limit = friction * next;
          } else {
            next = old - mass * v;
            if (next > limit) next = limit;
            else if (next < -limit) next = -limit;
          }
          contacts[base + C_LAMBDA + row] = next;
          const lambda = next - old;
          vbx += dx * lambda;
          vby += dy * lambda;
          vbz += dz * lambda;
          wbx += at(contacts, r + 9) * lambda;
          wby += at(contacts, r + 10) * lambda;
          wbz += at(contacts, r + 11) * lambda;
          if (ai >= 0) {
            vax -= dx * lambda;
            vay -= dy * lambda;
            vaz -= dz * lambda;
            wax -= at(contacts, r + 3) * lambda;
            way -= at(contacts, r + 4) * lambda;
            waz -= at(contacts, r + 5) * lambda;
          }
        }
        vel[b] = vbx;
        vel[b + 1] = vby;
        vel[b + 2] = vbz;
        omega[b] = wbx;
        omega[b + 1] = wby;
        omega[b + 2] = wbz;
        if (ai >= 0) {
          vel[a] = vax;
          vel[a + 1] = vay;
          vel[a + 2] = vaz;
          omega[a] = wax;
          omega[a + 1] = way;
          omega[a + 2] = waz;
        }
      }
    }
    for (let c = 0; c < contactCount; c++) {
      const slot = atInt(contactSlot, c);
      const base = c * STRIDE + C_LAMBDA;
      slotLambda[slot * 3] = at(contacts, base);
      slotLambda[slot * 3 + 1] = at(contacts, base + 1);
      slotLambda[slot * 3 + 2] = at(contacts, base + 2);
      slotStep[slot] = stepNumber + 1;
    }
  }

  return {
    get count(): number {
      return count;
    },

    add(shape, position, orientation, velocity, angularVelocity): number {
      if (count >= MAX_BODIES) throw new RangeError(`at most ${MAX_BODIES} bodies per world`);
      const i = count;
      const body = getBodyShape(shape);
      checkHull(body.vertices);
      shapes.push(body);
      bodyInvInertia.set(body.invInertia, i * 3);
      bodyRadius[i] = body.radius;
      pos.set(position, i * 3);
      vel.set(velocity, i * 3);
      omega.set(angularVelocity, i * 3);
      const [x, y, z, w] = orientation;
      const len = Math.sqrt(x * x + y * y + z * z + w * w);
      if (len > EPSILON) quat.set([x / len, y / len, z / len, w / len], i * 4);
      else quat.set([0, 0, 0, 1], i * 4);
      count++;
      return i;
    },

    /** One fixed step of DT: semi-implicit Euler velocity update (gravity, damping), contacts,
     *  sequential impulses, then position and first-order quaternion integration
     *  q += ½·DT·(ω, 0) ⊗ q with renormalization. */
    step(): void {
      const gdt = gravity * DT;
      for (let i = 0; i < count; i++) {
        const v = i * 3;
        vel[v + 1] = at(vel, v + 1) + gdt;
        for (let k = 0; k < 3; k++) {
          vel[v + k] = at(vel, v + k) * linearFactor;
          omega[v + k] = at(omega, v + k) * angularFactor;
        }
        updateInertia(i);
      }
      collide();
      solve();
      stepNumber++;
      const half = 0.5 * DT;
      for (let i = 0; i < count; i++) {
        const v = i * 3;
        pos[v] = at(pos, v) + at(vel, v) * DT;
        pos[v + 1] = at(pos, v + 1) + at(vel, v + 1) * DT;
        pos[v + 2] = at(pos, v + 2) + at(vel, v + 2) * DT;
        const wx = at(omega, v);
        const wy = at(omega, v + 1);
        const wz = at(omega, v + 2);
        const q = i * 4;
        const qx = at(quat, q);
        const qy = at(quat, q + 1);
        const qz = at(quat, q + 2);
        const qw = at(quat, q + 3);
        const nx = qx + half * (wx * qw + wy * qz - wz * qy);
        const ny = qy + half * (-wx * qz + wy * qw + wz * qx);
        const nz = qz + half * (wx * qy - wy * qx + wz * qw);
        const nw = qw + half * (-wx * qx - wy * qy - wz * qz);
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
        if (len > EPSILON) {
          quat[q] = nx / len;
          quat[q + 1] = ny / len;
          quat[q + 2] = nz / len;
          quat[q + 3] = nw / len;
        } else {
          quat[q] = 0;
          quat[q + 1] = 0;
          quat[q + 2] = 0;
          quat[q + 3] = 1;
        }
      }
    },

    read(i, out, offset): void {
      checkIndex(i);
      for (let k = 0; k < 3; k++) out[offset + k] = at(pos, i * 3 + k);
      for (let k = 0; k < 4; k++) out[offset + 3 + k] = at(quat, i * 4 + k);
    },

    linearSpeedSq(i): number {
      checkIndex(i);
      const x = at(vel, i * 3);
      const y = at(vel, i * 3 + 1);
      const z = at(vel, i * 3 + 2);
      return x * x + y * y + z * z;
    },

    angularSpeedSq(i): number {
      checkIndex(i);
      const x = at(omega, i * 3);
      const y = at(omega, i * 3 + 1);
      const z = at(omega, i * 3 + 2);
      return x * x + y * y + z * z;
    },
  };
}
