import { getPolyhedron } from './polyhedra';
import type { Polyhedron, ShapeType } from './polyhedra';
import { add, cross, dot, length, normalize, scale, sub } from './vec';
import type { Vec3 } from './vec';

export const BEVEL = 0.08;
export const MESH_STRIDE = 9; // floats per vertex: px py pz, nx ny nz, lu lv, cell

export interface DieMesh {
  shape: ShapeType;
  data: Float32Array;
  vertexCount: number;
}

const EPS = 1e-9;
const COIN_SEGMENTS = 48;
const COIN_ROUND = 0.04;
const COIN_ARC = 4; // steps per quarter-round edge

/** Label frame on a face plane: square center, side, right and up unit vectors, readout cell. */
interface Label {
  center: Vec3;
  side: number;
  right: Vec3;
  up: Vec3;
  cell: number;
}

function at<T>(list: readonly T[], i: number): T {
  const v = list[(i + list.length) % list.length];
  if (v === undefined) throw new RangeError(`index ${i} out of range`);
  return v;
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return scale(add(a, b), 0.5);
}

function centroid(points: readonly Vec3[]): Vec3 {
  let c: Vec3 = [0, 0, 0];
  for (const p of points) c = add(c, p);
  return scale(c, 1 / points.length);
}

/** Face polygon inset in its plane by BEVEL (same vertex order as the face). */
function insetFace(poly: Polyhedron, f: number): Vec3[] {
  const face = at(poly.faces, f);
  const n = at(poly.normals, f);
  const pts = face.map((i) => at(poly.vertices, i));
  return pts.map((v, k) => {
    const m1 = cross(n, normalize(sub(v, at(pts, k - 1))));
    const m2 = cross(n, normalize(sub(at(pts, k + 1), v)));
    return add(v, scale(add(m1, m2), BEVEL / (1 + dot(m1, m2))));
  });
}

/** Minimum distance from c to the lines through consecutive polygon points. */
function inradius(c: Vec3, pts: readonly Vec3[]): number {
  let r = Infinity;
  pts.forEach((a, k) => {
    const e = normalize(sub(at(pts, k + 1), a));
    const d = sub(c, a);
    r = Math.min(r, length(sub(d, scale(e, dot(d, e)))));
  });
  return r;
}

function labelFrame(center: Vec3, side: number, upDir: Vec3, n: Vec3, cell: number): Label {
  const up = normalize(upDir);
  return { center, side, up, right: cross(up, n), cell };
}

/** Reading "up" for a full-face label: d6-like squares point at the (0, 1) edge midpoint,
 *  everything else at the farthest vertex (ties → earliest). */
function faceUp(c: Vec3, pts: readonly Vec3[]): Vec3 {
  const dist = pts.map((p) => length(sub(p, c)));
  const max = Math.max(...dist);
  const min = Math.min(...dist);
  if (pts.length === 4 && max - min <= EPS) return sub(midpoint(at(pts, 0), at(pts, 1)), c);
  const k = dist.findIndex((d) => d >= max - EPS);
  return sub(at(pts, k), c);
}

type Emit = (p: Vec3, n: Vec3, label: Label | null) => void;

/** cos and sin of k · 360° / COIN_SEGMENTS: half angles from 30° give 7.5°, then repeated
 *  rotation, so no trigonometry is needed. */
