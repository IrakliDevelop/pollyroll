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
  friction: number; // floor
  wallFriction: number; // walls: low so dice slide off instead of resting cocked
  pairFriction: number; // die against die: low so dice slide off neighbours
  linearDamping: number; // per second, applied as v *= 1 / (1 + c·DT)
  angularDamping: number; // per second, applied as ω *= 1 / (1 + c·DT)
  iterations: number;
}

export const DT = 1 / 120;

export const DEFAULT_CONFIG: WorldConfig = {
  gravity: -30,
  restitution: 0.35,
  friction: 0.6,
  wallFriction: 0.1,
  pairFriction: 0.1,
  // Tuned on the settle-acceptance throws (10 mixed dice, seeds 0-49 and 50-249): the best settle
  // rate in the allowed ranges with a median of about 250 steps.
  linearDamping: 0.6,
  angularDamping: 2,
  iterations: 10,
};

export interface World {
  readonly count: number;
  /** Adds a body; returns its index. Max 30 bodies and 32 hull vertices (RangeError beyond). */
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
const MAX_VERTICES = 32;
const MAX_FACES = 20;
const MAX_EDGES = 48; // hull edges the penetration.ts scratch buffers hold
const FACE_EDGES = 16; // edges per face: bounds the clip polygon and the warm-start feature keys
const PLANES = 5;
const PAIR_CONTACTS = MAX_BODIES * 8;
const PAIR_KEEP = 4;
// Sutherland–Hodgman: each side plane adds at most one vertex to a convex polygon.
const MAX_CLIP = FACE_EDGES + FACE_EDGES;
const REFERENCE_BIAS = 0.005; // prefer A's face unless B's separates clearly more (frame coherence)
const MAX_CONTACTS = MAX_BODIES * PLANES * MAX_VERTICES + PAIR_CONTACTS;
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
// Warm-start slots: one per (body, plane, vertex), then a region per body pair (i, j) allocated at
// add, keyed by the clip feature with e = the pair's most edges per face: e incident vertices +
// 2·e (edge label) × e (reference edge) intersections + 1 fallback.
const PLANE_SLOTS = MAX_BODIES * PLANES * MAX_VERTICES;
const MARGIN = 0.01; // clipped points up to this far above the reference plane are speculative

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

/** Throws RangeError when a hull has more vertices, faces, or edges than the contact buffers hold. */
export function checkHull(body: BodyShape): void {
  if (body.vertices.length > MAX_VERTICES * 3) {
    throw new RangeError(`at most ${MAX_VERTICES} hull vertices per body`);
  }
  if (body.planes.length > MAX_FACES * 4) {
    throw new RangeError(`at most ${MAX_FACES} faces per body`);
  }
  let sides = 0;
  for (const face of body.faces) {
    if (face.length > FACE_EDGES) throw new RangeError(`at most ${FACE_EDGES} edges per face`);
    sides += face.length;
  }
  if (sides > MAX_EDGES * 2) throw new RangeError(`at most ${MAX_EDGES} edges per body`);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!(value >= min)) return min; // also maps NaN to min
  return value > max ? max : value;
}

/**
 * Fixed-step rigid-body world for convex dice of mass 1 in a box tray (floor y = 0 and four walls).
 * Each step is semi-implicit Euler (velocities first, then positions) with contacts solved by
 * warm-started sequential impulses (Catto, "Iterative Dynamics with Temporal Coherence", GDC 2005).
 * Dice collide by their hulls: face-normal separating axis test, then the incident face clipped
 * against the reference face (Gregorius, "Robust Contact Creation for Physics Simulations", GDC 2015).
 * All state lives in preallocated Float64Arrays; `step()` allocates nothing.
 */
export function createWorld(bounds: TrayBounds, config?: Partial<WorldConfig>): World {
  const cfg: WorldConfig = { ...DEFAULT_CONFIG, ...config };
  const { gravity, iterations } = cfg;
  const restitution = clampNumber(cfg.restitution, 0, 1);
  const friction = clampNumber(cfg.friction, 0, Infinity);
  const wallFriction = clampNumber(cfg.wallFriction, 0, Infinity);
  const pairFriction = clampNumber(cfg.pairFriction, 0, Infinity);
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
  const vertexCount = new Int32Array(MAX_BODIES);
  const faceEdges = new Int32Array(MAX_BODIES); // most edges on one face
  const pairSlot = new Int32Array(MAX_BODIES * MAX_BODIES); // first slot of pair (i, j), i < j
  const faceCount = new Int32Array(MAX_BODIES);
  const worldVerts = new Float64Array(MAX_BODIES * MAX_VERTICES * 3); // R·v + p
  const worldPlanes = new Float64Array(MAX_BODIES * MAX_FACES * 4); // R·n, R·n·p + h
  const queryFace = new Int32Array(2); // argmax face of the last face query, per side
  const clipA = new Float64Array(MAX_CLIP * 3); // Sutherland–Hodgman ping-pong polygons
  const clipB = new Float64Array(MAX_CLIP * 3);
  const keyA = new Int32Array(MAX_CLIP); // feature key of each clip point
  const keyB = new Int32Array(MAX_CLIP);
  const labelA = new Int32Array(MAX_CLIP); // edge label of the edge leaving each clip point
  const labelB = new Int32Array(MAX_CLIP);
  const clipDepth = new Float64Array(MAX_CLIP);
  const clipKept = new Uint8Array(MAX_CLIP);

  const contacts = new Float64Array(MAX_CONTACTS * STRIDE);
  const contactA = new Int32Array(MAX_CONTACTS); // -1 for a static plane
  const contactB = new Int32Array(MAX_CONTACTS);
  const contactSlot = new Int32Array(MAX_CONTACTS);
  const contactFriction = new Float64Array(MAX_CONTACTS);
  // Sized to the pairs added so far: a coin's 16-edge caps need ~9× the slots of a die pair.
  let slotLambda = new Float64Array(PLANE_SLOTS * 3); // accumulated impulses of each slot's last contact
  let slotStep = new Int32Array(PLANE_SLOTS); // stepNumber + 1 of the step that wrote slotLambda
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
    mu: number,
  ): void {
    const c = contactCount++;
    contactA[c] = a;
    contactB[c] = b;
    contactSlot[c] = slot;
    contactFriction[c] = mu;
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
    // A speculative contact (gap -depth) only stops approaches that would close the gap this step.
    contacts[base + C_TARGET] = depth < 0 ? depth / DT : bias > bounce ? bias : bounce;
  }

  /** Face query of the face-normal SAT: max over `ref` faces of min over `inc` vertices of n·v − d,
   *  argmax face (lowest index on ties) into queryFace[side]; returns early once > 0 (separated). */
  function faceQuery(ref: number, inc: number, side: number): number {
    const nv = atInt(vertexCount, inc);
    let best = -Infinity;
    for (let f = 0; f < atInt(faceCount, ref); f++) {
      const pl = (ref * MAX_FACES + f) * 4;
      const nx = at(worldPlanes, pl);
      const ny = at(worldPlanes, pl + 1);
      const nz = at(worldPlanes, pl + 2);
      const d = at(worldPlanes, pl + 3);
      let min = Infinity;
      for (let k = 0; k < nv; k++) {
        const w = (inc * MAX_VERTICES + k) * 3;
        const sep =
          nx * at(worldVerts, w) + ny * at(worldVerts, w + 1) + nz * at(worldVerts, w + 2) - d;
        if (sep < min) min = sep;
      }
      if (min > best) {
        best = min;
        queryFace[side] = f;
        if (best > 0) return best;
      }
    }
    return best;
  }

  /** Contact of pair (a, b) at world point x with normal n from a to b. */
  function pairContact(
    a: number,
    b: number,
    nx: number,
    ny: number,
    nz: number,
    x: number,
    y: number,
    z: number,
    depth: number,
    slot: number,
  ): void {
    const pa = a * 3;
    const pb = b * 3;
    addContact(
      a,
      b,
      nx,
      ny,
      nz,
      x - at(pos, pa),
      y - at(pos, pa + 1),
      z - at(pos, pa + 2),
      x - at(pos, pb),
      y - at(pos, pb + 1),
      z - at(pos, pb + 2),
      depth,
      slot,
      pairFriction,
    );
  }

  /**
   * Hull contacts of pair a < b: face-normal SAT (edge–edge axes are not tested, so edge–edge
   * separations may report a small early contact), then the incident face (most antiparallel to the
   * reference normal) is clipped against the reference face's side planes (Sutherland–Hodgman).
   * Clipped points less than MARGIN above the reference plane are contacts (speculative above it),
   * reduced to PAIR_KEEP (deepest, then farthest from those kept), each warm-started from the slot of
   * the clip feature that produced it; an empty clip falls back to Inc's deepest vertex.
   */
  function collidePair(a: number, b: number): void {
    const sepA = faceQuery(a, b, 0);
    if (sepA > 0) return;
    const sepB = faceQuery(b, a, 1);
    if (sepB > 0) return;
    const flip = sepB > sepA + REFERENCE_BIAS;
    const ref = flip ? b : a;
    const inc = flip ? a : b;
    const refShape = shapes[ref];
    const incShape = shapes[inc];
    if (refShape === undefined || incShape === undefined) return;
    const refFace = atInt(queryFace, flip ? 1 : 0);
    const pl = (ref * MAX_FACES + refFace) * 4;
    const nx = at(worldPlanes, pl);
    const ny = at(worldPlanes, pl + 1);
    const nz = at(worldPlanes, pl + 2);
    const d = at(worldPlanes, pl + 3);
    const sign = flip ? -1 : 1;
    const slotBase = atInt(pairSlot, a * MAX_BODIES + b);
    const edgesA = atInt(faceEdges, a);
    const edgesB = atInt(faceEdges, b);
    const edges = edgesA > edgesB ? edgesA : edgesB;

    let incFace = 0;
    let minDot = Infinity;
    for (let f = 0; f < atInt(faceCount, inc); f++) {
      const q = (inc * MAX_FACES + f) * 4;
      const dn =
        at(worldPlanes, q) * nx + at(worldPlanes, q + 1) * ny + at(worldPlanes, q + 2) * nz;
      if (dn < minDot) {
        minDot = dn;
        incFace = f;
      }
    }
    let src = clipA;
    let dst = clipB;
    let srcKey = keyA;
    let dstKey = keyB;
    let srcLabel = labelA;
    let dstLabel = labelB;
    const incPoly = incShape.faces[incFace] ?? [];
    let points = incPoly.length;
    for (let k = 0; k < points; k++) {
      const w = (inc * MAX_VERTICES + (incPoly[k] ?? 0)) * 3;
      src[k * 3] = at(worldVerts, w);
      src[k * 3 + 1] = at(worldVerts, w + 1);
      src[k * 3 + 2] = at(worldVerts, w + 2);
      srcKey[k] = k;
      srcLabel[k] = k;
    }
    const refPoly = refShape.faces[refFace] ?? [];
    for (let e = 0; e < refPoly.length && points > 0; e++) {
      const p = (ref * MAX_VERTICES + (refPoly[e] ?? 0)) * 3;
      const q = (ref * MAX_VERTICES + (refPoly[(e + 1) % refPoly.length] ?? 0)) * 3;
      const px = at(worldVerts, p);
      const py = at(worldVerts, p + 1);
      const pz = at(worldVerts, p + 2);
      const ex = at(worldVerts, q) - px;
      const ey = at(worldVerts, q + 1) - py;
      const ez = at(worldVerts, q + 2) - pz;
      // (q − p) × n points out of a counter-clockwise face.
      const sx = ey * nz - ez * ny;
      const sy = ez * nx - ex * nz;
      const sz = ex * ny - ey * nx;
      const limit = sx * px + sy * py + sz * pz;
      let out = 0;
      for (let k = 0; k < points; k++) {
        const c = k * 3;
        const n = ((k + 1) % points) * 3;
        const cx = at(src, c);
        const cy = at(src, c + 1);
        const cz = at(src, c + 2);
        const da = sx * cx + sy * cy + sz * cz - limit;
        const db = sx * at(src, n) + sy * at(src, n + 1) + sz * at(src, n + 2) - limit;
        // Edge labels: incident edge k is k, the part of side plane e is edges + e.
        const label = atInt(srcLabel, k);
        if (da <= 0) {
          dst[out * 3] = cx;
          dst[out * 3 + 1] = cy;
          dst[out * 3 + 2] = cz;
          dstKey[out] = atInt(srcKey, k);
          dstLabel[out] = da === 0 && db > 0 ? edges + e : label;
          out++;
        }
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const t = da / (da - db);
          dst[out * 3] = cx + (at(src, n) - cx) * t;
          dst[out * 3 + 1] = cy + (at(src, n + 1) - cy) * t;
          dst[out * 3 + 2] = cz + (at(src, n + 2) - cz) * t;
          dstKey[out] = edges + label * edges + e;
          dstLabel[out] = da < 0 ? edges + e : label;
          out++;
        }
      }
      const swap = src;
      src = dst;
      dst = swap;
      const swapKey = srcKey;
      srcKey = dstKey;
      dstKey = swapKey;
      const swapLabel = srcLabel;
      srcLabel = dstLabel;
      dstLabel = swapLabel;
      points = out;
    }

    let below = 0;
    for (let k = 0; k < points; k++) {
      const x = at(src, k * 3);
      const y = at(src, k * 3 + 1);
      const z = at(src, k * 3 + 2);
      const depth = d - (nx * x + ny * y + nz * z);
      if (!(depth > -MARGIN)) continue;
      src[below * 3] = x;
      src[below * 3 + 1] = y;
      src[below * 3 + 2] = z;
      srcKey[below] = atInt(srcKey, k);
      clipDepth[below] = depth;
      below++;
    }

    if (below === 0) {
      let deepest = 0;
      let minAlong = Infinity;
      for (let k = 0; k < atInt(vertexCount, inc); k++) {
        const w = (inc * MAX_VERTICES + k) * 3;
        const along =
          nx * at(worldVerts, w) + ny * at(worldVerts, w + 1) + nz * at(worldVerts, w + 2);
        if (along < minAlong) {
          minAlong = along;
          deepest = w;
        }
      }
      const depth = -(sepA > sepB ? sepA : sepB);
      pairContact(
        a,
        b,
        sign * nx,
        sign * ny,
        sign * nz,
        at(worldVerts, deepest),
        at(worldVerts, deepest + 1),
        at(worldVerts, deepest + 2),
        depth,
        slotBase + edges + 2 * edges * edges,
      );
      return;
    }

    for (let k = 0; k < below; k++) clipKept[k] = below > PAIR_KEEP ? 0 : 1;
    if (below > PAIR_KEEP) {
      let first = 0;
      for (let k = 1; k < below; k++) if (at(clipDepth, k) > at(clipDepth, first)) first = k;
      clipKept[first] = 1;
      for (let r = 1; r < PAIR_KEEP; r++) {
        let pick = 0;
        let pickDistSq = -1;
        for (let k = 0; k < below; k++) {
          if (clipKept[k] === 1) continue;
          let nearSq = Infinity;
          for (let l = 0; l < below; l++) {
            if (clipKept[l] !== 1) continue;
            const dx = at(src, k * 3) - at(src, l * 3);
            const dy = at(src, k * 3 + 1) - at(src, l * 3 + 1);
            const dz = at(src, k * 3 + 2) - at(src, l * 3 + 2);
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq < nearSq) nearSq = distSq;
          }
          if (nearSq > pickDistSq) {
            pickDistSq = nearSq;
            pick = k;
          }
        }
        clipKept[pick] = 1;
      }
    }
    for (let k = 0; k < below; k++) {
      if (clipKept[k] !== 1) continue;
      pairContact(
        a,
        b,
        sign * nx,
        sign * ny,
        sign * nz,
        at(src, k * 3),
        at(src, k * 3 + 1),
        at(src, k * 3 + 2),
        at(clipDepth, k),
        slotBase + atInt(srcKey, k),
      );
    }
  }

  /**
   * Convex vertex–plane contacts (exact for a hull against a half-space), then die pairs i < j:
   * bounding spheres as the broad phase, hull contacts by `collidePair`. Order: body, plane,
   * vertex; then pairs in (i, j) order, skipping the rest once PAIR_CONTACTS could be exceeded.
   */
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
      const r00 = at(rot, m);
      const r01 = at(rot, m + 1);
      const r02 = at(rot, m + 2);
      const r10 = at(rot, m + 3);
      const r11 = at(rot, m + 4);
      const r12 = at(rot, m + 5);
      const r20 = at(rot, m + 6);
      const r21 = at(rot, m + 7);
      const r22 = at(rot, m + 8);
      for (let k = 0; k < nv; k++) {
        const vx = at(verts, k * 3);
        const vy = at(verts, k * 3 + 1);
        const vz = at(verts, k * 3 + 2);
        const w = (i * MAX_VERTICES + k) * 3;
        worldVerts[w] = r00 * vx + r01 * vy + r02 * vz + px;
        worldVerts[w + 1] = r10 * vx + r11 * vy + r12 * vz + py;
        worldVerts[w + 2] = r20 * vx + r21 * vy + r22 * vz + pz;
      }
      const planes = shape.planes;
      for (let f = 0; f < planes.length / 4; f++) {
        const nx = at(planes, f * 4);
        const ny = at(planes, f * 4 + 1);
        const nz = at(planes, f * 4 + 2);
        const wx = r00 * nx + r01 * ny + r02 * nz;
        const wy = r10 * nx + r11 * ny + r12 * nz;
        const wz = r20 * nx + r21 * ny + r22 * nz;
        const pl = (i * MAX_FACES + f) * 4;
        worldPlanes[pl] = wx;
        worldPlanes[pl + 1] = wy;
        worldPlanes[pl + 2] = wz;
        worldPlanes[pl + 3] = wx * px + wy * py + wz * pz + at(planes, f * 4 + 3);
      }
      for (let p = 0; p < PLANES; p++) {
        const nx = at(planeNormal, p * 3);
        const ny = at(planeNormal, p * 3 + 1);
        const nz = at(planeNormal, p * 3 + 2);
        const offset = at(planeOffset, p);
        const mu = p === 0 ? friction : wallFriction;
        for (let k = 0; k < nv; k++) {
          const w = (i * MAX_VERTICES + k) * 3;
          const wx = at(worldVerts, w);
          const wy = at(worldVerts, w + 1);
          const wz = at(worldVerts, w + 2);
          const separation = nx * wx + ny * wy + nz * wz - offset;
          if (separation < 0) {
            const slot = (i * PLANES + p) * MAX_VERTICES + k;
            addContact(
              -1,
              i,
              nx,
              ny,
              nz,
              0,
              0,
              0,
              wx - px,
              wy - py,
              wz - pz,
              -separation,
              slot,
              mu,
            );
          }
        }
      }
    }
    const pairStart = contactCount;
    for (let i = 0; i < count; i++) {
      const ri = at(bodyRadius, i);
      for (let j = i + 1; j < count; j++) {
        const rj = at(bodyRadius, j);
        const dx = at(pos, j * 3) - at(pos, i * 3);
        const dy = at(pos, j * 3 + 1) - at(pos, i * 3 + 1);
        const dz = at(pos, j * 3 + 2) - at(pos, i * 3 + 2);
        const reach = ri + rj;
        if (dx * dx + dy * dy + dz * dz >= reach * reach) continue;
        if (contactCount - pairStart > PAIR_CONTACTS - PAIR_KEEP) return;
        collidePair(i, j);
      }
    }
  }

  /**
   * Sequential impulses with warm starting (Catto 2005): normal impulse clamped >= 0, box friction
   * clamped to ±μ·λn with the contact's μ; accumulated impulses are saved per slot for the next step.
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
            limit = at(contactFriction, c) * next;
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
      checkHull(body);
      shapes.push(body);
      bodyInvInertia.set(body.invInertia, i * 3);
      bodyRadius[i] = body.radius;
      vertexCount[i] = body.vertices.length / 3;
      faceCount[i] = body.planes.length / 4;
      for (const face of body.faces) faceEdges[i] = Math.max(atInt(faceEdges, i), face.length);
      let slots = slotStep.length;
      for (let j = 0; j < i; j++) {
        const e = Math.max(atInt(faceEdges, j), atInt(faceEdges, i));
        pairSlot[j * MAX_BODIES + i] = slots;
        slots += e + 2 * e * e + 1;
      }
      const lambda = new Float64Array(slots * 3);
      lambda.set(slotLambda);
      slotLambda = lambda;
      const step = new Int32Array(slots);
      step.set(slotStep);
      slotStep = step;
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