function circle(): [number, number][] {
  const c15 = Math.sqrt((1 + Math.sqrt(3) / 2) / 2);
  const c = Math.sqrt((1 + c15) / 2);
  const s = Math.sqrt((1 - c15) / 2);
  const out: [number, number][] = [];
  let p: [number, number] = [1, 0];
  for (let k = 0; k < COIN_SEGMENTS; k++) {
    out.push(p);
    p = [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  }
  return out;
}

/** Round disc swept about Y in COIN_SEGMENTS steps from angle 0: flat caps joined to the rim
 *  band by quarter-round edges of radius COIN_ROUND. */
function coin(poly: Polyhedron, emit: Emit): void {
  const [r, h] = at(poly.vertices, 0);
  const ring = circle();
  // Profile from the top cap edge to the bottom one: radial, y, normal radial, normal y.
  const profile: [number, number, number, number][] = [];
  const arcStep = COIN_SEGMENTS / 4 / COIN_ARC;
  for (let i = 0; i <= 2 * COIN_ARC + 1; i++) {
    const top = i <= COIN_ARC;
    const [c, s] = at(ring, arcStep * (top ? COIN_ARC - i : COIN_ARC + 1 - i));
    const y = (top ? 1 : -1) * (h - COIN_ROUND) + COIN_ROUND * s;
    profile.push([r - COIN_ROUND + COIN_ROUND * c, y, c, s]);
  }
  const point = (i: number, j: number): [Vec3, Vec3] => {
    const [pr, py, nr, ny] = at(profile, i);
    const [x, z] = at(ring, j);
    return [
      [pr * x, py, -pr * z],
      [nr * x, ny, -nr * z],
    ];
  };
  const up: Vec3 = [0, 1, 0];
  const down: Vec3 = [0, -1, 0];
  // Hull vertices 0 and 16, first on each cap, sit at angle 0 (+X).
  const topLabel = labelFrame([0, h, 0], 1, [1, 0, 0], up, 0);
  const bottomLabel = labelFrame([0, -h, 0], 1, [1, 0, 0], down, 1);
  const last = profile.length - 1;
  ring.forEach((_, j) => {
    emit([0, h, 0], up, topLabel);
    emit(point(0, j)[0], up, topLabel);
    emit(point(0, j + 1)[0], up, topLabel);
    emit([0, -h, 0], down, bottomLabel);
    emit(point(last, j + 1)[0], down, bottomLabel);
    emit(point(last, j)[0], down, bottomLabel);
    for (let i = 0; i < last; i++) {
      const a = point(i, j);
      const b = point(i + 1, j);
      const c = point(i + 1, j + 1);
      const d = point(i, j + 1);
      for (const [p, n] of [a, b, c, a, c, d]) emit(p, n, null);
    }
  });
}

function build(shape: ShapeType): DieMesh {
  const poly = getPolyhedron(shape);
  const out: number[] = [];
  const emit: Emit = (p, n, label) => {
    out.push(p[0], p[1], p[2], n[0], n[1], n[2]);
    if (label === null) {
      out.push(-1, -1, -1);
      return;
    }
    const d = sub(p, label.center);
    out.push(
      dot(d, label.right) / label.side + 0.5,
      dot(d, label.up) / label.side + 0.5,
      label.cell,
    );
  };
  const tri = (a: Vec3, b: Vec3, c: Vec3, n: Vec3, label: Label | null): void => {
    emit(a, n, label);
    emit(b, n, label);
    emit(c, n, label);
  };

  if (shape === 'coin') {
    coin(poly, emit);
    return { shape, data: new Float32Array(out), vertexCount: out.length / MESH_STRIDE };
  }

  const insets = poly.faces.map((_, f) => insetFace(poly, f));

  // Faces: label fans (d4: three corner quads per face).
  poly.faces.forEach((face, f) => {
    const n = at(poly.normals, f);
    const pts = at(insets, f);
    const c = centroid(pts);
    const r = inradius(c, pts);
    if (shape === 'd4') {
      pts.forEach((v, k) => {
        const next = midpoint(v, at(pts, k + 1));
        const prev = midpoint(at(pts, k - 1), v);
        // Largest glyph box (0.8 × 0.875 of the side) that fits the corner kite: k ≤ 2 / (0.8 + 0.4375 · 4/√3).
        const label = labelFrame(
          add(c, scale(sub(v, c), 0.36)),
          1.1 * r,
          sub(v, c),
          n,
          at(face, k),
        );
        tri(v, next, c, n, label);
        tri(v, c, prev, n, label);
      });
      return;
    }
    const label = labelFrame(c, 1.45 * r, faceUp(c, pts), n, f);
    pts.forEach((v, k) => tri(c, v, at(pts, k + 1), n, label));
  });

  /** Face index holding the directed edge a → b, and the position of a in it. */
  const findEdge = (a: number, b: number): [number, number] => {
    for (let g = 0; g < poly.faces.length; g++) {
      const face = at(poly.faces, g);
      const k = face.indexOf(a);
      if (k >= 0 && at(face, k + 1) === b) return [g, k];
    }
    throw new Error(`${shape} has no face with edge ${a} → ${b}`);
  };

  // Edge strips between the inset edges of the two faces sharing each hull edge.
  poly.faces.forEach((face, f) => {
    const nf = at(poly.normals, f);
    const pf = at(insets, f);
    face.forEach((a, k) => {
      const b = at(face, k + 1);
      if (a > b) return;
      const [g, j] = findEdge(b, a);
      const ng = at(poly.normals, g);
      const pg = at(insets, g);
      const aF = at(pf, k);
      const bF = at(pf, k + 1);
      const bG = at(pg, j);
      const aG = at(pg, j + 1);
      emit(aF, nf, null);
      emit(aG, ng, null);
      emit(bG, ng, null);
      emit(aF, nf, null);
      emit(bG, ng, null);
      emit(bF, nf, null);
    });
  });

  // Corner caps: walk the faces around each hull vertex counter-clockwise from outside.
  poly.vertices.forEach((_, v) => {
    const start = poly.faces.findIndex((face) => face.includes(v));
    const ring: [Vec3, Vec3][] = [];
    let f = start;
    do {
      const face = at(poly.faces, f);
      const k = face.indexOf(v);
      ring.push([at(at(insets, f), k), at(poly.normals, f)]);
      f = findEdge(v, at(face, k - 1))[0];
    } while (f !== start && ring.length <= poly.faces.length);
    const [p0, n0] = at(ring, 0);
    for (let i = 1; i + 1 < ring.length; i++) {
      const [p1, n1] = at(ring, i);
      const [p2, n2] = at(ring, i + 1);
      emit(p0, n0, null);
      emit(p1, n1, null);
      emit(p2, n2, null);
    }
  });

  return { shape, data: new Float32Array(out), vertexCount: out.length / MESH_STRIDE };
}

const cache: Partial<Record<ShapeType, DieMesh>> = {};

/** Non-indexed triangle list, CCW from outside, cached per shape. */
export function getDieMesh(shape: ShapeType): DieMesh {
  let mesh = cache[shape];
  if (mesh === undefined) {
    mesh = build(shape);
    cache[shape] = mesh;
  }
  return mesh;
}
